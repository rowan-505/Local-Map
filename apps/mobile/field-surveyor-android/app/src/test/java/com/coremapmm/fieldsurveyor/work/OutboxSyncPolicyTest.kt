package com.coremapmm.fieldsurveyor.work

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException

class OutboxSyncPolicyTest {
    @Test
    fun successIncludesIdempotentReplay() {
        assertTrue(OutboxSyncPolicy.classifyHttp(201, "{}") is OutboxHttpResult.Success)
        assertTrue(OutboxSyncPolicy.classifyHttp(200, "{}") is OutboxHttpResult.Success)
    }

    @Test
    fun validationDoesNotRetryForever() {
        assertTrue(OutboxSyncPolicy.classifyHttp(400, "Invalid") is OutboxHttpResult.Permanent)
        assertTrue(OutboxSyncPolicy.classifyHttp(409, "conflict") is OutboxHttpResult.Permanent)
        assertTrue(OutboxSyncPolicy.classifyHttp(422, "unprocessable") is OutboxHttpResult.Permanent)
    }

    @Test
    fun timeoutAndServerErrorsAreTransient() {
        assertTrue(OutboxSyncPolicy.classifyHttp(408, "") is OutboxHttpResult.Transient)
        assertTrue(OutboxSyncPolicy.classifyHttp(429, "") is OutboxHttpResult.Transient)
        assertTrue(OutboxSyncPolicy.classifyHttp(500, "") is OutboxHttpResult.Transient)
        assertTrue(OutboxSyncPolicy.classifyThrowable(SocketTimeoutException("timeout before POST")) is OutboxHttpResult.Transient)
        assertTrue(OutboxSyncPolicy.classifyThrowable(IOException("offline")) is OutboxHttpResult.Transient)
    }
}
