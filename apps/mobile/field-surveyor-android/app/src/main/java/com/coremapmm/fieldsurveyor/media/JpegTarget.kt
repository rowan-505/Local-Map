package com.coremapmm.fieldsurveyor.media

/** Longest-edge target for field JPEG evidence. Does not upscale. */
object JpegTarget {
    const val MIN_LONG_EDGE = 1280
    const val MAX_LONG_EDGE = 1600
    const val QUALITY = 78
    const val MAX_BYTES = 8 * 1024 * 1024
    const val MAX_PHOTOS_PER_REPORT = 3

    fun outputSize(srcWidth: Int, srcHeight: Int): Pair<Int, Int> {
        if (srcWidth <= 0 || srcHeight <= 0) {
            return 1 to 1
        }
        val longest = maxOf(srcWidth, srcHeight)
        if (longest <= MAX_LONG_EDGE) {
            return srcWidth to srcHeight
        }
        val scale = MAX_LONG_EDGE.toDouble() / longest.toDouble()
        val width = (srcWidth * scale).toInt().coerceAtLeast(1)
        val height = (srcHeight * scale).toInt().coerceAtLeast(1)
        return width to height
    }

    fun inSampleSize(srcWidth: Int, srcHeight: Int): Int {
        val longest = maxOf(srcWidth, srcHeight)
        var sample = 1
        while (longest / (sample * 2) >= MAX_LONG_EDGE) {
            sample *= 2
        }
        return sample
    }
}
