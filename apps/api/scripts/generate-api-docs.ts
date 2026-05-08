/**
 * Generates docs/API.md from the same OpenAPI document Fastify serves at /openapi.json.
 * Run: npm run docs:api
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../src/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HTTP_METHODS = ["get", "post", "patch", "put", "delete", "head", "options"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const METHOD_ORDER: Record<string, number> = {
    get: 0,
    post: 1,
    patch: 2,
    put: 3,
    delete: 4,
    head: 5,
    options: 6,
};

/** Limits keep Markdown readable; full schemas remain in OpenAPI / openapi.json. */
const MAX_SCHEMA_DEPTH = 6;
const MAX_OBJECT_KEYS = 28;
const ARRAY_SAMPLE_LENGTH = 1;

type Jsonish = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface OasDoc {
    openapi?: string;
    info?: { title?: string; description?: string; version?: string };
    servers?: { url: string; description?: string }[];
    tags?: { name: string; description?: string }[];
    paths?: Record<string, Record<string, unknown>>;
    components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveRef(root: OasDoc, ref: string): unknown {
    if (!ref.startsWith("#/")) {
        return undefined;
    }
    const parts = ref.slice(2).split("/");
    let cur: unknown = root;
    for (const p of parts) {
        if (!isRecord(cur)) return undefined;
        cur = cur[p];
    }
    return cur;
}

function exampleFromSchema(schema: unknown, root: OasDoc, depth: number): Jsonish {
    if (schema === undefined || schema === null) {
        return null;
    }
    if (!isRecord(schema)) {
        return null;
    }
    if (depth > MAX_SCHEMA_DEPTH) {
        return "(…)";
    }
    if (typeof schema.$ref === "string") {
        const resolved = resolveRef(root, schema.$ref);
        return exampleFromSchema(resolved, root, depth + 1);
    }
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        const merged: Record<string, unknown> = {};
        for (const part of schema.allOf) {
            const ex = exampleFromSchema(part, root, depth + 1);
            if (isRecord(ex)) {
                Object.assign(merged, ex);
            }
        }
        return merged;
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        return exampleFromSchema(schema.oneOf[0], root, depth + 1);
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        return exampleFromSchema(schema.anyOf[0], root, depth + 1);
    }
    if ("example" in schema && schema.example !== undefined) {
        return schema.example as Jsonish;
    }
    if ("const" in schema) {
        return schema.const as Jsonish;
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[0] as Jsonish;
    }

    const types: string[] = Array.isArray(schema.type)
        ? (schema.type as string[])
        : schema.type
          ? [schema.type as string]
          : schema.properties
            ? ["object"]
            : [];

    const nullable = schema.nullable === true;
    if (types.includes("null") || (types.length === 0 && nullable)) {
        return null;
    }

    // Infer type from properties / items
    let t = types[0];
    if (!t && isRecord(schema.items)) t = "array";
    if (!t && isRecord(schema.properties)) t = "object";

    switch (t) {
        case "string": {
            const fmt = schema.format as string | undefined;
            if (fmt === "uuid") return "00000000-0000-4000-8000-000000000000";
            if (fmt === "email") return "user@example.com";
            if (fmt === "date-time") return "2026-01-01T00:00:00.000Z";
            return "string";
        }
        case "integer":
            return 0;
        case "number":
            return 0;
        case "boolean":
            return false;
        case "array": {
            const items = schema.items;
            const sample: Jsonish[] = [];
            for (let i = 0; i < ARRAY_SAMPLE_LENGTH; i++) {
                sample.push(exampleFromSchema(items, root, depth + 1));
            }
            return sample;
        }
        case "object": {
            const out: Record<string, Jsonish> = {};
            const props = isRecord(schema.properties) ? schema.properties : {};
            const required: string[] = Array.isArray(schema.required) ? (schema.required as string[]) : [];
            const keys = Object.keys(props);
            const ordered = [...required, ...keys.filter((k) => !required.includes(k))];
            let count = 0;
            for (const key of ordered) {
                if (count >= MAX_OBJECT_KEYS) {
                    out["…"] = "(more fields — see OpenAPI spec)";
                    break;
                }
                out[key] = exampleFromSchema(props[key], root, depth + 1);
                count++;
            }
            return out;
        }
        default:
            return null;
    }
}

function pickJsonContentMediaEntry(content: unknown): { media: string; schema: unknown } | undefined {
    if (!isRecord(content)) return undefined;
    const jsonTypes = ["application/json", "application/problem+json"]; // prefer json
    for (const mt of jsonTypes) {
        if (content[mt] && isRecord(content[mt]) && "schema" in content[mt]) {
            return { media: mt, schema: (content[mt] as { schema: unknown }).schema };
        }
    }
    for (const [media, body] of Object.entries(content)) {
        if (isRecord(body) && "schema" in body) {
            return { media, schema: (body as { schema: unknown }).schema };
        }
    }
    return undefined;
}

