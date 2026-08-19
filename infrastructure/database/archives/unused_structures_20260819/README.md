# Unused-structure archive

Production project: `locghyuranqaqsnbxflc`  
Created: 2026-08-19  
Format: PostgreSQL custom archive (`pg_dump -Fc --compress=9`)  
Archive: `route_unification_plan.dump`  
SHA-256: `cb58757e8eb7789c16a706625fe2c41ce12bdc888470609618dbcf4642589e03`  
Compressed size: 10,186 bytes

The archive contains the table definition, owned sequence, primary key, and all
98 rows from `transport.route_unification_plan`. Every row had a non-null
`applied_at`; the plan was created and completely applied on 2026-06-25.

Restore into an isolated database only:

```sh
pg_restore --list route_unification_plan.dump
pg_restore --dbname "$ISOLATED_DATABASE_URL" --no-owner --no-privileges route_unification_plan.dump
```

Do not restore this archive directly over production.
