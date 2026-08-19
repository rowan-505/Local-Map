package com.coremapmm.app.core.fake

import com.coremapmm.app.core.model.OfflineAreaType
import com.coremapmm.app.core.model.OfflinePackageStatus
import com.coremapmm.app.core.model.OfflinePackageType
import com.coremapmm.app.core.model.OfflinePackageUiModel

object FakeOfflinePackages {
    val packages: List<OfflinePackageUiModel> = listOf(
        OfflinePackageUiModel(
            id = "offline-kyauktan-township-lite",
            areaName = "Kyauktan Township",
            areaType = OfflineAreaType.Township,
            packageType = OfflinePackageType.Lite,
            fileSizeText = "48 MB",
            downloadedDateText = "14 Jun 2026",
            latestUpdateDateText = "28 Jun 2026",
            lastUpdatedText = "Latest update 28 Jun 2026",
            status = OfflinePackageStatus.Downloaded,
            warningText = null,
        ),
        OfflinePackageUiModel(
            id = "offline-yangon-region-lite",
            areaName = "Yangon Region",
            areaType = OfflineAreaType.Region,
            packageType = OfflinePackageType.Lite,
            fileSizeText = "340 MB",
            downloadedDateText = "2 May 2026",
            latestUpdateDateText = "18 Jun 2026",
            lastUpdatedText = "Latest update 18 Jun 2026",
            status = OfflinePackageStatus.UpdateAvailable,
            warningText = "New roads added in Thanlyin area",
        ),
        OfflinePackageUiModel(
            id = "offline-thanlyin-district-standard",
            areaName = "Thanlyin District",
            areaType = OfflineAreaType.Township,
            packageType = OfflinePackageType.Standard,
            fileSizeText = "210 MB",
            downloadedDateText = "8 Jun 2026",
            latestUpdateDateText = "8 Jun 2026",
            lastUpdatedText = "Latest update 8 Jun 2026",
            status = OfflinePackageStatus.Downloaded,
            warningText = null,
        ),
        OfflinePackageUiModel(
            id = "offline-kyauktan-township-full",
            areaName = "Kyauktan Township",
            areaType = OfflineAreaType.Township,
            packageType = OfflinePackageType.Full,
            fileSizeText = "240 MB",
            downloadedDateText = null,
            latestUpdateDateText = null,
            lastUpdatedText = "Downloading… 62%",
            status = OfflinePackageStatus.Downloading,
            warningText = "Wi-Fi recommended while downloading",
        ),
    )

    fun byId(packageId: String): OfflinePackageUiModel? = packages.find { it.id == packageId }
}
