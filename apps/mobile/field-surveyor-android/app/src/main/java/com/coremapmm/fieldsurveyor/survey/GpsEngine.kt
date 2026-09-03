package com.coremapmm.fieldsurveyor.survey

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle

class GpsEngine(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(LocationManager::class.java)
    private var listener: LocationListener? = null

    @SuppressLint("MissingPermission")
    fun start(onFix: (GpsFix) -> Unit) {
        stop()
        val callback = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                onFix(toFix(location))
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

            override fun onProviderEnabled(provider: String) = Unit

            override fun onProviderDisabled(provider: String) = Unit
        }
        listener = callback
        try {
            lastKnown()?.let { last ->
                if (System.currentTimeMillis() - last.time <= GpsFixPolicy.MAX_FIX_AGE_MS) {
                    callback.onLocationChanged(last)
                }
            }
            providers().forEach { provider ->
                manager.requestLocationUpdates(
                    provider,
                    1_000L,
                    0f,
                    app.mainExecutor,
                    callback,
                )
            }
        } catch (_: SecurityException) {
            stop()
        }
    }

    fun stop() {
        listener?.let { manager.removeUpdates(it) }
        listener = null
    }

    fun gpsEnabled(): Boolean = providers().isNotEmpty()

    @SuppressLint("MissingPermission")
    private fun lastKnown(): Location? {
        return providers().firstNotNullOfOrNull { provider ->
            manager.getLastKnownLocation(provider)
        } ?: manager.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
    }

    private fun providers(): List<String> {
        val candidates = listOf(
            LocationManager.FUSED_PROVIDER,
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
        )
        return candidates.filter { provider ->
            runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false)
        }
    }

    companion object {
        fun toFix(location: Location): GpsFix = GpsFix(
            lat = location.latitude,
            lng = location.longitude,
            accuracyM = if (location.hasAccuracy()) location.accuracy else null,
            epochMs = location.time.takeIf { it > 0L } ?: System.currentTimeMillis(),
        )
    }
}
