package com.coremapmm.app.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.design.toTransitColor
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.model.RouteStepUiModel
import com.coremapmm.app.core.model.TravelMode

private val RailWidth = 40.dp
private val NodeSize = 26.dp

@Composable
fun VerticalRouteTimeline(
    steps: List<RouteStepUiModel>,
    modifier: Modifier = Modifier,
    destinationName: String = "Destination",
) {
    val displaySteps = buildDisplaySteps(steps, destinationName)
    Column(modifier = modifier.fillMaxWidth()) {
        displaySteps.forEachIndexed { index, step ->
            RouteTimelineStepRow(
                step = step,
                isFirst = index == 0,
                isLast = index == displaySteps.lastIndex,
            )
        }
    }
}

@Composable
private fun RouteTimelineStepRow(
    step: TimelineDisplayStep,
    isFirst: Boolean,
    isLast: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp),
    ) {
        TimelineRail(
            node = step,
            isFirst = isFirst,
            isLast = isLast,
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = CoreMapSpacing.sm, bottom = CoreMapSpacing.md),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = step.title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                step.metaText?.let { meta ->
                    Text(
                        text = meta,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (step.subtitle.isNotBlank()) {
                Text(
                    text = step.subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
            step.note?.let { note ->
                Text(
                    text = note,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
        }
    }
}

@Composable
private fun TimelineRail(
    node: TimelineDisplayStep,
    isFirst: Boolean,
    isLast: Boolean,
) {
    val outline = MaterialTheme.colorScheme.outline
    Column(
        modifier = Modifier
            .width(RailWidth)
            .fillMaxHeight(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        RailSegment(
            color = node.incomingColor ?: outline,
            dotted = node.incomingDotted,
            visible = !isFirst,
            heightDp = 14.dp,
        )
        TimelineNode(node = node)
        RailSegment(
            color = node.outgoingColor ?: outline,
            dotted = node.outgoingDotted,
            visible = !isLast,
            heightDp = 44.dp,
        )
    }
}

@Composable
private fun TimelineNode(node: TimelineDisplayStep) {
    Box(
        modifier = Modifier
            .size(NodeSize)
            .clip(CircleShape)
            .background(node.color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = node.iconText,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
        )
    }
}

@Composable
private fun RailSegment(
    color: Color,
    dotted: Boolean,
    visible: Boolean,
    heightDp: androidx.compose.ui.unit.Dp,
) {
    Box(
        modifier = Modifier
            .width(RailWidth)
            .height(heightDp),
        contentAlignment = Alignment.TopCenter,
    ) {
        if (visible) {
            androidx.compose.foundation.Canvas(
                modifier = Modifier
                    .width(6.dp)
                    .height(heightDp),
            ) {
                val x = size.width / 2f
                val effect = if (dotted) {
                    PathEffect.dashPathEffect(floatArrayOf(6f, 10f), 0f)
                } else {
                    null
                }
                drawLine(
                    color = color,
                    start = androidx.compose.ui.geometry.Offset(x, 0f),
                    end = androidx.compose.ui.geometry.Offset(x, size.height),
                    strokeWidth = 6f,
                    cap = StrokeCap.Round,
                    pathEffect = effect,
                )
            }
        }
    }
}

private data class TimelineDisplayStep(
    val title: String,
    val subtitle: String,
    val iconText: String,
    val color: Color,
    val metaText: String? = null,
    val note: String? = null,
    val incomingColor: Color? = null,
    val incomingDotted: Boolean = false,
    val outgoingColor: Color? = null,
    val outgoingDotted: Boolean = false,
)

private fun buildDisplaySteps(
    steps: List<RouteStepUiModel>,
    destinationName: String,
): List<TimelineDisplayStep> {
    val timeline = mutableListOf<TimelineDisplayStep>()
    val walkColor = TravelMode.Walk.toTransitColor()
    val primaryMode = steps.firstOrNull { it.mode != TravelMode.Walk }?.mode
    val primaryColor = primaryMode?.toTransitColor() ?: walkColor
    val firstWalk = steps.firstOrNull { it.mode == TravelMode.Walk }
    val primaryRide = steps.firstOrNull { it.mode != TravelMode.Walk }
    val lastWalk = steps.lastOrNull { it.mode == TravelMode.Walk }

    timeline.add(
        TimelineDisplayStep(
            title = "Start",
            subtitle = "Current location",
            iconText = "S",
            color = CoreMapColors.PrimaryGreen,
            note = "Estimated · data not verified",
        ),
    )

    when (primaryMode) {
        TravelMode.Bus, TravelMode.ExpressBus -> {
            timeline.add(
                TimelineDisplayStep(
                    title = "Walk to YBS 43 stop",
                    subtitle = firstWalk?.subtitle.orEmpty().ifBlank { "Connect to bus stop" },
                    iconText = "W",
                    color = walkColor,
                    metaText = firstWalk?.durationText,
                    incomingColor = walkColor,
                    incomingDotted = true,
                    outgoingColor = walkColor,
                    outgoingDotted = true,
                ),
            )
            timeline.add(
                TimelineDisplayStep(
                    title = "Get on",
                    subtitle = primaryRide?.title.orEmpty().ifBlank { "YBS 43 stop" },
                    iconText = "•",
                    color = primaryColor,
                    incomingColor = walkColor,
                    incomingDotted = true,
                    outgoingColor = primaryColor,
                ),
            )
            timeline.add(
                TimelineDisplayStep(
                    title = "Ride YBS 43",
                    subtitle = primaryRide?.subtitle.orEmpty().ifBlank { "Toward Kyauktan" },
                    iconText = "B",
                    color = primaryColor,
                    metaText = primaryRide?.durationText,
                    incomingColor = primaryColor,
                    outgoingColor = primaryColor,
                ),
            )
            timeline.add(
                TimelineDisplayStep(
                    title = "27 stops · 38 min",
                    subtitle = "Intermediate stops hidden",
                    iconText = "…",
                    color = primaryColor,
                    incomingColor = primaryColor,
                    outgoingColor = primaryColor,
                ),
            )
            timeline.add(
                TimelineDisplayStep(
                    title = "Get off",
                    subtitle = "Kyauktan Market stop",
                    iconText = "•",
                    color = primaryColor,
                    incomingColor = primaryColor,
                    outgoingColor = walkColor,
                    outgoingDotted = true,
                ),
            )
            timeline.add(
                TimelineDisplayStep(
                    title = "Walk to $destinationName",
                    subtitle = lastWalk?.subtitle.orEmpty().ifBlank { "Final approach" },
                    iconText = "W",
                    color = walkColor,
                    metaText = lastWalk?.durationText,
                    incomingColor = walkColor,
                    incomingDotted = true,
                    outgoingColor = walkColor,
                    outgoingDotted = true,
                ),
            )
        }
        TravelMode.Drive, TravelMode.Motorcycle -> {
            val step = primaryRide ?: steps.firstOrNull()
            timeline.add(
                TimelineDisplayStep(
                    title = primaryMode.label(),
                    subtitle = step?.title.orEmpty().ifBlank { "Continue to destination" },
                    iconText = primaryMode.iconText(),
                    color = primaryColor,
                    metaText = step?.durationText,
                    note = step?.subtitle,
                    incomingColor = primaryColor,
                    outgoingColor = primaryColor,
                ),
            )
        }
        TravelMode.Walk, null -> {
            val walkStep = firstWalk ?: steps.firstOrNull()
            timeline.add(
                TimelineDisplayStep(
                    title = "Walk to $destinationName",
                    subtitle = walkStep?.subtitle.orEmpty().ifBlank { "Follow walking route" },
                    iconText = "W",
                    color = walkColor,
                    metaText = walkStep?.durationText,
                    incomingColor = walkColor,
                    incomingDotted = true,
                    outgoingColor = walkColor,
                    outgoingDotted = true,
                ),
            )
        }
    }

    timeline.add(
        TimelineDisplayStep(
            title = "Arrive",
            subtitle = destinationName,
            iconText = "◎",
            color = CoreMapColors.DestinationRed,
            incomingColor = CoreMapColors.DestinationRed,
        ),
    )
    return timeline
}

private fun TravelMode.label(): String = when (this) {
    TravelMode.Walk -> "Walk"
    TravelMode.Drive -> "Drive"
    TravelMode.Motorcycle -> "Motorbike"
    TravelMode.Bus -> "Bus"
    TravelMode.ExpressBus -> "Express bus"
}

private fun TravelMode.iconText(): String = when (this) {
    TravelMode.Walk -> "W"
    TravelMode.Drive -> "C"
    TravelMode.Motorcycle -> "M"
    TravelMode.Bus -> "B"
    TravelMode.ExpressBus -> "E"
}

@Preview
@Composable
private fun VerticalRouteTimelinePreview() {
    CoreMapTheme {
        VerticalRouteTimeline(
            steps = FakeRoutes.ybsBusRoute.steps,
            destinationName = "Kyauktan Market",
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
