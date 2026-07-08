# YBS Phase 4 — Route Identity Policy (Stage 5)

This document defines how YBS extraction assigns route identity before Stage 7
normalization and Stage 8 import planning.

Code helpers live in `route-identity.ts`.

## Core model

CoreMap transport routes follow this rule:

- **Same route number + same public route title** → one `transport.routes` row later,
  with **outbound** and **inbound** variants only.
- **Same route number + different public route title** → **separate** `transport.routes`
  rows later.
- Do **not** model one route with 4 variants (for example outbound-A, inbound-A,
  outbound-B, inbound-B).
- `route_number` may repeat across rows.
- `route_code` must be unique.
- Do **not** invent fake `route_number` values.

## Route code policy

### 1. Unique numeric route

When a visible route number appears only once in the index batch:

```text
route_code_candidate = YBS-<number>
```

Example: `YBS-2`

### 2. Duplicate numeric route number

When the same visible route number appears more than once with different public
titles:

```text
route_code_candidate = YBS-<number>-A
route_code_candidate = YBS-<number>-B
route_code_candidate = YBS-<number>-C
```

Examples: `YBS-64-A`, `YBS-64-B`, `YBS-70-A`, `YBS-70-B`

Suffix assignment:

1. Group rows by `route_number`.
2. Sort each group by:
   1. normalized public route title
   2. operator name
   3. app `list_order`
3. Assign `A`, `B`, `C` in that stable order.
4. Store:
   - `duplicate_number_group_key` = `YBS-<number>`
   - `duplicate_number_group_index` = `1`, `2`, `3`, ...

### 3. Named official route

When the badge is an official display code and there is no numeric route number:

```text
route_number = null
route_code_candidate = <official display code>
```

Example: `APS`

### 4. Unclear or truncated route

When the list card title is truncated or identity is not safe yet:

```text
route_code_candidate = null
identity_status = needs_detail_confirmation
needs_detail_confirmation = true
```

Final `route_code` is decided later in normalization after route detail
confirmation.

## Shared identity fields

Every route index row and later normalized route record should carry:

| Field | Type | Meaning |
|---|---|---|
| `route_display_code` | string \| null | Visible badge text, for example `2`, `7 (Nat Sin)`, `APS` |
| `route_number` | number \| null | Parsed visible number only. No fake values. |
| `route_code_candidate` | string \| null | Stable candidate code from this policy |
| `route_title_my` | string \| null | Full visible Myanmar list title |
| `route_title_en` | string \| null | Full visible English list title |
| `operator_name` | string \| null | Visible operator if present |
| `public_name_candidate` | string \| null | Title without leading `(n)` prefix |
| `identity_status` | string | `confirmed`, `named_official`, or `needs_detail_confirmation` |
| `duplicate_number_group_key` | string \| null | `YBS-<number>` when number is duplicated |
| `duplicate_number_group_index` | number \| null | `1`, `2`, `3` inside duplicate group |
| `needs_detail_confirmation` | boolean | `true` when detail screen must confirm identity |

## Public title comparison

`public_name_candidate` removes the leading list prefix such as `(၂)` or
`(၇-နတ်စင်)`.

Use it to decide whether two rows with the same `route_number` are the same
route or separate routes.

Examples:

| Visible title | `public_name_candidate` |
|---|---|
| `(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး` | `ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး` |
| `(၇-နတ်စင်) အောင်မြင့်မိုရ်အိမ်ရာ ... - ပန်းဆိုးတန်း` | `အောင်မြင့်မိုရ်အိမ်ရာ ... - ပန်းဆိုးတန်း` |

## Stage flow

```text
Stage 4 extract route index (raw cards)
        ↓
Stage 5 assign route identity (this policy)
        ↓
Stage 6 extract route detail stops (outbound + inbound)
        ↓
Stage 7 normalization
        ↓
Stage 8 import planning
```

## Helper functions

| Function | Use |
|---|---|
| `assignRouteIdentities()` | Apply this policy to route index rows |
| `normalizePublicRouteTitle()` | Build `public_name_candidate` |
| `identityFromConfirmedRouteCode()` | Detail extraction with known `route_code` |
| `routeIdentityRecordKey()` | Dedupe after identity assignment |

## Related docs

- Skill: `docs/ai/skills/transport-data-extraction/SKILL.md`
- JSON format: `docs/ai/workflows/transport-extraction-json-format.md`
