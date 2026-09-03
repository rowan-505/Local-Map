package com.coremapmm.fieldsurveyor.data.transport

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.auth.FieldHttpError
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

class FieldBootstrapApi(
    private val baseUrl: String,
    private val http: OkHttpClient,
) {
    fun fetch(accessToken: String, localRevision: String?): BootstrapPayload {
        val urlBuilder = (baseUrl.trimEnd('/') + "/field/bootstrap").toHttpUrl().newBuilder()
        if (!localRevision.isNullOrBlank()) {
            urlBuilder.addQueryParameter("revision", localRevision)
        }
        val response = try {
            http.newCall(
                Request.Builder()
                    .url(urlBuilder.build())
                    .get()
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer $accessToken")
                    .build(),
            ).execute()
        } catch (error: IOException) {
            throw FieldHttpError.unreachable(error, baseUrl, "bootstrap")
        }
        response.use { httpResponse ->
            val body = httpResponse.body?.string().orEmpty()
            if (httpResponse.code == 401) {
                throw AuthException("Session expired", 401)
            }
            if (httpResponse.code == 403) {
                throw AuthException("Field survey access requires the surveyor role.", 403)
            }
            if (!httpResponse.isSuccessful) {
                throw SnapshotParseException("Bootstrap failed (${httpResponse.code})")
            }
            return BootstrapJson.parseResponse(body)
        }
    }
}
