package com.coremapmm.fieldsurveyor.outbox

import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.AnomalyCaptureInput
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.AnomalyPayload
import com.coremapmm.fieldsurveyor.survey.GpsFix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboxReportSummaryTest {
    @Test
    fun pendingStatusesAreEditable() {
        val json = sampleJson()
        assertTrue(summary(LocalReportEntity.STATUS_LOCAL, json).pending)
        assertTrue(summary(LocalReportEntity.STATUS_RETRY, json).pending)
        assertFalse(summary(LocalReportEntity.STATUS_SYNCED, json).pending)
        assertFalse(summary(LocalReportEntity.STATUS_SYNCING, json).pending)
    }

    @Test
    fun summaryReadsRouteStopAndNote() {
        val row = summary(LocalReportEntity.STATUS_LOCAL, sampleJson())
        assertEquals("MOVED", row.kind)
        assertEquals("YBS-13", row.routeCode)
        assertEquals("D0", row.variantCode)
        assertTrue(row.stopLabel.contains("Corner"))
        assertEquals("pole", row.note)
        assertEquals(16.805, row.lat!!, 0.0001)
    }

    private fun summary(status: String, json: String) = OutboxReportSummary.from(
        LocalReportEntity(
            clientPublicId = "11111111-1111-4111-8111-111111111111",
            status = status,
            payloadJson = json,
            createdAtEpochMs = 1L,
            updatedAtEpochMs = 1L,
        ),
    )

    private fun sampleJson(): String = AnomalyPayload.toJson(
        AnomalyCaptureInput(
            kind = AnomalyKind.MOVED,
            snapshotRevision = "rev-1",
            routePublicId = "11111111-1111-4111-8111-111111111111",
            routeCode = "YBS-13",
            variantPublicId = "22222222-2222-4222-8222-222222222222",
            variantCode = "D0",
            selectedStop = OrderedStopRow(4, "33333333-3333-4333-8333-333333333333", "S4", null, "Corner", 16.8, 96.15),
            gps = GpsFix(16.801, 96.151, 4f, 1L),
            note = "pole",
            reportLocation = GpsFix(16.805, 96.160, null, 1L),
            observedAtIso = "2026-09-02T09:00:00Z",
            createdAtEpochMs = 1L,
        ),
    )
}
