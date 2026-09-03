package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

class OutboxSyncRunnerTest {
    @Test
    fun offlineThenOnlineSyncsQueuedRow() = runBlocking {
        val reports = MemoryReports()
        val id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        reports.upsert(row(id, LocalReportEntity.STATUS_LOCAL))
        val first = runner(reports, hasSession = true) { _, _ ->
            OutboxSyncPolicy.classifyThrowable(java.io.IOException("offline"))
        }.syncOne()
        assertEquals(OutboxRunResult.RetryLater, first)
        assertEquals(LocalReportEntity.STATUS_RETRY, reports.rows.getValue(id).status)

        val second = runner(reports) { _, _ -> OutboxHttpResult.Success(201) }.syncOne()
        assertEquals(OutboxRunResult.Processed, second)
        assertEquals(LocalReportEntity.STATUS_SYNCED, reports.rows.getValue(id).status)
    }

    @Test
    fun timeoutBeforePostRetriesSameUuid() = runBlocking {
        val reports = MemoryReports()
        val id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        reports.upsert(row(id, LocalReportEntity.STATUS_QUEUED))
        val bodies = mutableListOf<String>()
        runner(reports) { _, body ->
            bodies.add(body)
            OutboxSyncPolicy.classifyThrowable(SocketTimeoutException("timeout before POST"))
        }.syncOne()
        runner(reports) { _, body ->
            bodies.add(body)
            OutboxHttpResult.Success(201)
        }.syncOne()
        assertEquals(2, bodies.size)
        assertEquals(id, JSONObject(bodies[0]).getString("clientPublicId"))
        assertEquals(id, JSONObject(bodies[1]).getString("clientPublicId"))
        assertEquals(LocalReportEntity.STATUS_SYNCED, reports.rows.getValue(id).status)
    }

    @Test
    fun lostSuccessResponseThenRetryStillOneServerRow() = runBlocking {
        val reports = MemoryReports()
        val id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        reports.upsert(row(id, LocalReportEntity.STATUS_QUEUED))
        val server = FakeServer()
        runner(reports) { _, body ->
            server.accept(body)
            OutboxSyncPolicy.classifyThrowable(java.io.IOException("response lost"))
        }.syncOne()
        runner(reports) { _, body -> server.accept(body) }.syncOne()
        assertEquals(1, server.created.size)
        assertEquals(2, server.posts)
        assertEquals(LocalReportEntity.STATUS_SYNCED, reports.rows.getValue(id).status)
    }

    @Test
    fun duplicateWorkerClaimsStillOneServerRow() = runBlocking {
        val reports = MemoryReports()
        val id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        reports.upsert(row(id, LocalReportEntity.STATUS_QUEUED))
        val first = reports.claimNext(1L)
        val second = reports.claimNext(2L)
        assertEquals(id, first?.clientPublicId)
        assertEquals(id, second?.clientPublicId)
        val server = FakeServer()
        val body = com.coremapmm.fieldsurveyor.survey.AnomalyPayload.toCreateBody(id, first!!.payloadJson)
        assertTrue(server.accept(body) is OutboxHttpResult.Success)
        assertTrue(server.accept(body) is OutboxHttpResult.Success)
        reports.updateStatus(id, LocalReportEntity.STATUS_SYNCED, null, 3L)
        reports.updateStatus(id, LocalReportEntity.STATUS_SYNCED, null, 4L)
        assertEquals(1, server.created.size)
        assertEquals(2, server.posts)
    }

    @Test
    fun processRestartRecoversSyncingRow() = runBlocking {
        val reports = MemoryReports()
        val id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        reports.upsert(row(id, LocalReportEntity.STATUS_SYNCING))
        runner(reports) { _, _ -> OutboxHttpResult.Success(200) }.syncOne()
        assertEquals(LocalReportEntity.STATUS_SYNCED, reports.rows.getValue(id).status)
    }

    @Test
    fun twoAnomaliesSameStopAndTypeStayTwoRows() = runBlocking {
        val reports = MemoryReports()
        val a = "11111111-1111-4111-8111-111111111111"
        val b = "22222222-2222-4222-8222-222222222222"
        reports.upsert(row(a, LocalReportEntity.STATUS_QUEUED))
        reports.upsert(row(b, LocalReportEntity.STATUS_QUEUED))
        val server = FakeServer()
        val sync = runner(reports) { _, body -> server.accept(body) }
        assertEquals(OutboxRunResult.Processed, sync.syncOne())
        assertEquals(OutboxRunResult.Processed, sync.syncOne())
        assertEquals(OutboxRunResult.Idle, sync.syncOne())
        assertEquals(setOf(a, b), server.created)
    }

