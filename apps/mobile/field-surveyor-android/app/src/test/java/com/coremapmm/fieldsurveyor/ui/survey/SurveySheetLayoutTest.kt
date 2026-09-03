package com.coremapmm.fieldsurveyor.ui.survey

import org.junit.Assert.assertEquals
import org.junit.Test

class SurveySheetLayoutTest {
    @Test
    fun fourStagesUseRequestedViewportFractions() {
        val height = 600f

        assertEquals(550f, SurveySheetLayout.offset(SurveySheetStage.MAP, height), 0.01f)
        assertEquals(400f, SurveySheetLayout.offset(SurveySheetStage.STOPS, height), 0.01f)
        assertEquals(300f, SurveySheetLayout.offset(SurveySheetStage.NEARBY, height), 0.01f)
        assertEquals(0f, SurveySheetLayout.offset(SurveySheetStage.FULL, height), 0.01f)
    }

    @Test
    fun dragSettlesAtNearestStage() {
        val height = 600f

        assertEquals(SurveySheetStage.MAP, SurveySheetLayout.nearest(540f, height))
        assertEquals(SurveySheetStage.STOPS, SurveySheetLayout.nearest(405f, height))
        assertEquals(SurveySheetStage.NEARBY, SurveySheetLayout.nearest(290f, height))
        assertEquals(SurveySheetStage.FULL, SurveySheetLayout.nearest(20f, height))
    }
}
