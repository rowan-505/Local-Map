import dns from "node:dns";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Client } from "pg";

// Node 17+ looks up AAAA first. macOS often returns NAT64 IPv6 for the
// Supabase pooler; those sockets can drop during SSL with
// "Connection terminated unexpectedly". Prefer IPv4.
dns.setDefaultResultOrder("ipv4first");

const defaultInspectedSchemas = [
  "ref",
  "core",
  "tiles",
  "app_auth",
  "routing",
  "transport",
  "transit_export",
  "import_review",
];
const missingDatabaseUrlMessage = "Missing DATABASE_URL. Add it to root .env.";
const connectionFailureMessage = "Failed to connect to database. Check DATABASE_URL.";
const connectRetryCount = 3;
const connectRetryDelayMs = 750;
const connectionTimeoutMillis = 20_000;

type DbObject = {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW" | "MATERIALIZED VIEW";
};

type Column = {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  ordinal_position: number;
};

type KeyColumn = {
  table_schema: string;
  table_name: string;
  column_name: string;
};

type ForeignKey = {
  constraint_schema: string;
  constraint_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

type DbFunction = {
  schema_name: string;
  function_name: string;
  arguments: string;
  return_type: string;
  kind: string;
};

type DbEnum = {
  schema_name: string;
  enum_name: string;
  enum_labels: string[];
};

function normalizePgTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return trimmed ? [trimmed] : [];
  }

  const inner = trimmed.slice(1, -1);
  if (!inner) {
    return [];
  }

  return inner.split(",").map((part) => part.trim().replace(/^"(.*)"$/, "$1"));
}

type Relationship = {
  constraintKey: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
};

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

function parseSchemaList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) {
    return fallback;
  }

  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

function usesAllSchemasMode(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "all" || value === "*" || value === "__all__";
}

const outputPath = process.env.ERD_OUTPUT_PATH?.trim()
  ? path.resolve(repoRoot, process.env.ERD_OUTPUT_PATH.trim())
  : path.join(repoRoot, "docs/database/current-erd.md");
const erdSourceLabel = process.env.ERD_SOURCE_LABEL?.trim() || "configured DATABASE_URL";
const mermaidFileOnly = outputPath.endsWith(".mmd");

function entityName(schema: string, name: string): string {
  return `${schema}_${name}`.replace(/[^A-Za-z0-9_]/g, "_");
}

function mermaidType(column: Column): string {
  const rawType =
    column.data_type === "USER-DEFINED"
      ? column.udt_name
      : column.data_type === "ARRAY"
        ? `${column.udt_name.replace(/^_/, "")}[]`
        : column.data_type;

  return rawType.toLowerCase().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_[\]]/g, "_");
}

function mermaidFieldName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function keyFor(schema: string, table: string, column?: string): string {
  return column ? `${schema}.${table}.${column}` : `${schema}.${table}`;
}

function sanitizeMermaidComment(value: string): string {
  return value.replace(/[\r\n"]/g, " ").trim();
}

function shouldUseSsl(connectionString: string): boolean {
  try {
    const databaseUrl = new URL(connectionString);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    return !localHosts.has(databaseUrl.hostname) && databaseUrl.searchParams.get("sslmode") !== "disable";
  } catch {
    return true;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDatabaseClient(connectionString: string): Client {
  const client = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis,
    application_name: "coremap-generate-erd",
  });

  // node-postgres emits 'error' on unexpected disconnect. Without a listener,
  // Node crashes with "Unhandled 'error' event".
  client.on("error", () => {});

  return client;
}

async function closeDatabaseClient(client: Client | undefined): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.end();
  } catch {
    // Ignore close errors after a dropped connection.
  }
}

async function connectDatabase(connectionString: string): Promise<Client> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= connectRetryCount; attempt++) {
    const client = createDatabaseClient(connectionString);

    try {
      await client.connect();
      await client.query("SET statement_timeout = 0");
      await client.query("SET idle_in_transaction_session_timeout = 0");
      return client;
    } catch (error) {
      lastError = error;
      await closeDatabaseClient(client);

      if (attempt < connectRetryCount) {
        await sleep(connectRetryDelayMs * attempt);
      }
    }
  }

  throw new Error(`${connectionFailureMessage} (${errorMessage(lastError)})`);
}

