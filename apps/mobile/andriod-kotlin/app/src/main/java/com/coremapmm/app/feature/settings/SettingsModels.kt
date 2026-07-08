package com.coremapmm.app.feature.settings

import com.coremapmm.app.core.model.OfflinePackageUiModel
import com.coremapmm.app.core.model.UserUiModel

enum class SettingsService {
    OfflineMaps,
    Reports,
    Points,
    DataSaver,
    Language,
    MapSettings,
    Help,
}

enum class OfflineAreaOption {
    CurrentTownship,
    CurrentDistrict,
    CurrentRegion,
    SearchArea,
}

enum class OfflinePackageOption {
    Lite,
    Standard,
    Full,
}

enum class ReportStatusFilter {
    All,
    Pending,
    Submitted,
    Reviewed,
    Rejected,
}

enum class OfflineWarningKind {
    WifiRecommended,
    MobileData,
    LowStorage,
    Info,
}

data class OfflineDownloadWarning(
    val kind: OfflineWarningKind,
    val message: String,
)

data class SettingsServiceItem(
    val service: SettingsService,
    val title: String,
    val description: String,
)

data class SettingsReportUiModel(
    val id: String,
    val title: String,
    val status: ReportStatusFilter,
    val updatedText: String,
)

data class SettingsContributionUiModel(
    val id: String,
    val title: String,
    val pointsText: String,
    val dateText: String,
)

data class SettingsUiState(
    val user: UserUiModel,
    val activeService: SettingsService? = null,
    val services: List<SettingsServiceItem> = emptyList(),
    val dataSaverEnabled: Boolean = true,
    val selectedOfflineArea: OfflineAreaOption = OfflineAreaOption.CurrentTownship,
    val selectedOfflinePackage: OfflinePackageOption = OfflinePackageOption.Lite,
    val estimatedPackageLabel: String = "Kyauktan Township Lite · 48 MB",
    val downloadedAreas: List<OfflinePackageUiModel> = emptyList(),
    val offlineWarnings: List<OfflineDownloadWarning> = emptyList(),
    val reports: List<SettingsReportUiModel> = emptyList(),
    val selectedReportFilter: ReportStatusFilter = ReportStatusFilter.All,
    val contributions: List<SettingsContributionUiModel> = emptyList(),
    val adminRewardText: String = "",
)
