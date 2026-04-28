
---

# 4) `docs/cursor_tasks.md`

```md
# Cursor Tasks

## Project Context
This project is a Kotlin Android map app called TownMap.
It is a lightweight, locally precise town map MVP for daily use.
The first target area is Kyauktan Township.

## Important Technical Constraints
- Kotlin only
- Android Studio project
- Jetpack Compose UI
- MVVM architecture
- Feature-based package structure
- Do not over-engineer
- Keep dependencies minimal
- Optimize for performance and maintainability
- Offline support is important
- Future admin dashboard will be separate, not part of current mobile MVP

## Code Structure Rules
All code must fit this structure:

app/src/main/java/com/rowan/townmap/
- app/
- core/common/
- core/ui/
- core/model/
- core/network/
- core/database/
- core/location/
- feature/map/
- feature/search/
- feature/places/
- feature/routing/
- feature/offline/
- sync/

Each feature should contain:
- presentation/
- domain/
- data/

## Current Product Priorities
1. Stable map foundation
2. Lightweight performance
3. Local place search
4. Place detail flow
5. Offline-ready architecture
6. Clean codebase for future scaling

## Current MVP Tasks
- Set up app theme and base navigation
- Create Map screen shell
- Create Search screen shell
- Create Place Detail screen shell
- Create Settings screen shell
- Add basic ViewModel structure for each screen
- Create shared models for Place, Route, OfflineRegion, MapMarker
- Prepare Room database foundation
- Prepare network layer foundation
- Prepare location helper foundation
- Prepare offline sync structure

## Implementation Rules for Cursor
- Do not create unnecessary abstraction
- Do not introduce many Gradle modules
- Do not add features outside V1 scope
- Do not move logic into composables
- Do not use mock architecture that is hard to replace
- Prefer simple and production-sensible code
- Keep file names explicit and consistent

## When Generating Code
Always:
- preserve package structure
- use clear naming
- create minimal but expandable implementations
- add TODO comments only where genuinely needed
- avoid placeholder complexity
- keep future offline and admin support in mind

## Immediate Next Step
Build the initial project foundation with:
- Application class
- MainActivity
- app navigation
- theme
- feature package skeleton
- empty screens for Map, Search, Place Detail, Settings
- basic ViewModel stubs