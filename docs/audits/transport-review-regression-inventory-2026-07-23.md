# Transport review feature inventory — 2026-07-23

Plugin mount: `/transport`. Audit writes use `insertTransportAuditLog` → `transport.transport_audit_logs`.

| Feature | Dashboard client | Endpoint | Schema | Service | Repo | Tables | Audit |
|---|---|---|---|---|---|---|---|
| Merge preview | `previewTransportStopMerge` | `POST /stops/merge-preview` | `stopMergePreviewBodySchema` | `getStopMergePreview` | `getStopMergePreview` | stops, stop_names, route_stops, variants, routes, terminals | no |
| Merge execution | `mergeTransportStopsGlobal` | `POST /stops/merge` | `stopMergeGlobalBodySchema` | `mergeStopsGlobal` | `mergeStopsKeepCanonical` | stops, names, route_stops, variants, terminals, source_links, fares | `transport.stop.merge` |
| Remove from route | `removeTransportRouteStop` | `DELETE /route-stops/:id` | `removeRouteStopBodySchema` | `removeRouteStop` | `removeRouteStop` | route_stops, variants | `transport.route_stop.remove` |
| Replace stop | `replaceTransportRouteStop` | `PATCH /route-stops/:id/replace-stop` | `replaceRouteStopBodySchema` | `replaceRouteStop` | `TransportReviewOperations.replaceRouteStop` | route_stops, stops | `transport.route_stop.replace_stop` |
| Insert existing | `insertExistingRouteStop` | `POST /route-variants/:id/stops/insert-existing` | `insertExistingRouteStopBodySchema` | `insertExistingRouteStop` | `insertExistingRouteStop` | route_stops, stops | `transport.route_stop.insert` |
| Create-and-insert | `createAndInsertRouteStop` | `POST /route-variants/:id/stops/create-and-insert` | `createAndInsertRouteStopBodySchema` | `createAndInsertRouteStop` | `createAndInsertRouteStop` | stops, names, route_stops | create + insert |
| Archive stop | `archiveTransportStop` | `DELETE /stops/:publicId` | `archiveStopBodySchema` | `archiveStop` | `archiveStopByPublicId` | stops, terminals | `transport.stop.archive` |
| Permanent delete | `permanentDeleteTransportStop` | `DELETE /stops/:publicId/permanent` | archive body + params | `permanentDeleteStop` | `permanentDeleteStopByPublicId` | stops, names, source_links | `transport.stop.delete` |
| Nearby candidates | `getNearbyTransportStopCandidates` | `GET /stops/nearby-candidates` | `nearbyTransportStopCandidatesQuerySchema` | `listNearbyStopCandidates` | `listNearbyStopCandidates` | stops | no |
| Route usage detail | `getTransportStopRouteUsageDetail` | `GET /stops/:id/route-usage-detail` | publicId param | `getStopRouteUsageDetail` | same | stops, route_stops, variants, routes | no |
| Route review | `applyTransportRouteReviewAction` | `POST /routes/:id/review-action` | `transportReviewActionBodySchema` | `applyRouteReviewAction` | review ops | routes | `transport.route.review_status` |
| Path review | `applyTransportRoutePathReviewAction` | `POST /route-paths/:id/review-action` | same | `applyRoutePathReviewAction` | review ops | route_paths | `transport.route_path.review_status` |
| Stop review | `applyTransportStopReviewAction` | `POST /stops/:id/review-action` | same | `applyStopReviewAction` | review ops | stops | `transport.stop.review_status` |
| Path generation | `generateTransportVariantPathFromStops` | `POST /route-variants/:id/generate-path-from-stops` | publicId param | `generatePathFromStops` | path upsert helpers | variants, route_stops, paths | path create/update |
| Path editing | `putTransportVariantPath` | `PUT /variants/:id/path` | `putVariantPathBodySchema` | `upsertVariantPath` | `upsertVariantPath` | route_paths | path create/update |
| Path deletion | `deleteTransportVariantPath` | `DELETE /variants/:id/path` | variant param | `deleteVariantPath` | `deleteVariantPath` | route_paths | `transport.route_path.delete` |
| Timing edit | `patchTransportRouteStopTiming` | `PATCH /route-stops/:id/timing` | `patchRouteStopTimingBodySchema` | `updateRouteStopTiming` | same | route_stops | `transport.route_stop.update_timing` |
| Overview | `getTransportOverview` | `GET /overview` | OpenAPI only | `getOverview` | `getOverview` | counts aggregates | no |
| Quality summary | `getTransportQualitySummary` | `GET /quality-summary` | OpenAPI only | `getQualitySummary` | same | routes/variants/stops | no |
| Quality queues | `getTransportDataQualityQueues` | `GET /data-quality/queues` | OpenAPI only | `getDataQualityQueues` | same | queues | no |
| Routes list/detail | `getTransportRoutes` / `getTransportRouteDetail` | `GET /routes`, `GET /routes/:id` | list query + publicId | `listRoutes` / `getRoute` | same | routes, variants, paths | no |
| Variants / ordered stops | `getTransportRouteVariants`, `getTransportVariantOrderedStops` | `GET /routes/:id/variants`, `GET /route-variants/:id/ordered-stops` | params + query | list/get helpers | same | variants, route_stops, stops | no |

## Fixture coverage (`apps/api/src/modules/transport/regression/fixtures.ts`)

Supports: no terminal, canonical-only, duplicate-only, both terminals, same-variant, different-variant, origin/destination refs, parent/child, duplicate names, bigint `admin_area_id`, inactive/deleted rows. Worlds are in-memory and restored on simulated rollback (no production DML).
