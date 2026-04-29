package com.rowan.townmap.core.database

import com.rowan.townmap.core.model.Place

fun PlaceEntity.toPlace(): Place = Place(
    id = id,
    name = name,
    latitude = latitude,
    longitude = longitude,
    category = category,
    details = details
)

fun Place.toEntity(): PlaceEntity = PlaceEntity(
    id = id,
    name = name,
    latitude = latitude,
    longitude = longitude,
    category = category,
    details = details
)
