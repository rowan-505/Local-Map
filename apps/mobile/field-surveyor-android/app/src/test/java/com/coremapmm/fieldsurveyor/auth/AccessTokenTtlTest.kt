package com.coremapmm.fieldsurveyor.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessTokenTtlTest {
    @Test
    fun parsesFastifyFifteenMinutes() {
        assertEquals(15L * 60L * 1000L, AccessTokenTtl.toMillis("15m"))
    }

    @Test
    fun refreshesWhenExpired() {
        assertTrue(AccessTokenTtl.needsRefresh(1_000L, 1_001L))
        assertFalse(AccessTokenTtl.needsRefresh(2_000L, 1_000L))
    }

    @Test
    fun appliesSkewBeforeExpiry() {
        val expires = AccessTokenTtl.accessExpiresAtEpochMs("15m", 0L)
        assertEquals(15L * 60L * 1000L - AccessTokenTtl.REFRESH_SKEW_MS, expires)
    }
}
