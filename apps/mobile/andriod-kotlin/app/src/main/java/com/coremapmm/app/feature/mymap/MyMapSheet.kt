package com.coremapmm.app.feature.mymap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeMyMapData
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val MyMapMenuButtonHeight = 92.dp

@Composable
fun MyMapSheet(
    sheetLevel: SheetLevel,
    onItemClick: (MyMapItemUiModel) -> Unit,
    modifier: Modifier = Modifier,
    onMenuSelected: () -> Unit = {},
    onSendInfoClick: () -> Unit = {},
    viewModel: MyMapViewModel = viewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val counts = MyMapSectionTab.entries.associateWith { uiState.countFor(it) }
    val onSectionSelected: (MyMapSectionTab) -> Unit = { tab ->
        viewModel.selectTab(tab)
        onMenuSelected()
    }

    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> MyMapMiniContent(
            counts = counts,
            selectedTab = uiState.selectedTab,
            onTabSelected = onSectionSelected,
            modifier = modifier,
        )
        SheetLevel.Default -> MyMapMenuContent(
            counts = counts,
            onTabSelected = onSectionSelected,
            modifier = modifier,
        )
        SheetLevel.Detail -> MyMapMenuContent(
            counts = counts,
            onTabSelected = onSectionSelected,
            selectedTab = uiState.selectedTab,
            showPreview = true,
            modifier = modifier,
        )
        SheetLevel.Full -> MyMapFullContent(
            uiState = uiState,
            onTabSelected = viewModel::selectTab,
            onItemClick = onItemClick,
            onSendInfoClick = onSendInfoClick,
            modifier = modifier,
        )
    }
}

@Composable
private fun MyMapMiniContent(
    counts: Map<MyMapSectionTab, Int>,
    selectedTab: MyMapSectionTab,
    onTabSelected: (MyMapSectionTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        items(MyMapSectionTab.entries, key = { it.name }) { tab ->
            MyMapMiniMenuItem(
                tab = tab,
                count = counts[tab] ?: 0,
                selected = tab == selectedTab,
                onClick = { onTabSelected(tab) },
            )
        }
    }
}

@Composable
private fun MyMapMiniMenuItem(
    tab: MyMapSectionTab,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .height(76.dp)
            .coreFloatingCard(elevation = 2.dp),
        onClick = onClick,
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                CoreMapColors.SoftGreenBackground
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        border = if (selected) {
            BorderStroke(1.dp, CoreMapColors.PrimaryGreen.copy(alpha = 0.4f))
        } else {
            null
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = CoreMapSpacing.md, vertical = CoreMapSpacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = tab.icon(),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp),
            )
            Text(
                text = tab.shortLabel(),
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
            )
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun MyMapMenuContent(
    counts: Map<MyMapSectionTab, Int>,
    onTabSelected: (MyMapSectionTab) -> Unit,
    selectedTab: MyMapSectionTab = MyMapSectionTab.Places,
    showPreview: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        Text(
            text = stringResource(R.string.tab_my_map),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = CoreMapSpacing.xs),
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item)) {
            items(MyMapSectionTab.entries, key = { it.name }) { tab ->
                MyMapMenuButton(
                    tab = tab,
                    count = counts[tab] ?: 0,
                    selected = tab == selectedTab,
                    onClick = { onTabSelected(tab) },
                )
            }
        }
        if (showPreview) {
            MyMapDetailPreview(selectedTab = selectedTab)
        }
    }
}

@Composable
private fun MyMapMenuButton(
    tab: MyMapSectionTab,
    count: Int,
    selected: Boolean = false,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .width(140.dp)
            .height(MyMapMenuButtonHeight)
            .coreFloatingCard(elevation = 2.dp),
        onClick = onClick,
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                CoreMapColors.SoftGreenBackground
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        border = if (selected) {
            BorderStroke(1.dp, CoreMapColors.PrimaryGreen.copy(alpha = 0.4f))
        } else {
            null
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(CoreMapSpacing.item),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = tab.icon(),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(28.dp),
            )
            Text(
                text = tab.menuLabel(),
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = CoreMapSpacing.sm),
            )
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
            )
        }
    }
}

