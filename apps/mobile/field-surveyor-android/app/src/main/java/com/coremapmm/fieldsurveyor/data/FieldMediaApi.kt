package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.auth.AuthJson
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import com.coremapmm.fieldsurveyor.work.OutboxSyncPolicy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

data class MediaUploadIntent(
    val publicId: String,
    val putUrl: String,
    val contentType: String,
    val contentLength: String,
)

class FieldMediaApi(
    private val baseUrl: String,
    http: OkHttpClient,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = http.newBuilder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .callTimeout(180, TimeUnit.SECONDS)
        .build()

    fun createUpload(accessToken: String, mimeType: String, byteSize: Long): MediaApiResult<MediaUploadIntent> {
        val mediaType = if (mimeType.startsWith("audio/")) "audio" else "image"
        val body = JSONObject()
            .put("mediaType", mediaType)
            .put("mimeType", mimeType)
            .put("byteSize", byteSize)
            .toString()
        val request = jsonPost("/media/uploads", accessToken, body)
        return executeJson(request) { json ->
            val upload = json.getJSONObject("upload")
            val headers = upload.getJSONObject("headers")
            MediaUploadIntent(
                publicId = json.getString("publicId"),
                putUrl = upload.getString("url"),
                contentType = headers.optString("Content-Type", "image/jpeg"),
                contentLength = headers.optString("Content-Length", byteSize.toString()),
            )
        }
    }

    fun putObject(intent: MediaUploadIntent, file: File): OutboxHttpResult {
        val mediaType = intent.contentType.toMediaType()
        val request = Request.Builder()
            .url(intent.putUrl)
            .put(file.asRequestBody(mediaType))
            .header("Content-Type", intent.contentType)
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return OutboxSyncPolicy.classifyThrowable(error)
        }
        response.use { httpResponse ->
            val body = httpResponse.body?.string().orEmpty()
            return when (httpResponse.code) {
                in 200..299 -> OutboxHttpResult.Success(httpResponse.code)
                400, 403 -> OutboxHttpResult.Transient(httpResponse.code, "expired or rejected PUT")
                else -> OutboxSyncPolicy.classifyHttp(httpResponse.code, body)
            }
        }
    }

    fun complete(accessToken: String, publicId: String): MediaApiResult<Unit> {
        val request = jsonPost("/media/$publicId/complete", accessToken, "")
        return executeJson(request) { }
    }

    fun attach(accessToken: String, reportPublicId: String, assetPublicId: String): MediaApiResult<Unit> {
        val body = JSONObject().put("assetPublicId", assetPublicId).toString()
        val request = jsonPost("/field/reports/$reportPublicId/media", accessToken, body)
        return executeJson(request) { }
    }

    private fun jsonPost(path: String, accessToken: String, jsonBody: String): Request {
        val requestBody = (jsonBody.ifBlank { "{}" }).toRequestBody(jsonType)
        return Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .post(requestBody)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .build()
    }

    private fun <T> executeJson(request: Request, parse: (JSONObject) -> T): MediaApiResult<T> {
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return MediaApiResult.Http(OutboxSyncPolicy.classifyThrowable(error))
        }
        response.use { httpResponse ->
            val body = httpResponse.body?.string().orEmpty()
            if (httpResponse.code == 401) {
                throw AuthException("Session expired", 401)
            }
            if (httpResponse.code == 409 && request.url.encodedPath.contains("/media/")) {
                val code = runCatching { JSONObject(body).optString("code") }.getOrDefault("")
                if (code == "OBJECT_SIZE_MISMATCH" || code == "OBJECT_TYPE_MISMATCH") {
                    return MediaApiResult.NeedNewUpload(AuthJson.errorMessage(body, code))
                }
            }
            if (httpResponse.code == 400) {
                val code = runCatching { JSONObject(body).optString("code") }.getOrDefault("")
                if (code == "OBJECT_NOT_FOUND") {
                    return MediaApiResult.NeedNewUpload(AuthJson.errorMessage(body, code))
                }
            }
            if (httpResponse.code == 409 && request.url.encodedPath.contains("/field/reports/")) {
                return MediaApiResult.Ok(parse(if (body.isBlank()) JSONObject() else JSONObject(body)))
            }
            return when (val classified = OutboxSyncPolicy.classifyHttp(httpResponse.code, body)) {
                is OutboxHttpResult.Success -> {
                    val json = if (body.isBlank()) JSONObject() else JSONObject(body)
                    MediaApiResult.Ok(parse(json))
                }
                else -> MediaApiResult.Http(classified)
            }
        }
    }
}

sealed class MediaApiResult<out T> {
    data class Ok<T>(val value: T) : MediaApiResult<T>()
    data class NeedNewUpload(val message: String) : MediaApiResult<Nothing>()
    data class Http(val result: OutboxHttpResult) : MediaApiResult<Nothing>()
}
