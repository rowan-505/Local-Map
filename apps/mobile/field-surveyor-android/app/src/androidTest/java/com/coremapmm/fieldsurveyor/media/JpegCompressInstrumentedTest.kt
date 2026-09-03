package com.coremapmm.fieldsurveyor.media

import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class JpegCompressInstrumentedTest {
    @Test
    fun noisyPhotoStaysInTargetSizeAndTime() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "perf-source.jpg")
        val dest = File(context.cacheDir, "perf-out.jpg")
        val bitmap = Bitmap.createBitmap(3200, 2400, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(3200 * 2400)
        var seed = 17
        for (i in pixels.indices) {
            seed = seed * 1103515245 + 12345
            val v = (seed ushr 16) and 0xFF
            pixels[i] = Color.rgb(v, (v * 3) and 0xFF, (v * 7) and 0xFF)
        }
        bitmap.setPixels(pixels, 0, 3200, 0, 0, 3200, 2400)
        FileOutputStream(source).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        bitmap.recycle()

        val result = JpegCompressor.compress(source, dest)
        assertTrue("longest edge ${result.width}x${result.height}", maxOf(result.width, result.height) in 1280..1600)
        assertTrue("bytes ${result.byteSize}", result.byteSize in 80_000L..1_500_000L)
        assertTrue("elapsed ${result.elapsedMs}ms", result.elapsedMs < 8_000)
    }
}
