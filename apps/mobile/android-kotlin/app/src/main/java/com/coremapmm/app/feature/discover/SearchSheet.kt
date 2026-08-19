package com.coremapmm.app.feature.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.SheetLevel

/**
 * Legacy sheet slot for search. Interactive search UI lives in [DiscoverSearchFullScreen]
 * and [com.coremapmm.app.core.ui.CoreTopMapOverlay] while search is active.
 */
@Composable
fun SearchSheet(
    sheetLevel: SheetLevel,
    onBack: () -> Unit,
    onResultClick: (SearchResultUiModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (sheetLevel == SheetLevel.Hidden) return

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface),
    )
}

@Preview(showBackground = true, heightDp = 200)
@Composable
private fun SearchSheetPreview() {
    CoreMapTheme {
        SearchSheet(
            sheetLevel = SheetLevel.Full,
            onBack = {},
            onResultClick = {},
        )
    }
}
