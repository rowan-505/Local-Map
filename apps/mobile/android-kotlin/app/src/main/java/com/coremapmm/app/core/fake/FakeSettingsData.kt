package com.coremapmm.app.core.fake

import com.coremapmm.app.core.model.OfflinePackageType
import com.coremapmm.app.feature.settings.OfflineAreaOption
import com.coremapmm.app.feature.settings.OfflineDownloadWarning
import com.coremapmm.app.feature.settings.OfflinePackageOption
import com.coremapmm.app.feature.settings.OfflineWarningKind
import com.coremapmm.app.feature.settings.ReportStatusFilter
import com.coremapmm.app.feature.settings.SettingsContributionUiModel
import com.coremapmm.app.feature.settings.SettingsReportUiModel
import com.coremapmm.app.feature.settings.SettingsService
import com.coremapmm.app.feature.settings.SettingsServiceItem

object FakeSettingsData {
    val services: List<SettingsServiceItem> = listOf(
        SettingsServiceItem(
            service = SettingsService.OfflineMaps,
            title = "Offline Maps",
            description = "Download areas for offline use",
        ),
        SettingsServiceItem(
            service = SettingsService.Reports,
            title = "Reports & Contributions",
            description = "Track issue reports and points",
        ),
        SettingsServiceItem(
            service = SettingsService.Points,
            title = "Points",
            description = "Contribution rewards history",
        ),
        SettingsServiceItem(
            service = SettingsService.DataSaver,
            title = "Data Saver",
            description = "Reduce mobile data usage",
        ),
        SettingsServiceItem(
            service = SettingsService.Language,
            title = "Language",
            description = "Myanmar and English labels",
        ),
        SettingsServiceItem(
            service = SettingsService.MapSettings,
            title = "Map Settings",
            description = "Layers, labels, and display",
        ),
        SettingsServiceItem(
            service = SettingsService.Help,
            title = "Help",
            description = "Guides, FAQ, and support",
        ),
    )

    private val packageSizes: Map<OfflineAreaOption, Map<OfflinePackageOption, String>> = mapOf(
        OfflineAreaOption.CurrentTownship to mapOf(
            OfflinePackageOption.Lite to "48 MB",
            OfflinePackageOption.Standard to "160 MB",
            OfflinePackageOption.Full to "240 MB",
        ),
        OfflineAreaOption.CurrentDistrict to mapOf(
            OfflinePackageOption.Lite to "95 MB",
            OfflinePackageOption.Standard to "210 MB",
            OfflinePackageOption.Full to "360 MB",
        ),
        OfflineAreaOption.CurrentRegion to mapOf(
            OfflinePackageOption.Lite to "340 MB",
            OfflinePackageOption.Standard to "580 MB",
            OfflinePackageOption.Full to "920 MB",
        ),
        OfflineAreaOption.SearchArea to mapOf(
            OfflinePackageOption.Lite to "—",
            OfflinePackageOption.Standard to "—",
            OfflinePackageOption.Full to "—",
        ),
    )

    fun packageSize(area: OfflineAreaOption, packageOption: OfflinePackageOption): String {
        return packageSizes[area]?.get(packageOption) ?: "—"
    }

    fun packageSizeMb(area: OfflineAreaOption, packageOption: OfflinePackageOption): Int? {
        val size = packageSize(area, packageOption)
        if (size == "—") return null
        return size.removeSuffix(" MB").toIntOrNull()
    }

    fun areaDisplayName(area: OfflineAreaOption): String = when (area) {
        OfflineAreaOption.CurrentTownship -> "Kyauktan Township"
        OfflineAreaOption.CurrentDistrict -> "Thanlyin District"
        OfflineAreaOption.CurrentRegion -> "Yangon Region"
        OfflineAreaOption.SearchArea -> "Search area"
    }

    fun packageSummaryLabel(
        area: OfflineAreaOption,
        packageOption: OfflinePackageOption,
    ): String {
        if (area == OfflineAreaOption.SearchArea) {
            return "Search area · choose on map"
        }
        return "${areaDisplayName(area)} ${packageLabel(packageOption)} · ${packageSize(area, packageOption)}"
    }

