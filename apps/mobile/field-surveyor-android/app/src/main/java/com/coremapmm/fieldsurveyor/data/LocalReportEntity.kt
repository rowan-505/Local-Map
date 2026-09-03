package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Local field anomaly outbox row. Logout must not delete these.
 * clientPublicId is the POST /field/reports idempotency key.
 */
@Entity(tableName = "local_reports")
data class LocalReportEntity(
    @PrimaryKey val clientPublicId: String,
    val status: String,
    val payloadJson: String,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val lastError: String? = null,
) {
    companion object {
        const val STATUS_LOCAL = "LOCAL"
        const val STATUS_QUEUED = "QUEUED"
        const val STATUS_SYNCING = "SYNCING"
        const val STATUS_SYNCED = "SYNCED"
        const val STATUS_RETRY = "RETRY"
        const val STATUS_PERMANENT_ERROR = "PERMANENT_ERROR"
    }
}
