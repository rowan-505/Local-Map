package com.coremapmm.fieldsurveyor.outbox

import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.survey.AnomalyPayload
import org.json.JSONObject

data class OutboxReportSummary(
    val clientPublicId: String,
    val status: String,
    val kind: String,
    val routeCode: String,
    val variantCode: String,
    val stopLabel: String,
    val note: String,
    val lat: Double?,
    val lng: Double?,
    val lastError: String?,
    val createdAtEpochMs: Long,
    val payloadJson: String,
) {
    val pending: Boolean
        get() = status in PENDING_STATUSES

    val title: String
        get() = listOf(kind, routeCode, variantCode).filter { it.isNotBlank() }.joinToString(" · ")

    companion object {
        val PENDING_STATUSES = setOf(
            LocalReportEntity.STATUS_LOCAL,
            LocalReportEntity.STATUS_QUEUED,
            LocalReportEntity.STATUS_RETRY,
            LocalReportEntity.STATUS_PERMANENT_ERROR,
        )

        fun from(row: LocalReportEntity): OutboxReportSummary {
            val root = runCatching { JSONObject(row.payloadJson) }.getOrNull()
            val context = root?.optJSONObject("context")
            val snap = context?.optJSONObject("canonicalSnapshot")
            val loc = AnomalyPayload.location(row.payloadJson)
            val stopName = snap?.optString("nameEn")?.ifBlank { null }
                ?: snap?.optString("nameMy")?.ifBlank { null }
                ?: snap?.optString("stopCode")?.ifBlank { null }
            val seq = context?.optInt("stopSequence", 0) ?: 0
            val stopLabel = when {
                stopName != null && seq > 0 -> "#$seq $stopName"
                stopName != null -> stopName
                else -> "—"
            }
            return OutboxReportSummary(
                clientPublicId = row.clientPublicId,
                status = row.status,
                kind = AnomalyPayload.anomalyKind(row.payloadJson).ifBlank { "OTHER" },
                routeCode = context?.optString("routeCode").orEmpty(),
                variantCode = context?.optString("variantCode").orEmpty(),
                stopLabel = stopLabel,
                note = AnomalyPayload.noteOf(row.payloadJson),
                lat = loc?.lat,
                lng = loc?.lng,
                lastError = row.lastError,
                createdAtEpochMs = row.createdAtEpochMs,
                payloadJson = row.payloadJson,
            )
        }
    }
}
