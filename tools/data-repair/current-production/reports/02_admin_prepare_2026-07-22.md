# Prompt 2 — Admin prepare results (2026-07-22)

## Clear repairs proposed (8 rows)

| id | Name | Category | Change |
|----|------|----------|--------|
| 7523 | ပုဇွန်တောင်မြို့နယ် | clear_parent (+ level/type) | parent 5271→13; level/type district→township |
| 6452 | မိုင်းမော | clear_parent | parent 6474→6485 (Wa North) |
| 5092,5151,6991,7177 | Ye/Taung/Oyster/Taik Kyun | clear_level (+ parent) | level state_region→ward_village_tract; parent→Rakhine 6722 |
| 7432,7433 | ဟိုင်းကြီးကျွန်း, စိန်ကျွန်း | clear_level (+ parent) | level→ward_village_tract; parent→Ayeyarwady 7279 |

## Counts

| Category | n |
|----------|--:|
| clear_parent_error | 2 |
| clear_level_error | 6 |
| clear_type_error | 1 (bundled with 7523) |
| possible / manual_review | ward/VT under non-township: 53; town under state_region: 2 |

## Update rules for Prompt 3

1. Apply only the 8 proposal rows above.
2. Do not auto-fix ward/VT parent chains without township covers.
3. Do not change geometry, names, or verified flags.
4. Skip none of these 8 for “uncertain”; islands are clear level mistakes; parent covers are unique per island.

## Confirmation

Production not changed in Prompt 2.
