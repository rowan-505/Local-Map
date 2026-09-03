package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyMapOverlaysTest {
    @Test
    fun routeFitIncludesPathAndStops() {
        val path = listOf(96.15 to 16.78, 96.20 to 16.85)
        val stops = listOf(
            OrderedStopRow(1, "a", "A", null, null, 16.90, 96.10),
        )

        val points = SurveyMapOverlays.routeFitLatLngs(path, stops)

        assertEquals(3, points.size)
        assertEquals(16.78, points[0].latitude, 0.000001)
        assertEquals(96.15, points[0].longitude, 0.000001)
        assertEquals(16.90, points[2].latitude, 0.000001)
        assertEquals(96.10, points[2].longitude, 0.000001)
        assertTrue(points.minOf { it.latitude } <= 16.78)
        assertTrue(points.maxOf { it.latitude } >= 16.90)
    }

    @Test
    fun routeFitWorksWithStopsOnly() {
        val stops = listOf(
            OrderedStopRow(1, "a", null, null, null, 16.8, 96.1),
        )
        assertEquals(1, SurveyMapOverlays.routeFitLatLngs(emptyList(), stops).size)
        assertTrue(SurveyMapOverlays.routeFitLatLngs(emptyList(), emptyList()).isEmpty())
    }
}
