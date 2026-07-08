package com.coremapmm.app.feature.transit

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.CoreTextFieldBox
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.coreFloatingCard

private val TransitContentHorizontalPadding = 0.dp

@Composable
fun TransitSheet(
    uiState: TransitUiState,
    sheetLevel: SheetLevel,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onRecentRouteClick: (RecentRouteUiModel) -> Unit,
    onRouteFieldClick: (RouteInputField) -> Unit,
    onRoutePlaceSelected: (RoutePlaceResultUiModel) -> Unit,
    onSwapRouteFields: () -> Unit,
    onRouteInputBack: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    when {
        sheetLevel == SheetLevel.Hidden -> Unit
        sheetLevel == SheetLevel.Mini -> TransitMiniSummary(
            from = uiState.fromText,
            to = uiState.toText,
            modifier = modifier,
        )
        uiState.sheetMode == TransitSheetMode.RouteInput -> RouteInputFullScreen(
            uiState = uiState,
            onBack = onRouteInputBack,
            onModeSelected = onModeSelected,
            onPlanRoutes = onPlanRoutes,
            onFieldClick = onRouteFieldClick,
            onPlaceSelected = onRoutePlaceSelected,
            onSwap = onSwapRouteFields,
            modifier = modifier,
        )
        sheetLevel == SheetLevel.Default -> TransitDefaultPlannerContent(
            uiState = uiState,
            onModeSelected = onModeSelected,
            onPlanRoutes = onPlanRoutes,
            onRecentRouteClick = onRecentRouteClick,
            onFieldClick = onRouteFieldClick,
            modifier = modifier,
        )
        else -> TransitPlannerContent(
            uiState = uiState,
            onModeSelected = onModeSelected,
            onPlanRoutes = onPlanRoutes,
            onRecentRouteClick = onRecentRouteClick,
            onFieldClick = onRouteFieldClick,
            modifier = modifier,
        )
    }
}

@Composable
private fun TransitMiniSummary(
    from: String,
    to: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth(),
    ) {
        Text(
            text = stringResource(R.string.tab_transit),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "$from → $to",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun TransitDefaultPlannerContent(
    uiState: TransitUiState,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onRecentRouteClick: (RecentRouteUiModel) -> Unit,
    onFieldClick: (RouteInputField) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = PaddingValues(bottom = CoreMapSpacing.lg),
    ) {
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = TransitContentHorizontalPadding),
                verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                Text(
                    text = stringResource(R.string.transit_route_planner),
                    style = MaterialTheme.typography.titleMedium,
                )
                RouteInputFieldRow(
                    label = stringResource(R.string.transit_from),
                    value = uiState.fromText,
                    onClick = { onFieldClick(RouteInputField.From) },
                )
                RouteInputFieldRow(
                    label = stringResource(R.string.transit_to),
                    value = uiState.toText,
                    onClick = { onFieldClick(RouteInputField.To) },
                )
                ModeChipRow(
                    selectedMode = uiState.selectedPlannerMode,
                    onModeSelected = onModeSelected,
                )
                CorePrimaryButton(
                    text = stringResource(R.string.transit_find_routes),
                    onClick = onPlanRoutes,
                )
            }
        }
        item {
            TransitPreviewCard(
                uiState = uiState,
                onRecentRouteClick = onRecentRouteClick,
                modifier = Modifier.padding(horizontal = TransitContentHorizontalPadding),
            )
        }
    }
}

