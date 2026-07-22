# Prompt 11 — Review backlog reconcile (2026-07-22)

## Classification matrix

### import_review

All candidate families and `review_batches` are **empty (0)**. Baseline earlier listed IR road candidates; they are no longer present. No deletes performed in this prompt. History of promotion remains in `system.system_publish_*`.

### publish_batches

| Status after | Count |
| --- | ---: |
| archived | 25 |
| promoted (preserved) | 8 |

Archived: smoke/test/multi-publish/failed/blocked road leftovers + ready batches with failed items / landuse already in core.

### publish_items

| Classification (operational) | How marked | Count |
| --- | --- | ---: |
| already_promoted | `success` unchanged | 1811 |
| already_represented_in_core | `pending` → `skipped` | 2273 |
| failed history preserved | `failed` unchanged | 1895 |
| still_useful / unmatched pending | `pending` remain | 36 |

No promotes. No candidate deletes. Backup: `system.repair_review_backlog_before_202607`.
