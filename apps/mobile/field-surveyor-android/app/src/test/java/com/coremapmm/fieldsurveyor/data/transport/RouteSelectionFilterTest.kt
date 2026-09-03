package com.coremapmm.fieldsurveyor.data.transport

import org.junit.Assert.assertEquals
import org.junit.Test

class RouteSelectionFilterTest {
    private val rows = listOf(
        RouteSelectionRow(
            routePublicId = "r1",
            routeCode = "YBS-13",
            variantPublicId = "v0",
            variantCode = "D0",
            originName = "A",
            destinationName = "B",
            stopCount = 4,
        ),
        RouteSelectionRow(
            routePublicId = "r1",
            routeCode = "YBS-13",
            variantPublicId = "v1",
            variantCode = "D1",
            originName = "B",
            destinationName = "A",
            stopCount = 4,
        ),
        RouteSelectionRow(
            routePublicId = "r2",
            routeCode = "YBS-21",
            variantPublicId = "v2",
            variantCode = "D0",
            originName = "C",
            destinationName = "D",
            stopCount = 8,
        ),
        RouteSelectionRow("r3", "YBS-119", "v3", "D0", "E", "F", 6),
        RouteSelectionRow("r4", "YBS-19", "v4", "D1", "G", "H", 7),
        RouteSelectionRow("r4", "YBS-19", "v5", "D0", "H", "G", 7),
        RouteSelectionRow("r5", "YBS-190", "v6", "D0", "I", "J", 9),
    )

    @Test
    fun filtersLocallyByRouteCodeWithoutNetwork() {
        val found = RouteSelectionFilter.byRouteCode(rows, "13")
        assertEquals(listOf("YBS-13", "YBS-13"), found.map { it.routeCode })
        assertEquals(listOf("D0", "D1"), found.map { it.variantCode })
    }

    @Test
    fun emptyQueryReturnsAll() {
        assertEquals(rows.size, RouteSelectionFilter.byRouteCode(rows, "  ").size)
    }

    @Test
    fun exactRouteNumberRanksBeforeContainingCodes() {
        val found = RouteSelectionFilter.byRouteCode(rows, "19")
        assertEquals(listOf("YBS-19", "YBS-19", "YBS-190", "YBS-119"), found.map { it.routeCode })
        assertEquals(listOf("D0", "D1"), found.take(2).map { it.variantCode })
    }

    @Test
    fun acceptsPrefixedRouteInput() {
        val found = RouteSelectionFilter.byRouteCode(rows, " ybs 19 ")
        assertEquals("YBS-19", found.first().routeCode)
    }
}
