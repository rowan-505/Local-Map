package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.animation.core.animate
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

enum class SurveySheetStage(val visibleFraction: Float) {
    MAP(0.5f / 6f),
    STOPS(2f / 6f),
    NEARBY(3f / 6f),
    FULL(1f),
}

internal object SurveySheetLayout {
    fun offset(stage: SurveySheetStage, heightPx: Float): Float =
        heightPx * (1f - stage.visibleFraction)

    fun nearest(offsetPx: Float, heightPx: Float, velocityPx: Float = 0f): SurveySheetStage {
        val projected = (offsetPx + velocityPx * 0.08f).coerceIn(0f, heightPx)
        return SurveySheetStage.entries.minBy { abs(offset(it, heightPx) - projected) }
    }
}

@Composable
fun FourStageSurveySheet(
    stage: SurveySheetStage,
    onStageChange: (SurveySheetStage) -> Unit,
    header: @Composable (Modifier) -> Unit,
    content: @Composable (SurveySheetStage) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val heightPx = with(density) { maxHeight.toPx() }.coerceAtLeast(1f)
        val scope = rememberCoroutineScope()
        var offsetPx by remember(heightPx) { mutableFloatStateOf(SurveySheetLayout.offset(stage, heightPx)) }

        fun settle(next: SurveySheetStage) {
            val target = SurveySheetLayout.offset(next, heightPx)
            scope.launch {
                animate(offsetPx, target) { value, _ -> offsetPx = value }
                onStageChange(next)
            }
        }

        LaunchedEffect(stage, heightPx) {
            val target = SurveySheetLayout.offset(stage, heightPx)
            if (abs(offsetPx - target) > 1f) {
                animate(offsetPx, target) { value, _ -> offsetPx = value }
            }
        }

        val dragState = rememberDraggableState { delta ->
            offsetPx = (offsetPx + delta).coerceIn(0f, SurveySheetLayout.offset(SurveySheetStage.MAP, heightPx))
        }
        val visibleStage = SurveySheetLayout.nearest(offsetPx, heightPx)

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(maxHeight)
                .offset { IntOffset(0, offsetPx.roundToInt()) }
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
            color = MaterialTheme.colorScheme.surfaceContainer,
            tonalElevation = 2.dp,
            shadowElevation = 8.dp,
        ) {
            Column {
                header(
                    Modifier.draggable(
                        state = dragState,
                        orientation = Orientation.Vertical,
                        onDragStopped = { velocity -> settle(SurveySheetLayout.nearest(offsetPx, heightPx, velocity)) },
                    ),
                )
                Box(Modifier.fillMaxWidth().weight(1f)) { content(visibleStage) }
            }
        }
    }
}
