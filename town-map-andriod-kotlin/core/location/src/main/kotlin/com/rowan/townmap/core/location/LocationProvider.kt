package com.rowan.townmap.core.location

interface LocationProvider {

    suspend fun lastKnownLocation(): LocationCoordinate?

    fun hasFineLocationPermission(): Boolean
}
