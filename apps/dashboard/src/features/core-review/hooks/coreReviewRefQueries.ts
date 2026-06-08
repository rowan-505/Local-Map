 "use client";
 
 import { useQuery } from "@tanstack/react-query";
 
 import {
     getAdminAreaOptions,
     getBuildingTypes,
     getCategories,
     getCoreReviewList,
     getRefLanduseClasses,
     getRoadClasses,
     getStreets,
 } from "@/src/lib/api";
 import type { CoreReviewBusRouteRow } from "@/src/features/core-review/config/types";
 
 // Cache policy: stable reference data, shared across core-review pages.
 const CORE_REVIEW_REFS_STALE_MS = 20 * 60 * 1000;
 const CORE_REVIEW_REFS_GC_MS = 60 * 60 * 1000;
 
 export const coreReviewRefQueryKeys = {
     categories: () => ["core-review", "refs", "categories"] as const,
     roadClasses: () => ["core-review", "refs", "road-classes"] as const,
     buildingTypes: () => ["core-review", "refs", "building-types"] as const,
     adminAreas: (limit: number) => ["core-review", "refs", "admin-areas", limit] as const,
     landuseClasses: () => ["core-review", "refs", "landuse-classes"] as const,
     streets: (limit: number) => ["core-review", "refs", "streets", limit] as const,
     busRoutes: (pageSize: number) => ["core-review", "refs", "bus-routes", pageSize] as const,
 } as const;
 
 function refQueryDefaults(enabled: boolean) {
     return {
         enabled,
         staleTime: CORE_REVIEW_REFS_STALE_MS,
         gcTime: CORE_REVIEW_REFS_GC_MS,
         refetchOnWindowFocus: false,
         refetchOnMount: false,
     } as const;
 }
 
 export function useCoreReviewRefCategories(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.categories(),
         queryFn: () => getCategories(),
         ...refQueryDefaults(enabled),
     });
 }
 
 export function useCoreReviewRefRoadClasses(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.roadClasses(),
         queryFn: ({ signal }) => getRoadClasses({ signal }),
         ...refQueryDefaults(enabled),
     });
 }
 
 export function useCoreReviewRefBuildingTypes(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.buildingTypes(),
         queryFn: ({ signal }) => getBuildingTypes({ signal }),
         ...refQueryDefaults(enabled),
     });
 }
 
export function useCoreReviewRefAdminAreas(limit: number, enabled: boolean, townshipOnly = false) {
    return useQuery({
        queryKey: [...coreReviewRefQueryKeys.adminAreas(limit), townshipOnly ? "township" : "all"],
        queryFn: () => getAdminAreaOptions({ limit, townshipOnly }),
        ...refQueryDefaults(enabled),
    });
}
 
 export function useCoreReviewRefLanduseClasses(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.landuseClasses(),
         queryFn: ({ signal }) => getRefLanduseClasses({ signal }),
         ...refQueryDefaults(enabled),
     });
 }
 
 export function useCoreReviewRefStreets(limit: number, enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.streets(limit),
         queryFn: ({ signal }) => getStreets({ limit }, { signal }),
         ...refQueryDefaults(enabled),
     });
 }
 
 export function useCoreReviewRefBusRoutes(pageSize: number, enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.busRoutes(pageSize),
         queryFn: ({ signal }) =>
             getCoreReviewList<CoreReviewBusRouteRow>("bus-routes", { page: 1, pageSize }, { signal }).then(
                 (res) => res.data
             ),
         ...refQueryDefaults(enabled),
     });
 }
 
