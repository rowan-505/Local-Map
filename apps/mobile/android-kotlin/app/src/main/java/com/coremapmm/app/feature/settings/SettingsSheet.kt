package com.coremapmm.app.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import com.coremapmm.app.core.model.UserUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CoreSmallFloatingShape
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.coreFloatingBorder
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val SettingsServiceCardHeightDefault = 104.dp
private val SettingsServiceCardHeightFull = 124.dp
private val SettingsServiceGridSpacing = CoreMapSpacing.item

@Composable
fun SettingsSheet(
    sheetLevel: SheetLevel,
    onOpenService: (SettingsService) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = viewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> SettingsMiniContent(modifier = modifier)
        SheetLevel.Default, SheetLevel.Detail, SheetLevel.Full -> {
            val activeService = uiState.activeService
            val scrollModifier = modifier.fillMaxSize()
            if (activeService == null) {
                SettingsMainContent(
                    user = uiState.user,
                    services = uiState.services,
                    expanded = sheetLevel == SheetLevel.Full,
                    onServiceClick = onOpenService,
                    onLoginClick = viewModel::toggleGuestUser,
                    modifier = scrollModifier,
                )
            } else {
                SettingsServiceContent(
                    service = activeService,
                    uiState = uiState,
                    onBack = viewModel::closeService,
                    onOfflineAreaSelected = viewModel::selectOfflineArea,
                    onOfflinePackageSelected = viewModel::selectOfflinePackage,
                    onReportFilterSelected = viewModel::selectReportFilter,
                    onDataSaverChanged = viewModel::toggleDataSaver,
                    modifier = scrollModifier,
                )
            }
        }
    }
}

