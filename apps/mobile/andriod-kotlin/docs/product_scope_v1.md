
---

# 2) `docs/product_scope_v1.md`

```md
# TownMap Product Scope V1

## Product Vision
TownMap is a lightweight and locally precise daily-use map for one town area.
The first version is a focused MVP to validate real user demand, map precision, and update workflow.

## Primary Goal
Deliver a map app that people in the target town can actually use daily for:
- finding places
- viewing roads
- checking important local points
- using basic offline access
- seeing practical local routing information

## Target Launch Area
- Kyauktan Township
- initial map coverage limited to target operational zone only

## Core User Problems
Users may struggle with:
- poor local map precision
- missing local places or landmarks
- weak support for local daily movement
- unreliable or incomplete local routing information
- poor offline usability

## V1 Success Criteria
V1 is successful if users can:
- open the app quickly
- view the town map smoothly
- find key places easily
- trust map data more than general map alternatives in that area
- use core features with low friction

## V1 Features

### 1. Map Screen
- display target town map
- show roads and key places
- allow zoom and pan
- optionally show user current location

### 2. Search
- search for local places by name
- show suggestions/results
- tap result to open place detail or move map camera

### 3. Place Detail
- place name
- category
- short address or local description
- coordinates if useful
- optional contact/opening details later

### 4. Basic Routing
- simple point-to-point route preview
- focus on practicality, not fancy UI
- routing quality matters more than visual complexity

### 5. Offline Support
- cache essential map/place data for target area
- allow basic usage with weak network
- keep offline package small

### 6. Settings
- map preferences
- offline management entry
- app info
- feedback entry point later

## Non-Goals for V1
These are deliberately excluded:
- nationwide map coverage
- full live traffic system
- full public transit engine
- delivery integration
- ride-hailing/taxi integration
- user accounts unless later proven necessary
- in-app business dashboard
- complex analytics UI inside the mobile app
- social reviews/photos system

## Data Priorities
The most important product asset is trustworthy local map data.

Priority order:
1. roads
2. local landmarks
3. key businesses and services
4. practical routing data
5. frequent updates for changed places/roads

## Product Principles
- fast launch
- small install size
- clear UI
- low battery impact
- offline friendly
- high local usefulness
- easy future expansion

## Risks
- bad local data quality will kill trust
- overbuilding features too early will slow launch
- poor update workflow will make map stale
- using a heavy map stack can hurt performance on lower-end devices

## V1 Deliverables
- Android app MVP in Kotlin
- single-town production-ready structure
- maintainable codebase for future growth
- clear path to later admin dashboard and backend

## After V1
If V1 proves demand, next steps may include:
- admin dashboard for place/road updates
- better routing
- bus/transit support
- delivery/taxi integrations
- broader regional expansion