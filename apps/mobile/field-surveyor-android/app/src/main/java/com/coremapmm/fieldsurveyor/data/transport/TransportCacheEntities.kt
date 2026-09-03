package com.coremapmm.fieldsurveyor.data.transport

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "cache_routes",
    indices = [Index(value = ["routeCode"])],
)
data class CacheRouteEntity(
    @PrimaryKey val publicId: String,
    val routeCode: String,
    val nameMy: String?,
    val nameEn: String?,
)

@Entity(
    tableName = "cache_variants",
    indices = [Index(value = ["routePublicId"])],
)
data class CacheVariantEntity(
    @PrimaryKey val publicId: String,
    val routePublicId: String,
    val variantCode: String,
    val directionId: Int,
    val originName: String?,
    val destinationName: String?,
)

@Entity(tableName = "cache_stops")
data class CacheStopEntity(
    @PrimaryKey val publicId: String,
    val stopCode: String?,
    val nameMy: String?,
    val nameEn: String?,
    val lat: Double,
    val lng: Double,
)

@Entity(
    tableName = "cache_route_stops",
    primaryKeys = ["variantPublicId", "stopSequence"],
    indices = [Index(value = ["variantPublicId"]), Index(value = ["stopPublicId"])],
)
data class CacheRouteStopEntity(
    val variantPublicId: String,
    val stopPublicId: String,
    val stopSequence: Int,
)

@Entity(tableName = "cache_route_paths")
data class CacheRoutePathEntity(
    @PrimaryKey val variantPublicId: String,
    val geometryJson: String,
)

@Entity(tableName = "cache_metadata")
data class CacheMetadataEntity(
    @PrimaryKey val id: Int = SINGLE_ROW_ID,
    val snapshotRevision: String,
) {
    companion object {
        const val SINGLE_ROW_ID = 1
    }
}

data class RouteSelectionRow(
    val routePublicId: String,
    val routeCode: String,
    val variantPublicId: String,
    val variantCode: String,
    val originName: String?,
    val destinationName: String?,
    val stopCount: Int,
)

data class OrderedStopRow(
    val stopSequence: Int,
    val stopPublicId: String,
    val stopCode: String?,
    val nameMy: String?,
    val nameEn: String?,
    val lat: Double,
    val lng: Double,
)
