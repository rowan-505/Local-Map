package com.coremapmm.fieldsurveyor.ui.survey

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.media.JpegTarget
import com.coremapmm.fieldsurveyor.media.VoiceRecorder
import com.coremapmm.fieldsurveyor.media.VoiceTarget
import com.coremapmm.fieldsurveyor.survey.*
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.tr
import java.io.File
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SurveyScreen(survey: SurveyController) {
    val state by survey.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val window = StopContext.window(state.stops, state.selection?.selectedStopPublicId)
    val permissionAction = remember { mutableStateOf("map") }
    var pendingKind by remember { mutableStateOf<AnomalyKind?>(null) }
    var note by remember { mutableStateOf("") }
    var routeIssue by remember { mutableStateOf<RouteIssueKind?>(null) }
    var mapPick by remember { mutableStateOf<GpsFix?>(null) }
    var showCamera by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recordStartedAt by remember { mutableLongStateOf(0L) }
    var voiceDraft by remember { mutableStateOf<File?>(null) }
    var voiceDraftDuration by remember { mutableLongStateOf(0L) }
    val photoDrafts = remember { mutableStateListOf<File>() }
    var draftStopId by remember { mutableStateOf<String?>(null) }
    var pendingStopId by remember { mutableStateOf<String?>(null) }
    var sheetStage by remember { mutableStateOf(SurveySheetStage.MAP) }
    val recorder = remember { VoiceRecorder(context) }
    val voiceDraftForCleanup by rememberUpdatedState(voiceDraft)

    val locationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val allowed = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (allowed) {
            if (permissionAction.value == "survey") survey.startSurvey() else survey.ensureGps()
        }
    }
    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) showCamera = true else survey.setMessage("Camera permission is needed for photos.")
    }
    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (!granted) survey.setMessage("Microphone permission is needed for voice.") }

    fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun withLocationPermission(action: String, block: () -> Unit) {
        val allowed = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (allowed) block() else {
            permissionAction.value = action
            locationPermission.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ))
        }
    }

    fun clearMediaDrafts() {
        photoDrafts.forEach { it.delete() }
        photoDrafts.clear()
        voiceDraft?.delete()
        voiceDraft = null
        voiceDraftDuration = 0L
        draftStopId = null
    }

    fun resetDraft() {
        clearMediaDrafts()
        pendingKind = null
        note = ""
        routeIssue = null
        mapPick = null
    }

    fun selectStop(stopId: String) {
        val changing = stopId != state.selection?.selectedStopPublicId
        if (changing && draftStopId != null && (photoDrafts.isNotEmpty() || voiceDraft != null)) {
            pendingStopId = stopId
            return
        }
        if (changing) resetDraft()
        survey.selectStop(stopId)
        sheetStage = SurveySheetStage.STOPS
    }

    DisposableEffect(Unit) {
        onDispose {
            recorder.cancel()
            photoDrafts.forEach { it.delete() }
            voiceDraftForCleanup?.delete()
            survey.releaseMapGps()
        }
    }
    LaunchedEffect(Unit) {
        survey.loadCachedVariant()
        withLocationPermission("map") { survey.ensureGps() }
    }
    LaunchedEffect(state.capturedBanner) {
        if (state.capturedBanner != null) {
            delay(1_400)
            survey.clearBanner()
        }
    }

    Box(Modifier.fillMaxSize()) {
        SurveyMap(
            variantPublicId = state.selection?.variantPublicId,
            pathCoordinates = state.pathCoordinates,
            stops = state.stops,
            selectedStopPublicId = state.selection?.selectedStopPublicId,
            nearbyStopPublicIds = state.nearbyStops.map { it.stop.stopPublicId }.toSet(),
            gps = state.gps,
            anomalies = state.anomalies,
            pickMovedGeom = pendingKind == AnomalyKind.MOVED && mapPick == null,
            pickedPoint = mapPick,
            sheetVisibleFraction = sheetStage.visibleFraction,
            onStopClick = ::selectStop,
            onMapPick = { lat, lng ->
                mapPick = GpsFix(lat, lng, null, System.currentTimeMillis())
                sheetStage = SurveySheetStage.FULL
            },
            onLocate = { withLocationPermission("map") { survey.ensureGps() } },
            modifier = Modifier.fillMaxSize(),
        )
        FourStageSurveySheet(
            stage = sheetStage,
            onStageChange = { sheetStage = it },
            modifier = Modifier.fillMaxSize(),
            header = { dragModifier ->
                Column(
                    dragModifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(
                        Modifier.align(Alignment.CenterHorizontally).size(width = 40.dp, height = 4.dp)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant, RoundedCornerShape(100.dp)),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        val title = state.selection?.let { "${it.routeCode} · ${it.variantCode}" }
                            ?: tr("Select a D0/D1 variant")
                        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        StatusPill(state.gpsLabel, positive = state.gps != null, warning = state.gps == null)
                        Button(
                            onClick = {
                                if (state.running) survey.endSurvey()
                                else withLocationPermission("survey") { survey.startSurvey() }
                            },
                            modifier = Modifier.height(34.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (state.running) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.primary,
                            ),
                        ) { Text(tr(if (state.running) "Stop" else "Start"), style = MaterialTheme.typography.labelMedium) }
                    }
                }
            },
            content = { visibleStage ->
                val scrolling = if (visibleStage == SurveySheetStage.FULL) {
                    Modifier.verticalScroll(rememberScrollState())
                } else Modifier
                Column(
                    scrolling
                        .fillMaxWidth()
                        .padding(
                            horizontal = 14.dp,
                            vertical = if (visibleStage == SurveySheetStage.MAP) 0.dp else 6.dp,
                        ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (visibleStage.ordinal >= SurveySheetStage.STOPS.ordinal) {
                        SurveySection(tr("Route stops")) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StopChoiceButton("Previous", window.previous, false, Modifier.weight(1f)) {
                                    window.previous?.let { selectStop(it.stopPublicId) }
                                }
                                StopChoiceButton("Current", window.current, true, Modifier.weight(1f)) {
                                    window.current?.let { selectStop(it.stopPublicId) }
                                }
                                StopChoiceButton("Next", window.next, false, Modifier.weight(1f)) {
                                    window.next?.let { selectStop(it.stopPublicId) }
                                }
                            }
                        }
                    }
                    if (visibleStage.ordinal >= SurveySheetStage.NEARBY.ordinal && state.nearbyStops.isNotEmpty()) {
                        SurveySection(tr("Nearest stops")) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                state.nearbyStops.take(3).forEachIndexed { index, nearby ->
                                    NearbyStopButton(
                                        nearby,
                                        nearby.stop.stopPublicId == state.selection?.selectedStopPublicId,
                                        index == 0,
                                        Modifier.weight(1f),
                                    ) { selectStop(nearby.stop.stopPublicId) }
                                }
                            }
                        }
                    }
                    if (visibleStage == SurveySheetStage.FULL) {
                        SurveySection(tr("Report issue")) {
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                AnomalyKind.entries.forEach { kind ->
                                    val selected = pendingKind == kind
                                    FilterChip(
                                        selected = selected,
                                        onClick = {
                                            when {
                                                !state.running -> survey.setMessage("Start the survey first.")
                                                state.selection?.selectedStopPublicId == null -> survey.setMessage("Select a stop first.")
                                                selected -> resetDraft()
                                                else -> {
                                                    clearMediaDrafts()
                                                    pendingKind = kind
                                                    note = ""
                                                    routeIssue = null
                                                    mapPick = null
                                                    survey.setMessage("")
                                                    if (kind == AnomalyKind.MOVED) sheetStage = SurveySheetStage.MAP
                                                }
                                            }
                                        },
                                        label = { Text(tr(kind.name), style = MaterialTheme.typography.labelSmall) },
                                    )
                                }
                            }
                        }
                        pendingKind?.let { kind ->
                            SurveySection(tr("Report details")) {
                                ReportKindForm(kind, note, { note = it }, routeIssue, { routeIssue = it }, mapPick)
                            }
                        }
                        SurveySection(tr("Evidence (optional)")) {
                            EvidenceSection(
                                hasReportContext = state.selection?.selectedStopPublicId != null && pendingKind != null,
                                photoDrafts = photoDrafts,
                                voiceDraft = voiceDraft,
                                voiceDraftDurationMs = voiceDraftDuration,
                                recording = recording,
                                onCamera = {
                                    if (hasPermission(Manifest.permission.CAMERA)) showCamera = true
                                    else cameraPermission.launch(Manifest.permission.CAMERA)
                                },
                                onRecordStart = {
                                    if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
                                        micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                    } else {
                                        val dest = File(context.cacheDir, "field-voice-${System.currentTimeMillis()}.m4a")
                                        runCatching {
                                            recorder.start(dest)
                                            recordStartedAt = System.currentTimeMillis()
                                            recording = true
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        }.onFailure { error -> survey.setMessage(error.message ?: "Could not start recording") }
                                    }
                                },
                                onRecordEnd = { cancelled ->
                                    if (recording) {
                                        recording = false
                                        val duration = System.currentTimeMillis() - recordStartedAt
                                        if (cancelled) recorder.cancel() else runCatching { recorder.stop() }
                                            .onSuccess { file ->
                                                if (duration < VoiceTarget.MIN_DURATION_MS) {
                                                    file.delete()
                                                    survey.setMessage("Hold longer to record.")
                                                } else {
                                                    voiceDraft?.delete()
                                                    voiceDraft = file
                                                    voiceDraftDuration = duration
                                                    draftStopId = state.selection?.selectedStopPublicId
                                                }
                                            }.onFailure { error -> survey.setMessage(error.message ?: "Could not save voice") }
                                    }
                                },
                                onRemovePhoto = { file -> photoDrafts.remove(file); file.delete() },
                                onDiscardVoice = {
                                    voiceDraft?.delete()
                                    voiceDraft = null
                                    voiceDraftDuration = 0L
                                },
                            )
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = ::resetDraft, modifier = Modifier.weight(1f)) {
                                Text(tr("Cancel"))
                            }
                            Button(
                                onClick = {
                                    val kind = pendingKind ?: return@Button
                                    scope.launch {
                                        val saved = survey.submitReport(
                                            kind = kind,
                                            note = note,
                                            reportLocation = if (kind == AnomalyKind.MOVED) mapPick else null,
                                            routeIssue = if (kind == AnomalyKind.ROUTE) routeIssue else null,
                                            photoDrafts = photoDrafts.toList(),
                                            voiceDraft = voiceDraft,
                                            voiceDurationMs = voiceDraftDuration,
                                        )
                                        if (saved) {
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                            resetDraft()
                                            sheetStage = SurveySheetStage.STOPS
                                        }
                                    }
                                },
                                enabled = pendingKind != null,
                                modifier = Modifier.weight(1f),
                            ) { Text(tr("Report")) }
                        }
                        state.capturedBanner?.let {
                            Text(tr(it), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                        }
                        state.message?.takeIf { it.isNotBlank() }?.let {
                            Text(tr(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                }
            },
        )
        if (showCamera) CameraCaptureOverlay(
            onCaptured = { file ->
                showCamera = false
                photoDrafts.add(file)
                draftStopId = state.selection?.selectedStopPublicId
            },
            onClose = { showCamera = false },
            onError = { message -> showCamera = false; survey.setMessage(message) },
        )
    }
    pendingStopId?.let { stopId ->
        AlertDialog(
            onDismissRequest = { pendingStopId = null },
            title = { Text(tr("Discard draft media?")) },
            text = { Text(tr("Changing stops removes the unsent photo or recording.")) },
            confirmButton = {
                TextButton(onClick = {
                    pendingStopId = null
                    resetDraft()
                    survey.selectStop(stopId)
                    sheetStage = SurveySheetStage.STOPS
                }) { Text(tr("Discard")) }
            },
            dismissButton = { TextButton(onClick = { pendingStopId = null }) { Text(tr("Keep editing")) } },
        )
    }
}

