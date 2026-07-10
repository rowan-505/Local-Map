import fs from "node:fs";
import path from "node:path";

export type PhaseStatus = "passed" | "failed" | "warning" | "skipped";

export type PhaseReportSummary = {
    phase: string;
    status: PhaseStatus;
    summary: string;
    details?: Record<string, unknown>;
};

export function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonFile(filePath: string, data: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function writeTextFile(filePath: string, text: string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

export function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function copyFile(src: string, dest: string): void {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

export function copyIfExists(src: string, dest: string): boolean {
    if (!fs.existsSync(src)) {
        return false;
    }
    copyFile(src, dest);
    return true;
}

export function markdownTable(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
    const safe = (value: string | number | null | undefined) =>
        String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const lines = [
        `| ${headers.map(safe).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
    ];
    for (const row of rows) {
        lines.push(`| ${row.map(safe).join(" | ")} |`);
    }
    return lines.join("\n");
}

export function phaseMarkdown(title: string, lines: string[]): string {
    return [`# ${title}`, "", ...lines, ""].join("\n");
}

export function statusFromBoolean(ok: boolean): PhaseStatus {
    return ok ? "passed" : "failed";
}

