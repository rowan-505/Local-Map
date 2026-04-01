package com.rowan.townmap.feature.places.data

import com.rowan.townmap.core.database.PlaceDao
import com.rowan.townmap.core.database.toEntity
import com.rowan.townmap.core.database.toPlace
import com.rowan.townmap.core.model.Place
import com.rowan.townmap.feature.places.domain.PlacesRepository

class PlacesRepositoryImpl(
    private val placeDao: PlaceDao
) : PlacesRepository {

    override suspend fun getPlace(id: String): Place? =
        placeDao.getById(id)?.toPlace()

    override suspend fun getPlaces(): List<Place> =
        placeDao.getAll().map { it.toPlace() }

    override suspend fun savePlace(place: Place) {
        placeDao.upsert(place.toEntity())
    }
}