function isDisconnectError(error: unknown): boolean {
  return /connection terminated|connection error|ECONNRESET|EPIPE/i.test(errorMessage(error));
}

async function discoverUserSchemas(client: Client): Promise<string[]> {
  const result = await client.query<{ nspname: string }>(
    `
      SELECT nspname
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND nspname <> 'information_schema'
      ORDER BY nspname
    `,
  );

  return result.rows.map((row) => row.nspname);
}

async function resolveInspectedSchemas(client: Client): Promise<string[]> {
  const raw = process.env.ERD_SCHEMAS;
  if (usesAllSchemasMode(raw)) {
    return discoverUserSchemas(client);
  }

  return parseSchemaList(raw, defaultInspectedSchemas);
}

function groupRelationships(foreignKeys: ForeignKey[]): Relationship[] {
  const relationships = new Map<string, Relationship>();

  for (const foreignKey of foreignKeys) {
    const constraintKey = `${foreignKey.constraint_schema}.${foreignKey.constraint_name}.${foreignKey.table_schema}.${foreignKey.table_name}`;
    const existing = relationships.get(constraintKey);

    if (existing) {
      if (!existing.sourceColumns.includes(foreignKey.column_name)) {
        existing.sourceColumns.push(foreignKey.column_name);
      }

      if (!existing.targetColumns.includes(foreignKey.foreign_column_name)) {
        existing.targetColumns.push(foreignKey.foreign_column_name);
      }

      continue;
    }

    relationships.set(constraintKey, {
      constraintKey,
      sourceSchema: foreignKey.table_schema,
      sourceTable: foreignKey.table_name,
      sourceColumns: [foreignKey.column_name],
      targetSchema: foreignKey.foreign_table_schema,
      targetTable: foreignKey.foreign_table_name,
      targetColumns: [foreignKey.foreign_column_name],
    });
  }

  return Array.from(relationships.values()).sort((a, b) => a.constraintKey.localeCompare(b.constraintKey));
}

function renderEntity(
  object: DbObject,
  columns: Column[],
  primaryKeys: Set<string>,
  foreignKeys: Set<string>,
): string[] {
  const lines = [`  ${entityName(object.table_schema, object.table_name)} {`];

  for (const column of columns) {
    const tags: string[] = [];
    const columnKey = keyFor(column.table_schema, column.table_name, column.column_name);

    if (primaryKeys.has(columnKey)) {
      tags.push("PK");
    }

    if (foreignKeys.has(columnKey)) {
      tags.push("FK");
    }

    const suffix = tags.length > 0 ? ` ${tags.join(", ")}` : "";
    lines.push(`    ${mermaidType(column)} ${mermaidFieldName(column.column_name)}${suffix}`);
  }

  lines.push("  }");
  return lines;
}

function renderFunctionComments(functions: DbFunction[]): string[] {
  if (functions.length === 0) {
    return [];
  }

  const lines = ["  %% FUNCTIONS"];
  let currentSchema = "";

  for (const fn of functions) {
    if (fn.schema_name !== currentSchema) {
      currentSchema = fn.schema_name;
      lines.push(`  %% [${currentSchema}]`);
    }

    const args = fn.arguments ? fn.arguments : "";
    const signature = `${fn.function_name}(${args}) -> ${fn.return_type}`;
    lines.push(`  %% ${sanitizeMermaidComment(`${fn.kind}: ${signature}`)}`);
  }

  return lines;
}

function renderEnumComments(enums: DbEnum[]): string[] {
  if (enums.length === 0) {
    return [];
  }

  const lines = ["  %% ENUM TYPES"];
  for (const enumType of enums) {
    const labels = enumType.enum_labels.join(", ");
    lines.push(
      `  %% ${sanitizeMermaidComment(`${enumType.schema_name}.${enumType.enum_name} { ${labels} }`)}`,
    );
  }

  return lines;
}

