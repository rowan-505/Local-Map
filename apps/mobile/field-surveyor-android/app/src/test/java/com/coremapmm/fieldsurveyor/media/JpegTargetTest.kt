package com.coremapmm.fieldsurveyor.media

import org.junit.Assert.assertEquals
import org.junit.Test

class JpegTargetTest {
    @Test
    fun doesNotUpscaleSmallImages() {
        assertEquals(800 to 600, JpegTarget.outputSize(800, 600))
    }

    @Test
    fun downscalesLongestEdgeTo1600() {
        assertEquals(1600 to 1200, JpegTarget.outputSize(3200, 2400))
        assertEquals(900 to 1600, JpegTarget.outputSize(1800, 3200))
    }

    @Test
    fun keepsAlreadyInRange() {
        assertEquals(1280 to 960, JpegTarget.outputSize(1280, 960))
        assertEquals(1600 to 900, JpegTarget.outputSize(1600, 900))
    }

    @Test
    fun sampleSizeJumpsByPowersOfTwo() {
        assertEquals(1, JpegTarget.inSampleSize(1600, 1200))
        assertEquals(2, JpegTarget.inSampleSize(4000, 3000))
    }
}
