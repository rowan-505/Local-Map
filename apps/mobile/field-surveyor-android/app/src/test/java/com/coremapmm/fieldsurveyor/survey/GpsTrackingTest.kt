package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsTrackingTest {
    @Test
    fun firstFixIsPublished() {
        val next = GpsFix(16.80, 96.15, 8f, 1_000L)
        assertEquals(next, GpsFixPolicy.publish(null, next, next.epochMs))
    }

    @Test
    fun olderFixIsDropped() {
        val previous = GpsFix(16.80, 96.15, 8f, 10_000L)
        val stale = GpsFix(16.81, 96.16, 5f, 1_000L)
        assertNull(GpsFixPolicy.publish(previous, stale, 10_000L))
    }

    @Test
    fun walkingFixesArePublished() {
        var previous: GpsFix? = null
        val published = (0 until 5).mapNotNull { step ->
            val next = GpsFix(
                lat = 16.80 + (step * 0.00012),
                lng = 96.15,
                accuracyM = 6f,
                epochMs = 1_000L + (step * 1_000L),
            )
            val accepted = GpsFixPolicy.publish(previous, next, next.epochMs)
            if (accepted != null) {
                previous = accepted
            }
            accepted
        }
        assertEquals(5, published.size)
        val moved = StopContext.haversineMeters(
            published.first().lat,
            published.first().lng,
            published.last().lat,
            published.last().lng,
        )
        assertTrue(moved > 40.0)
    }

    @Test
    fun everyMeaningfulMovementRefreshesTheMapFix() {
        var displayed = GpsFix(16.800000, 96.150000, 7f, 1_000L)
        repeat(6) { step ->
            val moved = GpsFix(
                lat = 16.800000 + ((step + 1) * 0.00002),
                lng = 96.150000,
                accuracyM = 7f,
                epochMs = 2_000L + (step * 1_000L),
            )
            displayed = GpsFixPolicy.publish(displayed, moved, moved.epochMs)
                ?: displayed
        }
        assertEquals(16.800120, displayed.lat, 0.000001)
        assertEquals(7_000L, displayed.epochMs)
    }

    @Test
    fun tinyJitterIsNotPublishedUntilHeartbeat() {
        val first = GpsFix(16.80, 96.15, 8f, 1_000L)
        val jitter = GpsFix(16.800001, 96.150001, 8f, 1_400L)
        assertNull(GpsFixPolicy.publish(first, jitter, jitter.epochMs))
        val heartbeat = GpsFix(16.800001, 96.150001, 8f, 3_200L)
        assertNotNull(GpsFixPolicy.publish(first, heartbeat, heartbeat.epochMs))
    }

    @Test
    fun cachedLastKnownOlderThanThirtySecondsIsDropped() {
        val cached = GpsFix(16.80, 96.15, 8f, 1_000L)
        assertNull(GpsFixPolicy.publish(null, cached, 1_000L + GpsFixPolicy.MAX_FIX_AGE_MS + 1L))
    }

    @Test
    fun followMovesCameraWhenUserWalks() {
        val start = GpsFix(16.80, 96.15, 5f, 1_000L)
        val walked = GpsFix(16.8002, 96.15, 5f, 2_000L)
        assertTrue(GpsCameraFollow.shouldMoveCamera(true, false, start, walked))
        assertFalse(GpsCameraFollow.shouldMoveCamera(false, false, start, walked))
        assertTrue(GpsCameraFollow.shouldMoveCamera(false, true, start, start))
    }

    @Test
    fun followDoesNotChaseJitter() {
        val start = GpsFix(16.80, 96.15, 5f, 1_000L)
        val jitter = GpsFix(16.800001, 96.150001, 5f, 2_000L)
        assertFalse(GpsCameraFollow.shouldMoveCamera(true, false, start, jitter))
    }

    @Test
    fun panGestureTurnsFollowOff() {
        assertFalse(GpsCameraFollow.followingAfterMoveStarted(GpsCameraFollow.REASON_GESTURE, true))
        assertTrue(GpsCameraFollow.followingAfterMoveStarted(2, true))
    }

    @Test
    fun meButtonUsesStreetZoom() {
        assertEquals(16.0, GpsCameraFollow.cameraZoom(true, 11.0), 0.01)
        assertEquals(12.0, GpsCameraFollow.cameraZoom(false, 12.0), 0.01)
    }

    @Test
    fun selectingAStopUsesAtLeastStreetZoom() {
        assertEquals(16.0, GpsCameraFollow.stopFocusZoom(11.0), 0.01)
        assertEquals(18.0, GpsCameraFollow.stopFocusZoom(18.0), 0.01)
    }
}
