package com.rowan.townmap.feature.places.navigation

import com.rowan.townmap.core.model.Place
import java.util.concurrent.ConcurrentHashMap

/**
 * Holds a [Place] when navigating by id so detail can load OSM-backed rows that are not in the local dev DB.
 * Not a data cache: entries are removed after [consume].
 */
object PlaceNavigationStore {
    private val pending = ConcurrentHashMap<String, Place>()

    fun remember(place: Place) {
        pending[place.id] = place
    }

    fun consume(id: String): Place? = pending.remove(id)
}
