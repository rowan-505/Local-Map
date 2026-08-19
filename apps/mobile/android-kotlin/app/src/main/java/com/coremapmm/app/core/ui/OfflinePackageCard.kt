package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeOfflinePackages
import com.coremapmm.app.core.model.OfflineAreaType
import com.coremapmm.app.core.model.OfflinePackageStatus
import com.coremapmm.app.core.model.OfflinePackageType
import com.coremapmm.app.core.model.OfflinePackageUiModel

@Composable
fun OfflinePackageCard(
    packageModel: OfflinePackageUiModel,
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {},
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 4.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        onClick = onClick,
    ) {
        Column(modifier = Modifier.padding(CoreMapSpacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = packageModel.areaName,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "${packageModel.areaType.label()} · ${packageModel.packageType.label()}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    )
                }
                Text(
                    text = packageModel.status.label(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                text = stringResource(
                    R.string.offline_package_meta,
                    packageModel.fileSizeText,
                    packageModel.lastUpdatedText,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = CoreMapSpacing.sm),
            )
            packageModel.warningText?.let { warning ->
                Text(
                    text = warning,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.padding(top = CoreMapSpacing.sm),
                )
            }
        }
    }
}

@Composable
private fun OfflineAreaType.label(): String = when (this) {
    OfflineAreaType.Township -> stringResource(R.string.offline_area_township)
    OfflineAreaType.Region -> stringResource(R.string.offline_area_region)
    OfflineAreaType.City -> stringResource(R.string.offline_area_city)
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

@Preview
@Composable
private fun OfflinePackageCardPreview() {
    CoreMapTheme {
        OfflinePackageCard(
            packageModel = FakeOfflinePackages.packages.first(),
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
