package com.rowan.townmap.sync.scheduler

/**
 * Schedules data refresh (places, metadata, etc.). Replace [NoOpDataRefreshScheduler] with an
 * implementation that enqueues work (e.g. WorkManager) when backend sync exists.
 */
interface DataRefreshScheduler {

    /** Request a single refresh run as soon as constraints allow. */
    fun enqueueOnDemandRefresh()
}

object NoOpDataRefreshScheduler : DataRefreshScheduler {
    override fun enqueueOnDemandRefresh() = Unit
}
