package com.coremapmm.fieldsurveyor.media

import android.content.Context
import android.media.MediaRecorder
import java.io.File

/** Platform MediaRecorder AAC/M4A, mono, ~40 kbps. */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    val isRecording: Boolean
        get() = recorder != null

    fun start(dest: File) {
        cancel()
        dest.parentFile?.mkdirs()
        if (dest.exists()) {
            dest.delete()
        }
        val next = MediaRecorder(context).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioChannels(VoiceTarget.CHANNELS)
            setAudioSamplingRate(VoiceTarget.SAMPLE_RATE_HZ)
            setAudioEncodingBitRate(VoiceTarget.BITRATE)
            setMaxDuration(VoiceTarget.MAX_DURATION_MS)
            setOutputFile(dest.absolutePath)
            prepare()
            start()
        }
        recorder = next
        output = dest
    }

    fun stop(): File {
        val file = output ?: error("Not recording")
        val active = recorder
        recorder = null
        output = null
        try {
            active?.stop()
        } catch (_: RuntimeException) {
            active?.reset()
            active?.release()
            file.delete()
            error("Recording failed")
        }
        active?.release()
        if (!file.isFile || file.length() <= 0L) {
            file.delete()
            error("Recording was empty")
        }
        if (file.length() > VoiceTarget.MAX_BYTES) {
            file.delete()
            error("Recording is too large")
        }
        return file
    }

    fun cancel() {
        val file = output
        val active = recorder
        recorder = null
        output = null
        runCatching { active?.reset() }
        runCatching { active?.release() }
        file?.delete()
    }
}
