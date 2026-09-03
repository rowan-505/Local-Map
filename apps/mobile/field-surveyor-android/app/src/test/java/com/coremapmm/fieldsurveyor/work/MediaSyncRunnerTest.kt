package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.data.MediaApiResult
import com.coremapmm.fieldsurveyor.data.MediaUploadIntent
import com.coremapmm.fieldsurveyor.media.MemoryMediaDao
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MediaSyncRunnerTest {
    @Test
    fun fullHappyPathPutsThenCompletesThenAttaches() = runBlocking {
        val dao = MemoryMediaDao()
        val file = jpegFile()
        dao.insert(mediaRow(file))
        val log = mutableListOf<String>()
        val result = runner(dao, log).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
        assertEquals(listOf("upload", "put", "complete", "attach"), log)
        assertEquals("asset-1", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun reportsStayIndependentWhenParentNotSynced() = runBlocking {
        val dao = MemoryMediaDao().also { it.parentSynced = { false } }
        dao.insert(mediaRow(jpegFile()))
        val result = runner(dao).syncOne()
        assertEquals(OutboxRunResult.Idle, result)
        assertEquals(LocalReportMediaEntity.STATE_LOCAL, dao.rows.values.single().syncState)
    }

    @Test
    fun expiredPutClearsRemoteIdAndRetries() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()))
        var puts = 0
        val first = runner(
            dao,
            put = {
                puts += 1
                OutboxHttpResult.Transient(403, "expired")
            },
        ).syncOne()
        assertEquals(OutboxRunResult.RetryLater, first)
        assertNull(dao.rows.values.single().remoteAssetPublicId)
        val second = runner(dao).syncOne()
        assertEquals(OutboxRunResult.Processed, second)
        assertEquals(1, puts)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun interruptedPutThenCompleteNotFoundRequestsNewUpload() = runBlocking {
        val dao = MemoryMediaDao()
        val row = mediaRow(jpegFile()).copy(remoteAssetPublicId = "old-asset")
        dao.insert(row)
        var uploads = 0
        val result = runner(
            dao,
            complete = { id ->
                if (id == "old-asset") MediaApiResult.NeedNewUpload("OBJECT_NOT_FOUND") else MediaApiResult.Ok(Unit)
            },
            createUpload = {
                uploads += 1
                MediaApiResult.Ok(intent("new-asset"))
            },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(1, uploads)
        assertEquals("new-asset", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun restartCompletesExistingRemoteWithoutSecondPut() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()).copy(remoteAssetPublicId = "asset-ready", syncState = LocalReportMediaEntity.STATE_SYNCING))
        val log = mutableListOf<String>()
        runner(
            dao,
            log,
            createUpload = { error("should not create") },
            put = { error("should not put") },
        ).syncOne()
        assertEquals(listOf("complete", "attach"), log)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun duplicateClaimKeepsFirstRemoteAsset() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()))
        val first = dao.claimNext(1L)!!
        val second = dao.claimNext(2L)!!
        assertEquals(first.mediaPublicId, second.mediaPublicId)
        dao.setRemoteAssetIfAbsent(first.mediaPublicId, "winner", 3L)
        val lost = dao.setRemoteAssetIfAbsent(second.mediaPublicId, "loser", 4L)
        assertEquals(0, lost)
        assertEquals("winner", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun createUploadUsesStoredMimeType() = runBlocking {
        val dao = MemoryMediaDao()
        val file = File.createTempFile("clip", ".m4a").apply { writeBytes(ByteArray(32) { 1 }) }
        dao.insert(mediaRow(file).copy(mimeType = LocalReportMediaEntity.MIME_AAC))
        var mime = ""
        val result = MediaSyncRunner(
            hasSession = { true },
            accessToken = { "token" },
            media = dao,
            createUpload = { _, nextMime, _ ->
                mime = nextMime
                MediaApiResult.Ok(intent("asset-1").copy(contentType = nextMime))
            },
            putObject = { _, _ -> OutboxHttpResult.Success(200) },
            complete = { _, _ -> MediaApiResult.Ok(Unit) },
            attach = { _, _, _ -> MediaApiResult.Ok(Unit) },
            nowMs = { 10L },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.MIME_AAC, mime)
    }

    private fun runner(
        dao: MemoryMediaDao,
        log: MutableList<String> = mutableListOf(),
        createUpload: () -> MediaApiResult<MediaUploadIntent> = {
            log += "upload"
            MediaApiResult.Ok(intent("asset-1"))
        },
        put: () -> OutboxHttpResult = {
            log += "put"
            OutboxHttpResult.Success(200)
        },
        complete: (String) -> MediaApiResult<Unit> = {
            log += "complete"
            MediaApiResult.Ok(Unit)
        },
        attach: () -> MediaApiResult<Unit> = {
            log += "attach"
            MediaApiResult.Ok(Unit)
        },
    ) = MediaSyncRunner(
        hasSession = { true },
        accessToken = { "token" },
        media = dao,
        createUpload = { _, _, _ -> createUpload() },
        putObject = { _, _ -> put() },
        complete = { _, id -> complete(id) },
        attach = { _, _, _ -> attach() },
        nowMs = { 10L },
    )

    private fun intent(id: String) = MediaUploadIntent(id, "https://example.invalid/put", "image/jpeg", "32")

    private fun jpegFile(): File = File.createTempFile("photo", ".jpg").apply { writeBytes(ByteArray(32) { 1 }) }

    private fun mediaRow(file: File) = LocalReportMediaEntity(
        mediaPublicId = "media-1",
        reportClientPublicId = "report-1",
        localPath = file.absolutePath,
        mimeType = LocalReportMediaEntity.MIME_JPEG,
        byteSize = file.length(),
        syncState = LocalReportMediaEntity.STATE_LOCAL,
        remoteAssetPublicId = null,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 1L,
    )
}
