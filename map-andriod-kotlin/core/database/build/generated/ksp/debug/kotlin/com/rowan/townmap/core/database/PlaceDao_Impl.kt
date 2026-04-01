package com.rowan.townmap.core.database

import androidx.room.EntityInsertAdapter
import androidx.room.RoomDatabase
import androidx.room.util.getColumnIndexOrThrow
import androidx.room.util.performSuspending
import androidx.sqlite.SQLiteStatement
import javax.`annotation`.processing.Generated
import kotlin.Double
import kotlin.Int
import kotlin.String
import kotlin.Suppress
import kotlin.Unit
import kotlin.collections.List
import kotlin.collections.MutableList
import kotlin.collections.mutableListOf
import kotlin.reflect.KClass

@Generated(value = ["androidx.room.RoomProcessor"])
@Suppress(names = ["UNCHECKED_CAST", "DEPRECATION", "REDUNDANT_PROJECTION", "REMOVAL"])
public class PlaceDao_Impl(
  __db: RoomDatabase,
) : PlaceDao {
  private val __db: RoomDatabase

  private val __insertAdapterOfPlaceEntity: EntityInsertAdapter<PlaceEntity>
  init {
    this.__db = __db
    this.__insertAdapterOfPlaceEntity = object : EntityInsertAdapter<PlaceEntity>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `places` (`id`,`name`,`latitude`,`longitude`,`category`,`details`) VALUES (?,?,?,?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: PlaceEntity) {
        statement.bindText(1, entity.id)
        statement.bindText(2, entity.name)
        statement.bindDouble(3, entity.latitude)
        statement.bindDouble(4, entity.longitude)
        statement.bindText(5, entity.category)
        statement.bindText(6, entity.details)
      }
    }
  }

  public override suspend fun upsert(entity: PlaceEntity): Unit = performSuspending(__db, false,
      true) { _connection ->
    __insertAdapterOfPlaceEntity.insert(_connection, entity)
  }

  public override suspend fun getById(id: String): PlaceEntity? {
    val _sql: String = "SELECT * FROM places WHERE id = ? LIMIT 1"
    return performSuspending(__db, true, false) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindText(_argIndex, id)
        val _columnIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _columnIndexOfName: Int = getColumnIndexOrThrow(_stmt, "name")
        val _columnIndexOfLatitude: Int = getColumnIndexOrThrow(_stmt, "latitude")
        val _columnIndexOfLongitude: Int = getColumnIndexOrThrow(_stmt, "longitude")
        val _columnIndexOfCategory: Int = getColumnIndexOrThrow(_stmt, "category")
        val _columnIndexOfDetails: Int = getColumnIndexOrThrow(_stmt, "details")
        val _result: PlaceEntity?
        if (_stmt.step()) {
          val _tmpId: String
          _tmpId = _stmt.getText(_columnIndexOfId)
          val _tmpName: String
          _tmpName = _stmt.getText(_columnIndexOfName)
          val _tmpLatitude: Double
          _tmpLatitude = _stmt.getDouble(_columnIndexOfLatitude)
          val _tmpLongitude: Double
          _tmpLongitude = _stmt.getDouble(_columnIndexOfLongitude)
          val _tmpCategory: String
          _tmpCategory = _stmt.getText(_columnIndexOfCategory)
          val _tmpDetails: String
          _tmpDetails = _stmt.getText(_columnIndexOfDetails)
          _result = PlaceEntity(_tmpId,_tmpName,_tmpLatitude,_tmpLongitude,_tmpCategory,_tmpDetails)
        } else {
          _result = null
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun getAll(): List<PlaceEntity> {
    val _sql: String = "SELECT * FROM places"
    return performSuspending(__db, true, false) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _columnIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _columnIndexOfName: Int = getColumnIndexOrThrow(_stmt, "name")
        val _columnIndexOfLatitude: Int = getColumnIndexOrThrow(_stmt, "latitude")
        val _columnIndexOfLongitude: Int = getColumnIndexOrThrow(_stmt, "longitude")
        val _columnIndexOfCategory: Int = getColumnIndexOrThrow(_stmt, "category")
        val _columnIndexOfDetails: Int = getColumnIndexOrThrow(_stmt, "details")
        val _result: MutableList<PlaceEntity> = mutableListOf()
        while (_stmt.step()) {
          val _item: PlaceEntity
          val _tmpId: String
          _tmpId = _stmt.getText(_columnIndexOfId)
          val _tmpName: String
          _tmpName = _stmt.getText(_columnIndexOfName)
          val _tmpLatitude: Double
          _tmpLatitude = _stmt.getDouble(_columnIndexOfLatitude)
          val _tmpLongitude: Double
          _tmpLongitude = _stmt.getDouble(_columnIndexOfLongitude)
          val _tmpCategory: String
          _tmpCategory = _stmt.getText(_columnIndexOfCategory)
          val _tmpDetails: String
          _tmpDetails = _stmt.getText(_columnIndexOfDetails)
          _item = PlaceEntity(_tmpId,_tmpName,_tmpLatitude,_tmpLongitude,_tmpCategory,_tmpDetails)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun deleteById(id: String) {
    val _sql: String = "DELETE FROM places WHERE id = ?"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindText(_argIndex, id)
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public companion object {
    public fun getRequiredConverters(): List<KClass<*>> = emptyList()
  }
}
