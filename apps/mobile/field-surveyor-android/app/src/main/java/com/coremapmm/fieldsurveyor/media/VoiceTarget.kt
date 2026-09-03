package com.coremapmm.fieldsurveyor.media

/** Short AAC-in-M4A voice clip. No trimming, no speech-to-text. */
object VoiceTarget {
    const val MIME = "audio/mp4"
    const val CHANNELS = 1
    const val SAMPLE_RATE_HZ = 16_000
    const val BITRATE = 40_000
    const val MIN_DURATION_MS = 800
    const val MAX_DURATION_MS = 40_000
    const val MAX_BYTES = 1 * 1024 * 1024
    const val MAX_CLIPS_PER_REPORT = 1
}
