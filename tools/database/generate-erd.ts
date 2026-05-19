import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Client } from "pg";

const defaultInspectedSchemas = ["ref", "core", "tiles", "app_auth"];
const missingDatabaseUrlMessage = "Missing DATABASE_URL. Add it to root .env.";
const connectionFailureMessage = "Failed to connect to database. Check DATABASE_URL.";

type DbObject = {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
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

const inspectedSchemas = parseSchemaList(process.env.ERD_SCHEMAS, defaultInspectedSchemas);
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

function shouldUseSsl(connectionString: string): boolean {
  try {
    const databaseUrl = new URL(connectionString);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    return !localHosts.has(databaseUrl.hostname) && databaseUrl.searchParams.get("sslmode") !== "disable";
  } catch {
    return true;
  }
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

function renderEntity(object: DbObject, columns: Column[], primaryKeys: Set<string>, foreignKeys: Set<string>): string[] {
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

function renderMermaid(
  objects: DbObject[],
  columns: Column[],
  primaryKeys: KeyColumn[],
  foreignKeys: ForeignKey[],
): string {
  const columnsByObject = new Map<string, Column[]>();
  const primaryKeySet = new Set(primaryKeys.map((key) => keyFor(key.table_schema, key.table_name, key.column_name)));
  const foreignKeySet = new Set(foreignKeys.map((key) => keyFor(key.table_schema, key.table_name, key.column_name)));
  const tables = objects.filter((object) => object.table_type === "BASE TABLE");
  const views = objects.filter((object) => object.table_type === "VIEW");
  const lines = ["erDiagram"];

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
    lines.push(...renderEntity(table, columnsByObject.get(keyFor(table.table_schema, table.table_name)) ?? [], primaryKeySet, foreignKeySet));
  }

  lines.push("  %% VIEWS");

  for (const view of views) {
    lines.push(...renderEntity(view, columnsByObject.get(keyFor(view.table_schema, view.table_name)) ?? [], primaryKeySet, foreignKeySet));
  }

  for (const relationship of groupRelationships(foreignKeys)) {
    const target = entityName(relationship.targetSchema, relationship.targetTable);
    const source = entityName(relationship.sourceSchema, relationship.sourceTable);
    const label = relationship.sourceColumns.join("_");
    lines.push(`  ${target} ||--o{ ${source} : "${label}"`);
  }

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

    const objectsResult = await client.query<DbObject>(
      `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = ANY($1)
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY
          CASE table_type WHEN 'BASE TABLE' THEN 0 ELSE 1 END,
          table_schema,
          table_name
      `,
      [inspectedSchemas],
    );

    const columnsResult = await client.query<Column>(
      `
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name, c.ordinal_position
        FROM information_schema.columns AS c
        JOIN information_schema.tables AS t
          ON t.table_schema = c.table_schema
          AND t.table_name = c.table_name
        WHERE c.table_schema = ANY($1)
          AND t.table_type IN ('BASE TABLE', 'VIEW')
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
        WHERE tc.table_schema = ANY($1)
          AND ccu.table_schema = ANY($1)
          AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
      `,
      [inspectedSchemas],
    );

    const objects = objectsResult.rows;
    const columns = columnsResult.rows;
    const primaryKeys = primaryKeysResult.rows;
    const foreignKeys = foreignKeysResult.rows;
    const tableCount = objects.filter((object) => object.table_type === "BASE TABLE").length;
    const viewCount = objects.filter((object) => object.table_type === "VIEW").length;
    const relationships = groupRelationships(foreignKeys);
    const mermaid = renderMermaid(objects, columns, primaryKeys, foreignKeys);
    const body = mermaidFileOnly
      ? `${mermaid}\n`
      : `# Current Database ERD

Generated from: ${erdSourceLabel}

Generated at: ${new Date().toISOString()}

\`\`\`mermaid
${mermaid}
\`\`\`
`;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, body, "utf8");

    console.log(`inspected schemas: ${inspectedSchemas.join(", ")}`);
    console.log(`table count: ${tableCount}`);
    console.log(`view count: ${viewCount}`);
    console.log(`column count: ${columns.length}`);
    console.log(`relationship count: ${relationships.length}`);
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
