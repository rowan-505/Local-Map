package com.rowan.townmap.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [PlaceEntity::class],
    version = 2,
    exportSchema = false
)
abstract class TownMapDatabase : RoomDatabase() {

    abstract fun placeDao(): PlaceDao
}
