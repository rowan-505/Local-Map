package com.coremapmm.fieldsurveyor.auth

/**
 * Parses Fastify JWT `expiresIn` values such as `15m`, `60s`, `1h`.
 */
object AccessTokenTtl {
    const val DEFAULT_ACCESS_TTL_MS = 15L * 60L * 1000L
    const val REFRESH_SKEW_MS = 30_000L

    fun toMillis(expiresIn: String): Long {
        val trimmed = expiresIn.trim()
        if (trimmed.isEmpty()) {
            return DEFAULT_ACCESS_TTL_MS
        }
        val unit = trimmed.last()
        val amount = trimmed.dropLast(1).toLongOrNull() ?: return DEFAULT_ACCESS_TTL_MS
        if (amount <= 0L) {
            return DEFAULT_ACCESS_TTL_MS
        }
        return when (unit) {
            's', 'S' -> amount * 1000L
            'm', 'M' -> amount * 60L * 1000L
            'h', 'H' -> amount * 60L * 60L * 1000L
            else -> DEFAULT_ACCESS_TTL_MS
        }
    }

    fun accessExpiresAtEpochMs(expiresIn: String, nowEpochMs: Long): Long {
        val ttl = toMillis(expiresIn)
        return nowEpochMs + (ttl - REFRESH_SKEW_MS).coerceAtLeast(1_000L)
    }

    fun needsRefresh(expiresAtEpochMs: Long, nowEpochMs: Long): Boolean {
        return nowEpochMs >= expiresAtEpochMs
    }
}
