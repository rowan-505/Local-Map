package com.coremapmm.fieldsurveyor.data.transport

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_routes` (
              `publicId` TEXT NOT NULL,
              `routeCode` TEXT NOT NULL,
              `nameMy` TEXT,
              `nameEn` TEXT,
              PRIMARY KEY(`publicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_cache_routes_routeCode` ON `cache_routes` (`routeCode`)",
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_variants` (
              `publicId` TEXT NOT NULL,
              `routePublicId` TEXT NOT NULL,
              `variantCode` TEXT NOT NULL,
              `directionId` INTEGER NOT NULL,
              `originName` TEXT,
              `destinationName` TEXT,
              PRIMARY KEY(`publicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_cache_variants_routePublicId` ON `cache_variants` (`routePublicId`)",
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_stops` (
              `publicId` TEXT NOT NULL,
              `stopCode` TEXT,
              `nameMy` TEXT,
              `nameEn` TEXT,
              `lat` REAL NOT NULL,
              `lng` REAL NOT NULL,
              PRIMARY KEY(`publicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_route_stops` (
              `variantPublicId` TEXT NOT NULL,
              `stopPublicId` TEXT NOT NULL,
              `stopSequence` INTEGER NOT NULL,
              PRIMARY KEY(`variantPublicId`, `stopSequence`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_cache_route_stops_variantPublicId` ON `cache_route_stops` (`variantPublicId`)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_cache_route_stops_stopPublicId` ON `cache_route_stops` (`stopPublicId`)",
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_route_paths` (
              `variantPublicId` TEXT NOT NULL,
              `geometryJson` TEXT NOT NULL,
              PRIMARY KEY(`variantPublicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `cache_metadata` (
              `id` INTEGER NOT NULL,
              `snapshotRevision` TEXT NOT NULL,
              PRIMARY KEY(`id`)
            )
            """.trimIndent(),
        )
    }
}
