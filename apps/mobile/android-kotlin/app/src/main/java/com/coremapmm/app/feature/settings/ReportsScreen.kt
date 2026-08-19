package com.coremapmm.app.feature.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
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
fun ReportsScreen(
    uiState: SettingsUiState,
    onBack: () -> Unit,
    onFilterSelected: (ReportStatusFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    val filteredReports = if (uiState.selectedReportFilter == ReportStatusFilter.All) {
        uiState.reports
    } else {
        uiState.reports.filter { it.status == uiState.selectedReportFilter }
    }

    LazyColumn(
        modifier = modifier,
        contentPadding = fullSheetLazyContentPadding(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        item {
            SettingsServiceHeader(
                title = stringResource(R.string.settings_service_reports),
                subtitle = stringResource(R.string.settings_reports_subtitle),
                onBack = onBack,
            )
        }
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                ReportStatusFilter.entries.forEach { filter ->
                    FilterChip(
                        selected = uiState.selectedReportFilter == filter,
                        onClick = { onFilterSelected(filter) },
                        label = { Text(text = filter.label()) },
                    )
                }
            }
        }
        item {
            Text(
                text = stringResource(R.string.settings_reports_my_reports),
                style = MaterialTheme.typography.titleSmall,
            )
        }
        item {
            Text(
                text = "My Reports are your submitted issue reports. Community Alerts are public regional info in My Map.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (filteredReports.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.settings_reports_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(filteredReports, key = { it.id }) { report ->
                ReportCard(report = report)
            }
        }
        item {
            Text(
                text = stringResource(R.string.settings_reports_pending_offline),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(
                    vertical = CoreMapSpacing.sm,
                ),
            )
        }
        item {
            ReportCard(report = FakeSettingsData.pendingOfflineReport, offline = true)
        }
        item {
            Text(
                text = "Contribution points are reviewed by admins.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = CoreMapSpacing.sm),
            )
        }
    }
}

@Composable
private fun ReportCard(
    report: SettingsReportUiModel,
    offline: Boolean = false,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 2.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(CoreMapSpacing.md),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            Text(text = report.title, style = MaterialTheme.typography.titleSmall)
            androidx.compose.foundation.layout.Row(
                horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = { Text(text = report.status.label()) },
                )
                if (offline) {
                    AssistChip(
                        onClick = {},
                        enabled = false,
                        label = { Text(text = stringResource(R.string.settings_reports_offline_chip)) },
                    )
                }
            }
            Text(
                text = report.updatedText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ReportStatusFilter.label(): String = when (this) {
    ReportStatusFilter.All -> stringResource(R.string.settings_reports_filter_all)
    ReportStatusFilter.Pending -> stringResource(R.string.settings_reports_filter_pending)
    ReportStatusFilter.Submitted -> "Submitted"
    ReportStatusFilter.Reviewed -> "Reviewed"
    ReportStatusFilter.Rejected -> "Rejected"
}

@Preview(showBackground = true, heightDp = 520)
@Composable
private fun ReportsScreenPreview() {
    CoreMapTheme {
        ReportsScreen(
            uiState = SettingsUiState(
                user = com.coremapmm.app.core.fake.FakeUser.currentUser,
                reports = FakeSettingsData.reports,
            ),
            onBack = {},
            onFilterSelected = {},
        )
    }
}
