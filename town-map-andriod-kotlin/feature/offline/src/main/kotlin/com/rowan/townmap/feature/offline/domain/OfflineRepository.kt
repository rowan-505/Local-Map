package com.rowan.townmap.feature.offline.domain

import com.rowan.townmap.core.model.OfflineRegion

interface OfflineRepository {

    suspend fun getRegions(): List<OfflineRegion>

    suspend fun upsertRegion(region: OfflineRegion)
}
