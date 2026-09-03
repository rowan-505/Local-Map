package com.coremapmm.fieldsurveyor.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class FieldLocalizationTest {
    @Test
    fun myanmarModeTranslatesNavigationAndDynamicCounts() {
        assertEquals("ဆက်တင်များ", translateFieldText("Settings", FieldLanguage.MYANMAR))
        assertEquals("လမ်းကြောင်းတစ်ခုလုံးကို ပြမည်", translateFieldText("Show whole route", FieldLanguage.MYANMAR))
        assertEquals("မှတ်တိုင်", translateFieldText("stops", FieldLanguage.MYANMAR))
        assertEquals(
            "အသုံးပြုနိုင်သော လမ်းကြောင်းခွဲ 19 ခု",
            translateFieldText("19 variants available", FieldLanguage.MYANMAR),
        )
        assertNotEquals(
            "Select a stop before adding media.",
            translateFieldText("Select a stop before adding media.", FieldLanguage.MYANMAR),
        )
    }

    @Test
    fun englishModeKeepsOriginalCopy() {
        assertEquals("Settings", translateFieldText("Settings", FieldLanguage.ENGLISH))
        assertEquals(
            "19 variants available",
            translateFieldText("19 variants available", FieldLanguage.ENGLISH),
        )
    }
}
