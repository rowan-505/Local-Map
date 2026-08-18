 "use client";
 
 import { useQuery } from "@tanstack/react-query";
 
import {
    getAdminAreaOptions,
    getBuildingTypes,
    getCategories,
    getRefLandAreaClasses,
    getRefWaterClasses,
    getRoadClasses,
    getStreets,
} from "@/src/lib/api";

 // Cache policy: stable reference data, shared across core-review pages.
 const CORE_REVIEW_REFS_STALE_MS = 20 * 60 * 1000;
 const CORE_REVIEW_REFS_GC_MS = 60 * 60 * 1000;
 
 export const coreReviewRefQueryKeys = {
     categories: () => ["core-review", "refs", "categories"] as const,
     roadClasses: () => ["core-review", "refs", "road-classes"] as const,
     buildingTypes: () => ["core-review", "refs", "building-types"] as const,
     adminAreas: (limit: number) => ["core-review", "refs", "admin-areas", limit] as const,
     landAreaClasses: () => ["core-review", "refs", "land-area-classes"] as const,
     waterClasses: () => ["core-review", "refs", "water-classes"] as const,
    streets: (limit: number) => ["core-review", "refs", "streets", limit] as const,
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
 
 export function useCoreReviewRefLandAreaClasses(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.landAreaClasses(),
         queryFn: ({ signal }) => getRefLandAreaClasses({ signal }),
         ...refQueryDefaults(enabled),
     });
 }

 export function useCoreReviewRefWaterClasses(enabled: boolean) {
     return useQuery({
         queryKey: coreReviewRefQueryKeys.waterClasses(),
         queryFn: ({ signal }) => getRefWaterClasses({ signal }),
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
 
