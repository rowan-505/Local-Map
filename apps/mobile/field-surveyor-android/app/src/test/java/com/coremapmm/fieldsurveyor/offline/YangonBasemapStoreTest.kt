package com.coremapmm.fieldsurveyor.offline

import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class YangonBasemapStoreTest {
    @Test
    fun incompleteFileWithoutMarkerIsNotReady() {
        val file = File.createTempFile("yangon", ".pmtiles")
        file.writeBytes(ByteArray(64))
        assertFalse(YangonBasemapStore.isComplete(file))
        file.delete()
        File(file.path + ".ok").delete()
    }

    @Test
    fun markerMustMatchLength() {
        val file = File.createTempFile("yangon", ".pmtiles")
        file.writeBytes(ByteArray(64))
        File(file.path + ".ok").writeText("999")
        assertFalse(YangonBasemapStore.isComplete(file))
        file.delete()
        File(file.path + ".ok").delete()
    }
}