@Composable
private fun TransitPlannerContent(
    uiState: TransitUiState,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onRecentRouteClick: (RecentRouteUiModel) -> Unit,
    onFieldClick: (RouteInputField) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = PaddingValues(bottom = CoreMapSpacing.fullSheetScrollBottomPadding),
    ) {
        item {
            PlannerCard(
                uiState = uiState,
                onModeSelected = onModeSelected,
                onPlanRoutes = onPlanRoutes,
                onFieldClick = onFieldClick,
                modifier = Modifier,
            )
        }
        item {
            TransitSectionHeader(
                title = stringResource(R.string.transit_nearby_stops),
                modifier = Modifier,
            )
        }
        items(uiState.nearbyStops.take(2), key = { it.id }) { stop ->
            TransitListRow(title = stop.name, subtitle = stop.distanceText)
        }
        item {
            TransitSectionHeader(
                title = stringResource(R.string.transit_recent_routes),
                modifier = Modifier,
            )
        }
        items(uiState.recentRoutes.take(2), key = { it.id }) { recent ->
            TransitListRow(
                title = "${recent.from} -> ${recent.to}",
                subtitle = "${recent.modeLabel} · ${stringResource(R.string.transit_label_estimated)}",
                onClick = { onRecentRouteClick(recent) },
            )
        }
    }
}

@Composable
private fun PlannerCard(
    uiState: TransitUiState,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onFieldClick: (RouteInputField) -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            Text(
                text = stringResource(R.string.transit_route_planner),
                style = MaterialTheme.typography.titleMedium,
            )
            RouteInputFieldRow(
                label = stringResource(R.string.transit_from),
                value = uiState.fromText,
                onClick = { onFieldClick(RouteInputField.From) },
            )
            RouteInputFieldRow(
                label = stringResource(R.string.transit_to),
                value = uiState.toText,
                onClick = { onFieldClick(RouteInputField.To) },
            )
            ModeChipRow(selectedMode = uiState.selectedPlannerMode, onModeSelected = onModeSelected)
            CorePrimaryButton(
                text = stringResource(R.string.transit_find_routes),
                onClick = onPlanRoutes,
            )
            Text(
                text = stringResource(R.string.transit_data_not_verified),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TransitPreviewCard(
    uiState: TransitUiState,
    onRecentRouteClick: (RecentRouteUiModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
        ) {
            Text(
                text = stringResource(R.string.transit_recent_routes),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            uiState.recentRoutes.take(2).forEach { recent ->
                TransitListRow(
                    title = "${recent.from} -> ${recent.to}",
                    subtitle = "${recent.modeLabel} · ${stringResource(R.string.transit_label_estimated)}",
                    onClick = { onRecentRouteClick(recent) },
                    modifier = Modifier.padding(horizontal = 0.dp),
                )
            }
            if (uiState.recentRoutes.isEmpty()) {
                uiState.nearbyStops.take(2).forEach { stop ->
                    TransitListRow(
                        title = stop.name,
                        subtitle = stop.distanceText,
                        modifier = Modifier.padding(horizontal = 0.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun RouteInputFieldRow(
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
) {
    CoreTextFieldBox(
        label = label,
        value = value,
        active = active,
        onClick = onClick,
        modifier = modifier,
    )
}

@Composable
private fun ModeChipRow(
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
                label = plannerModeLabel(mode),
                selected = mode == selectedMode,
                onClick = { onModeSelected(mode) },
            )
        }
    }
}

@Composable
private fun plannerModeLabel(mode: TransitPlannerMode): String = when (mode) {
    TransitPlannerMode.Walk -> stringResource(R.string.transit_mode_walk)
    TransitPlannerMode.Motorbike -> stringResource(R.string.transit_mode_motorbike)
    TransitPlannerMode.Car -> stringResource(R.string.transit_mode_car)
    TransitPlannerMode.Bus -> stringResource(R.string.transit_mode_bus)
}

@Composable
internal fun TransitSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(vertical = CoreMapSpacing.xs),
    )
}

@Composable
internal fun TransitListRow(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = CoreMapSpacing.item),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Preview(showBackground = true, heightDp = 500)
@Composable
private fun TransitSheetPreview() {
    CoreMapTheme {
        TransitSheet(
            uiState = TransitUiState(),
            sheetLevel = SheetLevel.Default,
            onModeSelected = {},
            onPlanRoutes = {},
            onRecentRouteClick = {},
            onRouteFieldClick = {},
            onRoutePlaceSelected = {},
            onSwapRouteFields = {},
        )
    }
}
