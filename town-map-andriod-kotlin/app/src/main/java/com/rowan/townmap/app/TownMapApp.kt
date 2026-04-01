package com.rowan.townmap.app

import android.app.Application
import com.mapbox.common.MapboxOptions
import com.rowan.townmap.R
import com.rowan.townmap.feature.map.MapboxAccess

class TownMapApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val token = MapboxAccess.token.takeIf { it.isNotBlank() }
            ?: getString(R.string.mapbox_access_token)
        MapboxOptions.accessToken = token
    }
}
