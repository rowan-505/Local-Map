package com.coremapmm.fieldsurveyor.data.transport

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
abstract class TransportCacheDao {
    @Query("SELECT snapshotRevision FROM cache_metadata WHERE id = 1 LIMIT 1")
    abstract suspend fun snapshotRevision(): String?

    @Query("SELECT COUNT(*) FROM cache_routes")
    abstract suspend fun routeCount(): Int

    @Query("SELECT COUNT(*) FROM cache_variants")
    abstract suspend fun variantCount(): Int

    @Query(
        """
        SELECT r.publicId AS routePublicId,
               r.routeCode AS routeCode,
               v.publicId AS variantPublicId,
               v.variantCode AS variantCode,
               v.originName AS originName,
               v.destinationName AS destinationName,
               (SELECT COUNT(*) FROM cache_route_stops rs WHERE rs.variantPublicId = v.publicId) AS stopCount
        FROM cache_variants v
        INNER JOIN cache_routes r ON r.publicId = v.routePublicId
        ORDER BY r.routeCode COLLATE NOCASE ASC, v.directionId ASC
        """,
    )
    abstract suspend fun listRouteSelections(): List<RouteSelectionRow>

    @Query(
        """
        SELECT * FROM cache_routes
        WHERE routeCode LIKE '%' || :query || '%'
        ORDER BY routeCode COLLATE NOCASE ASC
        """,
    )
    abstract suspend fun searchRoutesByCode(query: String): List<CacheRouteEntity>

    @Query(
        """
        SELECT * FROM cache_variants
        WHERE routePublicId = :routePublicId
        ORDER BY directionId ASC
        """,
    )
    abstract suspend fun variantsForRoute(routePublicId: String): List<CacheVariantEntity>

    @Query(
        """
        SELECT rs.stopSequence AS stopSequence,
               s.publicId AS stopPublicId,
               s.stopCode AS stopCode,
               s.nameMy AS nameMy,
               s.nameEn AS nameEn,
               s.lat AS lat,
               s.lng AS lng
        FROM cache_route_stops rs
        INNER JOIN cache_stops s ON s.publicId = rs.stopPublicId
        WHERE rs.variantPublicId = :variantPublicId
        ORDER BY rs.stopSequence ASC
        """,
    )
    abstract suspend fun orderedStops(variantPublicId: String): List<OrderedStopRow>

    @Query("SELECT geometryJson FROM cache_route_paths WHERE variantPublicId = :variantPublicId LIMIT 1")
    abstract suspend fun routePathJson(variantPublicId: String): String?

    @Query("SELECT * FROM cache_stops WHERE publicId = :stopPublicId LIMIT 1")
    abstract suspend fun stopById(stopPublicId: String): CacheStopEntity?

    @Query("DELETE FROM cache_route_paths")
    abstract suspend fun deletePaths()

    @Query("DELETE FROM cache_route_stops")
    abstract suspend fun deleteRouteStops()

    @Query("DELETE FROM cache_stops")
    abstract suspend fun deleteStops()

    @Query("DELETE FROM cache_variants")
    abstract suspend fun deleteVariants()

    @Query("DELETE FROM cache_routes")
    abstract suspend fun deleteRoutes()

    @Query("DELETE FROM cache_metadata")
    abstract suspend fun deleteMetadata()

    @Insert
    abstract suspend fun insertRoutes(rows: List<CacheRouteEntity>)

    @Insert
    abstract suspend fun insertVariants(rows: List<CacheVariantEntity>)

    @Insert
    abstract suspend fun insertStops(rows: List<CacheStopEntity>)

    @Insert
    abstract suspend fun insertRouteStops(rows: List<CacheRouteStopEntity>)

    @Insert
    abstract suspend fun insertPaths(rows: List<CacheRoutePathEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertMetadata(row: CacheMetadataEntity)

    /**
     * Full replace. Revision is written last in the same SQLite transaction so a
     * failed insert never publishes a new snapshotRevision.
     */
    @Transaction
    open suspend fun replaceSnapshot(snapshot: ValidatedSnapshot) {
        deletePaths()
        deleteRouteStops()
        deleteStops()
        deleteVariants()
        deleteRoutes()
        deleteMetadata()
        if (snapshot.routes.isNotEmpty()) insertRoutes(snapshot.routes)
        if (snapshot.variants.isNotEmpty()) insertVariants(snapshot.variants)
        if (snapshot.stops.isNotEmpty()) insertStops(snapshot.stops)
        if (snapshot.routeStops.isNotEmpty()) insertRouteStops(snapshot.routeStops)
        if (snapshot.paths.isNotEmpty()) insertPaths(snapshot.paths)
        upsertMetadata(CacheMetadataEntity(snapshotRevision = snapshot.snapshotRevision))
    }
}
