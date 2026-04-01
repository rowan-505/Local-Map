package com.rowan.townmap.core.network.overpass

import retrofit2.http.Field
import retrofit2.http.FormUrlEncoded
import retrofit2.http.POST

internal interface OverpassApi {
    @FormUrlEncoded
    @POST("interpreter")
    suspend fun interpreter(@Field("data") query: String): OverpassResponse
}
