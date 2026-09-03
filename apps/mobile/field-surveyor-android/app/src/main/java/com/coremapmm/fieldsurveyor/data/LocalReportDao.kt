package com.coremapmm.fieldsurveyor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface LocalReportDao {
    @Query("SELECT COUNT(*) FROM local_reports")
    suspend fun countAll(): Int

    @Query("SELECT COUNT(*) FROM local_reports WHERE status = 'SYNCED'")
    suspend fun countSynced(): Int

    @Query("SELECT COUNT(*) FROM local_reports WHERE status <> 'SYNCED'")
    suspend fun countWaiting(): Int

    @Query("SELECT * FROM local_reports ORDER BY updatedAtEpochMs DESC")
    suspend fun listAll(): List<LocalReportEntity>

    @Query(
        """
        SELECT * FROM local_reports
        WHERE status IN ('LOCAL', 'QUEUED', 'RETRY', 'SYNCING')
        ORDER BY createdAtEpochMs ASC
        LIMIT 1
        """,
    )
    suspend fun nextEligible(): LocalReportEntity?

    @Query("SELECT * FROM local_reports WHERE clientPublicId = :clientPublicId LIMIT 1")
    suspend fun findById(clientPublicId: String): LocalReportEntity?

    @Query(
        """
        UPDATE local_reports
        SET status = 'SYNCING', updatedAtEpochMs = :updatedAtEpochMs, lastError = NULL
        WHERE clientPublicId = :clientPublicId
          AND status IN ('LOCAL', 'QUEUED', 'RETRY', 'SYNCING')
        """,
    )
    suspend fun markSyncing(clientPublicId: String, updatedAtEpochMs: Long): Int

    @Query(
        """
        UPDATE local_reports
        SET status = :status, lastError = :lastError, updatedAtEpochMs = :updatedAtEpochMs
        WHERE clientPublicId = :clientPublicId
        """,
    )
    suspend fun updateStatus(
        clientPublicId: String,
        status: String,
        lastError: String?,
        updatedAtEpochMs: Long,
    )

    @Query(
        """
        UPDATE local_reports
        SET payloadJson = :payloadJson, updatedAtEpochMs = :updatedAtEpochMs
        WHERE clientPublicId = :clientPublicId AND status <> 'SYNCED'
        """,
    )
    suspend fun updatePayload(
        clientPublicId: String,
        payloadJson: String,
        updatedAtEpochMs: Long,
    )

    @Query(
        """
        DELETE FROM local_reports
        WHERE clientPublicId = :clientPublicId
          AND status IN ('LOCAL', 'QUEUED', 'RETRY', 'PERMANENT_ERROR')
        """,
    )
    suspend fun deletePending(clientPublicId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: LocalReportEntity)

    @Transaction
    suspend fun claimNext(nowEpochMs: Long): LocalReportEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.clientPublicId, nowEpochMs) == 1) {
                return row.copy(status = LocalReportEntity.STATUS_SYNCING, updatedAtEpochMs = nowEpochMs)
            }
        }
        return null
    }
}
