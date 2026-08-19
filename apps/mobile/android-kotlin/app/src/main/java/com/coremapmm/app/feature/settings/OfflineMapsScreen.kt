package com.coremapmm.app.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeOfflinePackages
import com.coremapmm.app.core.fake.FakeSettingsData
import com.coremapmm.app.core.model.OfflinePackageStatus
import com.coremapmm.app.core.model.OfflinePackageType
import com.coremapmm.app.core.model.OfflinePackageUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.CoreSmallFloatingShape
import com.coremapmm.app.core.ui.coreFloatingBorder
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val OfflineAreaTileHeight = 72.dp
private val OfflinePackageTileHeight = 64.dp

@Composable
fun OfflineMapsScreen(
    uiState: SettingsUiState,
    onBack: () -> Unit,
    onAreaSelected: (OfflineAreaOption) -> Unit,
    onPackageSelected: (OfflinePackageOption) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = fullSheetLazyContentPadding(top = CoreMapSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.md),
    ) {
        item {
            SettingsServiceHeader(
                title = stringResource(R.string.settings_service_offline_maps),
                subtitle = stringResource(R.string.settings_offline_subtitle),
                onBack = onBack,
            )
        }
        item {
            OfflineSectionTitle(text = stringResource(R.string.settings_offline_area_title))
            OfflineAreaSelector(
                selected = uiState.selectedOfflineArea,
                onSelected = onAreaSelected,
            )
        }
        item {
            OfflineSectionTitle(text = stringResource(R.string.settings_offline_package_title))
            OfflinePackageSelector(
                selected = uiState.selectedOfflinePackage,
                onSelected = onPackageSelected,
            )
        }
        item {
            OfflineSizeEstimateCard(label = uiState.estimatedPackageLabel)
        }
        if (uiState.offlineWarnings.isNotEmpty()) {
            item {
                OfflineSectionTitle(text = stringResource(R.string.settings_offline_warnings_title))
            }
            items(
                items = uiState.offlineWarnings,
                key = { warning -> "${warning.kind}-${warning.message}" },
            ) { warning ->
                OfflineWarningCard(warning = warning)
            }
        }
        item {
            OfflineSectionTitle(
                text = stringResource(R.string.settings_offline_downloaded_title),
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
            )
        }
        items(uiState.downloadedAreas, key = { it.id }) { packageModel ->
            OfflineDownloadedAreaCard(packageModel = packageModel)
        }
    }
}

@Composable
private fun OfflineSectionTitle(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(bottom = CoreMapSpacing.xs),
    )
}

@Composable
private fun OfflineAreaSelector(
    selected: OfflineAreaOption,
    onSelected: (OfflineAreaOption) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item)) {
        OfflineAreaOption.entries.chunked(2).forEach { rowOptions ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                rowOptions.forEach { option ->
                    OfflineSelectionTile(
                        label = FakeSettingsData.areaChipLabel(option),
                        subtitle = FakeSettingsData.areaChipSubtitle(option),
                        selected = option == selected,
                        onClick = { onSelected(option) },
                        modifier = Modifier
                            .weight(1f)
                            .height(OfflineAreaTileHeight),
                    )
                }
                if (rowOptions.size == 1) {
                    Box(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun OfflinePackageSelector(
    selected: OfflinePackageOption,
    onSelected: (OfflinePackageOption) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        OfflinePackageOption.entries.forEach { option ->
            OfflineSelectionTile(
                label = FakeSettingsData.packageLabel(option),
                selected = option == selected,
                onClick = { onSelected(option) },
                modifier = Modifier
                    .weight(1f)
                    .height(OfflinePackageTileHeight),
            )
        }
    }
}

@Composable
private fun OfflineSelectionTile(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
) {
    val shape = CoreSmallFloatingShape
    val containerColor = if (selected) {
        CoreMapColors.SoftGreenBackground
    } else {
        MaterialTheme.colorScheme.surface
    }
    val labelColor = if (selected) {
        CoreMapColors.DeepGreenText
    } else {
        MaterialTheme.colorScheme.onSurface
    }

    Surface(
        onClick = onClick,
        modifier = modifier
            .coreFloatingCard(elevation = if (selected) 3.dp else 2.dp, shape = shape)
            .coreFloatingBorder(shape = shape, selected = selected),
        shape = shape,
        color = containerColor,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = CoreMapSpacing.item, vertical = CoreMapSpacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = labelColor,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            subtitle?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) {
                        CoreMapColors.PrimaryGreen
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
        }
    }
}

@Composable
private fun OfflineSizeEstimateCard(label: String) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 3.dp)
            .coreFloatingBorder(shape = CoreFloatingCardShape, selected = true),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = CoreMapColors.SoftGreenBackground),
    ) {
        Column(modifier = Modifier.padding(CoreMapSpacing.md)) {
            Text(
                text = stringResource(R.string.settings_offline_estimated_size),
                style = MaterialTheme.typography.labelMedium,
                color = CoreMapColors.DeepGreenText,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
                color = CoreMapColors.DeepGreenText,
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
            )
        }
    }
}

