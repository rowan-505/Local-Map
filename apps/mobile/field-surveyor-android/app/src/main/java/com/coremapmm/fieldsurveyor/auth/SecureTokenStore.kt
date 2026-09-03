package com.coremapmm.fieldsurveyor.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Access and refresh tokens live in EncryptedSharedPreferences (Android Keystore AES-256).
 * Never use plain SharedPreferences for these values.
 */
class SecureTokenStore(context: Context) {
    private val prefs: SharedPreferences = createPrefs(context.applicationContext)

    fun load(): AuthSession? {
        val access = prefs.getString(KEY_ACCESS, null) ?: return null
        val refresh = prefs.getString(KEY_REFRESH, null) ?: return null
        val userJson = prefs.getString(KEY_USER, null) ?: return null
        val expires = prefs.getLong(KEY_EXPIRES, 0L)
        if (access.isBlank() || refresh.isBlank() || expires <= 0L) {
            return null
        }
        return runCatching {
            AuthSession(
                accessToken = access,
                refreshToken = refresh,
                accessExpiresAtEpochMs = expires,
                user = AuthJson.userFromJson(userJson),
            )
        }.getOrNull()
    }

    fun save(session: AuthSession) {
        prefs.edit()
            .putString(KEY_ACCESS, session.accessToken)
            .putString(KEY_REFRESH, session.refreshToken)
            .putLong(KEY_EXPIRES, session.accessExpiresAtEpochMs)
            .putString(KEY_USER, AuthJson.userToJson(session.user))
            .apply()
    }

    /** Clears credentials only. Does not touch Room drafts or PMTiles files. */
    fun clearCredentials() {
        prefs.edit().clear().apply()
    }

    companion object {
        const val PREFS_FILE = "field_auth_prefs"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_EXPIRES = "access_expires_at"
        private const val KEY_USER = "user_json"

        private fun createPrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}