@Composable
private fun StopChoiceButton(title: String, stop: OrderedStopRow?, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val icon = when (title) {
        "Previous" -> Icons.AutoMirrored.Outlined.KeyboardArrowLeft
        "Next" -> Icons.AutoMirrored.Outlined.KeyboardArrowRight
        else -> Icons.Outlined.MyLocation
    }
    OutlinedButton(
        onClick = onClick,
        enabled = stop != null,
        modifier = modifier.heightIn(min = 88.dp),
        shape = RoundedCornerShape(14.dp),
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 7.dp),
        colors = if (selected && stop != null) ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) else ButtonDefaults.outlinedButtonColors(),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Icon(imageVector = icon, contentDescription = tr(title), modifier = Modifier.size(17.dp))
                Text(stop?.let { "#${it.stopSequence}" } ?: "—", style = MaterialTheme.typography.labelMedium)
            }
            Text(
                stop?.let { stopName(it) } ?: "—",
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun NearbyStopButton(nearby: NearbyStop, selected: Boolean, nearest: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = when {
        selected -> ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        nearest -> ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        )
        else -> ButtonDefaults.outlinedButtonColors()
    }
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 82.dp),
        colors = colors,
        shape = RoundedCornerShape(14.dp),
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 7.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "#${nearby.stop.stopSequence} · ${formatDistance(nearby.distanceM)}",
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
            Text(
                stopName(nearby.stop),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun EvidenceSection(
    hasReportContext: Boolean,
    photoDrafts: List<File>,
    recording: Boolean,
    voiceDraft: File?,
    voiceDraftDurationMs: Long,
    onCamera: () -> Unit,
    onRecordStart: () -> Unit,
    onRecordEnd: (Boolean) -> Unit,
    onDiscardVoice: () -> Unit,
    onRemovePhoto: (File) -> Unit,
) {
    if (!hasReportContext) {
        Text(tr("Choose a stop and report action first."), style = MaterialTheme.typography.bodySmall)
        return
    }
    photoDrafts.forEach { PhotoDraftAttachment(it, onRemovePhoto) }
    voiceDraft?.let { VoiceDraft(it, voiceDraftDurationMs, onDiscardVoice) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = onCamera,
            enabled = photoDrafts.size < JpegTarget.MAX_PHOTOS_PER_REPORT,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Text(tr(if (photoDrafts.isEmpty()) "Photo" else "Add photo"), style = MaterialTheme.typography.labelMedium)
        }
        if (voiceDraft == null) {
            HoldToRecordButton(recording, onRecordStart, onRecordEnd, Modifier.weight(1f))
        }
    }
}

