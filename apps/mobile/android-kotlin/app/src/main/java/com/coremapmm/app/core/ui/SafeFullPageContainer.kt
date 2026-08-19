package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapSpacing

/**
 * Bounds layout for content shown at [SheetLevel.Full].
 *
 * Top status-bar / camera cutout padding is applied once by [CoreDraggableSheet]
 * (including the drag handle). Full pages should not add their own
 * [androidx.compose.foundation.layout.statusBarsPadding].
 */
@Composable
fun SafeFullPageContainer(
    modifier: Modifier = Modifier,
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    topPadding: Dp = CoreMapSpacing.item,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(top = topPadding),
        verticalArrangement = verticalArrangement,
        content = content,
    )
}

fun fullSheetLazyContentPadding(
    start: Dp = 0.dp,
    end: Dp = 0.dp,
    top: Dp = CoreMapSpacing.item,
    bottomExtra: Dp = 0.dp,
): PaddingValues = PaddingValues(
    start = start,
    end = end,
    top = top,
    bottom = CoreMapSpacing.bottomBarHeight + CoreMapSpacing.fullSheetScrollBottomPadding + bottomExtra,
)
