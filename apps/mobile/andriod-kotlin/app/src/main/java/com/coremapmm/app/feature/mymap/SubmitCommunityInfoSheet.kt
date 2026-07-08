package com.coremapmm.app.feature.mymap

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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CorePrimaryButton
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private val CommunityInfoCategories = listOf(
    "Road",
    "Transit",
    "Weather",
    "Local notice",
    "Safety",
    "Map update",
    "Other",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SubmitCommunityInfoSheet(
    modifier: Modifier = Modifier,
) {
    var selectedCategory by remember { mutableStateOf(CommunityInfoCategories.first()) }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = fullSheetLazyContentPadding(),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs)) {
                Text(
                    text = "Send community info",
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text = "Submitted info is reviewed before being shown publicly.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            Text(
                text = "Category",
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
                CommunityInfoCategories.forEach { category ->
                    CoreSelectableChip(
                        label = category,
                        selected = category == selectedCategory,
                        onClick = { selectedCategory = category },
                    )
                }
            }
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
                    text = "Area: Current area / Choose area placeholder",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(CoreMapSpacing.md),
                )
            }
        }
        item {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(text = "Title") },
                placeholder = { Text(text = "Short public info title") },
            )
        }
        item {
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                label = { Text(text = "Description") },
                placeholder = { Text(text = "What should nearby users know?") },
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
                    text = "Optional photo: Coming later",
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
                    text = "Urgent danger should be reported to local authorities first.",
                    style = MaterialTheme.typography.bodySmall,
                    color = CoreMapColors.WarningOrange,
                    modifier = Modifier.padding(CoreMapSpacing.md),
                )
            }
        }
        item {
            CorePrimaryButton(
                text = "Send for review",
                onClick = {},
            )
        }
    }
}

@Preview(showBackground = true, heightDp = 640)
@Composable
private fun SubmitCommunityInfoSheetPreview() {
    CoreMapTheme {
        SubmitCommunityInfoSheet()
    }
}
