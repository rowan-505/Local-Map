# Auth MVP — Manual Test Checklist

Public-user auth MVP for CoreMap. Endpoints: `POST /auth/register`, `POST /auth/login`,
`POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.

Set a base URL first:

```bash
export API=http://localhost:3001
```

## 0. Startup safety

- [ ] With `NODE_ENV=production` and `AUTH_BYPASS=true`, the API **fails to start**
      with: `AUTH_BYPASS=true is not allowed when NODE_ENV=production.`
- [ ] With `AUTH_BYPASS` unset (or in dev), the API starts normally.
- [ ] `JWT_SECRET` unset → API fails to start with `JWT_SECRET is required`.

## 1. Register (role = user only)

```bash
curl -i -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","displayName":"Alice","password":"hunter2pass"}'
```

- [ ] `201 Created`, body `{"message":"Account created","user":{...}}`.
- [ ] `user.roles` is exactly `["user"]` (never `admin` / `super_admin`).
- [ ] Response contains `email_verified:false`, `account_status:"active"`,
      `preferred_language`, `primary_region_id`, `total_points:0`.
- [ ] Response does **not** contain `password_hash` or `refresh_token_hash`.
- [ ] Re-registering the same email → `409` `Email already registered`.
- [ ] Weak password (<8 chars) or invalid email → `400`.

## 2. Login (short-lived access + refresh)

```bash
curl -i -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"hunter2pass"}'
```

- [ ] `200`, body has `accessToken`, `refreshToken`, `expiresIn:"15m"`, `user`.
- [ ] Decoding `accessToken` (jwt.io) shows `exp - iat ≈ 900s` (15 min) and `roles`.
- [ ] Wrong password → `401 Invalid email or password`.
- [ ] Unknown email → `401` (same message, no user enumeration).
- [ ] A row was inserted into `app_auth.auth_sessions` with a non-null
      `refresh_token_hash` (the raw token is **not** stored).

## 3. /auth/me

```bash
curl -i "$API/auth/me" -H "Authorization: Bearer <accessToken>"
```

- [ ] `200` with roles, `email_verified`, `account_status`, `primary_region_id`,
      `preferred_language`, `total_points`.
- [ ] No token / malformed token → `401`.
- [ ] No `password_hash` / `refresh_token_hash` / `is_active` in the response.

## 4. Refresh (rotation)

```bash
curl -i -X POST "$API/auth/refresh" -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

- [ ] `200` with a **new** `accessToken` and a **new** `refreshToken`.
- [ ] Re-using the **old** refresh token → `401` (it was rotated/invalidated).
- [ ] The new refresh token works for a subsequent `/auth/refresh`.
- [ ] In DB, the session's `refresh_token_hash` changed and `last_used_at` updated.

## 5. Logout (revocation)

```bash
curl -i -X POST "$API/auth/logout" -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<currentRefreshToken>"}'
```

- [ ] `200` `{"message":"Logged out"}`.
- [ ] Using that refresh token afterwards → `401`.
- [ ] Logout with an unknown/already-revoked token → still `200` (idempotent).
- [ ] In DB, the session's `revoked_at` is set.

## 6. Legacy bcrypt → Argon2id rehash

Pre-req: a user whose `password_hash` starts with `$2a$/$2b$/$2y$` (bcrypt).

- [ ] Login with the correct password succeeds (`200`).
- [ ] After that login, the user's `password_hash` now starts with `$argon2id$`.
- [ ] Subsequent logins still succeed against the upgraded Argon2id hash.

## 7. Inactive / suspended account

- [ ] Set `is_active=false` (or `account_status<>'active'`) for a user → login `403`,
      `/auth/me` `403`, and `/auth/refresh` `403`.

## 8. Role guard (requireRole)

- [ ] `app.requireRole("admin","super_admin")` returns `403 Insufficient role`
      for a `user`-only token and passes for an `admin`/`super_admin` token.

## 9. Email verification OTP (optional)

Requires `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_OTP_SECRET` set (else endpoints
return `503`). Both endpoints require a Bearer access token. OTP is optional and
never blocks account creation/use.

```bash
export TOKEN=<accessToken>
curl -i -X POST "$API/auth/email/send-otp" -H "Authorization: Bearer $TOKEN"
curl -i -X POST "$API/auth/email/verify-otp" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"123456"}'
```

- [ ] Without a token → `401`. With a token but config unset → `503`.
- [ ] `send-otp` for an unverified user → `200 {"status":"sent"}`, email arrives with a 6-digit code.
- [ ] A row appears in `app_auth.email_verification_otps` with an `otp_hash` (never the raw code) and `expires_at`.
- [ ] Calling `send-otp` again within 60s → `429`; after 60s → `200` (and previous OTPs are consumed/invalidated).
- [ ] `verify-otp` with the wrong code → `400 Invalid verification code` and `attempts_count` increments.
- [ ] After `max_attempts` wrong tries → `429 Too many attempts`.
- [ ] `verify-otp` with the correct code → `200 {"status":"verified"}`; `auth_users.email_verified=true` and the OTP's `consumed_at` is set.
- [ ] A `system.audit_logs` row is written with `action_type='email_verified'`, `entity_type='auth_user'`.
- [ ] After verification, `send-otp` / `verify-otp` return `{"status":"already_verified"}`.
- [ ] An expired OTP (past `expires_at`) → `verify-otp` returns `400 ... expired`.
- [ ] Server logs never contain the OTP code.
- [ ] `/auth/me` now shows `email_verified:true`.

## Rate limiting (per-IP, in-memory)

Limits (per IP, shared window `AUTH_RATE_LIMIT_WINDOW`, default 60s):

| Route | Default max / window | Env override |
|---|---|---|
| `POST /auth/login` | 10 / 60s | `AUTH_RATE_LIMIT_MAX` |
| `POST /auth/register` | 5 / 60s | (fixed) |
| `POST /auth/email/send-otp` | 3 / 60s | (fixed) + existing 60s per-user cooldown |
| `POST /auth/refresh` | 30 / 60s | (fixed) |
| `GET /auth/me`, `POST /auth/logout`, `POST /auth/email/verify-otp` | not IP-limited | — |

```bash
# Login: 11th request within the window is blocked.
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","password":"secret123"}'
done
```

- [ ] `POST /auth/login` returns `429` after 10 requests/minute/IP.
- [ ] `POST /auth/register` returns `429` after 5 requests/minute/IP.
- [ ] `POST /auth/email/send-otp` returns `429` after 3 requests/minute/IP (IP limit) — the per-user 60s cooldown also still returns `429`.
- [ ] `POST /auth/refresh` returns `429` after 30 requests/minute/IP.
- [ ] `GET /auth/me` is not IP rate-limited.
- [ ] The `429` body is sanitized: `{"message":"Too many requests. Please slow down and try again shortly."}` (no IP, limit count, or retry internals in the body).
- [ ] Setting `AUTH_RATE_LIMIT_MAX=3` and `AUTH_RATE_LIMIT_WINDOW=10000` changes the login limit to 3 per 10s.

## Known follow-ups (out of MVP scope)

- [x] Add `@fastify/rate-limit` and wrap register/login/refresh/send-otp (per-IP, in-memory).
- [x] Dashboard `/signup` page + "Create demo admin" link removed (demo-admin signup no longer exists).
- [ ] Consider delivering the refresh token via httpOnly cookie instead of JSON body.
- [ ] Move rate-limit store to Redis if/when the API runs multiple instances (current store is per-process in-memory).
