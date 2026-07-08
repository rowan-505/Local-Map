package com.coremapmm.app.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

@Composable
fun DataSaverScreen(
    enabled: Boolean,
    onBack: () -> Unit,
    onEnabledChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val bullets = listOf(
        stringResource(R.string.settings_data_saver_bullet_pois),
        stringResource(R.string.settings_data_saver_bullet_photos),
        stringResource(R.string.settings_data_saver_bullet_downloads),
        stringResource(R.string.settings_data_saver_bullet_cache),
    )

    LazyColumn(
        modifier = modifier,
        contentPadding = fullSheetLazyContentPadding(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        item {
            SettingsServiceHeader(
                title = stringResource(R.string.settings_service_data_saver),
                subtitle = stringResource(R.string.settings_data_saver_subtitle),
                onBack = onBack,
            )
        }
        item {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .coreFloatingCard(elevation = 2.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(CoreMapSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.settings_data_saver_toggle),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            text = if (enabled) {
                                stringResource(R.string.settings_data_saver_on)
                            } else {
                                stringResource(R.string.settings_data_saver_off)
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = CoreMapSpacing.xs),
                        )
                    }
                    Switch(
                        checked = enabled,
                        onCheckedChange = onEnabledChanged,
                    )
                }
            }
        }
        item {
            Text(
                text = stringResource(R.string.settings_data_saver_explanation_title),
                style = MaterialTheme.typography.titleSmall,
            )
        }
        items(bullets.size) { index ->
            Text(
                text = "• ${bullets[index]}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview(showBackground = true, heightDp = 360)
@Composable
private fun DataSaverScreenPreview() {
    CoreMapTheme {
        DataSaverScreen(
            enabled = true,
            onBack = {},
            onEnabledChanged = {},
        )
    }
}
