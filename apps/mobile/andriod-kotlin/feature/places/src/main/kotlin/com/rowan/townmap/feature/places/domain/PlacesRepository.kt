package com.rowan.townmap.feature.places.domain

import com.rowan.townmap.core.model.Place

interface PlacesRepository {

    suspend fun getPlace(id: String): Place?

    suspend fun getPlaces(): List<Place>

    suspend fun savePlace(place: Place)
}
