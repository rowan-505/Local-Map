package com.coremapmm.fieldsurveyor.data.transport

import org.json.JSONObject

class SnapshotParseException(message: String) : Exception(message)

sealed class BootstrapPayload {
    data class Unchanged(val snapshotRevision: String) : BootstrapPayload()
    data class Dataset(val raw: JSONObject) : BootstrapPayload()
}

object BootstrapJson {
    fun parseResponse(body: String): BootstrapPayload {
        val root = try {
            JSONObject(body)
        } catch (error: Exception) {
            throw SnapshotParseException("Bootstrap response is not JSON")
        }
        val revision = root.optString("snapshotRevision").trim()
        if (revision.isEmpty()) {
            throw SnapshotParseException("snapshotRevision is missing")
        }
        val unchanged = root.optBoolean("unchanged", false)
        return if (unchanged) {
            BootstrapPayload.Unchanged(revision)
        } else {
            BootstrapPayload.Dataset(root)
        }
    }

    fun parseDataset(root: JSONObject): UnvalidatedSnapshot {
        val revision = root.optString("snapshotRevision").trim()
        return UnvalidatedSnapshot(
            snapshotRevision = revision,
            routes = parseObjectArray(root, "routes"),
            variants = parseObjectArray(root, "variants"),
            stops = parseObjectArray(root, "stops"),
            routeStops = parseObjectArray(root, "routeStops"),
            routePaths = parseObjectArray(root, "routePaths"),
        )
    }

    private fun parseObjectArray(root: JSONObject, key: String): List<JSONObject> {
        val array = root.optJSONArray(key) ?: throw SnapshotParseException("$key is missing")
        return buildList {
            for (i in 0 until array.length()) {
                add(array.optJSONObject(i) ?: throw SnapshotParseException("$key[$i] is not an object"))
            }
        }
    }
}

data class UnvalidatedSnapshot(
    val snapshotRevision: String,
    val routes: List<JSONObject>,
    val variants: List<JSONObject>,
    val stops: List<JSONObject>,
    val routeStops: List<JSONObject>,
    val routePaths: List<JSONObject>,
)

data class ValidatedSnapshot(
    val snapshotRevision: String,
    val routes: List<CacheRouteEntity>,
    val variants: List<CacheVariantEntity>,
    val stops: List<CacheStopEntity>,
    val routeStops: List<CacheRouteStopEntity>,
    val paths: List<CacheRoutePathEntity>,
)

object SnapshotValidator {
    fun validate(raw: UnvalidatedSnapshot): ValidatedSnapshot {
        if (raw.snapshotRevision.isBlank()) {
            throw SnapshotParseException("snapshotRevision is blank")
        }
        val routes = raw.routes.mapIndexed { index, json -> parseRoute(json, index) }
        val routeIds = routes.map { it.publicId }.toHashSet()
        if (routeIds.size != routes.size) {
            throw SnapshotParseException("duplicate route publicId")
        }
        val variants = raw.variants.mapIndexed { index, json -> parseVariant(json, index, routeIds) }
        val variantIds = variants.map { it.publicId }.toHashSet()
        if (variantIds.size != variants.size) {
            throw SnapshotParseException("duplicate variant publicId")
        }
        val stops = raw.stops.mapIndexed { index, json -> parseStop(json, index) }
        val stopIds = stops.map { it.publicId }.toHashSet()
        if (stopIds.size != stops.size) {
            throw SnapshotParseException("duplicate stop publicId")
        }
        val routeStops = raw.routeStops.mapIndexed { index, json ->
            parseRouteStop(json, index, variantIds, stopIds)
        }
        val paths = raw.routePaths.mapIndexed { index, json -> parsePath(json, index, variantIds) }
        return ValidatedSnapshot(
            snapshotRevision = raw.snapshotRevision,
            routes = routes,
            variants = variants,
            stops = stops,
            routeStops = routeStops,
            paths = paths,
        )
    }

    private fun parseRoute(json: JSONObject, index: Int): CacheRouteEntity {
        val publicId = requireId(json, "publicId", "routes[$index]")
        val routeCode = json.optString("routeCode").trim()
        if (routeCode.isEmpty()) {
            throw SnapshotParseException("routes[$index].routeCode is blank")
        }
        return CacheRouteEntity(
            publicId = publicId,
            routeCode = routeCode,
            nameMy = json.nullableString("nameMy"),
            nameEn = json.nullableString("nameEn"),
        )
    }

    private fun parseVariant(json: JSONObject, index: Int, routeIds: Set<String>): CacheVariantEntity {
        val publicId = requireId(json, "publicId", "variants[$index]")
        val routePublicId = requireId(json, "routePublicId", "variants[$index]")
        if (!routeIds.contains(routePublicId)) {
            throw SnapshotParseException("variants[$index] references unknown route")
        }
        val variantCode = json.optString("variantCode").trim()
        val directionId = json.optInt("directionId", -1)
        val expectedDirection = when (variantCode) {
            "D0" -> 0
            "D1" -> 1
            else -> throw SnapshotParseException("variants[$index].variantCode must be D0 or D1")
        }
        if (directionId != expectedDirection) {
            throw SnapshotParseException("variants[$index] D0/D1 does not match directionId")
        }
        return CacheVariantEntity(
            publicId = publicId,
            routePublicId = routePublicId,
            variantCode = variantCode,
            directionId = directionId,
            originName = json.nullableString("originName"),
            destinationName = json.nullableString("destinationName"),
        )
    }

