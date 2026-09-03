package com.coremapmm.fieldsurveyor.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRefreshResult
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.offline.YangonBasemapStore
import com.coremapmm.fieldsurveyor.ui.components.FieldCard
import com.coremapmm.fieldsurveyor.ui.components.MetricRow
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.tr
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SetupSyncScreen(
    bootstrap: BootstrapRepository,
    yangon: YangonBasemapStore,
    title: String? = null,
    onContinue: (() -> Unit)? = null,
    onDisplaySettings: (() -> Unit)? = null,
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    var status by remember { mutableStateOf("Checking snapshot…") }
    var busy by remember { mutableStateOf(true) }
    var mapBusy by remember { mutableStateOf(false) }
    var mapStatus by remember { mutableStateOf("") }
    var yangonReady by remember { mutableStateOf(yangon.isReady()) }
    var downloadedBytes by remember { mutableLongStateOf(yangon.sizeBytes()) }
    var totalBytes by remember { mutableLongStateOf(yangon.sizeBytes()) }
    var variantCount by remember { mutableIntStateOf(0) }
    var revision by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val locked = busy || mapBusy
    val visibleTitle = title ?: tr("Setup / Sync")

    fun applyResult(result: BootstrapRefreshResult) {
        when (result) {
            is BootstrapRefreshResult.Unchanged -> {
                status = "Cache is current (${result.snapshotRevision})"
                revision = result.snapshotRevision
            }
            is BootstrapRefreshResult.Updated -> {
                status = "Downloaded snapshot ${result.snapshotRevision}"
                revision = result.snapshotRevision
                variantCount = result.variantCount
            }
            is BootstrapRefreshResult.Failed -> {
                val kept = result.keptRevision
                status = if (kept != null) {
                    "Refresh failed. Kept previous cache ($kept). ${result.message}"
                } else {
                    "Refresh failed. ${result.message}"
                }
                revision = kept
                variantCount = result.keptVariantCount
            }
        }
    }

    suspend fun runRefresh() {
        busy = true
        try {
            variantCount = bootstrap.variantCount()
            revision = bootstrap.snapshotRevision()
            applyResult(bootstrap.refresh())
            variantCount = bootstrap.variantCount()
            revision = bootstrap.snapshotRevision()
        } finally {
            busy = false
        }
    }

    suspend fun runYangonDownload() {
        mapBusy = true
        mapStatus = "Downloading Yangon streets map…"
        try {
            yangon.ensure { copied, total ->
                scope.launch {
                    downloadedBytes = copied
                    totalBytes = total
                }
            }
            yangonReady = yangon.isReady()
            mapStatus = if (yangonReady) {
                "Yangon streets map is on this device."
            } else {
                "Yangon download finished but the file is incomplete."
            }
        } catch (error: Exception) {
            yangonReady = yangon.isReady()
            mapStatus = error.message ?: error.toString()
        } finally {
            mapBusy = false
        }
    }

    LaunchedEffect(Unit) {
        yangonReady = yangon.isReady()
        downloadedBytes = yangon.sizeBytes()
        totalBytes = yangon.sizeBytes()
        mapStatus = if (yangonReady) {
            "Yangon streets map is on this device."
        } else {
            "Street zoom needs the Yangon map (~730 MB). Use Wi-Fi."
        }
        runRefresh()
    }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (visibleTitle.isNotBlank()) {
            ScreenHeader(
                title = visibleTitle,
                subtitle = tr("Prepare routes and the offline map before field work."),
            )
        }
        if (onDisplaySettings != null) {
            OutlinedButton(onClick = onDisplaySettings, modifier = Modifier.fillMaxWidth()) {
                Text(tr("Language and appearance"))
            }
        }
        MetricRow(
            variantCount.toString() to tr("route variants"),
            (revision ?: "—").take(10) to tr("snapshot"),
        )
        FieldCard {
            StatusPill(
                label = tr(if (busy) "Syncing routes" else if (revision != null) "Routes ready" else "Routes needed"),
                positive = !busy && revision != null,
                warning = !busy && revision == null,
            )
            Text(tr(status), style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(
                onClick = { scope.launch { runRefresh() } },
                enabled = !locked,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(tr(if (busy) "Syncing…" else "Sync routes"))
            }
        }
        FieldCard {
            StatusPill(
                label = tr(if (mapBusy) "Downloading map" else if (yangonReady) "Offline map ready" else "Map needed"),
                positive = yangonReady && !mapBusy,
                warning = !yangonReady && !mapBusy,
            )
            Text(tr(mapStatus), style = MaterialTheme.typography.bodyMedium)
            if (mapBusy && totalBytes > 0L) {
                LinearProgressIndicator(
                    progress = { (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else if (mapBusy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            Text(formatBytes(downloadedBytes, totalBytes), style = MaterialTheme.typography.bodySmall)
            OutlinedButton(
                onClick = { scope.launch { runYangonDownload() } },
                enabled = !locked,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(tr(if (mapBusy) "Downloading map…" else if (yangonReady) "Verify offline map" else "Download Yangon map"))
            }
        }
        if (onContinue != null) {
            Button(
                onClick = onContinue,
                enabled = !locked && variantCount > 0 && yangonReady,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(tr("Continue to route selection"))
            }
        }
    }
}

private fun formatBytes(copied: Long, total: Long): String {
    fun mb(value: Long): String = String.format(Locale.US, "%.0f", value / 1_000_000.0)
    return if (total > 0L) {
        "${mb(copied)} / ${mb(total)} MB"
    } else {
        "${mb(copied)} MB"
    }
}
