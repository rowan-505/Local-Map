package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.media.ReportPhotoStore
import com.coremapmm.fieldsurveyor.media.ReportVoiceStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

data class SurveyUiState(
    val running: Boolean = false,
    val selection: SurveySelection? = null,
    val stops: List<OrderedStopRow> = emptyList(),
    val pathCoordinates: List<Pair<Double, Double>> = emptyList(),
    val gps: GpsFix? = null,
    val gpsLabel: String = "GPS —",
    val nearbyStops: List<NearbyStop> = emptyList(),
    val capturedBanner: String? = null,
    val message: String? = null,
    val snapshotRevision: String? = null,
    val anomalies: List<GpsFix> = emptyList(),
)

class SurveyController(
    private val selectionStore: SurveySelectionStore,
    private val bootstrap: BootstrapRepository,
    private val reports: LocalReportDao,
    private val photos: ReportPhotoStore,
    private val voice: ReportVoiceStore,
    private val gpsEngine: GpsEngine,
    private val onCaptured: () -> Unit = {},
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val uptimeMs: () -> Long = { android.os.SystemClock.uptimeMillis() },
) {
    private val mutex = Mutex()
    private val gpsBuffer = ArrayDeque<GpsFix>(GpsBuffer.MAX_FIXES)
    private var lastKind: AnomalyKind? = null
    private var lastCaptureUptime = 0L

    private val stateFlow = MutableStateFlow(SurveyUiState(selection = selectionStore.load()))
    val state: StateFlow<SurveyUiState> = stateFlow.asStateFlow()
    private val runningFlow = MutableStateFlow(false)
    val isRunning: StateFlow<Boolean> = runningFlow.asStateFlow()

    suspend fun loadCachedVariant() {
        val selection = stateFlow.value.selection ?: selectionStore.load() ?: return
        applySelection(selection)
    }

    suspend fun selectVariant(row: RouteSelectionRow) {
        applySelection(
            SurveySelection(
                routePublicId = row.routePublicId,
                routeCode = row.routeCode,
                variantPublicId = row.variantPublicId,
                variantCode = row.variantCode,
                selectedStopPublicId = null,
            ),
        )
    }

    fun selectStop(stopPublicId: String?) {
        val current = stateFlow.value.selection ?: return
        val next = current.copy(selectedStopPublicId = stopPublicId)
        selectionStore.save(next)
        stateFlow.value = stateFlow.value.copy(
            selection = next,
            nearbyStops = nearbyFromGps(),
        )
    }

    fun selectPrevious() {
        val window = StopContext.window(stateFlow.value.stops, stateFlow.value.selection?.selectedStopPublicId)
        window.previous?.let { selectStop(it.stopPublicId) }
    }

    fun selectNext() {
        val window = StopContext.window(stateFlow.value.stops, stateFlow.value.selection?.selectedStopPublicId)
        window.next?.let { selectStop(it.stopPublicId) }
    }

    fun startSurvey(): String? {
        val error = when {
            stateFlow.value.selection == null -> "Select a D0/D1 variant first."
            !gpsEngine.gpsEnabled() -> "Turn on GPS to start survey."
            else -> null
        }
        if (error != null) {
            stateFlow.value = stateFlow.value.copy(message = error)
            return error
        }
        gpsBuffer.clear()
        attachGps()
        setRunning(true)
        stateFlow.value = stateFlow.value.copy(message = null)
        return null
    }

    fun endSurvey() {
        setRunning(false)
        gpsBuffer.clear()
        stateFlow.value = stateFlow.value.copy(
            message = "Survey ended. Start again to save reports.",
        )
    }

    fun ensureGps(): String? {
        if (!gpsEngine.gpsEnabled()) {
            val error = "Turn on GPS."
            stateFlow.value = stateFlow.value.copy(message = error)
            return error
        }
        attachGps()
        return null
    }

    fun releaseMapGps() {
        if (stateFlow.value.running) {
            return
        }
        gpsEngine.stop()
        stateFlow.value = stateFlow.value.copy(gps = null, gpsLabel = "GPS —", nearbyStops = emptyList())
    }

    suspend fun submitReport(
        kind: AnomalyKind,
        note: String = "",
        reportLocation: GpsFix? = null,
        routeIssue: RouteIssueKind? = null,
        photoDrafts: List<File> = emptyList(),
        voiceDraft: File? = null,
        voiceDurationMs: Long = 0L,
    ): Boolean {
        if (!CaptureDebounce.shouldAccept(lastKind, lastCaptureUptime, kind, uptimeMs())) {
            return false
        }
        val snapshot = stateFlow.value
        val selection = snapshot.selection ?: return false
        val selectedStop = snapshot.stops.firstOrNull {
            it.stopPublicId == selection.selectedStopPublicId
        }
        val flowError = SurveyReportFlow.saveError(
            running = snapshot.running,
            kind = kind,
            hasStop = selectedStop != null,
            mapPick = reportLocation,
            note = note,
            routeIssue = routeIssue,
        )
        if (flowError != null) {
            stateFlow.value = snapshot.copy(message = flowError)
            return false
        }
        ReportBundlePolicy.error(photoDrafts, voiceDraft, voiceDurationMs)?.let { error ->
            stateFlow.value = snapshot.copy(message = error)
            return false
        }
        val revision = snapshot.snapshotRevision
        if (revision.isNullOrBlank()) {
            stateFlow.value = snapshot.copy(message = "No local snapshot. Sync first.")
            return false
        }
        val gps = GpsBuffer.bestRecent(gpsBuffer.toList(), nowMs()) ?: snapshot.gps
        if (gps == null) {
            stateFlow.value = snapshot.copy(message = "Need a GPS fix")
            return false
        }
        val input = AnomalyCaptureInput(
            kind = kind,
            snapshotRevision = revision,
            routePublicId = selection.routePublicId,
            routeCode = selection.routeCode,
            variantPublicId = selection.variantPublicId,
            variantCode = selection.variantCode,
            selectedStop = selectedStop,
            gps = gps,
            note = SurveyReportFlow.composedNote(note, routeIssue),
            reportLocation = reportLocation,
            observedAtIso = Instant.ofEpochMilli(nowMs()).toString(),
            clientPublicId = UUID.randomUUID().toString(),
            createdAtEpochMs = nowMs(),
        )
        val row = LocalReportEntity(
            clientPublicId = input.clientPublicId,
            status = LocalReportEntity.STATUS_LOCAL,
            payloadJson = AnomalyPayload.toJson(input),
            createdAtEpochMs = input.createdAtEpochMs,
            updatedAtEpochMs = input.createdAtEpochMs,
        )
        try {
            mutex.withLock {
                withContext(Dispatchers.IO) {
                    // Media is written first. The sync DAO cannot claim it until the
                    // matching report exists and has synced successfully.
                    photoDrafts.forEach { photos.addFromCapture(input.clientPublicId, it) }
                    voiceDraft?.let { voice.addFromRecording(input.clientPublicId, it) }
                    reports.upsert(row)
                }
            }
        } catch (error: Exception) {
            withContext(Dispatchers.IO) { photos.deleteForReport(input.clientPublicId) }
            stateFlow.value = stateFlow.value.copy(
                message = error.message ?: "Could not save report",
            )
            return false
        }
        onCaptured()
        lastKind = kind
        lastCaptureUptime = uptimeMs()
        refreshAnomalies()
        stateFlow.value = stateFlow.value.copy(
            capturedBanner = "✓ Captured",
            message = null,
        )
        return true
    }

    fun setMessage(message: String) {
        stateFlow.value = stateFlow.value.copy(message = message.ifBlank { null })
    }

    fun clearBanner() {
        stateFlow.value = stateFlow.value.copy(capturedBanner = null)
    }

    suspend fun refreshAnomalies() {
        val variantId = stateFlow.value.selection?.variantPublicId ?: return
        val rows = withContext(Dispatchers.IO) { reports.listAll() }
        val points = rows.mapNotNull { row ->
            if (AnomalyPayload.variantPublicId(row.payloadJson) != variantId) {
                null
            } else {
                AnomalyPayload.location(row.payloadJson)
            }
        }
        stateFlow.value = stateFlow.value.copy(anomalies = points)
    }

    private fun attachGps() {
        gpsEngine.start { fix ->
            val published = GpsFixPolicy.publish(stateFlow.value.gps, fix, nowMs()) ?: return@start
            GpsBuffer.push(gpsBuffer, published)
            val nearby = StopContext.nearby(stateFlow.value.stops, published.lat, published.lng)
            stateFlow.value = stateFlow.value.copy(
                gps = published,
                gpsLabel = formatGps(published),
                nearbyStops = nearby,
            )
        }
    }

    private suspend fun applySelection(selection: SurveySelection) {
        val stops = bootstrap.orderedStops(selection.variantPublicId)
        val pathJson = bootstrap.routePathJson(selection.variantPublicId)
        val revision = bootstrap.snapshotRevision()
        val selected = selection.copy(
            selectedStopPublicId = selection.selectedStopPublicId
                ?.takeIf { id -> stops.any { it.stopPublicId == id } },
        )
        selectionStore.save(selected)
        val gps = stateFlow.value.gps
        stateFlow.value = stateFlow.value.copy(
            selection = selected,
            stops = stops,
            pathCoordinates = parseLine(pathJson),
            snapshotRevision = revision,
            nearbyStops = if (gps == null) emptyList() else StopContext.nearby(stops, gps.lat, gps.lng),
        )
        refreshAnomalies()
    }

    private fun nearbyFromGps(): List<NearbyStop> {
        val gps = stateFlow.value.gps ?: return emptyList()
        return StopContext.nearby(stateFlow.value.stops, gps.lat, gps.lng)
    }

    private fun setRunning(running: Boolean) {
        runningFlow.value = running
        stateFlow.value = stateFlow.value.copy(running = running)
    }

    companion object {
        fun formatGps(fix: GpsFix): String {
            val acc = fix.accuracyM?.let { "±${it.toInt()}m" } ?: "±?m"
            return "GPS $acc"
        }

        fun parseLine(geometryJson: String?): List<Pair<Double, Double>> {
            if (geometryJson.isNullOrBlank()) {
                return emptyList()
            }
            return runCatching {
                val geometry = JSONObject(geometryJson)
                val coordinates = geometry.optJSONArray("coordinates") ?: JSONArray()
                buildList {
                    for (i in 0 until coordinates.length()) {
                        val pair = coordinates.optJSONArray(i) ?: continue
                        val lng = pair.optDouble(0, Double.NaN)
                        val lat = pair.optDouble(1, Double.NaN)
                        if (lng.isFinite() && lat.isFinite()) {
                            add(lng to lat)
                        }
                    }
                }
            }.getOrDefault(emptyList())
        }
    }
}
