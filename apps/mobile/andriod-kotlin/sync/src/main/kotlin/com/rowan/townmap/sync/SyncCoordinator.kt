package com.rowan.townmap.sync

import com.rowan.townmap.sync.offline.NoOpOfflineRegionManager
import com.rowan.townmap.sync.offline.OfflineRegionManager
import com.rowan.townmap.sync.scheduler.DataRefreshScheduler
import com.rowan.townmap.sync.scheduler.NoOpDataRefreshScheduler

/**
 * Future orchestration point for on-demand / periodic refresh and offline region state.
 * Wire real implementations when network sync and map SDK offline APIs are added.
 */
class SyncCoordinator(
    val dataRefreshScheduler: DataRefreshScheduler = NoOpDataRefreshScheduler,
    val offlineRegionManager: OfflineRegionManager = NoOpOfflineRegionManager
)
