# Local Map Project – System Architecture & AI Guidance

## Overview

This project is a geospatial map system focused on:

- High precision local data (Kyauktan, Yangon)
- Lightweight performance
- Scalable backend architecture
- Web-first approach, mobile later

---

## Core Architecture

The system is divided into 3 main layers:

1. Database (PostgreSQL + PostGIS)
2. API (Fastify backend)
3. Clients (Dashboard, Web, Mobile)

---

## Data Flow

Clients → API → Database  
Database → Tiles → Map rendering

---

## Folder Structure

### apps/
Contains all runnable applications:

- apps/api → Fastify backend
- apps/dashboard → Next.js admin panel
- apps/web → public map frontend (MapLibre)
- apps/mobile → future mobile apps

---

### packages/
Shared reusable code:

- shared-types → TypeScript types shared across apps
- api-client → reusable API request logic

---

### infrastructure/
System-level components:

- database → SQL schema, migrations, functions
- tiles → PMTiles, Martin, style.json
- docker → local/dev containers
- cloud → deployment configs (R2, CDN, domains)

---

### tools/
Scripts and utilities:

- data import (OSM)
- tile building
- dev scripts

---

### docs/
Project documentation and planning

---

## Responsibilities by Layer

### API (apps/api)

- Business logic
- Validation
- CRUD operations
- Search
- Authentication

Rules:
- Only layer allowed to access the database
- Use Prisma for simple queries
- Use raw SQL for geospatial queries
- Must be modular (route → service → repo)

---

### Dashboard (apps/dashboard)

- Internal admin tool
- CRUD interface for data

Rules:
- MUST call API
- MUST NOT connect to database
- MUST NOT use Prisma
- Focus on functionality, not UI polish

---

### Web (apps/web)

- Public map frontend
- Map rendering using MapLibre

Rules:
- Use tiles for rendering
- Use API for search and data
- No business logic
- No database access

---

### Mobile (apps/mobile)

- Future Android/iOS apps

Rules:
- Use same API as web/dashboard
- Keep logic minimal
- Support offline tiles later

---

## Database (infrastructure/database)

- PostgreSQL + PostGIS is the source of truth

Contains:
- schema → table definitions
- migrations → versioned changes
- seeds → initial data
- functions → geospatial logic
- views → reusable queries
- indexes → performance optimization
- import → OSM pipeline

Rules:
- Always use migrations
- Do not manually change DB without SQL file
- Use PostGIS functions for geo queries

---

## Tiles (infrastructure/tiles)

- Rendering layer only

Components:
- PMTiles → static tiles
- Martin → dynamic tiles
- style.json → MapLibre style

Rules:
- Tiles are NOT data storage
- Do NOT mix API logic with tiles
- Do NOT store tiles in database

---

## Critical System Rules

- API is the only layer that can access the database
- Clients must go through API
- Tiles are for rendering only
- Do not duplicate business logic across layers
- Keep modules separated by domain (places, bus, search)

---

## Development Principles

- Performance first
- Simplicity over complexity
- Build minimal, then scale
- Keep system modular and clean

---

## Future Scaling Plan

- Add routing engine (graph-based)
- Add offline map packages
- Add mobile apps
- Split API into services if needed:
  - api-core
  - api-search
  - api-routing

---

## AI Guidance (Important)

When generating code:

- Respect folder boundaries strictly
- Do not mix frontend/backend/database logic
- Follow modular backend structure
- Prefer clean, simple, maintainable code
- Avoid over-engineering

---

## Summary

Database = source of truth  
API = business logic  
Tiles = rendering  
Clients = consumers

Maintain strict separation between these layers at all times.