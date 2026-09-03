package com.coremapmm.fieldsurveyor.ui.survey

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyMapControlLayoutTest {
    @Test
    fun controlsRemainAvailableForEveryMapVisibleStage() {
        assertTrue(SurveyMapControlLayout.visible(SurveySheetStage.MAP.visibleFraction))
        assertTrue(SurveyMapControlLayout.visible(SurveySheetStage.STOPS.visibleFraction))
        assertTrue(SurveyMapControlLayout.visible(SurveySheetStage.NEARBY.visibleFraction))
    }

    @Test
    fun controlsHideWhenFormCoversMap() {
        assertFalse(SurveyMapControlLayout.visible(SurveySheetStage.FULL.visibleFraction))
    }
}
