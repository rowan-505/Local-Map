package com.coremapmm.fieldsurveyor.auth

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * CoreMap Fastify auth endpoints: POST /auth/login, /auth/refresh, /auth/logout.
 * Refresh rotates the refresh token; the previous token is invalid after success.
 */
class AuthApi(
    private val baseUrl: String,
    private val http: OkHttpClient = defaultClient(),
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun login(email: String, password: String): SessionResponse {
        return postSession("/auth/login", AuthJson.loginBody(email, password))
    }

    fun refresh(refreshToken: String): SessionResponse {
        return postSession("/auth/refresh", AuthJson.refreshBody(refreshToken))
    }

    /**
     * Server logout is idempotent. Network failures are returned so the caller
     * can still clear local credentials.
     */
    fun logout(refreshToken: String): Result<Unit> {
        return runCatching {
            val response = http.newCall(
                Request.Builder()
                    .url(url("/auth/logout"))
                    .post(AuthJson.refreshBody(refreshToken).toRequestBody(jsonType))
                    .header("Accept", "application/json")
                    .build(),
            ).execute()
            response.use { httpResponse ->
                if (!httpResponse.isSuccessful && httpResponse.code != 401) {
                    val body = httpResponse.body?.string()
                    throw AuthException(
                        AuthJson.errorMessage(body, "Logout failed (${httpResponse.code})"),
                        httpResponse.code,
                    )
                }
            }
        }
    }

    private fun postSession(path: String, json: String): SessionResponse {
        val response = try {
            http.newCall(
                Request.Builder()
                    .url(url(path))
                    .post(json.toRequestBody(jsonType))
                    .header("Accept", "application/json")
                    .build(),
            ).execute()
        } catch (error: IOException) {
            throw FieldHttpError.unreachable(error, baseUrl)
        }
        response.use { httpResponse ->
            val body = httpResponse.body?.string().orEmpty()
            if (!httpResponse.isSuccessful) {
                throw AuthException(
                    AuthJson.errorMessage(body, "Request failed (${httpResponse.code})"),
                    httpResponse.code,
                )
            }
            return try {
                AuthJson.sessionFromBody(body)
            } catch (error: Exception) {
                throw AuthException("Unexpected auth response")
            }
        }
    }

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    companion object {
        fun defaultClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build()
        }
    }
}
