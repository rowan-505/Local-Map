package com.coremapmm.fieldsurveyor

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.coremapmm.fieldsurveyor.nav.FieldNavHost
import com.coremapmm.fieldsurveyor.ui.theme.FieldTheme
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences
import com.coremapmm.fieldsurveyor.ui.settings.FieldThemeMode
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import kotlinx.coroutines.launch
import org.maplibre.android.MapLibre

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        MapLibre.getInstance(this)
        val graph = (application as FieldApp).graph
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                graph.survey.isRunning.collect { running ->
                    applyKeepScreenOn(running)
                }
            }
        }
        setContent {
            val display = remember { FieldPreferences(this) }
            CompositionLocalProvider(LocalFieldLanguage provides display.language) {
                FieldTheme(darkTheme = display.themeMode == FieldThemeMode.DARK) {
                    Surface(modifier = Modifier.fillMaxSize()) {
                        FieldNavHost(graph, display)
                    }
                }
            }
        }
    }

    override fun onStop() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onStop()
    }

    private fun applyKeepScreenOn(running: Boolean) {
        if (running) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}
