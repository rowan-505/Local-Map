package com.coremapmm.fieldsurveyor.work

sealed class OutboxHttpResult {
    data class Success(val httpCode: Int) : OutboxHttpResult()
    data class Permanent(val httpCode: Int, val message: String) : OutboxHttpResult()
    data class Transient(val httpCode: Int?, val message: String) : OutboxHttpResult()
}

object OutboxSyncPolicy {
    fun classifyHttp(code: Int, body: String): OutboxHttpResult {
        return when (code) {
            200, 201 -> OutboxHttpResult.Success(code)
            400, 403, 404, 409, 422 -> OutboxHttpResult.Permanent(code, messageOf(body, code))
            else -> OutboxHttpResult.Transient(code, messageOf(body, code))
        }
    }

    fun classifyThrowable(error: Throwable): OutboxHttpResult {
        return OutboxHttpResult.Transient(null, error.message ?: error.javaClass.simpleName)
    }

    fun nextStatus(result: OutboxHttpResult): String {
        return when (result) {
            is OutboxHttpResult.Success -> com.coremapmm.fieldsurveyor.data.LocalReportEntity.STATUS_SYNCED
            is OutboxHttpResult.Permanent -> com.coremapmm.fieldsurveyor.data.LocalReportEntity.STATUS_PERMANENT_ERROR
            is OutboxHttpResult.Transient -> com.coremapmm.fieldsurveyor.data.LocalReportEntity.STATUS_RETRY
        }
    }

    private fun messageOf(body: String, code: Int): String {
        val trimmed = body.trim()
        if (trimmed.isEmpty()) {
            return "HTTP $code"
        }
        return trimmed.take(300)
    }
}
