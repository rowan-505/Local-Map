package com.coremapmm.fieldsurveyor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface LocalReportMediaDao {
    @Query("SELECT COUNT(*) FROM local_report_media WHERE reportClientPublicId = :reportClientPublicId")
    suspend fun countForReport(reportClientPublicId: String): Int

    @Query(
        """
        SELECT COUNT(*) FROM local_report_media
        WHERE reportClientPublicId = :reportClientPublicId AND mimeType = :mimeType
        """,
    )
    suspend fun countForReportMime(reportClientPublicId: String, mimeType: String): Int

    @Query("SELECT * FROM local_report_media WHERE reportClientPublicId = :reportClientPublicId ORDER BY createdAtEpochMs ASC")
    suspend fun listForReport(reportClientPublicId: String): List<LocalReportMediaEntity>

    @Query("SELECT * FROM local_report_media WHERE mediaPublicId = :mediaPublicId LIMIT 1")
    suspend fun findById(mediaPublicId: String): LocalReportMediaEntity?

    @Query(
        """
        SELECT m.* FROM local_report_media m
        INNER JOIN local_reports r ON r.clientPublicId = m.reportClientPublicId
        WHERE r.status = 'SYNCED'
          AND m.syncState IN ('LOCAL', 'QUEUED', 'RETRY', 'SYNCING')
        ORDER BY m.createdAtEpochMs ASC
        LIMIT 1
        """,
    )
    suspend fun nextEligible(): LocalReportMediaEntity?

    @Query(
        """
        UPDATE local_report_media
        SET syncState = 'SYNCING', updatedAtEpochMs = :updatedAtEpochMs, lastError = NULL
        WHERE mediaPublicId = :mediaPublicId
          AND syncState IN ('LOCAL', 'QUEUED', 'RETRY', 'SYNCING')
        """,
    )
    suspend fun markSyncing(mediaPublicId: String, updatedAtEpochMs: Long): Int

    @Query(
        """
        UPDATE local_report_media
        SET syncState = :syncState, lastError = :lastError, updatedAtEpochMs = :updatedAtEpochMs
        WHERE mediaPublicId = :mediaPublicId
        """,
    )
    suspend fun updateState(
        mediaPublicId: String,
        syncState: String,
        lastError: String?,
        updatedAtEpochMs: Long,
    )

    @Query(
        """
        UPDATE local_report_media
        SET remoteAssetPublicId = :remoteAssetPublicId, updatedAtEpochMs = :updatedAtEpochMs
        WHERE mediaPublicId = :mediaPublicId
          AND remoteAssetPublicId IS NULL
        """,
    )
    suspend fun setRemoteAssetIfAbsent(
        mediaPublicId: String,
        remoteAssetPublicId: String,
        updatedAtEpochMs: Long,
    ): Int

    @Query(
        """
        UPDATE local_report_media
        SET remoteAssetPublicId = NULL, updatedAtEpochMs = :updatedAtEpochMs
        WHERE mediaPublicId = :mediaPublicId
        """,
    )
    suspend fun clearRemoteAsset(mediaPublicId: String, updatedAtEpochMs: Long)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: LocalReportMediaEntity)

    @Query("DELETE FROM local_report_media WHERE reportClientPublicId = :reportClientPublicId")
    suspend fun deleteForReport(reportClientPublicId: String): Int

    @Query(
        """
        DELETE FROM local_report_media
        WHERE mediaPublicId = :mediaPublicId
          AND remoteAssetPublicId IS NULL
          AND syncState IN ('LOCAL', 'QUEUED', 'RETRY', 'PERMANENT_ERROR')
        """,
    )
    suspend fun deleteRemovable(mediaPublicId: String): Int

    @Transaction
    suspend fun claimNext(nowEpochMs: Long): LocalReportMediaEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.mediaPublicId, nowEpochMs) == 1) {
                return row.copy(syncState = LocalReportMediaEntity.STATE_SYNCING, updatedAtEpochMs = nowEpochMs)
            }
        }
        return null
    }
}
