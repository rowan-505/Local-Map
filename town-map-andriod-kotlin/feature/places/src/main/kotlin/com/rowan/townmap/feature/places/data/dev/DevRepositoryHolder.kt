package com.rowan.townmap.feature.places.data.dev

import com.rowan.townmap.feature.places.domain.PlacesRepository

object DevRepositoryHolder {
    val places: PlacesRepository by lazy { DevPlacesRepository() }
}