    private fun parseStop(json: JSONObject, index: Int): CacheStopEntity {
        val lat = json.optDouble("lat", Double.NaN)
        val lng = json.optDouble("lng", Double.NaN)
        if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) {
            throw SnapshotParseException("stops[$index] has invalid coordinates")
        }
        return CacheStopEntity(
            publicId = requireId(json, "publicId", "stops[$index]"),
            stopCode = json.nullableString("stopCode"),
            nameMy = json.nullableString("nameMy"),
            nameEn = json.nullableString("nameEn"),
            lat = lat,
            lng = lng,
        )
    }

    private fun parseRouteStop(
        json: JSONObject,
        index: Int,
        variantIds: Set<String>,
        stopIds: Set<String>,
    ): CacheRouteStopEntity {
        val variantPublicId = requireId(json, "variantPublicId", "routeStops[$index]")
        val stopPublicId = requireId(json, "stopPublicId", "routeStops[$index]")
        val sequence = json.optInt("stopSequence", -1)
        if (sequence < 1) {
            throw SnapshotParseException("routeStops[$index].stopSequence must be >= 1")
        }
        if (!variantIds.contains(variantPublicId)) {
            throw SnapshotParseException("routeStops[$index] references unknown variant")
        }
        if (!stopIds.contains(stopPublicId)) {
            throw SnapshotParseException("routeStops[$index] references unknown stop")
        }
        return CacheRouteStopEntity(
            variantPublicId = variantPublicId,
            stopPublicId = stopPublicId,
            stopSequence = sequence,
        )
    }

    private fun parsePath(json: JSONObject, index: Int, variantIds: Set<String>): CacheRoutePathEntity {
        val variantPublicId = requireId(json, "variantPublicId", "routePaths[$index]")
        if (!variantIds.contains(variantPublicId)) {
            throw SnapshotParseException("routePaths[$index] references unknown variant")
        }
        val geometry = json.optJSONObject("geometry")
            ?: throw SnapshotParseException("routePaths[$index].geometry is missing")
        if (geometry.optString("type") != "LineString") {
            throw SnapshotParseException("routePaths[$index] must be a LineString")
        }
        val coordinates = geometry.optJSONArray("coordinates")
            ?: throw SnapshotParseException("routePaths[$index] coordinates missing")
        if (coordinates.length() < 2) {
            throw SnapshotParseException("routePaths[$index] needs at least 2 coordinates")
        }
        for (i in 0 until coordinates.length()) {
            val pair = coordinates.optJSONArray(i)
                ?: throw SnapshotParseException("routePaths[$index] coordinate $i invalid")
            val lng = pair.optDouble(0, Double.NaN)
            val lat = pair.optDouble(1, Double.NaN)
            if (!lng.isFinite() || !lat.isFinite()) {
                throw SnapshotParseException("routePaths[$index] coordinate $i is not finite")
            }
        }
        return CacheRoutePathEntity(
            variantPublicId = variantPublicId,
            geometryJson = geometry.toString(),
        )
    }

    private fun requireId(json: JSONObject, key: String, label: String): String {
        val value = json.optString(key).trim()
        if (value.length < 32) {
            throw SnapshotParseException("$label.$key is not a public id")
        }
        return value
    }

    private fun JSONObject.nullableString(key: String): String? {
        if (!has(key) || isNull(key)) {
            return null
        }
        val value = optString(key).trim()
        return value.ifEmpty { null }
    }
}

object RouteSelectionFilter {
    fun byRouteCode(rows: List<RouteSelectionRow>, query: String): List<RouteSelectionRow> {
        val needle = normalizeRouteCode(query)
        if (needle.isEmpty()) {
            return rows
        }
        return rows
            .mapNotNull { row ->
                val code = normalizeRouteCode(row.routeCode)
                val rank = when {
                    code == needle -> 0
                    code.startsWith(needle) -> 1
                    code.contains(needle) -> 2
                    else -> return@mapNotNull null
                }
                Triple(row, rank, code.toIntOrNull() ?: Int.MAX_VALUE)
            }
            .sortedWith(
                compareBy<Triple<RouteSelectionRow, Int, Int>> { it.second }
                    .thenBy { it.third }
                    .thenBy { it.first.routeCode.lowercase() }
                    .thenBy { it.first.variantCode.lowercase() },
            )
            .map { it.first }
    }

    private fun normalizeRouteCode(value: String): String = value
        .trim()
        .uppercase()
        .removePrefix("YBS")
        .filter { it.isLetterOrDigit() }
}

object RoutePathGeometry {
    fun hasLineString(geometryJson: String): Boolean {
        val geometry = JSONObject(geometryJson)
        if (geometry.optString("type") != "LineString") {
            return false
        }
        val coordinates = geometry.optJSONArray("coordinates") ?: return false
        return coordinates.length() >= 2
    }
}
