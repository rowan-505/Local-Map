package com.coremapmm.fieldsurveyor.data

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `local_reports` ADD COLUMN `lastError` TEXT")
        db.execSQL(
            """
            UPDATE `local_reports` SET `status` = CASE
              WHEN `status` IN ('draft', 'queued') THEN 'QUEUED'
              WHEN `status` = 'failed' THEN 'RETRY'
              WHEN `status` = 'synced' THEN 'SYNCED'
              ELSE `status`
            END
            """.trimIndent(),
        )
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_report_media` (
              `mediaPublicId` TEXT NOT NULL,
              `reportClientPublicId` TEXT NOT NULL,
              `localPath` TEXT NOT NULL,
              `mimeType` TEXT NOT NULL,
              `byteSize` INTEGER NOT NULL,
              `syncState` TEXT NOT NULL,
              `remoteAssetPublicId` TEXT,
              `createdAtEpochMs` INTEGER NOT NULL,
              `updatedAtEpochMs` INTEGER NOT NULL,
              `lastError` TEXT,
              PRIMARY KEY(`mediaPublicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_report_media_reportClientPublicId` ON `local_report_media` (`reportClientPublicId`)",
        )
    }
}
