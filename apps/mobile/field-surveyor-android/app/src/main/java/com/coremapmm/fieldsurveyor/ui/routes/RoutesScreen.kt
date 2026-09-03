package com.coremapmm.fieldsurveyor.ui.routes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionFilter
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun RoutesScreen(
    bootstrap: BootstrapRepository,
    onNeedSync: () -> Unit,
    onSelectVariant: (RouteSelectionRow) -> Unit,
) {
    var allRows by remember { mutableStateOf<List<RouteSelectionRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        allRows = bootstrap.listSelections()
    }

    val visible = remember(allRows, query) {
        RouteSelectionFilter.byRouteCode(allRows, query)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ScreenHeader(tr("Choose a route"), tr("Search the offline YBS snapshot. No signal is required."))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text(tr("Search route code")) },
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
            )
            StatusPill(tr("${visible.size} variants available"), positive = visible.isNotEmpty())
            if (allRows.isEmpty()) {
                Text(tr("No local snapshot yet."))
                TextButton(onClick = onNeedSync) { Text(tr("Open Setup / Sync")) }
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(visible, key = { it.variantPublicId }) { row ->
                RouteSelectionItem(row, onClick = { onSelectVariant(row) })
            }
        }
    }
}

@Composable
private fun RouteSelectionItem(row: RouteSelectionRow, onClick: () -> Unit) {
    val origin = row.originName ?: "—"
    val destination = row.destinationName ?: "—"
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("${row.routeCode}  ·  ${row.variantCode}", style = MaterialTheme.typography.titleMedium)
            Text("$origin → $destination", style = MaterialTheme.typography.bodyMedium)
            Text(
                "${row.stopCount} ${tr("stops")}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
