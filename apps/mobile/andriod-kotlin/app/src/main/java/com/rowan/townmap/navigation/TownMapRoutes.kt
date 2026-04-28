package com.rowan.townmap.navigation

import android.net.Uri

object TownMapRoutes {
    const val MAP = "map"
    const val SEARCH = "search"
    const val PLACE_DETAIL = "place/{placeId}"
    const val SETTINGS = "settings"

    const val PLACE_ID_ARG = "placeId"

    /** Encodes [placeId] so values like `node/123` work as a single path segment. */
    fun placeDetail(placeId: String): String = "place/${Uri.encode(placeId)}"
}
