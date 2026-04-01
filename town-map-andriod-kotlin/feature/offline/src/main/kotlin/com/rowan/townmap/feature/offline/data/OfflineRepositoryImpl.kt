package com.rowan.townmap.feature.offline.data

import com.rowan.townmap.core.model.OfflineRegion
import com.rowan.townmap.feature.offline.domain.OfflineRepository

class OfflineRepositoryImpl : OfflineRepository {

    private val lock = Any()
    private val regionsById = LinkedHashMap<String, OfflineRegion>()

    override suspend fun getRegions(): List<OfflineRegion> = synchronized(lock) {
        regionsById.values.toList()
    }

    override suspend fun upsertRegion(region: OfflineRegion) = synchronized(lock) {
        regionsById[region.id] = region
    }
}
