import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Client } from "pg";

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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(missingDatabaseUrlMessage);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });
  let connected = false;

  try {
    await client.connect();
    connected = true;

    const inspectedSchemas = await resolveInspectedSchemas(client);

    const objectsResult = await client.query<DbObject>(
      `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = ANY($1)
          AND table_type IN ('BASE TABLE', 'VIEW')
        UNION ALL
        SELECT schemaname AS table_schema, matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type
        FROM pg_matviews
        WHERE schemaname = ANY($1)
        ORDER BY
          table_schema,
          table_name
      `,
      [inspectedSchemas],
    );

    const columnsResult = await client.query<Column>(
      `
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name, c.ordinal_position
        FROM information_schema.columns AS c
        JOIN (
          SELECT table_schema, table_name
          FROM information_schema.tables
          WHERE table_schema = ANY($1)
            AND table_type IN ('BASE TABLE', 'VIEW')
          UNION
          SELECT schemaname AS table_schema, matviewname AS table_name
          FROM pg_matviews
          WHERE schemaname = ANY($1)
        ) AS t
          ON t.table_schema = c.table_schema
          AND t.table_name = c.table_name
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `,
      [inspectedSchemas],
    );

    const primaryKeysResult = await client.query<KeyColumn>(
      `
        SELECT tc.table_schema, tc.table_name, kcu.column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON kcu.constraint_schema = tc.constraint_schema
          AND kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND kcu.table_name = tc.table_name
        WHERE tc.table_schema = ANY($1)
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
      `,
      [inspectedSchemas],
    );

    const foreignKeysResult = await client.query<ForeignKey>(
      `
        SELECT
          tc.constraint_schema,
          tc.constraint_name,
          tc.table_schema,
          tc.table_name,
          kcu.column_name,
          ccu.table_schema AS foreign_table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON kcu.constraint_schema = tc.constraint_schema
          AND kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND kcu.table_name = tc.table_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_schema = tc.constraint_schema
          AND ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND (
            tc.table_schema = ANY($1)
            OR ccu.table_schema = ANY($1)
          )
        ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
      `,
      [inspectedSchemas],
    );

    const functionsResult = await client.query<DbFunction>(
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
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1)
          AND p.prokind IN ('f', 'p', 'a', 'w')
        ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
      `,
      [inspectedSchemas],
    );

    const enumsResult = await client.query<{ schema_name: string; enum_name: string; enum_labels: string[] }>(
      `
        SELECT
          n.nspname AS schema_name,
          t.typname AS enum_name,
          array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_labels
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        JOIN pg_enum AS e ON e.enumtypid = t.oid
        WHERE n.nspname = ANY($1)
          AND t.typtype = 'e'
        GROUP BY n.nspname, t.typname
        ORDER BY n.nspname, t.typname
      `,
      [inspectedSchemas],
    );

    const objects = objectsResult.rows;
    const columns = columnsResult.rows;
    const primaryKeys = primaryKeysResult.rows;
    const foreignKeys = foreignKeysResult.rows;
    const functions = functionsResult.rows;
    const enums = enumsResult.rows.map((row) => ({
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
      throw new Error(connectionFailureMessage);
    }

    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
