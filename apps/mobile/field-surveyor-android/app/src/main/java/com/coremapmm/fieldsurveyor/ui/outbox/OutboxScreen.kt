package com.coremapmm.fieldsurveyor.ui.outbox

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.outbox.OutboxReportSummary
import com.coremapmm.fieldsurveyor.survey.AnomalyPayload
import com.coremapmm.fieldsurveyor.work.FieldWork
import com.coremapmm.fieldsurveyor.ui.components.MetricRow
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.tr
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun OutboxScreen(
    reports: LocalReportDao,
    photos: com.coremapmm.fieldsurveyor.media.ReportPhotoStore,
    reportMedia: com.coremapmm.fieldsurveyor.data.LocalReportMediaDao,
    onBack: () -> Unit,
) {
    var rows by remember { mutableStateOf<List<OutboxReportSummary>>(emptyList()) }
    var photoCounts by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        val all = reports.listAll()
        rows = all.map(OutboxReportSummary::from)
        photoCounts = all.associate { it.clientPublicId to reportMedia.countForReport(it.clientPublicId) }
    }

    val lifecycle = LocalLifecycleOwner.current
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            reload()
            FieldWork.enqueue(context)
        }
    }

    val selected = rows.firstOrNull { it.clientPublicId == selectedId }
    Column(modifier = Modifier.fillMaxSize()) {
        TextButton(onClick = {
            if (selectedId != null) {
                selectedId = null
            } else {
                onBack()
            }
        }) {
            Text(tr("Back"))
        }
        if (selected == null) {
            OutboxList(
                rows = rows,
                photoCounts = photoCounts,
                onOpen = { selectedId = it },
            )
        } else {
            OutboxDetail(
                summary = selected,
                photoCount = photoCounts[selected.clientPublicId] ?: 0,
                onSaved = {
                    scope.launch { reload() }
                },
                onCancelled = {
                    selectedId = null
                    scope.launch { reload() }
                },
                saveNote = { id, note ->
                    reports.updatePayload(
                        id,
                        AnomalyPayload.withNote(selected.payloadJson, note),
                        System.currentTimeMillis(),
                    )
                    if (selected.status == LocalReportEntity.STATUS_PERMANENT_ERROR) {
                        reports.updateStatus(
                            id,
                            LocalReportEntity.STATUS_LOCAL,
                            null,
                            System.currentTimeMillis(),
                        )
                    }
                    FieldWork.enqueue(context)
                },
                cancelPending = { id ->
                    photos.deleteForReport(id)
                    reports.deletePending(id)
                },
            )
        }
    }
}

@Composable
private fun OutboxList(
    rows: List<OutboxReportSummary>,
    photoCounts: Map<String, Int>,
    onOpen: (String) -> Unit,
) {
    val captured = rows.size
    val synced = rows.count { it.status == LocalReportEntity.STATUS_SYNCED }
    val waiting = captured - synced
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(
            title = tr("Outbox"),
            subtitle = tr("Reports upload safely in the background when a network is available."),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )
        MetricRow(
            captured.toString() to tr("captured"),
            synced.toString() to tr("synced"),
            waiting.toString() to tr("waiting"),
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        if (rows.isEmpty()) {
            Text(
                tr("No reports yet."),
                modifier = Modifier.padding(24.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(rows, key = { it.clientPublicId }) { row ->
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable { onOpen(row.clientPublicId) },
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(localizedTitle(row), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                StatusPill(
                                    statusLabel(row.status),
                                    positive = row.status == LocalReportEntity.STATUS_SYNCED,
                                    warning = row.status == LocalReportEntity.STATUS_PERMANENT_ERROR,
                                )
                            }
                            Text(row.stopLabel, style = MaterialTheme.typography.bodySmall)
                            val media = photoCounts[row.clientPublicId] ?: 0
                            if (media > 0) Text(tr("$media media file(s)"), style = MaterialTheme.typography.bodySmall)
                            if (row.note.isNotBlank()) Text(row.note, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OutboxDetail(
    summary: OutboxReportSummary,
    photoCount: Int,
    onSaved: () -> Unit,
    onCancelled: () -> Unit,
    saveNote: suspend (String, String) -> Unit,
    cancelPending: suspend (String) -> Int,
) {
    var note by remember(summary.clientPublicId) { mutableStateOf(summary.note) }
    var confirmCancel by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val whenText = remember(summary.createdAtEpochMs) {
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(summary.createdAtEpochMs))
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenHeader(tr("Report detail"), tr("Review evidence and sync status before upload."))
        Text(localizedTitle(summary), style = MaterialTheme.typography.titleMedium)
        StatusPill(
            statusLabel(summary.status),
            positive = summary.status == LocalReportEntity.STATUS_SYNCED,
            warning = summary.status == LocalReportEntity.STATUS_PERMANENT_ERROR,
        )
        Text(tr("Stop: ${summary.stopLabel}"), style = MaterialTheme.typography.bodyMedium)
        Text(tr("Media: $photoCount"), style = MaterialTheme.typography.bodyMedium)
        Text(tr("When: $whenText"), style = MaterialTheme.typography.bodySmall)
        if (summary.lat != null && summary.lng != null) {
            Text(
                tr("Location: ${"%.5f".format(summary.lat)}, ${"%.5f".format(summary.lng)}"),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (!summary.lastError.isNullOrBlank()) {
            Text(summary.lastError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        if (message != null) {
            Text(tr(message!!), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }
        if (summary.pending) {
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                label = { Text(tr("Note")) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 4,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = {
                        scope.launch {
                            saveNote(summary.clientPublicId, note)
                            message = "Saved. Upload will use this note."
                            onSaved()
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) { Text(tr("Save changes")) }
                OutlinedButton(
                    onClick = { confirmCancel = true },
                    modifier = Modifier.weight(1f),
                ) { Text(tr("Cancel report")) }
            }
        } else {
            Text(
                if (summary.note.isBlank()) tr("No note.") else summary.note,
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                tr("Already uploaded. Edit or cancel on the dashboard if needed."),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }

    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text(tr("Cancel this report?")) },
            text = { Text(tr("It will be deleted on this phone and will not upload.")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmCancel = false
                    scope.launch {
                        cancelPending(summary.clientPublicId)
                        onCancelled()
                    }
                }) { Text(tr("Delete")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmCancel = false }) { Text(tr("Keep")) }
            },
        )
    }
}

@Composable
private fun statusLabel(status: String): String {
    return tr(when (status) {
        LocalReportEntity.STATUS_LOCAL -> "Waiting"
        LocalReportEntity.STATUS_QUEUED -> "Queued"
        LocalReportEntity.STATUS_SYNCING -> "Uploading"
        LocalReportEntity.STATUS_SYNCED -> "Synced"
        LocalReportEntity.STATUS_RETRY -> "Retry later"
        LocalReportEntity.STATUS_PERMANENT_ERROR -> "Needs fix"
        else -> status
    })
}

@Composable
private fun localizedTitle(summary: OutboxReportSummary): String =
    listOf(tr(summary.kind), summary.routeCode, summary.variantCode)
        .filter { it.isNotBlank() }
        .joinToString(" · ")
