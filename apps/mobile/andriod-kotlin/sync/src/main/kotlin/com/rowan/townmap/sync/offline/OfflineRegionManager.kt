package com.rowan.townmap.sync.offline

/**
 * Abstraction for downloadable map regions and related local bundles (places, tiles metadata).
 * Map SDK–specific code should sit behind this type for easier testing and swapping providers.
 */
interface OfflineRegionManager {

    /** Stable ids for regions already available on device (empty until implemented). */
    suspend fun installedRegionIds(): Set<String>
}

object NoOpOfflineRegionManager : OfflineRegionManager {
    override suspend fun installedRegionIds(): Set<String> = emptySet()
}
