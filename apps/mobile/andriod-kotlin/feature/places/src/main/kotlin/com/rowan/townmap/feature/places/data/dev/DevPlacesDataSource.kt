package com.rowan.townmap.feature.places.data.dev

import com.rowan.townmap.core.model.Place

object DevPlacesDataSource {

    private const val LAT = 43.6591
    private const val LNG = -70.2568

    fun all(): List<Place> = listOf(
        Place(
            id = "place_town_hall",
            name = "Riverton Town Hall",
            latitude = LAT + 0.001,
            longitude = LNG - 0.0005,
            category = "Civic",
            details = "1 River Road — municipal offices and visitor information"
        ),
        Place(
            id = "place_library",
            name = "Riverton Public Library",
            latitude = LAT - 0.0008,
            longitude = LNG + 0.0011,
            category = "Library",
            details = "120 Maple Ave — books, Wi‑Fi, and community programs"
        ),
        Place(
            id = "place_founders_park",
            name = "Founders Park",
            latitude = LAT + 0.0015,
            longitude = LNG + 0.0006,
            category = "Park",
            details = "Green space, playground, and seasonal events"
        ),
        Place(
            id = "place_main_cafe",
            name = "Main Street Cafe",
            latitude = LAT - 0.0004,
            longitude = LNG - 0.0012,
            category = "Food & drink",
            details = "214 Main St — coffee, lunch, and local baked goods"
        ),
        Place(
            id = "place_transit_hub",
            name = "Riverton Transit Hub",
            latitude = LAT + 0.0002,
            longitude = LNG + 0.0014,
            category = "Transit",
            details = "Bay platforms for regional bus and shuttle connections"
        ),
        Place(
            id = "place_market",
            name = "Saturday Farmers Market",
            latitude = LAT - 0.0012,
            longitude = LNG - 0.0003,
            category = "Market",
            details = "Open-air stalls — produce, crafts, April through October"
        )
    )
}
