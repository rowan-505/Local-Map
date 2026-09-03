package com.coremapmm.fieldsurveyor.ui.settings

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FieldPreferencesInstrumentedTest {
    @Test
    fun defaultsAndChoicesPersist() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences(FieldPreferences.FILE_NAME, Context.MODE_PRIVATE)
            .edit().clear().commit()

        val initial = FieldPreferences(context)
        assertEquals(FieldLanguage.MYANMAR, initial.language)
        assertEquals(FieldThemeMode.LIGHT, initial.themeMode)

        initial.updateLanguage(FieldLanguage.ENGLISH)
        initial.updateThemeMode(FieldThemeMode.DARK)

        val restored = FieldPreferences(context)
        assertEquals(FieldLanguage.ENGLISH, restored.language)
        assertEquals(FieldThemeMode.DARK, restored.themeMode)
    }
}
