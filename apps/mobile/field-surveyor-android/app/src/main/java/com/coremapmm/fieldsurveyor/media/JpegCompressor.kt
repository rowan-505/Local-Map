package com.coremapmm.fieldsurveyor.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

data class JpegCompressResult(
    val width: Int,
    val height: Int,
    val byteSize: Long,
    val elapsedMs: Long,
)

object JpegCompressor {
    fun compress(source: File, destination: File): JpegCompressResult {
        val started = System.nanoTime()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        val srcW = bounds.outWidth
        val srcH = bounds.outHeight
        val sample = JpegTarget.inSampleSize(srcW, srcH)
        val decoded = BitmapFactory.Options().run {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
            BitmapFactory.decodeFile(source.absolutePath, this)
        } ?: error("Could not decode photo")
        val sampledW = decoded.width
        val sampledH = decoded.height
        val (outW, outH) = JpegTarget.outputSize(sampledW, sampledH)
        val scaled = if (outW == sampledW && outH == sampledH) {
            decoded
        } else {
            Bitmap.createScaledBitmap(decoded, outW, outH, true).also {
                if (it != decoded) {
                    decoded.recycle()
                }
            }
        }
        destination.parentFile?.mkdirs()
        FileOutputStream(destination).use { stream ->
            val ok = scaled.compress(Bitmap.CompressFormat.JPEG, JpegTarget.QUALITY, stream)
            if (!ok) {
                scaled.recycle()
                error("JPEG compress failed")
            }
        }
        scaled.recycle()
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        val size = destination.length()
        if (size <= 0L || size > JpegTarget.MAX_BYTES) {
            destination.delete()
            error("JPEG size out of range: $size")
        }
        return JpegCompressResult(
            width = outW,
            height = outH,
            byteSize = size,
            elapsedMs = elapsedMs,
        )
    }
}
