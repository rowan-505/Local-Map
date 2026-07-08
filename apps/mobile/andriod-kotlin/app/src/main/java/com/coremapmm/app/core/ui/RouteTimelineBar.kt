package com.coremapmm.app.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.design.toTransitColor
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.model.RouteSegmentColorType
import com.coremapmm.app.core.model.RouteSegmentUiModel
import com.coremapmm.app.core.model.TravelMode

@Composable
fun RouteTimelineBar(
    segments: List<RouteSegmentUiModel>,
    modifier: Modifier = Modifier,
    stops: List<String> = emptyList(),
) {
    if (segments.isEmpty()) return

    val timelineHeight = 28.dp
    val trackHeight = 18.dp
    val nodeSize = 12.dp

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.sm),
    ) {
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxWidth()
                .height(timelineHeight),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(trackHeight)
                    .align(Alignment.Center),
            ) {
                segments.forEachIndexed { index, segment ->
                    val weight = segment.durationMinutes.coerceAtLeast(1).toFloat()
                    Box(
                        modifier = Modifier
                            .weight(weight)
                            .fillMaxHeight()
                            .clip(segmentShape(index = index, count = segments.size))
                            .background(segment.colorType.toTimelineColor()),
                        contentAlignment = Alignment.Center,
                    ) {
                        SegmentLabel(
                            segment = segment,
                            contentPadding = segmentLabelPadding(index = index, count = segments.size),
                        )
                    }
                }
            }
            TimelineNodes(
                segments = segments,
                nodeSize = nodeSize,
                modifier = Modifier
                    .matchParentSize()
                    .zIndex(1f),
            )
        }

        if (stops.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                stops.take(4).forEach { stop ->
                    Text(
                        text = stop,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun SegmentLabel(
    segment: RouteSegmentUiModel,
    contentPadding: PaddingValues,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(contentPadding),
    ) {
        Text(
            text = segment.mode.timelineIcon(),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
            maxLines = 1,
        )
        Text(
            text = segment.durationMinutes.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TimelineNodes(
    segments: List<RouteSegmentUiModel>,
    nodeSize: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TimelineNode(size = nodeSize, modifier = Modifier.offset(x = -nodeSize / 2))
        segments.forEachIndexed { index, segment ->
            val segmentWeight = segment.durationMinutes.coerceAtLeast(1).toFloat()
            Spacer(modifier = Modifier.weight(segmentWeight))
            TimelineNode(
                size = nodeSize,
                modifier = if (index == segments.lastIndex) {
                    Modifier.offset(x = -nodeSize / 2)
                } else {
                    Modifier.offset(x = -nodeSize / 2)
                },
                emphasized = index == segments.lastIndex ||
                    segment.mode != segments.getOrNull(index + 1)?.mode,
            )
        }
    }
}

@Composable
private fun TimelineNode(
    size: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
    emphasized: Boolean = true,
) {
    val outerSize = if (emphasized) size else size - 2.dp
    Box(
        modifier = modifier
            .size(outerSize)
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                width = if (emphasized) 2.dp else 1.5.dp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                shape = RoundedCornerShape(50),
            )
            .padding(3.dp),
    ) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .clip(RoundedCornerShape(50))
                .background(Color.White),
        )
    }
}

@Composable
private fun RouteSegmentColorType.toTimelineColor(): Color = toTransitColor()

private fun segmentShape(index: Int, count: Int): RoundedCornerShape {
    val radius = 9.dp
    return RoundedCornerShape(
        topStart = if (index == 0) radius else 0.dp,
        bottomStart = if (index == 0) radius else 0.dp,
        topEnd = if (index == count - 1) radius else 0.dp,
        bottomEnd = if (index == count - 1) radius else 0.dp,
    )
}

private fun segmentLabelPadding(index: Int, count: Int): PaddingValues {
    val edgePadding = 12.dp
    return PaddingValues(
        start = if (index == 0) edgePadding else CoreMapSpacing.xs,
        end = if (index == count - 1) edgePadding else CoreMapSpacing.xs,
    )
}

private fun TravelMode.timelineIcon(): String = when (this) {
    TravelMode.Walk -> "W"
    TravelMode.Drive -> "C"
    TravelMode.Motorcycle -> "M"
    TravelMode.Bus -> "B"
    TravelMode.ExpressBus -> "E"
}

@Preview
@Composable
private fun RouteTimelineBarPreview() {
    CoreMapTheme {
        RouteTimelineBar(
            segments = FakeRoutes.ybsBusRoute.summarySegments,
            stops = FakeRoutes.ybsBusRoute.steps.map { it.title },
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
