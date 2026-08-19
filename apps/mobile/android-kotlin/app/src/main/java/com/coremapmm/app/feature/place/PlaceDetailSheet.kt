package com.coremapmm.app.feature.place

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakePlaces
import com.coremapmm.app.core.model.PlaceUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CoreSegmentedControl
import com.coremapmm.app.core.ui.PlacePhotoCarousel
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

@Composable
fun PlaceDetailSheet(
    sheetLevel: SheetLevel,
    place: PlaceUiModel,
    isSaved: Boolean,
    selectedTab: PlaceDetailTab,
    onTabSelected: (PlaceDetailTab) -> Unit,
    onToggleSave: () -> Unit,
    modifier: Modifier = Modifier,
    onActionClick: (String) -> Unit = {},
) {
    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> PlaceDetailMini(
            place = place,
            isSaved = isSaved,
            onToggleSave = onToggleSave,
            onActionClick = onActionClick,
            modifier = modifier,
        )
        SheetLevel.Default, SheetLevel.Detail -> PlaceDetailDefault(
            place = place,
            isSaved = isSaved,
            onToggleSave = onToggleSave,
            onActionClick = onActionClick,
            modifier = modifier,
        )
        SheetLevel.Full -> PlaceDetailFull(
            place = place,
            isSaved = isSaved,
            selectedTab = selectedTab,
            onTabSelected = onTabSelected,
            onToggleSave = onToggleSave,
            onActionClick = onActionClick,
            modifier = modifier,
        )
    }
}

// ── Mini 1/6 ────────────────────────────────────────────────────────────────

@Composable
private fun PlaceDetailMini(
    place: PlaceUiModel,
    isSaved: Boolean,
    onToggleSave: () -> Unit,
    onActionClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = CoreMapSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        Text(
            text = place.name,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = "${place.category} · ${place.distanceText}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        PlaceActionRow(
            actions = miniActions(isSaved),
            onActionClick = { action ->
                handleActionClick(action, onToggleSave, onActionClick)
            },
        )
    }
}

// ── Default 2/6 ─────────────────────────────────────────────────────────────

@Composable
private fun PlaceDetailDefault(
    place: PlaceUiModel,
    isSaved: Boolean,
    onToggleSave: () -> Unit,
    onActionClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(vertical = CoreMapSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.md),
    ) {
        PlaceHeaderSection(place = place)

        PlaceFloatingCard {
            PlaceLocationSummary(place = place)
        }

        PlaceActionRow(
            actions = fullActions(isSaved),
            onActionClick = { action ->
                handleActionClick(action, onToggleSave, onActionClick)
            },
        )

        if (place.photoUrls.isNotEmpty()) {
            PlacePhotoPreview(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
            )
        }
    }
}

// ── Full 6/6 ────────────────────────────────────────────────────────────────

@Composable
private fun PlaceDetailFull(
    place: PlaceUiModel,
    isSaved: Boolean,
    selectedTab: PlaceDetailTab,
    onTabSelected: (PlaceDetailTab) -> Unit,
    onToggleSave: () -> Unit,
    onActionClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.md),
        contentPadding = fullSheetLazyContentPadding(top = CoreMapSpacing.sm),
    ) {
        item {
            PlacePhotoCarousel(
                photoUrls = place.photoUrls,
                placeholderLabel = place.name,
            )
        }
        item {
            PlaceFloatingCard {
                PlaceHeaderSection(place = place, showAddress = true)
            }
        }
        item {
            PlaceActionRow(
                actions = fullActions(isSaved),
                onActionClick = { action ->
                    handleActionClick(action, onToggleSave, onActionClick)
                },
            )
        }
        item {
            PlaceFloatingCard {
                PlaceDetailInfoRows(place = place)
            }
        }
        item {
            PlaceDetailTabs(
                selectedTab = selectedTab,
                onTabSelected = onTabSelected,
            )
        }
        item {
            PlaceFloatingCard {
                PlaceDetailTabContent(tab = selectedTab, place = place)
            }
        }
    }
}

// ── Shared components ───────────────────────────────────────────────────────

@Composable
private fun PlaceFloatingCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
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
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            content = content,
        )
    }
}

@Composable
private fun PlaceHeaderSection(
    place: PlaceUiModel,
    showAddress: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
        Text(
            text = place.name,
            style = MaterialTheme.typography.headlineSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = place.category,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (place.verified) {
            VerifiedBadge(ratingText = place.ratingText)
        }
        if (showAddress && place.address.isNotBlank()) {
            Text(
                text = place.address,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun VerifiedBadge(ratingText: String) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = CoreMapColors.SoftGreenBackground,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            CoreMapColors.PrimaryGreen.copy(alpha = 0.3f),
        ),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = CoreMapSpacing.sm, vertical = CoreMapSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = CoreMapColors.PrimaryGreen,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = stringResource(R.string.place_verified_badge, ratingText),
                style = MaterialTheme.typography.labelMedium,
                color = CoreMapColors.DeepGreenText,
            )
        }
    }
}

