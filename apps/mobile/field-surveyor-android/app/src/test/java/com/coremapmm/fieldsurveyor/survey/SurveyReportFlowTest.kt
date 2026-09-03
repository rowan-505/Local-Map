package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SurveyReportFlowTest {
    @Test
    fun saveRequiresActiveSurvey() {
        val error = SurveyReportFlow.saveError(
            running = false,
            kind = AnomalyKind.MISSING,
            hasStop = true,
            mapPick = null,
            note = "",
            routeIssue = null,
        )
        assertNotNull(error)
    }

    @Test
    fun movedNeedsMapPick() {
        assertNotNull(
            SurveyReportFlow.saveError(true, AnomalyKind.MOVED, true, null, "", null),
        )
        assertNull(
            SurveyReportFlow.saveError(
                true,
                AnomalyKind.MOVED,
                true,
                GpsFix(16.8, 96.15, null, 1L),
                "",
                null,
            ),
        )
    }

    @Test
    fun dataNeedsNote() {
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.DATA, true, null, "  ", null))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.DATA, true, null, "wrong name", null))
    }

    @Test
    fun routeNeedsIssueChoice() {
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.ROUTE, false, null, "", null))
        assertNull(
            SurveyReportFlow.saveError(
                true,
                AnomalyKind.ROUTE,
                false,
                null,
                "",
                RouteIssueKind.PATH_WRONG,
            ),
        )
    }

    @Test
    fun composedNotePrefixesRouteIssue() {
        assertEquals("path wrong · fence", SurveyReportFlow.composedNote("fence", RouteIssueKind.PATH_WRONG))
        assertEquals("missing segment", SurveyReportFlow.composedNote("", RouteIssueKind.MISSING_SEGMENT))
    }
}
