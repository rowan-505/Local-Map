package com.coremapmm.app.feature.report

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val ReportIssueTypes = listOf(
    "Missing place",
    "Wrong location",
    "Wrong name",
    "Closed place",
    "Wrong road",
    "Wrong route",
    "Wrong bus stop",
    "Other",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReportIssueSheet(
    contextLabel: String?,
    modifier: Modifier = Modifier,
) {
    var selectedType by remember { mutableStateOf(ReportIssueTypes.first()) }
    var description by remember { mutableStateOf("") }

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = fullSheetLazyContentPadding(),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
                Text(
                    text = "Report a map issue",
                    style = MaterialTheme.typography.headlineSmall,
                )
                contextLabel?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        item {
            Text(
                text = "Issue type",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
                verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.sm),
            ) {
                ReportIssueTypes.forEach { type ->
                    CoreSelectableChip(
                        label = type,
                        selected = type == selectedType,
                        onClick = { selectedType = type },
                    )
                }
            }
        }
        item {
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                label = { Text(text = "Description") },
                placeholder = { Text(text = "Describe what should be corrected") },
            )
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                ),
            ) {
                Text(
                    text = "Optional photo placeholder: Coming later",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(CoreMapSpacing.md),
                )
            }
        }
        item {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = CoreMapColors.SoftWarningBackground,
            ) {
                Text(
                    text = "If offline, report will be saved and sent later. Contribution points are reviewed by admins.",
                    style = MaterialTheme.typography.bodySmall,
                    color = CoreMapColors.WarningOrange,
                    modifier = Modifier.padding(CoreMapSpacing.md),
                )
            }
        }
        item {
            CorePrimaryButton(
                text = "Submit report",
                onClick = {},
            )
        }
    }
}

@Preview(showBackground = true, heightDp = 640)
@Composable
private fun ReportIssueSheetPreview() {
    CoreMapTheme {
        ReportIssueSheet(contextLabel = "Place: Kyauktan Market")
    }
}
