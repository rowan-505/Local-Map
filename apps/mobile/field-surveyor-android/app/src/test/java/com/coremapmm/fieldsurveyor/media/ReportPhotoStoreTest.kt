package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReportPhotoStoreTest {
    @Test
    fun compressesOffCallerAndCapsAtThree() = runBlocking {
        val dao = MemoryMediaDao()
        val dir = File.createTempFile("media", "dir").also {
            it.delete()
            it.mkdirs()
        }
        var nextId = 0
        val store = ReportPhotoStore(
            mediaDir = dir,
            dao = dao,
            compress = { source, dest ->
                dest.writeBytes(source.readBytes())
                JpegCompressResult(1600, 1200, dest.length(), 1L)
            },
            nowMs = { 10L },
            newId = {
                "00000000-0000-4000-8000-${(nextId++).toString().padStart(12, '0')}"
            },
        )
        val source = File.createTempFile("src", ".jpg").apply { writeBytes(ByteArray(32) { 7 }) }
        store.addFromCapture("report-a", source)
        store.addFromCapture("report-a", source)
        store.addFromCapture("report-a", source)
        assertEquals(3, store.count("report-a"))
        val removable = store.list("report-a").first()
        assertTrue(store.remove(removable.mediaPublicId))
        assertEquals(2, store.count("report-a"))
        store.addFromCapture("report-a", source)
        val fourth = runCatching { store.addFromCapture("report-a", source) }
        assertTrue(fourth.isFailure)
        store.deleteForReport("report-a")
        assertEquals(0, store.count("report-a"))
        assertTrue(dir.listFiles().isNullOrEmpty())
    }

    @Test
    fun voiceClipDoesNotConsumePhotoSlots() = runBlocking {
        val dao = MemoryMediaDao()
        val dir = File.createTempFile("media", "dir").also {
            it.delete()
            it.mkdirs()
        }
        val photos = ReportPhotoStore(
            mediaDir = dir,
            dao = dao,
            compress = { source, dest ->
                dest.writeBytes(source.readBytes())
                JpegCompressResult(1600, 1200, dest.length(), 1L)
            },
            nowMs = { 10L },
            newId = { "00000000-0000-4000-8000-${dao.rows.size.toString().padStart(12, '0')}" },
        )
        val voice = ReportVoiceStore(
            mediaDir = dir,
            dao = dao,
            nowMs = { 10L },
            newId = { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        )
        val jpeg = File.createTempFile("src", ".jpg").apply { writeBytes(ByteArray(32) { 7 }) }
        val clip = File.createTempFile("clip", ".m4a").apply { writeBytes(ByteArray(32) { 2 }) }
        voice.addFromRecording("report-a", clip)
        photos.addFromCapture("report-a", jpeg)
        photos.addFromCapture("report-a", jpeg)
        photos.addFromCapture("report-a", jpeg)
        assertEquals(3, photos.count("report-a"))
        assertEquals(1, voice.count("report-a"))
        assertEquals(4, dao.countForReport("report-a"))
    }
}

internal class MemoryMediaDao : LocalReportMediaDao {
    val rows = linkedMapOf<String, LocalReportMediaEntity>()
    var parentSynced: (String) -> Boolean = { true }

    override suspend fun countForReport(reportClientPublicId: String) =
        rows.values.count { it.reportClientPublicId == reportClientPublicId }

    override suspend fun countForReportMime(reportClientPublicId: String, mimeType: String) =
        rows.values.count { it.reportClientPublicId == reportClientPublicId && it.mimeType == mimeType }

    override suspend fun listForReport(reportClientPublicId: String) =
        rows.values.filter { it.reportClientPublicId == reportClientPublicId }.sortedBy { it.createdAtEpochMs }

    override suspend fun findById(mediaPublicId: String) = rows[mediaPublicId]

    override suspend fun nextEligible(): LocalReportMediaEntity? {
        return rows.values
            .filter {
                parentSynced(it.reportClientPublicId) &&
                    it.syncState in setOf(
                        LocalReportMediaEntity.STATE_LOCAL,
                        LocalReportMediaEntity.STATE_QUEUED,
                        LocalReportMediaEntity.STATE_RETRY,
                        LocalReportMediaEntity.STATE_SYNCING,
                    )
            }
            .minByOrNull { it.createdAtEpochMs }
    }

    override suspend fun markSyncing(mediaPublicId: String, updatedAtEpochMs: Long): Int {
        val current = rows[mediaPublicId] ?: return 0
        val eligible = current.syncState in setOf(
            LocalReportMediaEntity.STATE_LOCAL,
            LocalReportMediaEntity.STATE_QUEUED,
            LocalReportMediaEntity.STATE_RETRY,
            LocalReportMediaEntity.STATE_SYNCING,
        )
        if (!eligible) return 0
        rows[mediaPublicId] = current.copy(syncState = LocalReportMediaEntity.STATE_SYNCING, updatedAtEpochMs = updatedAtEpochMs, lastError = null)
        return 1
    }

    override suspend fun updateState(mediaPublicId: String, syncState: String, lastError: String?, updatedAtEpochMs: Long) {
        val current = rows[mediaPublicId] ?: return
        rows[mediaPublicId] = current.copy(syncState = syncState, lastError = lastError, updatedAtEpochMs = updatedAtEpochMs)
    }

    override suspend fun setRemoteAssetIfAbsent(mediaPublicId: String, remoteAssetPublicId: String, updatedAtEpochMs: Long): Int {
        val current = rows[mediaPublicId] ?: return 0
        if (current.remoteAssetPublicId != null) return 0
        rows[mediaPublicId] = current.copy(remoteAssetPublicId = remoteAssetPublicId, updatedAtEpochMs = updatedAtEpochMs)
        return 1
    }

    override suspend fun clearRemoteAsset(mediaPublicId: String, updatedAtEpochMs: Long) {
        val current = rows[mediaPublicId] ?: return
        rows[mediaPublicId] = current.copy(remoteAssetPublicId = null, updatedAtEpochMs = updatedAtEpochMs)
    }

    override suspend fun insert(row: LocalReportMediaEntity) {
        rows[row.mediaPublicId] = row
    }

    override suspend fun deleteForReport(reportClientPublicId: String): Int {
        val keys = rows.filterValues { it.reportClientPublicId == reportClientPublicId }.keys.toList()
        keys.forEach { rows.remove(it) }
        return keys.size
    }

    override suspend fun deleteRemovable(mediaPublicId: String): Int {
        val row = rows[mediaPublicId] ?: return 0
        if (row.remoteAssetPublicId != null || row.syncState !in setOf(
                LocalReportMediaEntity.STATE_LOCAL,
                LocalReportMediaEntity.STATE_QUEUED,
                LocalReportMediaEntity.STATE_RETRY,
                LocalReportMediaEntity.STATE_PERMANENT_ERROR,
            )
        ) return 0
        rows.remove(mediaPublicId)
        return 1
    }

    override suspend fun claimNext(nowEpochMs: Long): LocalReportMediaEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.mediaPublicId, nowEpochMs) == 1) {
                return rows.getValue(row.mediaPublicId)
            }
        }
        return null
    }
}