function renderMermaid(
  inspectedSchemas: string[],
  objects: DbObject[],
  columns: Column[],
  primaryKeys: KeyColumn[],
  foreignKeys: ForeignKey[],
  functions: DbFunction[],
  enums: DbEnum[],
): string {
  const columnsByObject = new Map<string, Column[]>();
  const objectKeys = new Set(objects.map((object) => keyFor(object.table_schema, object.table_name)));
  const primaryKeySet = new Set(primaryKeys.map((key) => keyFor(key.table_schema, key.table_name, key.column_name)));
  const foreignKeySet = new Set(foreignKeys.map((key) => keyFor(key.table_schema, key.table_name, key.column_name)));
  const tables = objects.filter((object) => object.table_type === "BASE TABLE");
  const views = objects.filter(
    (object) => object.table_type === "VIEW" || object.table_type === "MATERIALIZED VIEW",
  );
  const lines = [
    "erDiagram",
    `  %% Inspected schemas (${inspectedSchemas.length}): ${inspectedSchemas.join(", ")}`,
  ];

  for (const column of columns) {
    const objectKey = keyFor(column.table_schema, column.table_name);
    const objectColumns = columnsByObject.get(objectKey) ?? [];
    objectColumns.push(column);
    columnsByObject.set(objectKey, objectColumns);
  }

  for (const objectColumns of columnsByObject.values()) {
    objectColumns.sort((a, b) => a.ordinal_position - b.ordinal_position);
  }

  for (const table of tables) {
    lines.push(
      ...renderEntity(
        table,
        columnsByObject.get(keyFor(table.table_schema, table.table_name)) ?? [],
        primaryKeySet,
        foreignKeySet,
      ),
    );
  }

  if (views.length > 0) {
    lines.push("  %% VIEWS");
    for (const view of views) {
      lines.push(
        ...renderEntity(
          view,
          columnsByObject.get(keyFor(view.table_schema, view.table_name)) ?? [],
          primaryKeySet,
          foreignKeySet,
        ),
      );
    }
  }

  lines.push("  %% RELATIONSHIPS");
  for (const relationship of groupRelationships(foreignKeys)) {
    const sourceKey = keyFor(relationship.sourceSchema, relationship.sourceTable);
    const targetKey = keyFor(relationship.targetSchema, relationship.targetTable);
    if (!objectKeys.has(sourceKey) || !objectKeys.has(targetKey)) {
      continue;
    }

    const target = entityName(relationship.targetSchema, relationship.targetTable);
    const source = entityName(relationship.sourceSchema, relationship.sourceTable);
    const label = sanitizeMermaidComment(relationship.sourceColumns.join("_"));
    lines.push(`  ${target} ||--o{ ${source} : "${label}"`);
  }

  lines.push(...renderEnumComments(enums));
  lines.push(...renderFunctionComments(functions));

  return lines.join("\n");
}

