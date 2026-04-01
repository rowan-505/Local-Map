# TownMap Architecture

## Goal
Build a lightweight, precise, offline-friendly town map Android app for daily use.
Version 1 focuses on one town area only and prioritizes speed, small app size, and maintainable structure.

## Tech Stack
- Language: Kotlin
- UI: Jetpack Compose
- Architecture: MVVM with layered feature structure
- Async: Coroutines + Flow
- Dependency Injection: Hilt
- Local Database: Room
- Background Work: WorkManager
- Networking: Retrofit
- Map Engine: to be finalized based on Myanmar data/testing needs

## Project Structure
```text
app/src/main/java/com/rowan/townmap/
├─ app/
├─ core/
│  ├─ common/
│  ├─ ui/
│  ├─ model/
│  ├─ network/
│  ├─ database/
│  └─ location/
├─ feature/
│  ├─ map/
│  │  ├─ presentation/
│  │  ├─ domain/
│  │  └─ data/
│  ├─ search/
│  │  ├─ presentation/
│  │  ├─ domain/
│  │  └─ data/
│  ├─ places/
│  │  ├─ presentation/
│  │  ├─ domain/
│  │  └─ data/
│  ├─ routing/
│  │  ├─ presentation/
│  │  ├─ domain/
│  │  └─ data/
│  └─ offline/
│     ├─ presentation/
│     ├─ domain/
│     └─ data/
└─ sync/