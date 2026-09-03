package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.media.JpegTarget
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ReportBundlePolicyTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun mediaIsOptional() {
        assertNull(ReportBundlePolicy.error(emptyList(), null, 0L))
    }

    @Test
    fun acceptedDraftMediaCanBeSubmittedTogether() {
        val photo = nonEmptyFile("stop.jpg")
        val voice = nonEmptyFile("stop.m4a")

        assertNull(ReportBundlePolicy.error(listOf(photo), voice, 2_000L))
    }

    @Test
    fun missingAndExcessDraftsAreRejectedBeforePersistence() {
        val missing = File(temporaryFolder.root, "missing.jpg")
        assertEquals(
            "A photo draft is missing. Take it again.",
            ReportBundlePolicy.error(listOf(missing), null, 0L),
        )

        val photos = (0..JpegTarget.MAX_PHOTOS_PER_REPORT).map { nonEmptyFile("$it.jpg") }
        assertEquals(
            "Max ${JpegTarget.MAX_PHOTOS_PER_REPORT} photos for this report.",
            ReportBundlePolicy.error(photos, null, 0L),
        )
    }

    private fun nonEmptyFile(name: String) = temporaryFolder.newFile(name).apply {
        writeBytes(byteArrayOf(1, 2, 3))
    }
}