@Composable
private fun PlaceLocationSummary(place: PlaceUiModel) {
    Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
        Text(
            text = "${place.township} · ${place.region}",
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (place.address.isNotBlank()) {
            Text(
                text = place.address,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = place.distanceText,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun PlaceDetailInfoRows(place: PlaceUiModel) {
    InfoRow(
        label = stringResource(R.string.place_hours_placeholder),
        muted = true,
    )
    HorizontalDivider(color = CoreMapColors.Border)
    InfoRow(
        label = stringResource(R.string.place_phone_label, place.phoneText),
    )
    HorizontalDivider(color = CoreMapColors.Border)
    InfoRow(
        label = stringResource(R.string.place_plus_code_label, place.plusCode),
    )
    HorizontalDivider(color = CoreMapColors.Border)
    InfoRow(
        label = stringResource(R.string.place_coordinates_placeholder),
        muted = true,
    )
}

@Composable
private fun InfoRow(
    label: String,
    muted: Boolean = false,
) {
    Text(
        text = label,
        style = if (muted) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
        color = if (muted) {
            MaterialTheme.colorScheme.onSurfaceVariant
        } else {
            MaterialTheme.colorScheme.onSurface
        },
        modifier = Modifier.padding(vertical = CoreMapSpacing.xs),
    )
}

@Composable
private fun PlacePhotoPreview(
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .coreFloatingCard(elevation = 2.dp)
            .clip(CoreFloatingCardShape)
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.surfaceVariant,
                        CoreMapColors.PrimaryGreen.copy(alpha = 0.1f),
                    ),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.Default.Place,
            contentDescription = null,
            tint = CoreMapColors.MapOnSurfaceMuted.copy(alpha = 0.5f),
            modifier = Modifier.size(28.dp),
        )
    }
}

@Composable
private fun PlaceDetailTabs(
    selectedTab: PlaceDetailTab,
    onTabSelected: (PlaceDetailTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = PlaceDetailTab.entries
    CoreSegmentedControl(
        options = tabs.map { tab ->
            when (tab) {
                PlaceDetailTab.Overview -> stringResource(R.string.place_tab_overview)
                PlaceDetailTab.Nearby -> stringResource(R.string.place_tab_nearby)
                PlaceDetailTab.Info -> stringResource(R.string.place_tab_info)
                PlaceDetailTab.Reports -> stringResource(R.string.place_tab_reports)
            }
        },
        selectedIndex = tabs.indexOf(selectedTab),
        onSelected = { index -> onTabSelected(tabs[index]) },
        modifier = modifier,
    )
}

@Composable
private fun PlaceDetailTabContent(
    tab: PlaceDetailTab,
    place: PlaceUiModel,
) {
    val text = when (tab) {
        PlaceDetailTab.Overview -> stringResource(R.string.place_tab_overview_body, place.name)
        PlaceDetailTab.Nearby -> stringResource(R.string.place_tab_nearby_body, place.township)
        PlaceDetailTab.Info -> stringResource(R.string.place_tab_info_body, place.address)
        PlaceDetailTab.Reports -> stringResource(R.string.place_tab_reports_body)
    }
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

// ── Action helpers ──────────────────────────────────────────────────────────

@Composable
private fun miniActions(isSaved: Boolean): List<PlaceActionItem> = listOf(
    PlaceActionItem(PlaceActionId.To, stringResource(R.string.place_action_to)),
    PlaceActionItem(
        PlaceActionId.Save,
        if (isSaved) stringResource(R.string.place_action_saved) else stringResource(R.string.place_action_save),
    ),
)

@Composable
private fun fullActions(isSaved: Boolean): List<PlaceActionItem> = listOf(
    PlaceActionItem(PlaceActionId.Report, stringResource(R.string.place_action_report)),
    PlaceActionItem(
        PlaceActionId.Save,
        if (isSaved) stringResource(R.string.place_action_saved) else stringResource(R.string.place_action_save),
    ),
    PlaceActionItem(PlaceActionId.Share, stringResource(R.string.place_action_share)),
    PlaceActionItem(PlaceActionId.From, stringResource(R.string.place_action_from)),
    PlaceActionItem(PlaceActionId.To, stringResource(R.string.place_action_to)),
)

private fun handleActionClick(
    action: PlaceActionItem,
    onToggleSave: () -> Unit,
    onActionClick: (String) -> Unit,
) {
    when (action.id) {
        PlaceActionId.Save -> onToggleSave()
        PlaceActionId.Report -> onActionClick("Report")
        else -> onActionClick(action.label)
    }
}

// ── Previews ────────────────────────────────────────────────────────────────

@Preview(showBackground = true, heightDp = 120)
@Composable
private fun PlaceDetailMiniPreview() {
    CoreMapTheme {
        PlaceDetailSheet(
            sheetLevel = SheetLevel.Mini,
            place = FakePlaces.discoverPlaces.first(),
            isSaved = true,
            selectedTab = PlaceDetailTab.Overview,
            onTabSelected = {},
            onToggleSave = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}

@Preview(showBackground = true, heightDp = 400)
@Composable
private fun PlaceDetailDefaultPreview() {
    CoreMapTheme {
        PlaceDetailSheet(
            sheetLevel = SheetLevel.Default,
            place = FakePlaces.discoverPlaces.first(),
            isSaved = true,
            selectedTab = PlaceDetailTab.Overview,
            onTabSelected = {},
            onToggleSave = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}

@Preview(showBackground = true, heightDp = 700)
@Composable
private fun PlaceDetailFullPreview() {
    CoreMapTheme {
        PlaceDetailSheet(
            sheetLevel = SheetLevel.Full,
            place = FakePlaces.discoverPlaces.first(),
            isSaved = false,
            selectedTab = PlaceDetailTab.Overview,
            onTabSelected = {},
            onToggleSave = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
