package com.coremapmm.app.map

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun MapPlaceholder(
    state: MapUiState,
    modifier: Modifier = Modifier,
    onMarkerClick: (String) -> Unit = {},
    onMapClick: () -> Unit = {},
) {
    val interactionSource = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(CoreMapColors.MapLandLight)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onMapClick,
            ),
    ) {
        MapCanvasLayer(state = state, modifier = Modifier.fillMaxSize())

        state.labels.forEach { label ->
            MapLabelChip(
                text = label.text,
                fractionX = label.x,
                fractionY = label.y,
            )
        }

        state.markers.forEach { marker ->
            MapMarker(
                marker = marker,
                selected = marker.id == state.selectedMarkerId,
                onClick = { onMarkerClick(marker.id) },
            )
        }
    }
}

@Composable
private fun MapCanvasLayer(
    state: MapUiState,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        state.parkAreas.forEach { area ->
            drawArea(area.points, CoreMapColors.MapParkLight)
        }
        state.waterAreas.forEach { area ->
            drawArea(area.points, CoreMapColors.MapWaterLight)
        }
        state.roads
            .filter { it.type == MapRoadType.Minor }
            .forEach { road -> drawRoad(road, casingWidth = 10f, coreWidth = 6f, minor = true) }
        state.roads
            .filter { it.type == MapRoadType.Major }
            .forEach { road -> drawRoad(road, casingWidth = 22f, coreWidth = 14f, minor = false) }
        state.routeOverlay?.let { overlay ->
            drawRouteOverlay(overlay)
        }
    }
}

private fun DrawScope.drawRouteOverlay(overlay: MapRouteOverlay) {
    if (overlay.points.size < 2) return
    val path = Path().apply {
        moveTo(overlay.points.first().x * size.width, overlay.points.first().y * size.height)
        overlay.points.drop(1).forEach { lineTo(it.x * size.width, it.y * size.height) }
    }
    drawPath(
        path = path,
        color = overlay.color.copy(alpha = 0.35f),
        style = Stroke(width = 18f, cap = StrokeCap.Round),
    )
    drawPath(
        path = path,
        color = overlay.color,
        style = Stroke(width = 8f, cap = StrokeCap.Round),
    )
}

private fun DrawScope.drawArea(points: List<MapPoint>, color: Color) {
    if (points.size < 3) return
    val path = Path().apply {
        moveTo(points.first().x * size.width, points.first().y * size.height)
        points.drop(1).forEach { lineTo(it.x * size.width, it.y * size.height) }
        close()
    }
    drawPath(path = path, color = color)
}

private fun DrawScope.drawRoad(
    road: MapRoadUi,
    casingWidth: Float,
    coreWidth: Float,
    minor: Boolean,
) {
    if (road.points.size < 2) return
    val path = Path().apply {
        moveTo(road.points.first().x * size.width, road.points.first().y * size.height)
        road.points.drop(1).forEach { lineTo(it.x * size.width, it.y * size.height) }
    }
    drawPath(
        path = path,
        color = CoreMapColors.MapRoadCasing,
        style = Stroke(width = casingWidth, cap = StrokeCap.Round),
    )
    drawPath(
        path = path,
        color = if (minor) CoreMapColors.MapRoadMinor else CoreMapColors.MapRoadMajor,
        style = Stroke(width = coreWidth, cap = StrokeCap.Round),
    )
}

@Composable
private fun BoxScope.MapMarker(
    marker: MapMarkerUi,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FractionOffset(marker.x, marker.y) { xOffset, yOffset ->
        Box(
            modifier = Modifier
                .offset(x = xOffset, y = yOffset)
                .clip(CircleShape)
                .background(Color.White)
                .clickable(onClick = onClick)
                .padding(3.dp),
            contentAlignment = Alignment.Center,
        ) {
            val dotSize: Dp = if (selected) 22.dp else 16.dp
            Box(
                modifier = Modifier
                    .size(dotSize)
                    .clip(CircleShape)
                    .background(
                        if (selected) CoreMapColors.MapMarkerSelected
                        else CoreMapColors.MapMarker,
                    ),
            )
        }
    }
}

@Composable
private fun BoxScope.MapLabelChip(
    text: String,
    fractionX: Float,
    fractionY: Float,
) {
    FractionOffset(fractionX, fractionY) { xOffset, yOffset ->
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = CoreMapColors.MapLabel,
            modifier = Modifier.offset(x = xOffset, y = yOffset),
        )
    }
}

/**
 * Positions content using 0f..1f fractions of the parent size.
 */
@Composable
private fun BoxScope.FractionOffset(
    fractionX: Float,
    fractionY: Float,
    content: @Composable (Dp, Dp) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.matchParentSize()) {
        val xOffset = maxWidth * fractionX
        val yOffset = maxHeight * fractionY
        content(xOffset, yOffset)
    }
}

@Preview(showBackground = true)
@Composable
private fun MapPlaceholderPreview() {
    CoreMapTheme {
        MapPlaceholder(state = MapUiState(selectedMarkerId = "place-shwedagon-pagoda"))
    }
}
