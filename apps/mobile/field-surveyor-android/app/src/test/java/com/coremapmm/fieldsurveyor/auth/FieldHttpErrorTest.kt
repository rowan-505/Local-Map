package com.coremapmm.fieldsurveyor.auth

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.ConnectException

class FieldHttpErrorTest {
    @Test
    fun includesBaseUrlAndCause() {
        val message = FieldHttpError.formatUnreachable(
            ConnectException("Failed to connect to /192.168.1.10:3001"),
            "http://192.168.1.10:3001",
        )
        assertTrue(message.contains("http://192.168.1.10:3001"))
        assertTrue(message.contains("Failed to connect"))
    }

    @Test
    fun fallsBackToExceptionNameWhenMessageBlank() {
        val message = FieldHttpError.formatUnreachable(IOException("  "), "http://10.0.2.2:3001")
        assertTrue(message.contains("IOException"))
        assertTrue(message.contains("http://10.0.2.2:3001"))
    }
}
