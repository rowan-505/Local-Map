package com.coremapmm.fieldsurveyor.survey

object GpsFixPolicy {
    const val STALE_BEHIND_MS = 3_000L
    const val MIN_MOVE_METERS = 1.0
    const val HEARTBEAT_MS = 2_000L
    /** Drop lastKnown / cached provider samples that are too old for field capture. */
    const val MAX_FIX_AGE_MS = 30_000L

    /**
     * GPS and network can both fire. Drop stale or duplicate jitter.
     * Keep a heartbeat so the blue dot and accuracy label stay fresh.
     */
    fun publish(previous: GpsFix?, next: GpsFix, nowEpochMs: Long): GpsFix? {
        if (nowEpochMs - next.epochMs > MAX_FIX_AGE_MS) {
            return null
        }
        if (previous == null) {
            return next
        }
        if (next.epochMs + STALE_BEHIND_MS < previous.epochMs) {
            return null
        }
        val moved = StopContext.haversineMeters(
            previous.lat,
            previous.lng,
            next.lat,
            next.lng,
        ) >= MIN_MOVE_METERS
        val betterAccuracy = (next.accuracyM ?: Float.MAX_VALUE) + 3f <
            (previous.accuracyM ?: Float.MAX_VALUE)
        val heartbeat = next.epochMs - previous.epochMs >= HEARTBEAT_MS
        return if (moved || betterAccuracy || heartbeat) next else null
    }
}

object GpsCameraFollow {
    /** Same value as MapLibre [org.maplibre.android.maps.MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE]. */
    const val REASON_GESTURE = 1
    const val FOLLOW_MOVE_METERS = 1.0

    fun followingAfterMoveStarted(reason: Int, following: Boolean): Boolean {
        return if (reason == REASON_GESTURE) false else following
    }

    fun cameraZoom(focusOnUser: Boolean, currentZoom: Double): Double {
        val zoom = if (focusOnUser) SurveyMapOverlays.GPS_ZOOM else currentZoom
        return zoom.coerceIn(SurveyMapOverlays.MIN_ZOOM, SurveyMapOverlays.MAX_ZOOM)
    }

    fun stopFocusZoom(currentZoom: Double): Double {
        return maxOf(currentZoom, SurveyMapOverlays.GPS_ZOOM)
            .coerceIn(SurveyMapOverlays.MIN_ZOOM, SurveyMapOverlays.MAX_ZOOM)
    }

    fun shouldMoveCamera(
        following: Boolean,
        focusOnUser: Boolean,
        previous: GpsFix?,
        next: GpsFix?,
    ): Boolean {
        if (next == null) {
            return false
        }
        if (focusOnUser) {
            return true
        }
        if (!following) {
            return false
        }
        if (previous == null) {
            return true
        }
        return StopContext.haversineMeters(
            previous.lat,
            previous.lng,
            next.lat,
            next.lng,
        ) >= FOLLOW_MOVE_METERS
    }
}
