package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Local photo queue for a field report. GPS/route live on the report row only.
 */
@Entity(
    tableName = "local_report_media",
    indices = [Index(value = ["reportClientPublicId"])],
)
data class LocalReportMediaEntity(
    @PrimaryKey val mediaPublicId: String,
    val reportClientPublicId: String,
    val localPath: String,
    val mimeType: String,
    val byteSize: Long,
    val syncState: String,
    val remoteAssetPublicId: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val lastError: String? = null,
) {
    companion object {
        const val MIME_JPEG = "image/jpeg"
        const val MIME_AAC = "audio/mp4"
        const val STATE_LOCAL = "LOCAL"
        const val STATE_QUEUED = "QUEUED"
        const val STATE_SYNCING = "SYNCING"
        const val STATE_SYNCED = "SYNCED"
        const val STATE_RETRY = "RETRY"
        const val STATE_PERMANENT_ERROR = "PERMANENT_ERROR"
    }
}
