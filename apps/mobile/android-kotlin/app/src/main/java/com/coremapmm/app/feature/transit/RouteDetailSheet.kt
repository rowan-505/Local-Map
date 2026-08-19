package com.coremapmm.app.feature.transit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.model.RouteStepUiModel
import com.coremapmm.app.core.model.RouteUiModel
import com.coremapmm.app.core.model.TravelMode
import com.coremapmm.app.core.ui.CoreOutlinedButton
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.RouteTimelineBar
import com.coremapmm.app.core.ui.SafeFullPageContainer
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.VerticalRouteTimeline
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

@Composable
fun RouteDetailSheet(
    route: RouteUiModel,
    sheetLevel: SheetLevel,
    destinationName: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onReportIssue: () -> Unit = {},
) {
    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> RouteDetailMini(route = route, modifier = modifier)
        SheetLevel.Default, SheetLevel.Detail -> RouteDetailDefault(
            route = route,
            onBack = onBack,
            onReportIssue = onReportIssue,
            modifier = modifier,
        )
        SheetLevel.Full -> RouteDetailFull(
            route = route,
            destinationName = destinationName,
            onBack = onBack,
            onReportIssue = onReportIssue,
            modifier = modifier,
        )
    }
}

// ── Mini 1/6 ────────────────────────────────────────────────────────────────

@Composable
private fun RouteDetailMini(
    route: RouteUiModel,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "${route.totalDurationText} · ${route.mode.label()}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = stringResource(R.string.transit_data_estimated),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Detail 3/6 (map visible above) ──────────────────────────────────────────

@Composable
private fun RouteDetailDefault(
    route: RouteUiModel,
    onBack: () -> Unit,
    onReportIssue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            RouteDetailHeader(route = route, onBack = onBack)
            RouteTimelineBar(
                segments = route.summarySegments,
                modifier = Modifier.padding(horizontal = CoreMapSpacing.xs),
            )
            HorizontalDivider(
                color = CoreMapColors.Border,
                modifier = Modifier.padding(vertical = CoreMapSpacing.xs),
            )
            TransitSectionHeader(
                title = stringResource(R.string.transit_first_steps),
                modifier = Modifier.padding(horizontal = CoreMapSpacing.xs),
            )
            route.steps.take(3).forEach { step ->
                RouteStepPreview(step = step)
            }
        }
        RouteDetailActionBar(onReportIssue = onReportIssue)
    }
}

// ── Full 6/6 (vertical timeline + fixed actions) ────────────────────────────

@Composable
private fun RouteDetailFull(
    route: RouteUiModel,
    destinationName: String,
    onBack: () -> Unit,
    onReportIssue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SafeFullPageContainer(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = fullSheetLazyContentPadding(bottomExtra = CoreMapSpacing.buttonHeight),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            item {
                RouteDetailHeader(route = route, onBack = onBack)
            }
            item {
                RouteTimelineBar(
                    segments = route.summarySegments,
                    modifier = Modifier.padding(horizontal = CoreMapSpacing.xs),
                )
            }
            item {
                HorizontalDivider(
                    color = CoreMapColors.Border,
                    modifier = Modifier.padding(vertical = CoreMapSpacing.item),
                )
            }
            item {
                VerticalRouteTimeline(
                    steps = route.steps,
                    destinationName = destinationName,
                    modifier = Modifier.padding(
                        horizontal = CoreMapSpacing.xs,
                        vertical = CoreMapSpacing.item,
                    ),
                )
            }
            item {
                DestinationPreviewCard(destinationName = destinationName)
            }
        }
        RouteDetailActionBar(onReportIssue = onReportIssue)
    }
}

// ── Shared pieces ───────────────────────────────────────────────────────────

@Composable
private fun RouteDetailHeader(
    route: RouteUiModel,
    onBack: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.transit_back_to_results),
                )
            }
            Text(
                text = route.totalDurationText,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(start = CoreMapSpacing.xs),
            )
        }
        Text(
            text = "${route.distanceText} · ${route.fareText}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = CoreMapSpacing.xs),
        )
        DataBadge(
            text = stringResource(R.string.transit_schedule_based),
            modifier = Modifier.padding(
                horizontal = CoreMapSpacing.xs,
                vertical = CoreMapSpacing.xs,
            ),
        )
    }
}

@Composable
private fun DataBadge(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = CoreMapColors.SoftWarningBackground,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = CoreMapColors.WarningOrange,
            modifier = Modifier.padding(horizontal = CoreMapSpacing.sm, vertical = CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun RouteDetailActionBar(onReportIssue: () -> Unit = {}) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = CoreMapSpacing.screenHorizontal,
                    vertical = CoreMapSpacing.item,
                ),
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            CoreOutlinedButton(
                text = stringResource(R.string.transit_preview),
                onClick = {},
                modifier = Modifier.weight(1f),
            )
            CorePrimaryButton(
                text = stringResource(R.string.transit_go),
                onClick = {},
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun DestinationPreviewCard(
    destinationName: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier.padding(CoreMapSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.surfaceVariant,
                                CoreMapColors.PrimaryGreen.copy(alpha = 0.12f),
                            ),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "◎",
                    style = MaterialTheme.typography.titleLarge,
                    color = CoreMapColors.DestinationRed,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
                Text(
                    text = "Destination preview",
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = destinationName,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RouteStepPreview(step: RouteStepUiModel) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = CoreMapSpacing.xs, vertical = CoreMapSpacing.xs),
    ) {
        Text(text = step.title, style = MaterialTheme.typography.bodyLarge)
        Text(
            text = "${step.mode.label()} · ${step.durationText} · ${step.distanceText}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun TravelMode.label(): String = when (this) {
    TravelMode.Walk -> "Walk"
    TravelMode.Drive -> "Car"
    TravelMode.Motorcycle -> "Motorbike"
    TravelMode.Bus -> "Bus"
    TravelMode.ExpressBus -> "Express bus"
}

@Preview(showBackground = true, heightDp = 300)
@Composable
private fun RouteDetailDefaultPreview() {
    CoreMapTheme {
        RouteDetailSheet(
            route = FakeRoutes.ybsBusRoute,
            sheetLevel = SheetLevel.Detail,
            destinationName = "Kyauktan Market",
            onBack = {},
        )
    }
}

@Preview(showBackground = true, heightDp = 720)
@Composable
private fun RouteDetailFullPreview() {
    CoreMapTheme {
        RouteDetailSheet(
            route = FakeRoutes.ybsBusRoute,
            sheetLevel = SheetLevel.Full,
            destinationName = "Kyauktan Market",
            onBack = {},
        )
    }
}
