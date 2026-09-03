package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.media.JpegTarget
import com.coremapmm.fieldsurveyor.media.VoiceTarget
import java.io.File

object ReportBundlePolicy {
    fun error(
        photos: List<File>,
        voice: File?,
        voiceDurationMs: Long,
    ): String? = when {
        photos.size > JpegTarget.MAX_PHOTOS_PER_REPORT ->
            "Max ${JpegTarget.MAX_PHOTOS_PER_REPORT} photos for this report."
        photos.any { !it.isFile || it.length() <= 0L } -> "A photo draft is missing. Take it again."
        voice != null && (!voice.isFile || voice.length() <= 0L) -> "Recording was empty."
        voice != null && voiceDurationMs < VoiceTarget.MIN_DURATION_MS -> "Hold longer to record."
        voice != null && voice.length() > VoiceTarget.MAX_BYTES -> "Recording is too large."
        else -> null
    }
}
