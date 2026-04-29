# 🗺️ Tech Stack Documentation

## 1. Overview

This project is a map application focused on:

- Myanmar (initial)
- Yangon (medium detail)
- Kyauktan (high detail)

### Goals
- Fast and lightweight
- Mobile-friendly
- Scalable for future growth

---

## 2. Core Idea

Database → API → App (Web / Mobile)  
Database → Tiles → Map

- Database = source of truth  
- API = business logic  
- Tiles = map rendering only  

---

## 3. Database

- PostgreSQL  
- PostGIS  

### Used for:
- POIs (places, businesses)
- Geometry (locations)
- All map data

### Rule:
- Do NOT store important data only in tiles
- Always update database first

---

## 4. Web Application

- React (Vite)
- MapLibre GL JS
- Tailwind CSS

### Used for:
- Public map
- Feature testing

---

## 5. Admin Dashboard

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod

### Used for:
- Add/edit POIs
- Validate data
- Manage system

### Rule:
- Dashboard must use API
- Do NOT access database directly

---

## 6. Backend API

- Fastify
- TypeScript

### Used for:
- Business logic
- Search
- Authentication
- CRUD operations

### Rule:
- API handles logic only
- Do NOT generate tiles here

---

## 7. Static Tiles (Basemap)

- Planetiler / Tippecanoe
- PMTiles
- Cloudflare R2

### Used for:
- Roads
- Land
- Water
- Boundaries

### Flow:
Data → Build → PMTiles → R2 → MapLibre

### Rule:
- Update occasionally (not real-time)
- Always version tiles (v1, v2, etc.)

---

## 8. Dynamic Tiles

- Martin
- PostGIS

### Used for:
- Large dynamic data (e.g., many POIs)

### Flow:
Request → Martin → PostGIS → Tile → Map

### Rule:
- Generated on demand
- Do NOT pre-build dynamic tiles

---

## 9. Storage & CDN

- Cloudflare R2
- Cloudflare CDN

### Used for:
- Storing PMTiles
- Fast global delivery

---

## 10. Domain Structure

app.yourdomain.com → Web app  
admin.yourdomain.com → Dashboard  
api.yourdomain.com → Backend API  
tiles.yourdomain.com → Tiles (PMTiles)  

---

## 11. Mobile Applications

### Android
- Kotlin
- MapLibre Native

### iOS
- Swift
- MapLibre Native

### Used for:
- Main user-facing apps

---

## 12. Data Flow

Static Tiles:
Build → PMTiles → R2 → Map

Dynamic Tiles:
Database → Martin → Map

API:
App → API → Database

---

## 13. When to Use What

### Static Tiles
- Roads
- Land
- Boundaries
- Stable map layers

### Dynamic Tiles
- Large datasets
- Frequently changing overlays

### API (NOT tiles)
- Search results
- Single place details
- User actions (create/update)

---

## 14. Rules

- Do NOT use demo tile sources in production  
- Do NOT mix API and tile server  
- Do NOT store dynamic data in static tiles  
- Do NOT overbuild in early stage  
- Keep system modular  

---

## 15. Future Plans

- Offline map downloads
- Routing system
- Real-time updates
- Advanced search

---

## 16. Final Stack Summary

- PostgreSQL + PostGIS → Data
- Fastify → API
- Martin → Dynamic tiles
- PMTiles + R2 → Static tiles
- MapLibre → Map rendering
- Next.js → Admin dashboard
- React → Web app
- Kotlin + Swift → Mobile apps

---

## 17. Usage

### For developers
- Understand system quickly
- Follow architecture rules

### For AI tools (ChatGPT / Cursor)
- Use this file as project context
- Follow stack and rules strictly