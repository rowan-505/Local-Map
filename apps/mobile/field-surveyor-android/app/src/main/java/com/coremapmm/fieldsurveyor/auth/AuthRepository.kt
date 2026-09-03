package com.coremapmm.fieldsurveyor.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Login, refresh-token rotation, and logout against CoreMap auth HTTP routes.
 *
 * Logout always clears Keystore-backed credentials. It never deletes Room
 * drafts or local GPS/report rows. See README logout section.
 */
class AuthRepository(
    private val api: AuthApi,
    private val tokenStore: SecureTokenStore,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()
    private val sessionFlow = MutableStateFlow(tokenStore.load())
    val session: StateFlow<AuthSession?> = sessionFlow.asStateFlow()

    fun currentSession(): AuthSession? = sessionFlow.value

    suspend fun login(email: String, password: String) {
        val response = withContext(Dispatchers.IO) { api.login(email, password) }
        if (!response.user.isFieldSurveyor) {
            withContext(Dispatchers.IO) { api.logout(response.refreshToken) }
            throw AuthException("This account is not a field surveyor.")
        }
        persist(response.toSession(nowMs()))
    }

    /**
     * Returns a usable access token, rotating the refresh token when needed.
     * If refresh is rejected, credentials are cleared; local reports stay.
     */
    suspend fun validAccessToken(): String {
        mutex.withLock {
            val existing = sessionFlow.value ?: throw AuthException("Not signed in", 401)
            if (!AccessTokenTtl.needsRefresh(existing.accessExpiresAtEpochMs, nowMs())) {
                return existing.accessToken
            }
            return rotateRefresh(existing.refreshToken)
        }
    }

    suspend fun logout() {
        val refresh = sessionFlow.value?.refreshToken
        try {
            if (!refresh.isNullOrBlank()) {
                withContext(Dispatchers.IO) { api.logout(refresh) }
            }
        } finally {
            clearCredentialsOnly()
        }
    }

    fun clearCredentialsOnly() {
        tokenStore.clearCredentials()
        sessionFlow.value = null
    }

    private suspend fun rotateRefresh(refreshToken: String): String {
        val response = try {
            withContext(Dispatchers.IO) { api.refresh(refreshToken) }
        } catch (error: AuthException) {
            if (error.statusCode == 401) {
                clearCredentialsOnly()
            }
            throw error
        }
        val session = response.toSession(nowMs())
        persist(session)
        return session.accessToken
    }

    private fun persist(session: AuthSession) {
        tokenStore.save(session)
        sessionFlow.value = session
    }
}

fun SessionResponse.toSession(nowEpochMs: Long): AuthSession {
    return AuthSession(
        accessToken = accessToken,
        refreshToken = refreshToken,
        accessExpiresAtEpochMs = AccessTokenTtl.accessExpiresAtEpochMs(expiresIn, nowEpochMs),
        user = user,
    )
}