@Composable
private fun MyMapFullContent(
    uiState: MyMapUiState,
    onTabSelected: (MyMapSectionTab) -> Unit,
    onItemClick: (MyMapItemUiModel) -> Unit,
    onSendInfoClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selectedSection = uiState.selectedTab.toSection()
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = fullSheetLazyContentPadding(),
    ) {
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                Text(
                    text = stringResource(R.string.tab_my_map),
                    style = MaterialTheme.typography.titleMedium,
                )
                MyMapSegmentedTabs(
                    selectedTab = uiState.selectedTab,
                    onTabSelected = onTabSelected,
                )
            }
        }
        item {
            MyMapSectionHeader(title = selectedSection.title)
        }
        if (uiState.selectedTab == MyMapSectionTab.Alerts) {
            item {
                AlertsIntroRow(onSendInfoClick = onSendInfoClick)
            }
            items(FakeMyMapData.communityAlerts, key = { it.id }) { alert ->
                CommunityAlertCard(alert = alert)
            }
        } else {
            items(selectedSection.items, key = { it.id }) { item ->
                MyMapItemRow(
                    item = item,
                    onClick = { onItemClick(item) },
                    onQuickAction = { onItemClick(item) },
                    showDivider = item.id != selectedSection.items.lastOrNull()?.id,
                )
            }
        }
    }
}

@Composable
private fun MyMapSegmentedTabs(
    selectedTab: MyMapSectionTab,
    onTabSelected: (MyMapSectionTab) -> Unit,
) {
    val tabs = MyMapSectionTab.entries
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        tabs.forEach { tab ->
            FilterChip(
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
                label = {
                    Text(
                        text = tab.segmentLabel(),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
            )
        }
    }
}

@Composable
private fun MyMapSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = CoreMapSpacing.xs),
    )
}

@Composable
private fun MyMapSectionTab.menuLabel(): String = when (this) {
    MyMapSectionTab.Places -> stringResource(R.string.mymap_menu_saved_places)
    MyMapSectionTab.Routes -> stringResource(R.string.mymap_menu_routes)
    MyMapSectionTab.Recents -> stringResource(R.string.mymap_menu_recent_searches)
    MyMapSectionTab.Alerts -> "Community Alerts"
    MyMapSectionTab.Downloads -> stringResource(R.string.mymap_menu_downloaded_areas)
}

@Composable
private fun MyMapSectionTab.segmentLabel(): String = when (this) {
    MyMapSectionTab.Places -> stringResource(R.string.mymap_tab_places)
    MyMapSectionTab.Routes -> stringResource(R.string.mymap_tab_routes)
    MyMapSectionTab.Recents -> stringResource(R.string.mymap_tab_recents)
    MyMapSectionTab.Alerts -> "Alerts"
    MyMapSectionTab.Downloads -> "Offline"
}

private fun MyMapSectionTab.icon(): ImageVector = when (this) {
    MyMapSectionTab.Places -> Icons.Default.Star
    MyMapSectionTab.Routes -> Icons.Default.Menu
    MyMapSectionTab.Recents -> Icons.Default.Search
    MyMapSectionTab.Alerts -> Icons.Default.Warning
    MyMapSectionTab.Downloads -> Icons.Default.Add
}

private fun MyMapSectionTab.shortLabel(): String = when (this) {
    MyMapSectionTab.Places -> "Saved"
    MyMapSectionTab.Routes -> "Routes"
    MyMapSectionTab.Recents -> "Recents"
    MyMapSectionTab.Alerts -> "Alerts"
    MyMapSectionTab.Downloads -> "Offline"
}

