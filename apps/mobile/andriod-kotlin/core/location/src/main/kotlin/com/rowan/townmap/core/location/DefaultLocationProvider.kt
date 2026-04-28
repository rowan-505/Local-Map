package com.rowan.townmap.core.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

class DefaultLocationProvider(
    private val appContext: Context
) : LocationProvider {

    override suspend fun lastKnownLocation(): LocationCoordinate? = null

    override fun hasFineLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
}
