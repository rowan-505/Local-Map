package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopContextTest {
    private val a = stop(1, "a", 16.80, 96.15)
    private val b = stop(2, "b", 16.81, 96.16)
    private val c = stop(3, "c", 16.82, 96.17)

    @Test
    fun windowUsesStopSequenceOrder() {
        val window = StopContext.window(listOf(a, b, c), "b")
        assertEquals("a", window.previous?.stopPublicId)
        assertEquals("b", window.current?.stopPublicId)
        assertEquals("c", window.next?.stopPublicId)
    }

    @Test
    fun noSelectionDoesNotAssumeCurrent() {
        val window = StopContext.window(listOf(a, b, c), null)
        assertNull(window.previous)
        assertNull(window.current)
        assertEquals("a", window.next?.stopPublicId)
    }

    @Test
    fun nearestDoesNotWriteSelection() {
        val nearest = StopContext.nearest(listOf(a, b, c), 16.811, 96.161)
        assertEquals("b", nearest?.stopPublicId)
    }

    @Test
    fun nearbyReturnsThreeStopsOrderedByDistance() {
        val nearby = StopContext.nearby(listOf(a, b, c), 16.811, 96.161)
        assertEquals(listOf("b", "c", "a"), nearby.map { it.stop.stopPublicId })
        assertTrue(nearby[0].distanceM < nearby[1].distanceM)
    }

    @Test
    fun movementReordersNearestSuggestions() {
        val beforeMove = StopContext.nearby(listOf(a, b, c), 16.8001, 96.1501)
        val afterMove = StopContext.nearby(listOf(a, b, c), 16.8199, 96.1699)

        assertEquals("a", beforeMove.first().stop.stopPublicId)
        assertEquals("c", afterMove.first().stop.stopPublicId)
        assertTrue(afterMove.zipWithNext().all { (nearer, farther) -> nearer.distanceM <= farther.distanceM })
    }

    private fun stop(seq: Int, id: String, lat: Double, lng: Double) = OrderedStopRow(
        stopSequence = seq,
        stopPublicId = id,
        stopCode = "S$seq",
        nameMy = null,
        nameEn = id,
        lat = lat,
        lng = lng,
    )
}
