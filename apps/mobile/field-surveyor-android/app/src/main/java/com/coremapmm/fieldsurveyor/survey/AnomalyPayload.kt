package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.json.JSONObject
import java.util.UUID

data class AnomalyCaptureInput(
    val kind: AnomalyKind,
    val snapshotRevision: String,
    val routePublicId: String,
    val routeCode: String,
    val variantPublicId: String,
    val variantCode: String,
    val selectedStop: OrderedStopRow?,
    val gps: GpsFix,
    val note: String = "",
    val reportLocation: GpsFix? = null,
    val observedAtIso: String,
    val clientPublicId: String = UUID.randomUUID().toString(),
    val createdAtEpochMs: Long,
)

object AnomalyPayload {
    fun toJson(input: AnomalyCaptureInput): String {
        val hasStop = input.selectedStop != null
        val targetType = AnomalyMapping.targetEntityType(input.kind, hasStop)
        val targetId = when (targetType) {
            "stop" -> input.selectedStop?.stopPublicId
            "route" -> input.routePublicId
            else -> input.variantPublicId
        }
        val target = JSONObject()
            .put("entityType", targetType)
            .put("publicId", targetId ?: JSONObject.NULL)
        val context = JSONObject()
            .put("snapshotRevision", input.snapshotRevision)
            .put("routePublicId", input.routePublicId)
            .put("routeCode", input.routeCode)
            .put("variantPublicId", input.variantPublicId)
            .put("variantCode", input.variantCode)
        val stop = input.selectedStop
        val reportFix = input.reportLocation ?: input.gps
        if (stop != null) {
            val snapshot = JSONObject()
                .put("stopPublicId", stop.stopPublicId)
                .put("stopSequence", stop.stopSequence)
                .put("stopCode", stop.stopCode)
                .put("nameEn", stop.nameEn)
                .put("nameMy", stop.nameMy)
                .put("lat", stop.lat)
                .put("lng", stop.lng)
            if (input.reportLocation != null) {
                snapshot.put("correctedLat", reportFix.lat)
                snapshot.put("correctedLng", reportFix.lng)
                snapshot.put("observerLat", input.gps.lat)
                snapshot.put("observerLng", input.gps.lng)
                snapshot.put("observerAccuracyM", input.gps.accuracyM?.toDouble() ?: JSONObject.NULL)
            }
            context.put("stopPublicId", stop.stopPublicId)
            context.put("stopSequence", stop.stopSequence)
            context.put("canonicalSnapshot", snapshot)
        }
        val location = JSONObject()
            .put("lat", reportFix.lat)
            .put("lng", reportFix.lng)
            .put("accuracyM", reportFix.accuracyM?.toDouble() ?: JSONObject.NULL)
        return JSONObject()
            .put("clientPublicId", input.clientPublicId)
            .put("reportTypeCode", AnomalyMapping.reportTypeCode(input.kind))
            .put("anomalyKind", input.kind.name)
            .put("observedAt", input.observedAtIso)
            .put("location", location)
            .put("target", target)
            .put("context", context)
            .put("note", input.note.trim().take(4000))
            .toString()
    }

    /** Body for POST /field/reports. Always uses the Room client UUID. */
    fun toCreateBody(clientPublicId: String, payloadJson: String): String {
        val root = JSONObject(payloadJson)
        root.put("clientPublicId", clientPublicId)
        val note = root.optString("note").trim()
        if (note.isNotEmpty()) {
            root.put("description", note.take(4000))
        }
        root.remove("anomalyKind")
        return root.toString()
    }

    fun noteOf(payloadJson: String): String {
        return runCatching { JSONObject(payloadJson).optString("note") }.getOrDefault("")
    }

    fun withNote(payloadJson: String, note: String): String {
        val root = JSONObject(payloadJson)
        root.put("note", note.trim().take(4000))
        return root.toString()
    }

    fun anomalyKind(payloadJson: String): String {
        return runCatching { JSONObject(payloadJson).optString("anomalyKind") }.getOrDefault("OTHER")
    }

    fun variantPublicId(payloadJson: String): String? {
        return runCatching {
            JSONObject(payloadJson).optJSONObject("context")?.optString("variantPublicId")?.ifBlank { null }
        }.getOrNull()
    }

    fun location(payloadJson: String): GpsFix? {
        return runCatching {
            val loc = JSONObject(payloadJson).optJSONObject("location") ?: return null
            val lat = loc.optDouble("lat", Double.NaN)
            val lng = loc.optDouble("lng", Double.NaN)
            if (!lat.isFinite() || !lng.isFinite()) {
                return null
            }
            val accuracy = if (loc.isNull("accuracyM")) null else loc.optDouble("accuracyM").toFloat()
            GpsFix(lat, lng, accuracy, 0L)
        }.getOrNull()
    }
}
