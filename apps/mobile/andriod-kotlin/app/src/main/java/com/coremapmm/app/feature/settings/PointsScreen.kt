package com.coremapmm.app.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeSettingsData
import com.coremapmm.app.core.ui.coreFloatingCard
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

@Composable
fun PointsScreen(
    uiState: SettingsUiState,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = fullSheetLazyContentPadding(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        item {
            SettingsServiceHeader(
                title = stringResource(R.string.settings_service_points),
                subtitle = stringResource(R.string.settings_points_subtitle),
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
                Column(modifier = Modifier.padding(CoreMapSpacing.md)) {
                    Text(
                        text = stringResource(R.string.settings_points_summary_title),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = uiState.user.pointsText,
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    )
                    Text(
                        text = uiState.user.levelText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    )
                }
            }
        }
        item {
            Text(
                text = stringResource(R.string.settings_points_history_title),
                style = MaterialTheme.typography.titleSmall,
            )
        }
        items(uiState.contributions, key = { it.id }) { contribution ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .coreFloatingCard(elevation = 2.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(
                    modifier = Modifier.padding(CoreMapSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
                ) {
                    Text(text = contribution.title, style = MaterialTheme.typography.titleSmall)
                    Text(
                        text = contribution.pointsText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = contribution.dateText,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .coreFloatingCard(elevation = 2.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Column(modifier = Modifier.padding(CoreMapSpacing.md)) {
                    Text(
                        text = stringResource(R.string.settings_points_admin_reward_title),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = uiState.adminRewardText,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = CoreMapSpacing.sm),
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true, heightDp = 560)
@Composable
private fun PointsScreenPreview() {
    CoreMapTheme {
        PointsScreen(
            uiState = SettingsUiState(
                user = com.coremapmm.app.core.fake.FakeUser.signedInUser,
                contributions = FakeSettingsData.contributions,
                adminRewardText = FakeSettingsData.adminRewardText,
            ),
            onBack = {},
        )
    }
}
