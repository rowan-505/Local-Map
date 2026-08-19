package com.coremapmm.app.feature.discover

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.coremapmm.app.core.model.OfflinePackageUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.coreFloatingCard

/** Manual download placeholder only — no auto-download behavior. */
@Composable
fun OfflineSuggestionCard(
    packageModel: OfflinePackageUiModel,
    modifier: Modifier = Modifier,
    onDownloadClick: () -> Unit = {},
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(CoreMapSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Default.Add,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = CoreMapSpacing.sm),
            ) {
                Text(
                    text = stringResource(R.string.discover_offline_title, packageModel.areaName),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = stringResource(
                        R.string.discover_offline_subtitle,
                        packageModel.fileSizeText,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
            TextButton(onClick = onDownloadClick) {
                Text(text = stringResource(R.string.discover_offline_action))
            }
        }
    }
}

@Preview
@Composable
private fun OfflineSuggestionCardPreview() {
    CoreMapTheme {
        OfflineSuggestionCard(
            packageModel = FakeOfflinePackages.packages.first(),
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
