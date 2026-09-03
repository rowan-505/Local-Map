package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReportVoiceStoreTest {
    @Test
    fun capsAtOneClipAndCopiesM4a() = runBlocking {
        val dao = MemoryMediaDao()
        val dir = File.createTempFile("voice", "dir").also {
            it.delete()
            it.mkdirs()
        }
        val store = ReportVoiceStore(
            mediaDir = dir,
            dao = dao,
            nowMs = { 10L },
            newId = { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        )
        val source = File.createTempFile("clip", ".m4a").apply { writeBytes(ByteArray(64) { 3 }) }
        store.addFromRecording("report-a", source)
        assertEquals(1, store.count("report-a"))
        assertEquals(LocalReportMediaEntity.MIME_AAC, dao.rows.values.single().mimeType)
        val second = runCatching { store.addFromRecording("report-a", source) }
        assertTrue(second.isFailure)
        assertTrue(File(dir, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.m4a").isFile)
        assertTrue(store.remove(dao.rows.values.single().mediaPublicId))
        assertEquals(0, store.count("report-a"))
        store.addFromRecording("report-a", source)
        assertEquals(1, store.count("report-a"))
    }
}
