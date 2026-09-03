package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureAndPayloadTest {
    @Test
    fun sameButtonUnder80msIsDropped() {
        assertFalse(
            CaptureDebounce.shouldAccept(AnomalyKind.MOVED, 1_000L, AnomalyKind.MOVED, 1_079L),
        )
    }

    @Test
    fun twentyRapidCapturesAt90msAllAccepted() {
        var last: AnomalyKind? = null
        var t = 0L
        var accepted = 0
        repeat(20) {
            if (CaptureDebounce.shouldAccept(last, t, AnomalyKind.DATA, t + 90L)) {
                accepted += 1
                last = AnomalyKind.DATA
                t += 90L
            }
        }
        assertEquals(20, accepted)
    }

    @Test
    fun differentButtonsAreNotCollapsed() {
        assertTrue(
            CaptureDebounce.shouldAccept(AnomalyKind.MOVED, 1_000L, AnomalyKind.MISSING, 1_001L),
        )
    }

    @Test
    fun payloadIncludesRevisionGpsAndStopSnapshot() {
        val json = AnomalyPayload.toJson(
            AnomalyCaptureInput(
                kind = AnomalyKind.MOVED,
                snapshotRevision = "rev-1",
                routePublicId = "route-1",
                routeCode = "YBS-13",
                variantPublicId = "var-1",
                variantCode = "D0",
                selectedStop = OrderedStopRow(
                    stopSequence = 4,
                    stopPublicId = "stop-1",
                    stopCode = "S4",
                    nameMy = null,
                    nameEn = "Corner",
                    lat = 16.8,
                    lng = 96.15,
                ),
                gps = GpsFix(16.801, 96.151, 4.2f, 1_700_000_000_000L),
                observedAtIso = "2026-09-02T09:00:00Z",
                clientPublicId = "11111111-1111-4111-8111-111111111111",
                createdAtEpochMs = 1_700_000_000_000L,
            ),
        )
        val root = JSONObject(json)
        assertEquals("11111111-1111-4111-8111-111111111111", root.getString("clientPublicId"))
        assertEquals("wrong_location", root.getString("reportTypeCode"))
        assertEquals("MOVED", root.getString("anomalyKind"))
        assertEquals(16.801, root.getJSONObject("location").getDouble("lat"), 0.0001)
        val context = root.getJSONObject("context")
        assertEquals("rev-1", context.getString("snapshotRevision"))
        assertEquals("D0", context.getString("variantCode"))
        assertEquals(4, context.getInt("stopSequence"))
        assertEquals("S4", context.getJSONObject("canonicalSnapshot").getString("stopCode"))
    }

    @Test
    fun noteEditDoesNotDropCaptureFields() {
        val original = AnomalyPayload.toJson(
            AnomalyCaptureInput(
                kind = AnomalyKind.ROUTE,
                snapshotRevision = "rev-1",
                routePublicId = "route-1",
                routeCode = "YBS-13",
                variantPublicId = "var-1",
                variantCode = "D1",
                selectedStop = null,
                gps = GpsFix(16.8, 96.15, 8f, 1L),
                observedAtIso = "2026-09-02T09:00:00Z",
                createdAtEpochMs = 1L,
            ),
        )
        val edited = AnomalyPayload.withNote(original, "  pole moved  ")
        val root = JSONObject(edited)
        assertEquals("pole moved", root.getString("note"))
        assertEquals("transport_issue", root.getString("reportTypeCode"))
        assertEquals("route", root.getJSONObject("target").getString("entityType"))
    }

    @Test
    fun correctStopHasNoAnomalyKindAndWritesNoPayload() {
        assertFalse(AnomalyKind.entries.any { it.name == "CORRECT" })
    }

    @Test
    fun parseLineReadsLngLatPairs() {
        val coords = SurveyController.parseLine(
            """{"type":"LineString","coordinates":[[96.15,16.78],[96.16,16.79]]}""",
        )
        assertEquals(2, coords.size)
        assertEquals(96.15, coords[0].first, 0.0001)
        assertEquals(16.78, coords[0].second, 0.0001)
    }

    @Test
    fun gpsBufferKeepsBoundAndPicksBestRecent() {
        val buffer = ArrayDeque<GpsFix>()
        repeat(40) { i ->
            GpsBuffer.push(buffer, GpsFix(16.8, 96.15, 20f - (i % 5), i * 1_000L))
        }
        assertEquals(GpsBuffer.MAX_FIXES, buffer.size)
        val best = GpsBuffer.bestRecent(buffer.toList(), 39_000L)
        assertEquals(16f, best?.accuracyM)
        assertNull(GpsBuffer.bestRecent(buffer.toList(), 80_000L))
    }

    @Test
    fun createBodyReusesClientUuidAndMapsNote() {
        val stored = AnomalyPayload.toJson(
            AnomalyCaptureInput(
                kind = AnomalyKind.DATA,
                snapshotRevision = "rev-1",
                routePublicId = "11111111-1111-4111-8111-111111111111",
                routeCode = "YBS-13",
                variantPublicId = "22222222-2222-4222-8222-222222222222",
                variantCode = "D0",
                selectedStop = OrderedStopRow(1, "33333333-3333-4333-8333-333333333333", "S1", null, "A", 16.8, 96.15),
                gps = GpsFix(16.8, 96.15, 5f, 1L),
                observedAtIso = "2026-09-02T09:00:00Z",
                clientPublicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                createdAtEpochMs = 1L,
            ),
        )
        val withNote = AnomalyPayload.withNote(stored, "pole")
        val body = JSONObject(
            AnomalyPayload.toCreateBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", withNote),
        )
        assertEquals("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", body.getString("clientPublicId"))
        assertEquals("pole", body.getString("description"))
        assertFalse(body.has("anomalyKind"))
    }

    @Test
    fun movedReportUsesMapPickAsLocation() {
        val json = AnomalyPayload.toJson(
            AnomalyCaptureInput(
                kind = AnomalyKind.MOVED,
                snapshotRevision = "rev-1",
                routePublicId = "route-1",
                routeCode = "YBS-13",
                variantPublicId = "var-1",
                variantCode = "D0",
                selectedStop = OrderedStopRow(4, "stop-1", "S4", null, "Corner", 16.8, 96.15),
                gps = GpsFix(16.801, 96.151, 4.2f, 1L),
                note = "pole",
                reportLocation = GpsFix(16.805, 96.160, null, 1L),
                observedAtIso = "2026-09-02T09:00:00Z",
                clientPublicId = "11111111-1111-4111-8111-111111111111",
                createdAtEpochMs = 1L,
            ),
        )
        val root = JSONObject(json)
        assertEquals(16.805, root.getJSONObject("location").getDouble("lat"), 0.0001)
        assertEquals(96.160, root.getJSONObject("location").getDouble("lng"), 0.0001)
        assertEquals("pole", root.getString("note"))
        val snap = root.getJSONObject("context").getJSONObject("canonicalSnapshot")
        assertEquals(16.805, snap.getDouble("correctedLat"), 0.0001)
        assertEquals(16.801, snap.getDouble("observerLat"), 0.0001)
    }
}
