package com.coremapmm.app.feature.transit

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.model.RouteBadge
import com.coremapmm.app.core.model.RouteUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CoreOutlinedButton
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.CoreTextFieldBox
import com.coremapmm.app.core.ui.RouteTimelineBar
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val RouteResultsHorizontalPadding = 0.dp

@Composable
fun RouteResultSheet(
    sheetLevel: SheetLevel,
    routes: List<RouteUiModel>,
    selectedRouteId: String?,
    fromText: String,
    toText: String,
    routeInputExpanded: Boolean,
    selectedMode: TransitPlannerMode,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onRouteInputExpandedChange: (Boolean) -> Unit,
    onFindRoutes: () -> Unit,
    onSwapRouteFields: () -> Unit,
    onRouteSelected: (String) -> Unit,
    onRouteOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> RouteResultsMiniContent(routeCount = routes.size, modifier = modifier)
        SheetLevel.Full -> RouteResultsFullContent(
            routes = routes,
            selectedRouteId = selectedRouteId,
            fromText = fromText,
            toText = toText,
            routeInputExpanded = routeInputExpanded,
            selectedMode = selectedMode,
            onModeSelected = onModeSelected,
            onRouteInputExpandedChange = onRouteInputExpandedChange,
            onFindRoutes = onFindRoutes,
            onSwapRouteFields = onSwapRouteFields,
            onRouteSelected = onRouteSelected,
            onRouteOpen = onRouteOpen,
            onBack = onBack,
            modifier = modifier,
        )
        else -> RouteResultsMiniContent(routeCount = routes.size, modifier = modifier)
    }
}

@Composable
private fun RouteResultsMiniContent(
    routeCount: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth(),
    ) {
        Text(
            text = stringResource(R.string.transit_route_results),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = stringResource(R.string.transit_results_mini_summary, routeCount),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun RouteResultsFullContent(
    routes: List<RouteUiModel>,
    selectedRouteId: String?,
    fromText: String,
    toText: String,
    routeInputExpanded: Boolean,
    selectedMode: TransitPlannerMode,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onRouteInputExpandedChange: (Boolean) -> Unit,
    onFindRoutes: () -> Unit,
    onSwapRouteFields: () -> Unit,
    onRouteSelected: (String) -> Unit,
    onRouteOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = fullSheetLazyContentPadding(
            start = RouteResultsHorizontalPadding,
            end = RouteResultsHorizontalPadding,
            top = CoreMapSpacing.sm,
        ),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.md),
        ) {
        item {
            RouteResultsHeader(
                fromText = fromText,
                toText = toText,
                expanded = routeInputExpanded,
                selectedMode = selectedMode,
                onBack = onBack,
                onToggleExpanded = { onRouteInputExpandedChange(!routeInputExpanded) },
                onModeSelected = onModeSelected,
                onFindRoutes = {
                    onRouteInputExpandedChange(false)
                    onFindRoutes()
                },
                onSwapRouteFields = onSwapRouteFields,
            )
        }
        items(routes, key = { it.id }) { route ->
            RouteResultCard(
                route = route,
                selected = route.id == selectedRouteId,
                onClick = { onRouteSelected(route.id) },
                onOpen = { onRouteOpen(route.id) },
            )
        }
    }
}

@Composable
private fun RouteResultsHeader(
    fromText: String,
    toText: String,
    expanded: Boolean,
    selectedMode: TransitPlannerMode,
    onBack: () -> Unit,
    onToggleExpanded: () -> Unit,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onFindRoutes: () -> Unit,
    onSwapRouteFields: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.transit_back),
                )
            }
            Column(modifier = Modifier.padding(start = CoreMapSpacing.xs)) {
                Text(
                    text = stringResource(R.string.transit_route_results),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = stringResource(R.string.transit_data_not_verified),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (expanded) {
            ExpandedRouteInputCard(
                fromText = fromText,
                toText = toText,
                selectedMode = selectedMode,
                onModeSelected = onModeSelected,
                onFindRoutes = onFindRoutes,
                onSwapRouteFields = onSwapRouteFields,
            )
        } else {
            CollapsedRouteSummaryCard(
                fromText = fromText,
                toText = toText,
                onClick = onToggleExpanded,
            )
        }
    }
}

@Composable
private fun CollapsedRouteSummaryCard(
    fromText: String,
    toText: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp)
            .clickable(onClick = onClick),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(CoreMapSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.sm),
        ) {
            RouteEndpointDot(color = CoreMapColors.PrimaryGreen)
            Text(
                text = "$fromText → $toText",
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.Default.Place,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun ExpandedRouteInputCard(
    fromText: String,
    toText: String,
    selectedMode: TransitPlannerMode,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onFindRoutes: () -> Unit,
    onSwapRouteFields: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 3.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            CoreTextFieldBox(
                label = stringResource(R.string.transit_from),
                value = fromText,
                onClick = {},
            )
            CoreTextFieldBox(
                label = stringResource(R.string.transit_to),
                value = toText,
                onClick = {},
            )
            CoreOutlinedButton(
                text = stringResource(R.string.transit_swap),
                onClick = onSwapRouteFields,
            )
            RouteResultsModeChips(
                selectedMode = selectedMode,
                onModeSelected = onModeSelected,
            )
            CorePrimaryButton(
                text = stringResource(R.string.transit_find_routes),
                onClick = onFindRoutes,
            )
        }
    }
}

