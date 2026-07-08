---
status: archived
reason: replaced by docs/archive/old-docs/import-review/simple-promotion-readiness.md
archived_at: 2026-07-01
---

# Simple promotion readiness

Static and pre-flight checks before running simplified import-review promotion (validate → promote) on a batch.

**Runtime QA:** [simple-promotion-runtime-qa.md](./simple-promotion-runtime-qa.md) — smoke script and manual dashboard steps.

**Contract:** [direct-edit-promotion-contract.md](./direct-edit-promotion-contract.md).

---

## Static checks (no database)

Run from **repository root**.

### No nested Prisma transactions in family promote repos

`promoteAndCommitItem` in `import-review-promotion-promote.repo.ts` is the **only** owner of `prisma.$transaction` for per-item promotion commits. Family repos (`*promotion-promote-*.repo.ts`) receive a transaction client and must use `*Tx(db, …)` helpers — not start another transaction.

```bash
node tools/import-review/check-no-nested-promotion-transactions.mjs
```

| Result | Meaning |
|--------|---------|
| `PASS` | No forbidden `$transaction` calls under scanned `*promotion-promote*.ts` files (tests excluded). |
| `FAIL` | Prints `file:line` for each nested call; exit code `1`. |

**Scanned paths:** `apps/api/src/modules/import-review/**/*promotion-promote*.ts` (excluding `*.test.ts`).

**Allowed without failing:**

| Case | Rule |
|------|------|
| Top-level orchestration | Whole file allowlist: `import-review-promotion-promote.repo.ts` |
| Standalone entrypoints | Method name contains `Standalone` (e.g. `insertPlaceStandalone`) on the same call or within ~60 lines above |
| Documented exception | Line (or 2 lines above) contains `// promotion-allow-nested-transaction` |

**Unit tests:** `apps/api/src/modules/import-review/import-review-promotion-promote-nested-transaction.test.ts` also asserts key family repos avoid `$transaction` at runtime with a mock client.

### Dashboard route consistency (optional)

```bash
node tools/import-review/check-import-review-dashboard-route-consistency.mjs
```

Ensures import-review entity pages use the shared `createImportReviewEntityRoutePage` shell.

---

## API checks (local)

```bash
cd apps/api && npm run typecheck
cd apps/api && node --import tsx --test src/modules/import-review/*promote*.test.ts
cd apps/api && node --import tsx --test src/modules/import-review/*promotion*.test.ts
node tools/import-review/check-no-nested-promotion-transactions.mjs
```

---

## Suggested order before a promotion batch

1. Static: nested-transaction check (this doc).
2. Typecheck + promotion unit tests.
3. Runtime smoke: `node apps/api/scripts/smoke-import-review-promotion-simple.mjs` ([simple-promotion-runtime-qa.md](./simple-promotion-runtime-qa.md)).
4. Dashboard promote on a small selected batch; confirm list refetch hides promoted rows (default `include_promoted=false`).
