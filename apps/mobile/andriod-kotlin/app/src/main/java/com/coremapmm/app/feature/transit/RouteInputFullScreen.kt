package com.coremapmm.app.feature.transit

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CoreOutlinedButton
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.CoreTextFieldBox
import com.coremapmm.app.core.ui.SafeFullPageContainer
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val RouteInputHorizontalPadding = 0.dp

@Composable
fun RouteInputFullScreen(
    uiState: TransitUiState,
    onBack: () -> Unit,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onFieldClick: (RouteInputField) -> Unit,
    onPlaceSelected: (RoutePlaceResultUiModel) -> Unit,
    onSwap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SafeFullPageContainer(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = RouteInputHorizontalPadding),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.transit_back),
                )
            }
            Text(
                text = stringResource(R.string.transit_route_input_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = CoreMapSpacing.xs),
            )
        }

        RouteInputGroupCard(
            uiState = uiState,
            onModeSelected = onModeSelected,
            onPlanRoutes = onPlanRoutes,
            onFieldClick = onFieldClick,
            onSwap = onSwap,
            modifier = Modifier.padding(horizontal = RouteInputHorizontalPadding),
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = fullSheetLazyContentPadding(
                start = RouteInputHorizontalPadding,
                end = RouteInputHorizontalPadding,
            ),
        ) {
            item {
                Text(
                    text = stringResource(R.string.search_results),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(
                        horizontal = CoreMapSpacing.xs,
                        vertical = CoreMapSpacing.xs,
                    ),
                )
            }
            items(uiState.filteredRoutePlaceResults, key = { it.id }) { result ->
                RoutePlaceResultRow(
                    result = result,
                    onClick = { onPlaceSelected(result) },
                )
            }
        }
    }
}

@Composable
private fun RouteInputGroupCard(
    uiState: TransitUiState,
    onModeSelected: (TransitPlannerMode) -> Unit,
    onPlanRoutes: () -> Unit,
    onFieldClick: (RouteInputField) -> Unit,
    onSwap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 3.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            RouteInputFieldRow(
                label = stringResource(R.string.transit_from),
                value = uiState.fromText,
                active = uiState.activeInputField == RouteInputField.From,
                onClick = { onFieldClick(RouteInputField.From) },
            )
            RouteInputFieldRow(
                label = stringResource(R.string.transit_to),
                value = uiState.toText,
                active = uiState.activeInputField == RouteInputField.To,
                onClick = { onFieldClick(RouteInputField.To) },
            )
            CoreOutlinedButton(
                text = stringResource(R.string.transit_swap),
                onClick = onSwap,
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
}

@Composable
private fun RouteInputFieldRow(
    label: String,
    value: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
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
private fun RoutePlaceResultRow(
    result: RoutePlaceResultUiModel,
    onClick: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = CoreMapSpacing.item),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Default.Place,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(end = CoreMapSpacing.item),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = result.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = result.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            result.distanceText?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider(color = CoreMapColors.Border)
    }
}

@Composable
private fun plannerModeLabel(mode: TransitPlannerMode): String = when (mode) {
    TransitPlannerMode.Walk -> stringResource(R.string.transit_mode_walk)
    TransitPlannerMode.Motorbike -> stringResource(R.string.transit_mode_motorbike)
    TransitPlannerMode.Car -> stringResource(R.string.transit_mode_car)
    TransitPlannerMode.Bus -> stringResource(R.string.transit_mode_bus)
}

@Preview(showBackground = true, heightDp = 700)
@Composable
private fun RouteInputFullScreenPreview() {
    CoreMapTheme {
        RouteInputFullScreen(
            uiState = TransitUiState(sheetMode = TransitSheetMode.RouteInput),
            onBack = {},
            onModeSelected = {},
            onPlanRoutes = {},
            onFieldClick = {},
            onPlaceSelected = {},
            onSwap = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
