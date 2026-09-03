package com.coremapmm.fieldsurveyor.auth

const val FIELD_SURVEYOR_ROLE = "surveyor"

data class AuthUser(
    val id: String,
    val publicId: String,
    val email: String,
    val displayName: String,
    val roles: List<String>,
) {
    val isFieldSurveyor: Boolean get() = roles.contains(FIELD_SURVEYOR_ROLE)
}

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAtEpochMs: Long,
    val user: AuthUser,
)

data class SessionResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: String,
    val user: AuthUser,
)

class AuthException(message: String, val statusCode: Int? = null) : Exception(message)
