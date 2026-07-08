# CoreMap AI configuration

Shared, tool-neutral AI guidance for CoreMap. Edit canonical content here; tool-specific folders mirror or reference it.

## Layout

| Path | Role |
|------|------|
| [`skills/`](skills/) | **Canonical** skill definitions (procedures, references, assets). Add or update skills here first. |
| [`workflows/`](workflows/) | Workflow checklists and phased implementation guides. |
| [`../../AGENTS.md`](../../AGENTS.md) | Tool-neutral operating guide: product direction, architecture, V2 scope, security, testing. |
| [`../../CLAUDE.md`](../../CLAUDE.md) | Claude Code entry point. |

## Tool-specific folders

| Path | Role |
|------|------|
| [`.claude/skills/`](../../.claude/skills/) | Claude Code skill mirror. Copied from `docs/ai/skills` for compatibility. |
| [`.cursor/rules/`](../../.cursor/rules/) | Cursor agent rules (architecture, workflow, scoped setup guides). |
| [`.cursor/mcp.json`](../../.cursor/mcp.json) | Cursor MCP server configuration. |
| [`.cursor/settings.json`](../../.cursor/settings.json) | Cursor plugin settings for this repo. |
| [`.agents/`](../../.agents/) | **Legacy / optional.** Older agent skill layout; see [`.agents/README.md`](../../.agents/README.md). |

## Maintenance

1. Change skills in `docs/ai/skills/`.
2. Copy updated skills to `.claude/skills/` (or re-run the project sync script when one exists).
3. Keep `AGENTS.md` tool-neutral; put Cursor-only behavior in `.cursor/rules/`.
4. Before large AI config changes, back up to `_local_backups/ai-config-backup-YYYYMMDD-HHMMSS/`.

## Related docs

- V2 roadmap: [`docs/11-roadmap/v2-plan.md`](../11-roadmap/v2-plan.md)
- Human docs index: [`docs/README.md`](../README.md)