@Composable
private fun OfflineWarningCard(warning: OfflineDownloadWarning) {
    val icon = warning.icon()
    val accentColor = when (warning.kind) {
        OfflineWarningKind.WifiRecommended,
        OfflineWarningKind.MobileData,
        OfflineWarningKind.LowStorage,
        -> CoreMapColors.WarningOrange
        OfflineWarningKind.Info -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val backgroundColor = when (warning.kind) {
        OfflineWarningKind.Info -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        else -> CoreMapColors.SoftWarningBackground
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 1.dp, shape = CoreSmallFloatingShape),
        shape = CoreSmallFloatingShape,
        colors = CardDefaults.cardColors(containerColor = backgroundColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(CoreMapSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = accentColor,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = warning.message,
                style = MaterialTheme.typography.bodyMedium,
                color = accentColor,
            )
        }
    }
}

@Composable
private fun OfflineDownloadedAreaCard(
    packageModel: OfflinePackageUiModel,
    modifier: Modifier = Modifier,
) {
    val isUpdateAvailable = packageModel.status == OfflinePackageStatus.UpdateAvailable
    val isDownloading = packageModel.status == OfflinePackageStatus.Downloading

    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp)
            .coreFloatingBorder(shape = CoreFloatingCardShape, selected = isUpdateAvailable),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = packageModel.areaName,
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = stringResource(
                            R.string.settings_offline_package_size_line,
                            packageModel.packageType.label(),
                            packageModel.fileSizeText,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OfflineStatusChip(status = packageModel.status)
            }

            packageModel.downloadedDateText?.let { downloadedDate ->
                Text(
                    text = stringResource(R.string.settings_offline_downloaded_on, downloadedDate),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            val latestUpdate = packageModel.latestUpdateDateText
                ?: packageModel.lastUpdatedText.takeIf { isDownloading }
            latestUpdate?.let { updateText ->
                Text(
                    text = if (isDownloading) {
                        updateText
                    } else {
                        stringResource(R.string.settings_offline_latest_update, updateText)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (isUpdateAvailable) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = CoreMapColors.WarningOrange,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        text = packageModel.warningText
                            ?: stringResource(R.string.settings_offline_update_available),
                        style = MaterialTheme.typography.bodySmall,
                        color = CoreMapColors.WarningOrange,
                    )
                }
            } else {
                packageModel.warningText?.let { warning ->
                    Text(
                        text = warning,
                        style = MaterialTheme.typography.bodySmall,
                        color = CoreMapColors.WarningOrange,
                    )
                }
            }
        }
    }
}

@Composable
private fun OfflineStatusChip(status: OfflinePackageStatus) {
    val label = status.label()
    val containerColor = when (status) {
        OfflinePackageStatus.Downloaded -> CoreMapColors.SoftGreenBackground
        OfflinePackageStatus.UpdateAvailable -> CoreMapColors.SoftWarningBackground
        OfflinePackageStatus.Downloading -> CoreMapColors.SoftBlueBackground
        OfflinePackageStatus.NotDownloaded -> MaterialTheme.colorScheme.surfaceVariant
    }
    val labelColor = when (status) {
        OfflinePackageStatus.Downloaded -> CoreMapColors.PrimaryGreen
        OfflinePackageStatus.UpdateAvailable -> CoreMapColors.WarningOrange
        OfflinePackageStatus.Downloading -> CoreMapColors.AccentBlue
        OfflinePackageStatus.NotDownloaded -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    AssistChip(
        onClick = {},
        enabled = false,
        label = { Text(text = label) },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = containerColor,
            labelColor = labelColor,
            disabledContainerColor = containerColor,
            disabledLabelColor = labelColor,
        ),
    )
}

@Composable
private fun OfflinePackageType.label(): String = when (this) {
    OfflinePackageType.Lite -> stringResource(R.string.offline_package_lite)
    OfflinePackageType.Standard -> stringResource(R.string.offline_package_standard)
    OfflinePackageType.Full -> stringResource(R.string.offline_package_full)
}

@Composable
private fun OfflinePackageStatus.label(): String = when (this) {
    OfflinePackageStatus.NotDownloaded -> stringResource(R.string.offline_status_not_downloaded)
    OfflinePackageStatus.Downloading -> stringResource(R.string.offline_status_downloading)
    OfflinePackageStatus.Downloaded -> stringResource(R.string.offline_status_downloaded)
    OfflinePackageStatus.UpdateAvailable -> stringResource(R.string.offline_status_update_available)
}

private fun OfflineDownloadWarning.icon(): ImageVector = Icons.Default.Warning

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun OfflineMapsScreenPreview() {
    CoreMapTheme {
        OfflineMapsScreen(
            uiState = SettingsUiState(
                user = com.coremapmm.app.core.fake.FakeUser.currentUser,
                services = FakeSettingsData.services,
                selectedOfflineArea = OfflineAreaOption.CurrentTownship,
                selectedOfflinePackage = OfflinePackageOption.Lite,
                estimatedPackageLabel = FakeSettingsData.packageSummaryLabel(
                    OfflineAreaOption.CurrentTownship,
                    OfflinePackageOption.Lite,
                ),
                downloadedAreas = FakeOfflinePackages.packages,
                offlineWarnings = FakeSettingsData.offlineWarnings(
                    OfflineAreaOption.CurrentTownship,
                    OfflinePackageOption.Lite,
                ),
            ),
            onBack = {},
            onAreaSelected = {},
            onPackageSelected = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
