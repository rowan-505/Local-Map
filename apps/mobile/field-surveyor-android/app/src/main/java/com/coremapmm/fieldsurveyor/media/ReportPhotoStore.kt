package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class ReportPhotoStore(
    private val mediaDir: File,
    private val dao: LocalReportMediaDao,
    private val compress: (File, File) -> JpegCompressResult = JpegCompressor::compress,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun count(reportClientPublicId: String): Int =
        dao.countForReportMime(reportClientPublicId, LocalReportMediaEntity.MIME_JPEG)

    suspend fun list(reportClientPublicId: String): List<LocalReportMediaEntity> =
        dao.listForReport(reportClientPublicId).filter { it.mimeType == LocalReportMediaEntity.MIME_JPEG }

    suspend fun addFromCapture(reportClientPublicId: String, source: File): LocalReportMediaEntity {
        return withContext(Dispatchers.IO) {
            val existing = dao.countForReportMime(reportClientPublicId, LocalReportMediaEntity.MIME_JPEG)
            if (existing >= JpegTarget.MAX_PHOTOS_PER_REPORT) {
                error("Max ${JpegTarget.MAX_PHOTOS_PER_REPORT} photos for this report")
            }
            val id = newId()
            mediaDir.mkdirs()
            val dest = File(mediaDir, "$id.jpg")
            val result = compress(source, dest)
            val now = nowMs()
            val row = LocalReportMediaEntity(
                mediaPublicId = id,
                reportClientPublicId = reportClientPublicId,
                localPath = dest.absolutePath,
                mimeType = LocalReportMediaEntity.MIME_JPEG,
                byteSize = result.byteSize,
                syncState = LocalReportMediaEntity.STATE_LOCAL,
                remoteAssetPublicId = null,
                createdAtEpochMs = now,
                updatedAtEpochMs = now,
            )
            dao.insert(row)
            row
        }
    }

    suspend fun deleteForReport(reportClientPublicId: String) {
        withContext(Dispatchers.IO) {
            val rows = dao.listForReport(reportClientPublicId)
            rows.forEach { File(it.localPath).delete() }
            dao.deleteForReport(reportClientPublicId)
        }
    }

    suspend fun remove(mediaPublicId: String): Boolean = withContext(Dispatchers.IO) {
        val row = dao.findById(mediaPublicId)
            ?.takeIf { it.mimeType == LocalReportMediaEntity.MIME_JPEG }
            ?: return@withContext false
        if (dao.deleteRemovable(mediaPublicId) != 1) return@withContext false
        File(row.localPath).delete()
        true
    }

    companion object {
        fun dir(noBackupFilesDir: File): File = File(noBackupFilesDir, "media")
    }
}
