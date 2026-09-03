package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import com.coremapmm.fieldsurveyor.work.OutboxSyncPolicy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class FieldReportsApi(
    private val baseUrl: String,
    http: OkHttpClient,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = http.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    fun create(accessToken: String, jsonBody: String): OutboxHttpResult {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/field/reports")
            .post(jsonBody.toRequestBody(jsonType))
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return OutboxSyncPolicy.classifyThrowable(error)
        }
        response.use { httpResponse ->
            val body = httpResponse.body?.string().orEmpty()
            if (httpResponse.code == 401) {
                throw AuthException("Session expired", 401)
            }
            return OutboxSyncPolicy.classifyHttp(httpResponse.code, body)
        }
    }
}
