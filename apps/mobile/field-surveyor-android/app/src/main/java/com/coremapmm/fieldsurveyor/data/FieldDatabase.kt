package com.coremapmm.fieldsurveyor.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.coremapmm.fieldsurveyor.data.transport.CacheMetadataEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRouteEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRoutePathEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRouteStopEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheStopEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheVariantEntity
import com.coremapmm.fieldsurveyor.data.transport.MIGRATION_1_2
import com.coremapmm.fieldsurveyor.data.transport.TransportCacheDao
import java.io.File

@Database(
    entities = [
        LocalReportEntity::class,
        LocalReportMediaEntity::class,
        CacheRouteEntity::class,
        CacheVariantEntity::class,
        CacheStopEntity::class,
        CacheRouteStopEntity::class,
        CacheRoutePathEntity::class,
        CacheMetadataEntity::class,
    ],
    version = 4,
    exportSchema = false,
)
abstract class FieldDatabase : RoomDatabase() {
    abstract fun localReportDao(): LocalReportDao
    abstract fun localReportMediaDao(): LocalReportMediaDao
    abstract fun transportCacheDao(): TransportCacheDao

    companion object {
        const val FILE_NAME = "field.db"

        fun create(context: Context): FieldDatabase {
            val app = context.applicationContext
            val file = File(app.noBackupFilesDir, FILE_NAME)
            return Room.databaseBuilder(app, FieldDatabase::class.java, file.absolutePath)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()
        }
    }
}