@Composable
private fun RouteEndpointDot(color: androidx.compose.ui.graphics.Color) {
    Box(
        modifier = Modifier
            .size(10.dp)
            .clip(RoundedCornerShape(50))
            .background(color),
    )
}

@Composable
private fun RouteResultsModeChips(
    selectedMode: TransitPlannerMode,
    onModeSelected: (TransitPlannerMode) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        TransitPlannerMode.entries.forEach { mode ->
            CoreSelectableChip(
                label = routeResultsModeLabel(mode),
                selected = mode == selectedMode,
                onClick = { onModeSelected(mode) },
            )
        }
    }
}

@Composable
private fun routeResultsModeLabel(mode: TransitPlannerMode): String = when (mode) {
    TransitPlannerMode.Walk -> stringResource(R.string.transit_mode_walk)
    TransitPlannerMode.Motorbike -> stringResource(R.string.transit_mode_motorbike)
    TransitPlannerMode.Car -> stringResource(R.string.transit_mode_car)
    TransitPlannerMode.Bus -> stringResource(R.string.transit_mode_bus)
}

@Composable
private fun RouteResultCard(
    route: RouteUiModel,
    selected: Boolean,
    onClick: () -> Unit,
    onOpen: () -> Unit,
) {
    val highlighted = selected || route.badge == RouteBadge.Recommended
    val borderColor = when {
        route.badge == RouteBadge.Recommended -> CoreMapColors.PrimaryGreen
        selected -> CoreMapColors.AccentBlue
        else -> CoreMapColors.Border
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = if (highlighted) 4.dp else 2.dp)
            .clickable(onClick = onClick),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(
            width = if (highlighted) 1.5.dp else 1.dp,
            color = borderColor,
        ),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
                ) {
                    route.badge?.let { badge ->
                        RouteBadgeChip(badge = badge)
                    }
                    Text(
                        text = route.totalDurationText,
                        style = MaterialTheme.typography.headlineSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                RouteMetaColumn(
                    distanceText = route.distanceText,
                    fareText = route.fareText,
                    modifier = Modifier.padding(start = CoreMapSpacing.item),
                )
            }

            Text(
                text = stringResource(R.string.transit_data_not_verified),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            RouteTimelineBar(
                segments = route.summarySegments,
            )

            RouteSummarySteps(
                steps = route.steps.map { it.title },
            )

            CoreOutlinedButton(
                text = stringResource(R.string.transit_view_route),
                onClick = onOpen,
            )
        }
    }
}

@Composable
private fun RouteMetaColumn(
    distanceText: String,
    fareText: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.widthIn(min = 88.dp),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = distanceText,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = fareText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun RouteSummarySteps(
    steps: List<String>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
    ) {
        steps.take(4).forEachIndexed { index, step ->
            Text(
                text = "${index + 1}. $step",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RouteBadgeChip(badge: RouteBadge) {
    val label = when (badge) {
        RouteBadge.Recommended -> stringResource(R.string.transit_recommended)
        RouteBadge.Fastest -> stringResource(R.string.transit_badge_fastest)
        RouteBadge.LessWalking -> stringResource(R.string.transit_badge_less_walking)
    }
    val containerColor = when (badge) {
        RouteBadge.Recommended -> CoreMapColors.SoftGreenBackground
        RouteBadge.Fastest -> CoreMapColors.SoftBlueBackground
        RouteBadge.LessWalking -> CoreMapColors.SoftWarningBackground
    }
    val textColor = when (badge) {
        RouteBadge.Recommended -> CoreMapColors.DeepGreenText
        RouteBadge.Fastest -> CoreMapColors.MapBlueDark
        RouteBadge.LessWalking -> CoreMapColors.WarningOrange
    }

    Surface(
        shape = RoundedCornerShape(20.dp),
        color = containerColor,
        border = BorderStroke(1.dp, textColor.copy(alpha = 0.25f)),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = textColor,
            modifier = Modifier.padding(horizontal = CoreMapSpacing.item, vertical = CoreMapSpacing.xs),
        )
    }
}

@Preview(showBackground = true, heightDp = 720)
@Composable
private fun RouteResultSheetPreview() {
    CoreMapTheme {
        RouteResultSheet(
            sheetLevel = SheetLevel.Full,
            routes = FakeRoutes.sampleRoutes.take(3),
            selectedRouteId = FakeRoutes.ybsBusRoute.id,
            fromText = "Current location",
            toText = "Kyauktan Market",
            routeInputExpanded = false,
            selectedMode = TransitPlannerMode.Bus,
            onModeSelected = {},
            onRouteInputExpandedChange = {},
            onFindRoutes = {},
            onSwapRouteFields = {},
            onRouteSelected = {},
            onRouteOpen = {},
            onBack = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
