package com.rowan.townmap.feature.places.data.dev

import com.rowan.townmap.core.model.Place
import com.rowan.townmap.feature.places.domain.PlacesRepository

class DevPlacesRepository(
    private val dataSource: DevPlacesDataSource = DevPlacesDataSource
) : PlacesRepository {

    override suspend fun getPlace(id: String): Place? =
        dataSource.all().find { it.id == id }

    override suspend fun getPlaces(): List<Place> =
        dataSource.all()

    override suspend fun savePlace(place: Place) {}
}