@Composable
private fun PhotoDraftAttachment(file: File, onRemove: (File) -> Unit) {
    val bitmap = remember(file.absolutePath, file.lastModified()) { BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap() }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            bitmap?.let {
                Image(it, tr("Attached report photo"), Modifier.fillMaxWidth().height(120.dp), contentScale = ContentScale.Crop)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Photo ready"), modifier = Modifier.weight(1f))
                TextButton(onClick = { onRemove(file) }) { Text(tr("Remove")) }
            }
        }
    }
}

@Composable
private fun VoiceDraft(file: File, durationMs: Long, onDiscard: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(tr("Voice · ${durationMs / 1_000}s"), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            AudioButton(file)
            TextButton(onClick = onDiscard) { Text(tr("Retake")) }
        }
    }
}

@Composable
private fun AudioButton(file: File, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var playing by remember(file.absolutePath) { mutableStateOf(false) }
    val player = remember(file.absolutePath) {
        runCatching { MediaPlayer.create(context, Uri.fromFile(file)) }.getOrNull()
    }
    DisposableEffect(player) {
        player?.setOnCompletionListener { playing = false }
        onDispose { player?.release() }
    }
    OutlinedButton(
        onClick = {
            if (player != null) {
                if (playing) player.pause() else player.start()
                playing = !playing
            }
        },
        enabled = player != null,
        modifier = modifier,
    ) { Text(tr(if (playing) "Pause" else "Play")) }
}

