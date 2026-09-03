package com.coremapmm.fieldsurveyor.offline

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

class YangonBasemapStore(
    context: Context,
    private val downloadUrl: String,
    private val http: OkHttpClient,
) {
    private val app = context.applicationContext

    fun localFile(): File = File(File(app.filesDir, "basemap").apply { mkdirs() }, FILE_NAME)

    fun isReady(): Boolean = isComplete(localFile())

    fun sizeBytes(): Long = localFile().takeIf { it.isFile }?.length() ?: 0L

    suspend fun ensure(onProgress: (downloaded: Long, total: Long) -> Unit) {
        withContext(Dispatchers.IO) {
            val dest = localFile()
            if (isComplete(dest)) {
                writeCompleteMarker(dest)
                onProgress(dest.length(), dest.length())
                return@withContext
            }
            val tmp = File(dest.path + ".tmp")
            val request = Request.Builder().url(downloadUrl).get().build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Yangon map download failed (${response.code})")
                }
                val body = response.body ?: throw IOException("Empty Yangon map response")
                val total = body.contentLength()
                if (isComplete(dest) && (total <= 0L || dest.length() == total)) {
                    onProgress(dest.length(), dest.length())
                    return@use
                }
                tmp.outputStream().use { output ->
                    var copied = 0L
                    var lastReported = -1L
                    body.byteStream().use { input ->
                        val buffer = ByteArray(256 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) {
                                break
                            }
                            output.write(buffer, 0, read)
                            copied += read
                            if (lastReported < 0L || copied - lastReported >= 1_000_000L) {
                                lastReported = copied
                                onProgress(copied, total)
                            }
                        }
                    }
                    onProgress(copied, total)
                }
                if (total > 0L && tmp.length() != total) {
                    tmp.delete()
                    throw IOException("Yangon map file was incomplete")
                }
                if (dest.exists()) {
                    dest.delete()
                }
                if (!tmp.renameTo(dest)) {
                    tmp.copyTo(dest, overwrite = true)
                    tmp.delete()
                }
                writeCompleteMarker(dest)
                onProgress(dest.length(), dest.length())
            }
        }
    }

    companion object {
        const val FILE_NAME = "yangon.pmtiles"
        private const val MIN_READY_BYTES = 400_000_000L

        fun isComplete(file: File): Boolean {
            if (!file.isFile || file.length() < MIN_READY_BYTES) {
                return false
            }
            val marker = File(file.path + ".ok")
            if (!marker.isFile) {
                return false
            }
            return marker.readText().trim() == file.length().toString()
        }

        fun writeCompleteMarker(file: File) {
            File(file.path + ".ok").writeText(file.length().toString())
        }
    }
}
