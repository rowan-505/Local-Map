package com.coremapmm.app.core.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CoreDraggableSheet(
    level: SheetLevel,
    onLevelChange: (SheetLevel) -> Unit,
    modifier: Modifier = Modifier,
    onDragDelta: (Float) -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraintsSheet(
        modifier = modifier,
        level = level,
        onLevelChange = onLevelChange,
        onDragDelta = onDragDelta,
        content = content,
    )
}

@Composable
private fun BoxWithConstraintsSheet(
    level: SheetLevel,
    onLevelChange: (SheetLevel) -> Unit,
    onDragDelta: (Float) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    androidx.compose.foundation.layout.BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        if (maxHeight <= 0.dp) return@BoxWithConstraints

        val maxHeightPx = constraints.maxHeight.toFloat()
        var dragOffsetPx by remember { mutableFloatStateOf(0f) }
        val animatedFraction by animateFloatAsState(
            targetValue = level.heightFraction,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioNoBouncy,
                stiffness = Spring.StiffnessMediumLow,
            ),
            label = "sheetLevelFraction",
        )
        val dragFraction = if (maxHeightPx > 0f) dragOffsetPx / maxHeightPx else 0f
        val displayFraction = (animatedFraction - dragFraction).coerceIn(0f, 1f)
        val sheetHeight = maxHeight * displayFraction

        if (displayFraction > 0f) {
            SheetSurface(
                sheetHeight = sheetHeight,
                currentLevel = level,
                maxHeightPx = maxHeightPx,
                onLevelChange = onLevelChange,
                onDragDelta = onDragDelta,
                onDragOffsetChange = { dragOffsetPx = it },
                onDragEnd = { totalDragPx ->
                    val dragDeltaFraction = totalDragPx / maxHeightPx
                    onLevelChange(level.resolveDragEnd(dragDeltaFraction))
                    dragOffsetPx = 0f
                },
                content = content,
            )
        }
    }
}

@Composable
private fun BoxScope.SheetSurface(
    sheetHeight: androidx.compose.ui.unit.Dp,
    currentLevel: SheetLevel,
    maxHeightPx: Float,
    onLevelChange: (SheetLevel) -> Unit,
    onDragDelta: (Float) -> Unit,
    onDragOffsetChange: (Float) -> Unit,
    onDragEnd: (Float) -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    var totalDragPx by remember(currentLevel) { mutableFloatStateOf(0f) }
    val nestedConnection = remember(currentLevel, onLevelChange) {
        SheetNestedScrollConnection(
            level = currentLevel,
            onLevelChange = onLevelChange,
        )
    }

    Surface(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .height(sheetHeight)
            .pointerInput(currentLevel) {
                detectVerticalDragGestures(
                    onDragStart = {
                        totalDragPx = 0f
                        onDragOffsetChange(0f)
                    },
                    onDragEnd = {
                        onDragEnd(totalDragPx)
                        totalDragPx = 0f
                    },
                    onDragCancel = {
                        onDragOffsetChange(0f)
                        totalDragPx = 0f
                    },
                    onVerticalDrag = { _, dragAmount ->
                        totalDragPx += dragAmount
                        onDragOffsetChange(totalDragPx)
                        onDragDelta(dragAmount / maxHeightPx)
                    },
                )
            },
        shape = CoreBottomSheetStyle.shape,
        shadowElevation = CoreBottomSheetStyle.elevation,
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = CoreMapColors.Border,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .then(
                    if (currentLevel == SheetLevel.Full) {
                        Modifier.statusBarsPadding()
                    } else {
                        Modifier
                    },
                ),
        ) {
            SheetDragHandle(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = CoreMapSpacing.sm),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .nestedScroll(nestedConnection)
                    .padding(horizontal = CoreMapSpacing.screenHorizontal),
                content = content,
            )
        }
    }
}

@Composable
private fun SheetDragHandle(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .width(CoreBottomSheetStyle.dragHandleWidth)
                .height(CoreBottomSheetStyle.dragHandleHeight)
                .background(
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(2.dp),
                ),
        )
    }
}

@Preview(showBackground = true, heightDp = 400)
@Composable
private fun CoreDraggableSheetPreview() {
    CoreMapTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        ) {
            CoreDraggableSheet(
                level = SheetLevel.Default,
                onLevelChange = {},
            ) {
                TextPreviewContent()
            }
        }
    }
}

@Composable
private fun ColumnScope.TextPreviewContent() {
    Text(
        text = "Sheet content",
        style = MaterialTheme.typography.titleMedium,
    )
    Text(
        text = "Drag up or down to change sheet level.",
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(top = CoreMapSpacing.sm),
    )
}