private fun MyMapSectionTab.toSection(): MyMapSectionUiModel = when (this) {
    MyMapSectionTab.Places -> MyMapSectionUiModel(
        id = "saved-places",
        title = "Saved Places",
        items = FakeMyMapData.savedPlaces,
    )
    MyMapSectionTab.Routes -> MyMapSectionUiModel(
        id = "saved-routes",
        title = "Routes",
        items = FakeMyMapData.savedRoutes,
    )
    MyMapSectionTab.Recents -> MyMapSectionUiModel(
        id = "recent-searches",
        title = "Recent Searches",
        items = FakeMyMapData.recentSearches,
    )
    MyMapSectionTab.Alerts -> MyMapSectionUiModel(
        id = "community-alerts",
        title = "Community Info / Alerts",
        items = emptyList(),
    )
    MyMapSectionTab.Downloads -> MyMapSectionUiModel(
        id = "downloaded-areas",
        title = "Downloaded Areas",
        items = FakeMyMapData.downloadedAreas,
    )
}

@Composable
private fun MyMapDetailPreview(selectedTab: MyMapSectionTab) {
    if (selectedTab == MyMapSectionTab.Alerts) {
        Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Verified local info",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = {}) {
                    Icon(imageVector = Icons.Default.Add, contentDescription = "Send info")
                }
            }
            FakeMyMapData.communityAlerts.take(3).forEach { alert ->
                CommunityAlertCard(alert = alert, compact = true)
            }
        }
    } else {
        val section = selectedTab.toSection()
        Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
            Text(
                text = section.title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            section.items.take(2).forEach { item ->
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun AlertsIntroRow(onSendInfoClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Verified regional notices from CoreMap and the community.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onSendInfoClick) {
            Icon(imageVector = Icons.Default.Add, contentDescription = "Send info")
        }
    }
}

@Composable
private fun CommunityAlertCard(
    alert: CommunityAlertUiModel,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val severityColor = alert.severity.color()
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, severityColor.copy(alpha = 0.24f)),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = alert.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = if (compact) 1 else 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${alert.area} · ${alert.category}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Surface(
                    shape = CoreFloatingCardShape,
                    color = severityColor.copy(alpha = 0.12f),
                ) {
                    Text(
                        text = alert.severity.label(),
                        style = MaterialTheme.typography.labelSmall,
                        color = severityColor,
                        modifier = Modifier.padding(
                            horizontal = CoreMapSpacing.sm,
                            vertical = CoreMapSpacing.xs,
                        ),
                    )
                }
            }
            Text(
                text = "${alert.sourceText} · ${alert.updatedText}",
                style = MaterialTheme.typography.labelMedium,
                color = severityColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = alert.message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (compact) 2 else 3,
                overflow = TextOverflow.Ellipsis,
            )
            alert.affectedAreaText?.let {
                Text(
                    text = "Affected area: $it",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private fun CommunityAlertSeverity.color(): androidx.compose.ui.graphics.Color = when (this) {
    CommunityAlertSeverity.Info -> CoreMapColors.AccentBlue
    CommunityAlertSeverity.Notice -> CoreMapColors.PrimaryGreen
    CommunityAlertSeverity.Warning -> CoreMapColors.WarningOrange
    CommunityAlertSeverity.Urgent -> CoreMapColors.DestinationRed
}

private fun CommunityAlertSeverity.label(): String = when (this) {
    CommunityAlertSeverity.Info -> "Info"
    CommunityAlertSeverity.Notice -> "Notice"
    CommunityAlertSeverity.Warning -> "Warning"
    CommunityAlertSeverity.Urgent -> "Urgent"
}

@Preview(showBackground = true, heightDp = 280)
@Composable
private fun MyMapMenuPreview() {
    CoreMapTheme {
        MyMapMenuContent(
            counts = mapOf(
                MyMapSectionTab.Places to 12,
                MyMapSectionTab.Routes to 2,
                MyMapSectionTab.Recents to 3,
                MyMapSectionTab.Alerts to 4,
                MyMapSectionTab.Downloads to 2,
            ),
            onTabSelected = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}

@Preview(showBackground = true, heightDp = 640)
@Composable
private fun MyMapFullPreview() {
    CoreMapTheme {
        MyMapFullContent(
            uiState = MyMapUiState(),
            onTabSelected = {},
            onItemClick = {},
            onSendInfoClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