    fun offlineWarnings(
        area: OfflineAreaOption,
        packageOption: OfflinePackageOption,
    ): List<OfflineDownloadWarning> {
        if (area == OfflineAreaOption.SearchArea) {
            return listOf(
                OfflineDownloadWarning(
                    kind = OfflineWarningKind.Info,
                    message = "Select a map area before choosing a package size",
                ),
            )
        }

        val warnings = mutableListOf<OfflineDownloadWarning>()
        val sizeMb = packageSizeMb(area, packageOption)

        if (packageOption != OfflinePackageOption.Lite || (sizeMb ?: 0) >= 95) {
            warnings += OfflineDownloadWarning(
                kind = OfflineWarningKind.WifiRecommended,
                message = "Wi-Fi recommended for large downloads",
            )
        }

        if ((sizeMb ?: 0) > 100) {
            warnings += OfflineDownloadWarning(
                kind = OfflineWarningKind.MobileData,
                message = "Mobile data warning for packages over 100 MB",
            )
        }

        if (packageOption == OfflinePackageOption.Full || (sizeMb ?: 0) >= 360) {
            warnings += OfflineDownloadWarning(
                kind = OfflineWarningKind.LowStorage,
                message = "Low storage — check free space before download",
            )
        }

        return warnings
    }

    val reports: List<SettingsReportUiModel> = listOf(
        SettingsReportUiModel(
            id = "report-1",
            title = "Road name missing near Thanlyin Bridge",
            status = ReportStatusFilter.Pending,
            updatedText = "Submitted 2 days ago",
        ),
        SettingsReportUiModel(
            id = "report-2",
            title = "Kyauktan market pin moved",
            status = ReportStatusFilter.Submitted,
            updatedText = "Updated yesterday",
        ),
        SettingsReportUiModel(
            id = "report-3",
            title = "YBS 43 stop label corrected",
            status = ReportStatusFilter.Reviewed,
            updatedText = "Reviewed last week",
        ),
        SettingsReportUiModel(
            id = "report-4",
            title = "Duplicate tea shop report",
            status = ReportStatusFilter.Rejected,
            updatedText = "Rejected placeholder",
        ),
    )

    val pendingOfflineReport = SettingsReportUiModel(
        id = "offline-report-1",
        title = "Kyauktan main road correction",
        status = ReportStatusFilter.Pending,
        updatedText = "Waiting to upload when online",
    )

    val contributions: List<SettingsContributionUiModel> = listOf(
        SettingsContributionUiModel(
            id = "contrib-1",
            title = "Added Kyauktan market details",
            pointsText = "+40 points",
            dateText = "12 Jun 2026",
        ),
        SettingsContributionUiModel(
            id = "contrib-2",
            title = "Reported missing road segment",
            pointsText = "+25 points",
            dateText = "3 Jun 2026",
        ),
        SettingsContributionUiModel(
            id = "contrib-3",
            title = "Verified bus stop location",
            pointsText = "+15 points",
            dateText = "28 May 2026",
        ),
    )

    val adminRewardText =
        "Manual admin reward only. Points are added after review, not automatically."

    fun areaChipLabel(area: OfflineAreaOption): String = when (area) {
        OfflineAreaOption.CurrentTownship -> "Current township"
        OfflineAreaOption.CurrentDistrict -> "Current district"
        OfflineAreaOption.CurrentRegion -> "Current region"
        OfflineAreaOption.SearchArea -> "Search area"
    }

    fun areaChipSubtitle(area: OfflineAreaOption): String = when (area) {
        OfflineAreaOption.CurrentTownship -> "Kyauktan"
        OfflineAreaOption.CurrentDistrict -> "Thanlyin"
        OfflineAreaOption.CurrentRegion -> "Yangon Region"
        OfflineAreaOption.SearchArea -> "Map picker"
    }

    fun areaLabel(area: OfflineAreaOption): String = when (area) {
        OfflineAreaOption.CurrentTownship -> "Current township (Kyauktan)"
        OfflineAreaOption.CurrentDistrict -> "Current district (Thanlyin)"
        OfflineAreaOption.CurrentRegion -> "Current region (Yangon Region)"
        OfflineAreaOption.SearchArea -> "Search area"
    }

    fun packageLabel(packageOption: OfflinePackageOption): String = when (packageOption) {
        OfflinePackageOption.Lite -> OfflinePackageType.Lite.name
        OfflinePackageOption.Standard -> OfflinePackageType.Standard.name
        OfflinePackageOption.Full -> OfflinePackageType.Full.name
    }
}