    @Test
    fun validationStopsRetry() = runBlocking {
        val reports = MemoryReports()
        val id = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        reports.upsert(row(id, LocalReportEntity.STATUS_QUEUED))
        val result = runner(reports) { _, _ ->
            OutboxSyncPolicy.classifyHttp(400, "Unknown stop")
        }.syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportEntity.STATUS_PERMANENT_ERROR, reports.rows.getValue(id).status)
        assertEquals(OutboxRunResult.Idle, runner(reports) { _, _ -> error("should not post") }.syncOne())
    }

    @Test
    fun logoutDoesNotDeleteWaitingRow() = runBlocking {
        val reports = MemoryReports()
        val id = "99999999-9999-4999-8999-999999999999"
        reports.upsert(row(id, LocalReportEntity.STATUS_RETRY))
        assertEquals(1, reports.rows.size)
        assertEquals(LocalReportEntity.STATUS_RETRY, reports.rows.getValue(id).status)
    }

    @Test
    fun noSessionDoesNotDropQueue() = runBlocking {
        val reports = MemoryReports()
        reports.upsert(row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LocalReportEntity.STATUS_QUEUED))
        val result = runner(reports, hasSession = false) { _, _ -> error("no network") }.syncOne()
        assertEquals(OutboxRunResult.Idle, result)
        assertEquals(LocalReportEntity.STATUS_QUEUED, reports.rows.values.single().status)
    }

    @Test
    fun countsMatchCapturedSyncedWaiting() = runBlocking {
        val reports = MemoryReports()
        reports.upsert(row("a", LocalReportEntity.STATUS_SYNCED, "a"))
        reports.upsert(row("b", LocalReportEntity.STATUS_SYNCED, "b"))
        reports.upsert(row("c", LocalReportEntity.STATUS_RETRY, "c"))
        assertEquals(3, reports.rows.size)
        assertEquals(2, reports.rows.values.count { it.status == LocalReportEntity.STATUS_SYNCED })
        assertEquals(1, reports.rows.values.count { it.status != LocalReportEntity.STATUS_SYNCED })
    }

    private fun runner(
        reports: MemoryReports,
        hasSession: Boolean = true,
        post: (String, String) -> OutboxHttpResult,
    ) = OutboxSyncRunner(
        hasSession = { hasSession },
        accessToken = { "token" },
        reports = reports,
        post = post,
        nowMs = { 10L },
    )

    private fun row(id: String, status: String, key: String = id) = LocalReportEntity(
        clientPublicId = id,
        status = status,
        payloadJson = """{"clientPublicId":"$id","reportTypeCode":"wrong_location","observedAt":"2026-09-02T09:00:00Z","location":{"lat":16.8,"lng":96.15,"accuracyM":5},"target":{"entityType":"stop","publicId":"33333333-3333-4333-8333-333333333333"},"context":{"snapshotRevision":"rev","variantCode":"D0"},"note":""}""",
        createdAtEpochMs = key.hashCode().toLong(),
        updatedAtEpochMs = 0L,
    )
}

private class FakeServer {
    val created = linkedSetOf<String>()
    var posts = 0

    fun accept(body: String): OutboxHttpResult {
        posts += 1
        val id = JSONObject(body).getString("clientPublicId")
        val isNew = created.add(id)
        return OutboxHttpResult.Success(if (isNew) 201 else 200)
    }
}

private class MemoryReports : LocalReportDao {
    val rows = linkedMapOf<String, LocalReportEntity>()

    override suspend fun countAll() = rows.size

    override suspend fun countSynced() = rows.values.count { it.status == LocalReportEntity.STATUS_SYNCED }

    override suspend fun countWaiting() = rows.values.count { it.status != LocalReportEntity.STATUS_SYNCED }

    override suspend fun listAll() = rows.values.toList()

    override suspend fun nextEligible(): LocalReportEntity? {
        return rows.values
            .filter {
                it.status == LocalReportEntity.STATUS_LOCAL ||
                    it.status == LocalReportEntity.STATUS_QUEUED ||
                    it.status == LocalReportEntity.STATUS_RETRY ||
                    it.status == LocalReportEntity.STATUS_SYNCING
            }
            .minByOrNull { it.createdAtEpochMs }
    }

    override suspend fun findById(clientPublicId: String) = rows[clientPublicId]

    override suspend fun markSyncing(clientPublicId: String, updatedAtEpochMs: Long): Int {
        val current = rows[clientPublicId] ?: return 0
        val eligible = current.status == LocalReportEntity.STATUS_LOCAL ||
            current.status == LocalReportEntity.STATUS_QUEUED ||
            current.status == LocalReportEntity.STATUS_RETRY ||
            current.status == LocalReportEntity.STATUS_SYNCING
        if (!eligible) {
            return 0
        }
        rows[clientPublicId] = current.copy(
            status = LocalReportEntity.STATUS_SYNCING,
            updatedAtEpochMs = updatedAtEpochMs,
            lastError = null,
        )
        return 1
    }

    override suspend fun updateStatus(
        clientPublicId: String,
        status: String,
        lastError: String?,
        updatedAtEpochMs: Long,
    ) {
        val current = rows[clientPublicId] ?: return
        rows[clientPublicId] = current.copy(
            status = status,
            lastError = lastError,
            updatedAtEpochMs = updatedAtEpochMs,
        )
    }

    override suspend fun updatePayload(clientPublicId: String, payloadJson: String, updatedAtEpochMs: Long) {
        val current = rows[clientPublicId] ?: return
        if (current.status == LocalReportEntity.STATUS_SYNCED) {
            return
        }
        rows[clientPublicId] = current.copy(payloadJson = payloadJson, updatedAtEpochMs = updatedAtEpochMs)
    }

    override suspend fun deletePending(clientPublicId: String): Int {
        val current = rows[clientPublicId] ?: return 0
        val pending = current.status == LocalReportEntity.STATUS_LOCAL ||
            current.status == LocalReportEntity.STATUS_QUEUED ||
            current.status == LocalReportEntity.STATUS_RETRY ||
            current.status == LocalReportEntity.STATUS_PERMANENT_ERROR
        if (!pending) {
            return 0
        }
        rows.remove(clientPublicId)
        return 1
    }

    override suspend fun upsert(row: LocalReportEntity) {
        rows[row.clientPublicId] = row
    }

    override suspend fun claimNext(nowEpochMs: Long): LocalReportEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.clientPublicId, nowEpochMs) == 1) {
                return rows.getValue(row.clientPublicId)
            }
        }
        return null
    }
}