@Composable
private fun ReportKindForm(
    kind: AnomalyKind,
    note: String,
    onNote: (String) -> Unit,
    routeIssue: RouteIssueKind?,
    onRouteIssue: (RouteIssueKind) -> Unit,
    mapPick: GpsFix?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (kind) {
            AnomalyKind.MOVED -> {
                Text(tr(if (mapPick == null) "Tap the correct stop position on the map." else "New position selected."))
                OptionalNote(note, onNote)
            }
            AnomalyKind.MISSING -> OptionalNote(note, onNote)
            AnomalyKind.DATA -> NoteField(note, onNote, "What is wrong?")
            AnomalyKind.ROUTE -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    RouteIssueKind.entries.forEach { issue ->
                        val selected = routeIssue == issue
                        OutlinedButton(
                            onClick = { onRouteIssue(issue) }, modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(4.dp),
                            colors = if (selected) ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                            ) else ButtonDefaults.outlinedButtonColors(),
                        ) {
                            Text(tr(when (issue) {
                                RouteIssueKind.PATH_WRONG -> "Path"
                                RouteIssueKind.MISSING_SEGMENT -> "Gap"
                                RouteIssueKind.OTHER -> "Other"
                            }))
                        }
                    }
                }
                OptionalNote(note, onNote)
            }
            AnomalyKind.OTHER -> NoteField(note, onNote, "Describe the issue")
        }
    }
}

@Composable
private fun OptionalNote(note: String, onNote: (String) -> Unit) = NoteField(note, onNote, "Note (optional)")

@Composable
private fun NoteField(note: String, onNote: (String) -> Unit, label: String) {
    OutlinedTextField(
        note, onNote, label = { Text(tr(label)) }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3,
    )
}

@Composable
private fun stopName(stop: OrderedStopRow): String {
    val name = if (LocalFieldLanguage.current == FieldLanguage.MYANMAR) {
        stop.nameMy ?: stop.nameEn
    } else {
        stop.nameEn ?: stop.nameMy
    } ?: stop.stopCode ?: stop.stopPublicId.take(8)
    return name
}

internal fun formatDistance(distanceM: Double): String = when {
    distanceM < 1_000 -> "${distanceM.toInt()} m"
    distanceM < 100_000 -> String.format(Locale.US, "%.1f km", distanceM / 1_000)
    else -> "${(distanceM / 1_000).toInt()} km"
}

@Composable
private fun SurveySection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            content()
        }
    }
}

@Composable
private fun HoldToRecordButton(
    recording: Boolean,
    onHoldStart: () -> Unit,
    onHoldEnd: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(20.dp)
    val color = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.border(1.dp, color, shape).padding(horizontal = 12.dp, vertical = 10.dp)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onHoldStart()
                    onHoldEnd(waitForUpOrCancellation() == null)
                }
            },
    ) {
        Text(
            tr(if (recording) "Recording…" else "Hold for voice"),
            color = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}