async function loadCatalog(client: Client, inspectedSchemas: string[]): Promise<{
  objects: DbObject[];
  columns: Column[];
  primaryKeys: KeyColumn[];
  foreignKeys: ForeignKey[];
  functions: DbFunction[];
  enums: Array<{ schema_name: string; enum_name: string; enum_labels: string[] }>;
}> {
  const objects: DbObject[] = [];
  const columns: Column[] = [];
  const primaryKeys: KeyColumn[] = [];
  const foreignKeys: ForeignKey[] = [];
  const functions: DbFunction[] = [];
  const enums: Array<{ schema_name: string; enum_name: string; enum_labels: string[] }> = [];

  // Query one schema at a time so each statement finishes before the pooler
  // idle-kills a long catalog scan, and so pg starts from pg_namespace.
  for (const schema of inspectedSchemas) {
    const params = [schema];
    process.stdout.write(`${schema}... `);
    const started = Date.now();

    objects.push(
      ...(
        await client.query<DbObject>(
          `
            SELECT
              n.nspname AS table_schema,
              c.relname AS table_name,
              CASE c.relkind
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                ELSE 'BASE TABLE'
              END AS table_type
            FROM pg_namespace AS n
            JOIN pg_class AS c ON c.relnamespace = n.oid
            WHERE n.nspname = $1
              AND c.relkind IN ('r', 'p', 'v', 'm')
              AND NOT c.relispartition
            ORDER BY c.relname
          `,
          params,
        )
      ).rows,
    );

    columns.push(
      ...(
        await client.query<Column>(
          `
            SELECT
              n.nspname AS table_schema,
              c.relname AS table_name,
              a.attname AS column_name,
              CASE
                WHEN t.typcategory = 'A' THEN 'ARRAY'
                WHEN t.typtype IN ('e', 'd') OR tn.nspname NOT IN ('pg_catalog', 'information_schema') THEN 'USER-DEFINED'
                ELSE format_type(a.atttypid, NULL)
              END AS data_type,
              t.typname AS udt_name,
              a.attnum AS ordinal_position
            FROM pg_namespace AS n
            JOIN pg_class AS c ON c.relnamespace = n.oid
            JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            JOIN pg_type AS t ON t.oid = a.atttypid
            JOIN pg_namespace AS tn ON tn.oid = t.typnamespace
            WHERE n.nspname = $1
              AND c.relkind IN ('r', 'p', 'v', 'm')
              AND NOT c.relispartition
            ORDER BY c.relname, a.attnum
          `,
          params,
        )
      ).rows,
    );

    primaryKeys.push(
      ...(
        await client.query<KeyColumn>(
          `
            SELECT
              n.nspname AS table_schema,
              c.relname AS table_name,
              a.attname AS column_name
            FROM pg_namespace AS n
            JOIN pg_class AS c ON c.relnamespace = n.oid
            JOIN pg_index AS i ON i.indrelid = c.oid AND i.indisprimary
            JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinal_position) ON true
            JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attnum = k.attnum
            WHERE n.nspname = $1
              AND NOT c.relispartition
            ORDER BY c.relname, k.ordinal_position
          `,
          params,
        )
      ).rows,
    );

    foreignKeys.push(
      ...(
        await client.query<ForeignKey>(
          `
            SELECT
              n.nspname AS constraint_schema,
              con.conname AS constraint_name,
              n.nspname AS table_schema,
              rel.relname AS table_name,
              att.attname AS column_name,
              fn.nspname AS foreign_table_schema,
              frel.relname AS foreign_table_name,
              fatt.attname AS foreign_column_name
            FROM pg_namespace AS n
            JOIN pg_class AS rel ON rel.relnamespace = n.oid
            JOIN pg_constraint AS con ON con.conrelid = rel.oid AND con.contype = 'f'
            JOIN pg_class AS frel ON frel.oid = con.confrelid
            JOIN pg_namespace AS fn ON fn.oid = frel.relnamespace
            JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src(attnum, ordinal_position) ON true
            JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS dst(attnum, ordinal_position)
              ON dst.ordinal_position = src.ordinal_position
            JOIN pg_attribute AS att ON att.attrelid = rel.oid AND att.attnum = src.attnum
            JOIN pg_attribute AS fatt ON fatt.attrelid = frel.oid AND fatt.attnum = dst.attnum
            WHERE n.nspname = $1
              AND NOT rel.relispartition
            ORDER BY rel.relname, con.conname, src.ordinal_position
          `,
          params,
        )
      ).rows,
    );

    functions.push(
      ...(
        await client.query<DbFunction>(
          `
            SELECT
              n.nspname AS schema_name,
              p.proname AS function_name,
              pg_get_function_identity_arguments(p.oid) AS arguments,
              pg_catalog.format_type(p.prorettype, NULL) AS return_type,
              CASE p.prokind
                WHEN 'f' THEN 'function'
                WHEN 'p' THEN 'procedure'
                WHEN 'a' THEN 'aggregate'
                WHEN 'w' THEN 'window'
                ELSE p.prokind::text
              END AS kind
            FROM pg_namespace AS n
            JOIN pg_proc AS p ON p.pronamespace = n.oid
            JOIN pg_language AS l ON l.oid = p.prolang
            WHERE n.nspname = $1
              AND p.prokind IN ('f', 'p', 'a', 'w')
              AND l.lanname IN ('sql', 'plpgsql')
            ORDER BY p.proname, p.oid
          `,
          params,
        )
      ).rows,
    );

    enums.push(
      ...(
        await client.query<{ schema_name: string; enum_name: string; enum_labels: string[] }>(
          `
            SELECT
              n.nspname AS schema_name,
              t.typname AS enum_name,
              array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_labels
            FROM pg_namespace AS n
            JOIN pg_type AS t ON t.typnamespace = n.oid AND t.typtype = 'e'
            JOIN pg_enum AS e ON e.enumtypid = t.oid
            WHERE n.nspname = $1
            GROUP BY n.nspname, t.typname
            ORDER BY t.typname
          `,
          params,
        )
      ).rows,
    );

    console.log(`${Date.now() - started}ms`);
  }

  return { objects, columns, primaryKeys, foreignKeys, functions, enums };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(missingDatabaseUrlMessage);
  }

  const connectionString = process.env.DATABASE_URL;
  let client: Client | undefined;
  let connected = false;

  try {
    client = await connectDatabase(connectionString);
    connected = true;

    const inspectedSchemas = await resolveInspectedSchemas(client);
    console.log(`connected. inspecting ${inspectedSchemas.length} schemas`);

    let catalog;
    try {
      catalog = await loadCatalog(client, inspectedSchemas);
    } catch (error) {
      if (!isDisconnectError(error)) {
        throw error;
      }

      console.log(`catalog query dropped (${errorMessage(error)}); reconnecting...`);
      await closeDatabaseClient(client);
      connected = false;
      client = await connectDatabase(connectionString);
      connected = true;
      catalog = await loadCatalog(client, inspectedSchemas);
    }

    const objects = catalog.objects;
    const columns = catalog.columns;
    const primaryKeys = catalog.primaryKeys;
    const foreignKeys = catalog.foreignKeys;
    const functions = catalog.functions;
    const enums = catalog.enums.map((row) => ({
      schema_name: row.schema_name,
      enum_name: row.enum_name,
      enum_labels: normalizePgTextArray(row.enum_labels),
    }));
    const tableCount = objects.filter((object) => object.table_type === "BASE TABLE").length;
    const viewCount = objects.filter(
      (object) => object.table_type === "VIEW" || object.table_type === "MATERIALIZED VIEW",
    ).length;
    const relationships = groupRelationships(foreignKeys);
    const mermaid = renderMermaid(inspectedSchemas, objects, columns, primaryKeys, foreignKeys, functions, enums);
    const body = mermaidFileOnly
      ? `${mermaid}\n`
      : `# Current Database ERD

Generated from: ${erdSourceLabel}

Generated at: ${new Date().toISOString()}

Inspected schemas (${inspectedSchemas.length}): ${inspectedSchemas.join(", ")}

\`\`\`mermaid
${mermaid}
\`\`\`
`;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, body, "utf8");

    console.log(`schema mode: ${usesAllSchemasMode(process.env.ERD_SCHEMAS) ? "all user schemas" : "explicit list"}`);
    console.log(`inspected schemas: ${inspectedSchemas.join(", ")}`);
    console.log(`table count: ${tableCount}`);
    console.log(`view count: ${viewCount}`);
    console.log(`column count: ${columns.length}`);
    console.log(`relationship count: ${relationships.length}`);
    console.log(`function count: ${functions.length}`);
    console.log(`enum type count: ${enums.length}`);
    console.log(`output path: ${path.relative(repoRoot, outputPath)}`);
  } catch (error) {
    if (!connected) {
      throw error instanceof Error ? error : new Error(connectionFailureMessage);
    }

    throw error;
  } finally {
    await closeDatabaseClient(client);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