function formatParamLocation(inLoc: string): string {
    if (inLoc === "path") return "Path";
    if (inLoc === "query") return "Query";
    if (inLoc === "header") return "Header";
    return inLoc;
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function mdTable(headers: string[], rows: string[][]): string {
    const h = `| ${headers.join(" | ")} |\n`;
    const sep = `| ${headers.map(() => "---").join(" | ")} |\n`;
    const b = rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |\n`).join("");
    return h + sep + b;
}

interface OperationEntry {
    method: HttpMethod;
    path: string;
    op: Record<string, unknown>;
    mergedParams: unknown[];
}

function collectOperations(spec: OasDoc): OperationEntry[] {
    const out: OperationEntry[] = [];
    const paths = spec.paths ?? {};
    for (const [path, pathItem] of Object.entries(paths)) {
        if (!isRecord(pathItem)) continue;
        const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
        for (const method of HTTP_METHODS) {
            const op = pathItem[method];
            if (!isRecord(op)) continue;
            const opParams = Array.isArray(op.parameters) ? op.parameters : [];
            out.push({
                method,
                path,
                op,
                mergedParams: [...pathLevelParams, ...opParams],
            });
        }
    }
    return out;
}

function primaryTag(op: Record<string, unknown>): string {
    const tags = op.tags;
    if (Array.isArray(tags) && tags.length > 0 && typeof tags[0] === "string") {
        return tags[0];
    }
    return "Other";
}

function tagSortIndex(tagName: string, spec: OasDoc): number {
    const tags = spec.tags ?? [];
    const idx = tags.findIndex((t) => t.name === tagName);
    return idx === -1 ? 1000 : idx;
}

function collectErrorTemplates(spec: OasDoc): Map<string, unknown> {
    const templates = new Map<string, unknown>();
    for (const entry of collectOperations(spec)) {
        const responses = entry.op.responses;
        if (!isRecord(responses)) continue;
        for (const [code, resp] of Object.entries(responses)) {
            const n = Number(code);
            if (Number.isNaN(n) || n < 400) continue;
            if (templates.has(code)) continue;
            if (!isRecord(resp)) continue;
            const picked = pickJsonContentMediaEntry(resp.content);
            if (picked?.schema) {
                templates.set(code, picked.schema);
            }
        }
    }
    return templates;
}

function generateMarkdown(spec: OasDoc): string {
    const lines: string[] = [];
    const title = spec.info?.title ?? "API";
    const version = spec.info?.version ?? "";
    const when = new Date().toISOString();

    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`> **Generated:** ${when} (UTC)  `);
    lines.push(
        `> **OpenAPI:** This file is produced from \`buildApp().swagger()\` in \`scripts/generate-api-docs.ts\` — the same JSON as \`GET /openapi.json\` when the server is running.`
    );
    lines.push("");

    lines.push("## Base URLs");
    lines.push("");
    if (spec.servers && spec.servers.length > 0) {
        const rows = spec.servers.map((s) => [s.description ?? s.url, `\`${s.url}\``]);
        lines.push(mdTable(["Description", "URL"], rows));
    } else {
        lines.push("*(No `servers` entry in OpenAPI.)*");
    }
    lines.push("");
    lines.push(
        "| Environment | Typical base | Notes |\n|---|---|---|\n| Local development | `http://localhost:3001` | Default `PORT` in `server.ts` is **3001** unless `PORT` is set. |\n| Deployed | Set `PUBLIC_API_URL` | Configures the OpenAPI `servers` entry used by Swagger UI (`/` means same origin). |\n"
    );

    lines.push("## Authentication");
    lines.push("");
    if (spec.info?.description) {
        lines.push(spec.info.description);
        lines.push("");
    }
    const schemes = spec.components?.securitySchemes;
    if (schemes && isRecord(schemes.bearerAuth)) {
        const b = schemes.bearerAuth as Record<string, unknown>;
        lines.push("### Bearer JWT (`bearerAuth`)");
        lines.push("");
        if (typeof b.description === "string") {
            lines.push(b.description);
            lines.push("");
        }
        lines.push("Send the header: `Authorization: Bearer <accessToken>`");
        lines.push("");
    }

    const operations = collectOperations(spec);
    const byTag = new Map<string, OperationEntry[]>();
    for (const entry of operations) {
        const tag = primaryTag(entry.op);
        const list = byTag.get(tag) ?? [];
        list.push(entry);
        byTag.set(tag, list);
    }

    const tagNames = [...byTag.keys()].sort((a, b) => {
        const da = tagSortIndex(a, spec);
        const db = tagSortIndex(b, spec);
        if (da !== db) return da - db;
        return a.localeCompare(b);
    });

    for (const tag of tagNames) {
        const list = byTag.get(tag)!;
        list.sort((a, b) => {
            if (a.path !== b.path) return a.path.localeCompare(b.path);
            return (METHOD_ORDER[a.method] ?? 99) - (METHOD_ORDER[b.method] ?? 99);
        });
    }

    lines.push("## Endpoints by tag");
    lines.push("");
    for (const tag of tagNames) {
        const desc = spec.tags?.find((t) => t.name === tag)?.description;
        lines.push(`### ${tag}`);
        lines.push("");
        if (desc) {
            lines.push(desc);
            lines.push("");
        }
        for (const { method, path, op, mergedParams } of byTag.get(tag)!) {
            const m = method.toUpperCase();
            lines.push(`#### \`${m}\` \`${path}\``);
            lines.push("");
            if (typeof op.summary === "string" && op.summary.length > 0) {
                lines.push(`**Summary:** ${op.summary}`);
                lines.push("");
            }
            if (typeof op.description === "string" && op.description.trim().length > 0) {
                lines.push(op.description.trim());
                lines.push("");
            }

            const security = op.security;
            const hasBearer =
                Array.isArray(security) &&
                security.some((s) => isRecord(s) && Object.keys(s).includes("bearerAuth"));
            lines.push(hasBearer ? "**Security:** Bearer JWT (`Authorization: Bearer …`)" : "**Security:** None");
            lines.push("");

            if (mergedParams.length > 0) {
                const rows: string[][] = [];
                for (const p of mergedParams) {
                    if (!isRecord(p)) continue;
                    const name = String(p.name ?? "");
                    const inLoc = String(p.in ?? "");
                    const required = p.required === true ? "yes" : "no";
                    let schemaHint = "";
                    if (isRecord(p.schema)) {
                        const t = p.schema.type;
                        const fmt = p.schema.format;
                        schemaHint = [Array.isArray(t) ? t.join(" | ") : t, fmt].filter(Boolean).join(", ");
                    }
                    rows.push([name, formatParamLocation(inLoc), required, schemaHint || "—"]);
                }
                if (rows.length > 0) {
                    lines.push(mdTable(["Name", "In", "Required", "Schema"], rows));
                    lines.push("");
                }
            }

            const body = op.requestBody;
            if (isRecord(body) && isRecord(body.content)) {
                const picked = pickJsonContentMediaEntry(body.content);
                if (picked) {
                    lines.push(`**Request body** (\`${picked.media}\`)`);
                    lines.push("");
                    const ex = exampleFromSchema(picked.schema, spec, 0);
                    lines.push("```json");
                    lines.push(JSON.stringify(ex, null, 2));
                    lines.push("```");
                    lines.push("");
                }
            }

            lines.push("**Responses**");
            lines.push("");
            const responses = op.responses;
            if (!isRecord(responses)) {
                lines.push("*(No responses documented.)*");
                lines.push("");
                continue;
            }
            const codes = Object.keys(responses).sort((a, b) => Number(a) - Number(b));
            for (const code of codes) {
                const resp = responses[code];
                lines.push(`- **\`${code}\`**`);
                if (isRecord(resp) && typeof resp.description === "string" && resp.description !== "Default Response") {
                    lines.push(`  - ${resp.description}`);
                }
                if (isRecord(resp) && isRecord(resp.content)) {
                    const picked = pickJsonContentMediaEntry(resp.content);
                    if (picked) {
                        const ex = exampleFromSchema(picked.schema, spec, 0);
                        lines.push("");
                        lines.push("  ```json");
                        const indented = JSON.stringify(ex, null, 2)
                            .split("\n")
                            .map((line) => `  ${line}`)
                            .join("\n");
                        lines.push(indented);
                        lines.push("  ```");
                    }
                }
                lines.push("");
            }
        }
    }

    lines.push("## Common error responses");
    lines.push("");
    lines.push(
        "Many routes return JSON error bodies for failed validation, auth, or missing resources. Shapes are defined per route in OpenAPI; representative **examples** (from the first matching response schema in the spec) are below."
    );
    lines.push("");
    const errTemplates = collectErrorTemplates(spec);
    const codes = [...errTemplates.keys()].sort((a, b) => Number(a) - Number(b));
    if (codes.length === 0) {
        lines.push("*(No `4xx`/`5xx` JSON response schemas found in this spec.)*");
    } else {
        for (const code of codes) {
            lines.push(`### HTTP ${code}`);
            lines.push("");
            const ex = exampleFromSchema(errTemplates.get(code), spec, 0);
            lines.push("```json");
            lines.push(JSON.stringify(ex, null, 2));
            lines.push("```");
            lines.push("");
        }
    }

    lines.push("---");
    lines.push("");
    lines.push(`*OpenAPI version: ${spec.openapi ?? "unknown"} · API version: ${version} · Operations: ${operations.length}*`);

    return lines.join("\n");
}

async function main() {
    const app = await buildApp();
    try {
        await app.ready();
        const spec = app.swagger() as OasDoc;
        const md = generateMarkdown(spec);
        const outPath = join(__dirname, "../docs/API.md");
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, md, "utf8");
        console.log(`Wrote ${outPath} (${collectOperations(spec).length} operations).`);
    } finally {
        await app.close();
    }
}

void main();