@Composable
private fun SettingsMiniContent(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth(),
    ) {
        Text(text = stringResource(R.string.tab_settings), style = MaterialTheme.typography.titleMedium)
        Text(
            text = stringResource(R.string.settings_mini_summary),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun SettingsMainContent(
    user: UserUiModel,
    services: List<SettingsServiceItem>,
    expanded: Boolean,
    onServiceClick: (SettingsService) -> Unit,
    onLoginClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = services.chunked(2)
    val cardHeight = if (expanded) SettingsServiceCardHeightFull else SettingsServiceCardHeightDefault

    LazyColumn(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(if (expanded) CoreMapSpacing.md else CoreMapSpacing.item),
        contentPadding = if (expanded) {
            fullSheetLazyContentPadding(top = CoreMapSpacing.xs)
        } else {
            PaddingValues(bottom = CoreMapSpacing.item)
        },
    ) {
        item {
            SettingsProfileCard(
                user = user,
                expanded = expanded,
                onLoginClick = onLoginClick,
            )
        }
        item {
            Text(
                text = stringResource(R.string.settings_services_title),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(
                    top = if (expanded) CoreMapSpacing.xs else 0.dp,
                    bottom = CoreMapSpacing.xs,
                ),
            )
        }
        rows.forEachIndexed { index, rowItems ->
            item(key = "settings-row-$index") {
                SettingsServiceRow(
                    services = rowItems,
                    showDescription = expanded,
                    cardHeight = cardHeight,
                    onServiceClick = onServiceClick,
                )
            }
        }
    }
}

@Composable
private fun SettingsProfileCard(
    user: UserUiModel,
    expanded: Boolean,
    onLoginClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val avatarSize = if (expanded) 64.dp else 48.dp
    val cardPadding = if (expanded) CoreMapSpacing.lg else CoreMapSpacing.md

    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 3.dp)
            .coreFloatingBorder(shape = CoreFloatingCardShape),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(cardPadding),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            Box(
                modifier = Modifier
                    .size(avatarSize)
                    .clip(CircleShape)
                    .background(CoreMapColors.SoftGreenBackground),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = user.name.take(1).uppercase(),
                    style = if (expanded) {
                        MaterialTheme.typography.headlineSmall
                    } else {
                        MaterialTheme.typography.titleMedium
                    },
                    color = CoreMapColors.PrimaryGreen,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = user.name,
                    style = if (expanded) {
                        MaterialTheme.typography.headlineSmall
                    } else {
                        MaterialTheme.typography.titleMedium
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = user.levelText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    maxLines = if (expanded) 2 else 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = user.pointsText,
                    style = MaterialTheme.typography.labelLarge,
                    color = CoreMapColors.PrimaryGreen,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
                if (user.isGuest) {
                    TextButton(
                        onClick = onLoginClick,
                        modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    ) {
                        Text(
                            text = stringResource(R.string.settings_login_placeholder),
                            color = CoreMapColors.PrimaryGreen,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsServiceRow(
    services: List<SettingsServiceItem>,
    showDescription: Boolean,
    cardHeight: androidx.compose.ui.unit.Dp,
    onServiceClick: (SettingsService) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(SettingsServiceGridSpacing),
    ) {
        services.forEach { item ->
            SettingsServiceCard(
                item = item,
                showDescription = showDescription,
                onClick = { onServiceClick(item.service) },
                modifier = Modifier
                    .weight(1f)
                    .height(cardHeight),
            )
        }
        if (services.size == 1) {
            Box(modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun SettingsServiceCard(
    item: SettingsServiceItem,
    showDescription: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val iconContainerSize = if (showDescription) 44.dp else 40.dp
    val iconSize = if (showDescription) 24.dp else 22.dp

    Card(
        modifier = modifier
            .coreFloatingCard(elevation = 2.dp)
            .coreFloatingBorder(shape = CoreSmallFloatingShape),
        onClick = onClick,
        shape = CoreSmallFloatingShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = CoreMapSpacing.item, vertical = CoreMapSpacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(iconContainerSize)
                    .clip(CircleShape)
                    .background(CoreMapColors.SoftGreenBackground),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = item.service.icon(),
                    contentDescription = null,
                    tint = CoreMapColors.PrimaryGreen,
                    modifier = Modifier.size(iconSize),
                )
            }
            Text(
                text = item.title,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = CoreMapSpacing.sm),
            )
            if (showDescription) {
                Text(
                    text = item.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
        }
    }
}

@Composable
private fun SettingsServiceContent(
    service: SettingsService,
    uiState: SettingsUiState,
    onBack: () -> Unit,
    onOfflineAreaSelected: (OfflineAreaOption) -> Unit,
    onOfflinePackageSelected: (OfflinePackageOption) -> Unit,
    onReportFilterSelected: (ReportStatusFilter) -> Unit,
    onDataSaverChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (service) {
        SettingsService.OfflineMaps -> OfflineMapsScreen(
            uiState = uiState,
            onBack = onBack,
            onAreaSelected = onOfflineAreaSelected,
            onPackageSelected = onOfflinePackageSelected,
            modifier = modifier,
        )
        SettingsService.Reports -> ReportsScreen(
            uiState = uiState,
            onBack = onBack,
            onFilterSelected = onReportFilterSelected,
            modifier = modifier,
        )
        SettingsService.Points -> PointsScreen(
            uiState = uiState,
            onBack = onBack,
            modifier = modifier,
        )
        SettingsService.DataSaver -> DataSaverScreen(
            enabled = uiState.dataSaverEnabled,
            onBack = onBack,
            onEnabledChanged = onDataSaverChanged,
            modifier = modifier,
        )
        SettingsService.Language -> ServicePlaceholderScreen(
            title = stringResource(R.string.settings_service_language),
            description = stringResource(R.string.settings_service_language_body),
            onBack = onBack,
            modifier = modifier,
        )
        SettingsService.MapSettings -> ServicePlaceholderScreen(
            title = stringResource(R.string.settings_service_map_settings),
            description = stringResource(R.string.settings_service_map_settings_body),
            onBack = onBack,
            modifier = modifier,
        )
        SettingsService.Help -> ServicePlaceholderScreen(
            title = stringResource(R.string.settings_service_help),
            description = stringResource(R.string.settings_service_help_body),
            onBack = onBack,
            modifier = modifier,
        )
    }
}

private fun SettingsService.icon(): ImageVector = when (this) {
    SettingsService.OfflineMaps -> Icons.Default.LocationOn
    SettingsService.Reports -> Icons.Default.Warning
    SettingsService.Points -> Icons.Default.Star
    SettingsService.DataSaver -> Icons.Default.CheckCircle
    SettingsService.Language -> Icons.Default.Menu
    SettingsService.MapSettings -> Icons.Default.Settings
    SettingsService.Help -> Icons.Default.Info
}

@Preview(showBackground = true, heightDp = 360)
@Composable
private fun SettingsDefaultPreview() {
    CoreMapTheme {
        SettingsMainContent(
            user = com.coremapmm.app.core.fake.FakeUser.signedInUser,
            services = com.coremapmm.app.core.fake.FakeSettingsData.services,
            expanded = false,
            onServiceClick = {},
            onLoginClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}

@Preview(showBackground = true, heightDp = 720)
@Composable
private fun SettingsFullPreview() {
    CoreMapTheme {
        SettingsMainContent(
            user = com.coremapmm.app.core.fake.FakeUser.signedInUser,
            services = com.coremapmm.app.core.fake.FakeSettingsData.services,
            expanded = true,
            onServiceClick = {},
            onLoginClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
