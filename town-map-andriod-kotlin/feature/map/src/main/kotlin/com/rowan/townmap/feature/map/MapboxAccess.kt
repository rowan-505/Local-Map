package com.rowan.townmap.feature.map

/**
 * Mapbox access token from `MAPBOX_ACCESS_TOKEN` in `local.properties` (wired via [BuildConfig]).
 * Do not commit real tokens; copy `local.properties.example` to `local.properties` and set the value there.
 */
object MapboxAccess {
    val token: String
        get() = BuildConfig.MAPBOX_ACCESS_TOKEN

    val isConfigured: Boolean
        get() = token.isNotBlank()

    /**
     * Use when Mapbox must be initialized; fails fast if the token was not set at build time.
     */
    fun requireToken(): String =
        token.ifBlank {
            error(
                "MAPBOX_ACCESS_TOKEN is missing. Add it to local.properties (see local.properties.example)."
            )
        }
}
