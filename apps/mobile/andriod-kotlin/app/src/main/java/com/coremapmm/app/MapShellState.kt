package com.coremapmm.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.coremapmm.app.core.model.CoreMapTab
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.expanded
import com.coremapmm.app.core.ui.collapsed

/**
 * UI-only state holder for the global map shell:
 * selected tab, sheet level, and selected marker.
 */
class MapShellState(
    initialTab: CoreMapTab,
    initialSheetLevel: SheetLevel,
) {
    var selectedTab by mutableStateOf(initialTab)
        private set

    var sheetLevel by mutableStateOf(initialSheetLevel)
        private set

    var selectedMarkerId by mutableStateOf<String?>(null)
        private set

    /** Tapping a bottom tab selects it and opens the tab's preferred map sheet level. */
    fun onTabSelected(tab: CoreMapTab) {
        selectedTab = tab
        sheetLevel = when (tab) {
            CoreMapTab.Transit -> SheetLevel.Detail
            CoreMapTab.Discover,
            CoreMapTab.MyMap,
            CoreMapTab.Settings,
            -> SheetLevel.Default
        }
    }

    fun updateSheetLevel(level: SheetLevel) {
        sheetLevel = level
    }

    fun expandSheet() {
        sheetLevel = sheetLevel.expanded()
    }

    fun collapseSheet() {
        sheetLevel = sheetLevel.collapsed()
    }

    fun onMarkerSelected(markerId: String) {
        selectedMarkerId = markerId
    }

    fun onMapTapped() {
        selectedMarkerId = null
    }
}

@Composable
fun rememberMapShellState(
    initialTab: CoreMapTab = CoreMapTab.Discover,
    initialSheetLevel: SheetLevel = SheetLevel.Default,
): MapShellState = remember {
    MapShellState(initialTab = initialTab, initialSheetLevel = initialSheetLevel)
}
