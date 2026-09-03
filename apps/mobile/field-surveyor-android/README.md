# CoreMap Field (Android)

One Gradle app module (`:app`). Package folders, not extra modules. Do not copy `apps/mobile/android-kotlin`.

This is the field-surveyor foundation: CoreMap auth, Keystore token storage, Room, WorkManager, and the offline PMTiles map from the spike.

## Screens

Login → Setup/Sync → Routes | Survey | Settings

- **Login** — `POST /auth/login` with email + password. Role must include `surveyor`.
- **Setup/Sync** — `GET /field/bootstrap` plus a one-time Yangon PMTiles download (~730 MB). Matching `revision` skips the snapshot. Other regions are not downloaded.
- **Routes** — local Room search by route code. Tap a D0/D1 variant to open Survey.
- **Survey** — local PMTiles + selected path/stops + live GPS. Check report types, then **Create report**. No media. No API during survey.
- **Settings** — Profile, Outbox (list, detail, edit/cancel waiting rows), Infra (Yangon PMTiles + YBS snapshot).

Not in this step: CameraX, audio, R2, public media, routing, POIs, consumer Discover/Saved/Profile, Hilt/Koin.

## Active survey (this step)

Uses cached bootstrap data and device GPS only. Airplane mode is expected.

Map shows only:

- local Yangon PMTiles (`filesDir/basemap/yangon.pmtiles`) after Setup download
- selected variant path
- selected variant stops
- current GPS
- local anomaly markers for that variant

It does not render all routes, all YBS stops, POIs, online tiles, or media.

Start Survey: keep GPS hot, keep the screen awake, and allow saving reports. End Survey: you can still see the map, but Save report is blocked until Start again. Display `GPS ±Xm`. One round locate icon recenters on you; pinch-zoom and pan stay. Pan does not stop the blue GPS dot. Selecting a stop flies to that stop’s stored coordinates. GPS fixes are not saved to disk.

Stop context is previous / current / next by `stop_sequence`. GPS may suggest a nearby stop; the surveyor must confirm. Correct stop writes nothing.

Report types are outlined pills. A filled background means that type’s form is open. **MOVED** requires a map tap for the real stop location, then **Save report**. **MISSING / DATA / ROUTE / OTHER** open a short form (note or route choices). Each save writes one Room `local_reports` row (`wrong_location`, `missing_item`, `wrong_info`, `transport_issue`, `other_map_issue`) with UUID, GPS, snapshot revision, route/variant, and stop when selected. No media.

There is no survey-session database table. Last variant/stop selection is a small UI pref only.

## Outbox sync

WorkManager unique work `field-outbox-sync` (network required, exponential backoff). One anomaly per `POST /field/reports`. The local `clientPublicId` is reused on every retry. The server treats that UUID as the report public id (`ON CONFLICT DO NOTHING`), so a lost 201 still becomes one dashboard row.

Local states: `LOCAL`, `QUEUED`, `SYNCING`, `SYNCED`, `RETRY`, `PERMANENT_ERROR` (4xx validation — no infinite retry). Waiting rows (not yet synced) can be opened, note-edited, or deleted on the phone. Synced rows are view-only.

Survey capture does not wait for upload. Process restart re-enqueues work. Logout clears auth only.

## Authentication

Uses the existing Fastify client:

| Method | Path | Body |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` |

Refresh **rotates** the refresh token. The previous refresh token is invalid after a successful refresh. The next call must send the new token (stored immediately).

Access tokens follow API `expiresIn` (currently `15m`). The app refreshes 30 seconds early.

Non-surveyor accounts: login response is not stored; the app calls logout to revoke the just-issued refresh session.

## Secure storage

Access token, refresh token, and user JSON are in `EncryptedSharedPreferences` (`field_auth_prefs`), encrypted with an Android Keystore `MasterKey` (AES256-GCM / AES256-SIV).

Do not store those values in plain SharedPreferences. Do not embed API JWT secrets, R2 keys, or database URLs in the app.

## API base URL

Non-secret origin only, via `BuildConfig.API_BASE_URL`.

- Debug default: `http://10.0.2.2:3001` (emulator → host Fastify). This does **not** work on a physical phone.
- Real phone (same Wi-Fi as the Mac): add this line to gitignored `local.properties` and rebuild debug:

```text
fieldApiBaseUrl=http://<MAC_LAN_IP>:3001
```

- CLI override (debug or release): `-PfieldApiBaseUrl=https://api.example.com`
- Release default placeholder: `https://api.invalid.coremap.local` until you pass a real HTTPS origin. `local.properties` is **debug only**.

Debug builds allow HTTP cleartext (`src/debug`). Release forbids cleartext.

## Room

`FieldDatabase` lives in `noBackupFilesDir/field.db` so Android backup does not copy it.

Table `local_reports` is the outbox. Capture writes `LOCAL`. WorkManager posts to `POST /field/reports` and marks `SYNCED` (or `RETRY` / `PERMANENT_ERROR`).

Transport cache (field-use only, not a Postgres mirror):

- `cache_routes`, `cache_variants`, `cache_stops`, `cache_route_stops`, `cache_route_paths`
- `cache_metadata.snapshotRevision`

Refresh: if server revision equals local revision, no dataset download. If it differs, download the compact snapshot, validate, replace those tables in one transaction, then store the new revision. Failure keeps the previous good cache and revision.

Local queries: search route code, variants for a route, D0/D1, ordered stops, selected route path, stop coordinates/names.

Route search never calls the network per keystroke.

## WorkManager

`FieldApp` implements `Configuration.Provider` (default WorkManager initializer removed). On start it enqueues unique work `field-foundation` (`KEEP`). Real upload workers come later.

## Logout (safe behavior)

1. `POST /auth/logout` with the current refresh token (idempotent on the server). If the network fails, local logout still continues.
2. Clear Keystore-backed credentials only.
3. **Do not** delete Room `local_reports` rows, GPS/evidence files, or the local PMTiles copy.

Unsynced drafts stay on the device so a surveyor can sign in again and sync later. There is no silent wipe.

After a 401 refresh, credentials are cleared the same way. Drafts stay.

## Process restart

Encrypted prefs restore the session. If the access token is still valid, the app opens Routes. If it is expired, the next API call rotates refresh. If refresh is rejected, the user returns to Login; drafts remain.

## Backup exclusions

`data_extraction_rules.xml` and `backup_rules.xml` exclude:

- `field_auth_prefs.xml` (tokens)
- app databases
- `files/reports`, `files/evidence`, `files/gps`, `files/basemap`

Room already uses `noBackupFilesDir`.

## Offline PMTiles

Survey zoom is street-level (up to z20). Overview tiles only cover z0–z8, so the app does **not** pack all regional PMTiles. It downloads **Yangon only** into `filesDir/basemap/yangon.pmtiles` (~730 MB). Style URL is `pmtiles://file://…`. Glyphs stay `asset://`. No live tile HTTP after the file is on the device.

Default URL: `https://tiles.coremapmm.com/basemaps/yangon/v1/basemap.pmtiles`. Override with `-PfieldYangonPmtilesUrl=…` (LAN copy of the file). Logout does not delete this file.

Gradle still copies the small overview PMTiles as a fallback asset. Setup requires the Yangon file before Continue.

## Build / test / install

From this directory:

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Physical device (Android 12, arm64):

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.coremapmm.fieldsurveyor/.MainActivity
```

On a phone, set `fieldApiBaseUrl` in `local.properties` to the Mac LAN Fastify origin (not `10.0.2.2`, not `localhost`).

Mac API (same Wi-Fi):

```bash
cd apps/api
# HOST defaults to 0.0.0.0 in server.ts; set it in .env if you previously bound 127.0.0.1
HOST=0.0.0.0 npm run dev
```

Mac LAN IP (Wi-Fi, typical):

```bash
ipconfig getifaddr en0
```

If that is empty, list other interfaces:

```bash
ifconfig | awk '/inet / && $2 != "127.0.0.1" { print $2 }'
```

Phone browser check (replace with your IP): `http://<MAC_LAN_IP>:3001/health` should return JSON `status` ok. Then rebuild the debug APK so login uses that origin.
