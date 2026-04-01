# TownMap Coding Rules

## Core Principles
- Write simple, readable Kotlin.
- Optimize for maintainability, not cleverness.
- Prefer clear names over short names.
- Keep files focused and not bloated.
- Avoid premature abstraction.

## General Rules
- Kotlin only
- Jetpack Compose only for UI
- MVVM for screen architecture
- Coroutines + Flow for async/state streams
- Hilt for dependency injection
- Room for local persistence
- Repository pattern for data access
- One responsibility per class where practical

## Naming Rules

### Classes
Use descriptive PascalCase names:
- MapScreen
- MapViewModel
- SearchRepository
- GetPlaceDetailUseCase

### Functions
Use clear camelCase names:
- loadNearbyPlaces()
- refreshOfflineRegion()
- observeSearchResults()

### Variables
Use meaningful names:
- selectedPlace
- visibleMarkers
- routePreviewState

Avoid vague names:
- data
- temp
- obj
- thing

## File Rules
- One main screen per file
- One ViewModel per screen
- Keep composables small and extract reusable pieces
- Avoid huge utility files
- Avoid god classes

## UI Rules
- No business logic inside composables
- UI reads state and emits events
- Use immutable UI state data classes
- Keep Compose previews where useful
- Reuse common UI components from core/ui

## ViewModel Rules
ViewModel may:
- coordinate screen state
- call use cases
- expose StateFlow or similar UI state
- handle user intents/events

ViewModel must not:
- directly manipulate database tables
- contain raw Retrofit setup
- contain unrelated logic from other features

## Domain Rules
Use cases should:
- represent a clear business action
- be small and testable
- not depend on Android UI classes

Examples:
- SearchPlacesUseCase
- GetOfflineRegionStatusUseCase
- BuildRoutePreviewUseCase

## Data Rules
Data layer may contain:
- repository implementations
- API services
- DAOs
- entities
- DTOs
- mappers

Rules:
- map DTOs/entities into app models cleanly
- keep remote and local concerns separated
- do not leak API response models into UI

## Error Handling
- Never silently swallow exceptions
- Convert errors into app-level result/state types
- Show stable, user-friendly messages in UI
- Log technical details where appropriate

## State Management
- Use explicit UI state classes
- Prefer unidirectional data flow
- Avoid scattered mutable state
- Keep loading, success, and error states visible in code structure

## Performance Rules
- Avoid unnecessary recomposition in Compose
- Avoid heavy work on main thread
- Use pagination or chunked loading when needed
- Be careful with map marker rendering volume
- Keep memory usage predictable

## Dependency Rules
- Minimize dependencies
- Add a dependency only if it solves a real problem
- Prefer official or stable libraries
- Avoid trendy libraries with unclear maintenance

## Testing Rules
- Write unit tests for important use cases and repository logic
- Prefer deterministic tests
- Test edge cases for routing/search/offline logic
- UI tests can come later after core behavior is stable

## Future-Proofing Rules
- Organize by feature first
- Do not split into many Gradle modules too early
- Keep package boundaries clean so modularization later is easy
- Build for V1 reality, not imaginary enterprise scale

## Forbidden Patterns
- Direct network call from composable
- Direct database call from composable
- Business logic inside MainActivity
- Huge files with mixed responsibilities
- Copy-paste logic across features
- Feature code depending randomly on another feature’s internal classes

## Preferred Package Pattern
Each feature should follow:
```text
feature/<name>/
├─ presentation/
├─ domain/
└─ data/