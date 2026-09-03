package com.coremapmm.fieldsurveyor.auth

import org.json.JSONArray
import org.json.JSONObject

object AuthJson {
    fun sessionFromBody(body: String): SessionResponse {
        val root = JSONObject(body)
        val userJson = root.getJSONObject("user")
        val rolesJson = userJson.optJSONArray("roles") ?: JSONArray()
        val roles = buildList {
            for (i in 0 until rolesJson.length()) {
                add(rolesJson.getString(i))
            }
        }
        return SessionResponse(
            accessToken = root.getString("accessToken"),
            refreshToken = root.getString("refreshToken"),
            expiresIn = root.optString("expiresIn", "15m"),
            user = AuthUser(
                id = userJson.getString("id"),
                publicId = userJson.getString("public_id"),
                email = userJson.getString("email"),
                displayName = userJson.getString("display_name"),
                roles = roles,
            ),
        )
    }

    fun loginBody(email: String, password: String): String {
        return JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .toString()
    }

    fun refreshBody(refreshToken: String): String {
        return JSONObject().put("refreshToken", refreshToken).toString()
    }

    fun errorMessage(body: String?, fallback: String): String {
        if (body.isNullOrBlank()) {
            return fallback
        }
        return runCatching { JSONObject(body).optString("message").takeIf { it.isNotBlank() } }
            .getOrNull() ?: fallback
    }

    fun userToJson(user: AuthUser): String {
        val roles = JSONArray()
        user.roles.forEach { roles.put(it) }
        return JSONObject()
            .put("id", user.id)
            .put("public_id", user.publicId)
            .put("email", user.email)
            .put("display_name", user.displayName)
            .put("roles", roles)
            .toString()
    }

    fun userFromJson(json: String): AuthUser {
        val userJson = JSONObject(json)
        val rolesJson = userJson.optJSONArray("roles") ?: JSONArray()
        val roles = buildList {
            for (i in 0 until rolesJson.length()) {
                add(rolesJson.getString(i))
            }
        }
        return AuthUser(
            id = userJson.getString("id"),
            publicId = userJson.getString("public_id"),
            email = userJson.getString("email"),
            displayName = userJson.getString("display_name"),
            roles = roles,
        )
    }
}
