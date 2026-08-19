# CoreMap Android

## Current Status

CoreMap Android is currently a UI-only Jetpack Compose prototype for a Myanmar map app. It is a map-first placeholder app that demonstrates the intended screen structure, bottom sheet behavior, visual states, and fake user flows.

This project does not currently implement real CoreMap backend integration, real MapLibre rendering, PMTiles loading, real routing, auth, offline downloads, persistence, sync, or production data storage.

**This is not a production-ready app.** Everything below describes prototype UI and local fake data only.

## What Is Already Implemented (UI Prototype Only)

### Project setup

- Android application module at `app`.
- Package namespace and application ID: `com.coremapmm.app`.
- Single Activity entry point: `MainActivity`.
- Jetpack Compose UI with Material 3.
- Compose theme, color, typography, and spacing helpers under `core/design`.
- Gradle version catalog under `gradle/libs.versions.toml`.
- Minimum SDK: 23.
- Compile SDK: 37.
- Target SDK: 37.

### Architecture

- Single Activity app shell: `CoreMapApp`.
- UI state holders using Compose state and ViewModel + StateFlow.
- No repository layer, network client, database, or background workers yet.
- Current Gradle dependencies are Compose, Lifecycle, Activity, and test libraries only.
- Domain-like feature folders under `feature`.
- Reusable UI components under `core/ui`.
- UI models under `core/model`.
- Fake data sources under `core/fake`.
- Placeholder map components under `map`.

### Global UI

- Map-first layout using `MapPlaceholder`, not a real map SDK.
- Floating search bar.
- Floating category chips.
- Right-side map control buttons.
- Fixed bottom navigation.
- Shared draggable bottom sheet with four states (product labels vs code):
  - Hidden `0/6` (`0f`)
  - Mini `1/6` (`1f / 6f`)
  - Default `2/6` (`2f / 6f`)
  - Full `6/6` label, but `SheetLevel.Full` uses `1f` (maximum sheet height above the bottom nav)
- Floating card helper for rounded shapes and subtle shadows.

### Navigation / bottom tabs

- Four bottom tabs are implemented:
  - Discover
  - Transit
  - My Map
  - Settings
- Tab switching is handled by in-memory shell state.
- There is no production navigation graph currently wired.

### Discover

- Discover sheet with Mini, Default, and Full states.
- Local / Country Hotspots segmented tabs.
- Current-area card.
- Nearby place rows.
- Four country hotspot cards.
- Manual offline map suggestion card placeholder.
- Save toggle state for fake places.

### Search

- Search overlay sheet with Mini, Default, and Full states.
- Back action.
- Query text field.
- Shortcut chips for Home, Work, and Saved.
- Filter chips for all, places, roads, bus, address, and township.
- Recent search placeholder rows.
- Fake search result rows.

### Place detail

- Place detail sheet states for Mini, Default, and Full.
- Random point sheet (opened by tapping empty map) with Mini, Default, and Full states.
- Place title, category, township, region, distance, verified badge, address, phone, plus code, and placeholder coordinates.
- Action row placeholders for From, To, Save, Share, Call, and Report.
- Horizontal photo carousel placeholder in the Full sheet.
- Placeholder tabs for Overview, Nearby, Info, and Reports.

### Transit / route UI

- Transit planner placeholder with From / To fields.
- Planner mode chips for walk, motorbike, car, and bus.
- Nearby stops, popular bus routes, recent routes, and coming-soon sections.
- Route results sheet using fake routes.
- Horizontal route timeline bar in route result cards.
- Route detail sheet with Mini, Default, and Full states.
- Vertical route timeline in the Full route detail sheet.
- Fake map route overlay state used by `MapPlaceholder`.

### My Map

- My Map sheet with Mini, Default, and Full states.
- Saved/offline summary.
- Default sheet: 5 fake sections (Saved Places, Saved Routes, Recent Searches, Downloaded Areas, Pending Reports).
- Full sheet: 7 fake sections (adds Pins, Cached Places, Pending Offline Reports).
- Reusable My Map item rows and action labels.

### Settings

- Settings sheet with Mini, Default, and Full states.
- Profile card with avatar placeholder, name/Guest state, level text, points text, and login placeholder for guests.
- Service grid for:
  - Offline Maps
  - Reports
  - Points
  - Data Saver
  - Language
  - Map Settings
  - Privacy
  - Help
- Service placeholder screens are opened from the Settings grid using in-memory state.

### Offline placeholder

- Offline Maps placeholder screen.
- Area selector:
  - Current township
  - Current district
  - Current region
  - Search area
- Package selector:
  - Lite
  - Standard
  - Full
- Fake file size updates based on selected area and package.
- Downloaded areas list with fake package type, size, latest update text, and update warning text.
- Warning placeholders for Wi-Fi, mobile data, low storage, and update availability.

### Reports / Points placeholder

- Reports placeholder with My Reports list, status filter chips, and pending offline report placeholder.
- Points placeholder with points summary, contribution history, and manual admin reward note.
- Data Saver placeholder with ON-by-default in-memory switch and explanation:
  - fewer POIs
  - no automatic photo loading
  - no automatic offline downloads
  - cache-first behavior

### Fake data

- Fake places, routes, search results, transit data, offline packages, settings data, My Map data, and user data.
- Fake data is local Kotlin code only.
- Some fake place models include placeholder photo URL strings, but the app does not load images from the network.

## What Is Placeholder Only

The following are visual placeholders only:

- The map background, roads, labels, markers, and route overlay.
- Map controls for layers, saved places, and current location.
- Search results and filters.
- Place details, actions, photos, tabs, and save state.
- Random point details.
- Transit planner, nearby stops, route results, route detail, and route overlay.
- Offline area selection, package selection, file sizes, downloaded area list, warnings, and download actions.
- My Map saved places, offline areas, routes, pins, cached places, and pending offline reports.
- Settings, profile/login, language, map settings, privacy, help, reports, points, and Data Saver.
- All state is in-memory and reset when the process is recreated.

## What Is Not Implemented Yet

- Real MapLibre map rendering.
- PMTiles or online basemap loading.
- Offline PMTiles package download.
- Real CoreMap API integration.
- Search API.
- Place detail API.
- Routing API.
- Transit API.
- Auth/session system.
- Saved places persistence.
- Reports submission.
- Points system.
- Room local cache.
- DataStore settings persistence.
- WorkManager background sync.
- Network state handling.
- Image loading/caching.
- Runtime permissions.
- Product tests. Only default sample unit/instrumented tests are present.
- Release signing.
- Security hardening.
- Performance profiling.
- Accessibility pass.
- Myanmar/English localization.

## Planned Production Architecture

The intended production architecture should stay simple and modular:

- Single Activity.
- Jetpack Compose UI.
- Navigation Compose for future screen navigation (not in dependencies yet).
- ViewModel + StateFlow for UI state.
- Repository pattern for app data boundaries.
- Retrofit/OkHttp for CoreMap API integration later.
- Room for local cache later.
- DataStore for preferences later.
- WorkManager for background sync later.
- MapLibre for map rendering later.
- Downloaded PMTiles for offline map packages later.

Production integrations should be isolated behind repositories and service classes, not embedded directly in Composables.

## Folder Structure

Current project structure, excluding build output folders:

```text
.
├── README.md
├── .gitignore
├── app
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src
│       ├── androidTest
│       │   └── java/com/coremapmm/app/ExampleInstrumentedTest.kt
│       ├── main
│       │   ├── AndroidManifest.xml
│       │   ├── java/com/coremapmm/app
│       │   │   ├── CoreMapApp.kt
│       │   │   ├── MainActivity.kt
│       │   │   ├── MapShellState.kt
│       │   │   ├── core
│       │   │   │   ├── design
│       │   │   │   ├── fake
│       │   │   │   ├── model
│       │   │   │   └── ui
│       │   │   ├── feature
│       │   │   │   ├── discover
│       │   │   │   ├── mymap
│       │   │   │   ├── place
│       │   │   │   ├── settings
│       │   │   │   └── transit
│       │   │   └── map
│       │   └── res
│       │       ├── drawable
│       │       ├── drawable-v24
│       │       ├── mipmap-anydpi-v26
│       │       ├── values
│       │       └── xml
│       └── test
│           └── java/com/coremapmm/app/ExampleUnitTest.kt
├── gradle
│   ├── libs.versions.toml
│   ├── gradle-daemon-jvm.properties
│   └── wrapper
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
├── build.gradle.kts
├── gradle.properties
├── gradlew
├── gradlew.bat
└── settings.gradle.kts
```

There are no XML layout files for screens. UI is written with Jetpack Compose.

## How To Run

1. Open this Android project folder in Android Studio:
   `apps/mobile/android-kotlin`
2. Let Android Studio run Gradle sync.
3. Select the `app` configuration.
4. Run on an emulator or device.

Detected SDK values:

- Minimum SDK: 23
- Compile SDK: 37
- Target SDK: 37

Command-line debug build:

```bash
./gradlew assembleDebug
```

## Development Rules

- Do not add real backend logic directly inside Composables.
- Do not access a database directly from UI.
- Keep UI components reusable and small.
- Use fake data only until the integration phase starts.
- Do not commit secrets.
- Do not commit `local.properties`.
- Do not commit keystores or signing files.
- Keep future MapLibre, API, Room, DataStore, and WorkManager integration isolated behind clear boundaries.
- Keep low-data Myanmar users in mind: avoid heavy image feeds and automatic downloads by default.

## Production Roadmap

### Phase 1: UI prototype (current)

- The Compose UI shell and fake flows exist today.
- Continue polishing sheet states, placeholder screens, and low-data defaults.
- This phase does not include production backend or map SDK integration.

### Phase 2: real MapLibre map

- Add MapLibre map rendering behind an isolated map module.
- Replace the Canvas map placeholder without changing unrelated feature UI.

### Phase 3: API integration

- Add CoreMap API client boundaries.
- Integrate real search, place detail, routing metadata, reports, and user-facing data step by step.

### Phase 4: Room/DataStore local cache

- Add Room for cached app data.
- Add DataStore for preferences.
- Keep cache and preference access outside Composables.

### Phase 5: offline PMTiles packages

- Add PMTiles package metadata, download state, storage checks, and update checks.
- Keep offline downloads explicit and low-data friendly.

### Phase 6: routing/transit integration

- Integrate routing and transit APIs.
- Keep route rendering and route details consistent with the current UI structure.

### Phase 7: auth/saved/reports/points

- Add auth/session handling.
- Persist saved places.
- Submit reports through the API.
- Show points from the server-side/manual admin reward system.

### Phase 8: testing/security/performance/release

- Add meaningful unit, UI, and integration tests.
- Add release signing setup outside source control.
- Harden security-sensitive flows.
- Profile startup, map interaction, and low-end device performance.
- Complete accessibility and localization passes.

## Notes For Future AI/Cursor Work

- Inspect the actual code before editing.
- Do not overengineer this prototype.
- Do not add unrelated dependencies.
- Keep Myanmar low-data users in mind.
- Prioritize fast UI, clear fake states, and Data Saver behavior.
- Do not claim a production feature is implemented unless the code really implements it.
