Rules:
- PostgreSQL + PostGIS only
- Do NOT leave NULL for required fields
- If a required reference field (like source_type_id) is unclear:
  → use safe MVP default value instead of NULL
- All inserts must NOT silently filter out rows
- All inserts must return inserted row count
- If 0 rows inserted, script must expose why in validation