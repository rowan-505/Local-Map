package com.rowan.townmap.core.network.overpass

import com.rowan.townmap.core.model.Place
import com.rowan.townmap.core.network.overpass.internal.createOverpassRetrofit
import retrofit2.Retrofit

private const val DefaultBaseUrl = "https://overpass-api.de/api/"

/**
 * Overpass API client (POST `/api/interpreter` with `data=` form field).
 *
 * Callers must hold [android.permission.INTERNET] in the application manifest.
 */
class OverpassClient private constructor(
    private val api: OverpassApi,
) {

    constructor(
        baseUrl: String = DefaultBaseUrl,
        retrofit: Retrofit = createOverpassRetrofit(baseUrl),
    ) : this(retrofit.create(OverpassApi::class.java))

    /**
     * Fetches named shops and named amenities (including restaurants, schools, etc.) in the Kyauktan bbox.
     *
     * @return [Result] with [Place] rows, or failure (HTTP / network / parse).
     */
    suspend fun fetchKyauktanPlaces(): Result<List<Place>> = runCatching {
        val query = buildKyauktanPoiQuery()
        val response = api.interpreter(query)
        response.elements
            .mapNotNull { it.toPlaceOrNull() }
            .distinctBy { it.id }
    }
}
