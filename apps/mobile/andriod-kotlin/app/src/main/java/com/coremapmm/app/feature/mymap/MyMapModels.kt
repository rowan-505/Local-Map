package com.coremapmm.app.feature.mymap

enum class MyMapItemIconType {
    Place,
    Route,
    Search,
    Offline,
    Alert,
    Pin,
    Cache,
    Report,
}

enum class MyMapQuickAction {
    Open,
    Navigate,
    More,
    Download,
    Remove,
}

enum class MyMapSectionTab {
    Places,
    Routes,
    Recents,
    Alerts,
    Downloads,
}

enum class CommunityAlertSeverity {
    Info,
    Notice,
    Warning,
    Urgent,
}

data class CommunityAlertUiModel(
    val id: String,
    val title: String,
    val area: String,
    val category: String,
    val severity: CommunityAlertSeverity,
    val updatedText: String,
    val sourceText: String,
    val message: String,
    val affectedAreaText: String? = null,
)

data class MyMapItemUiModel(
    val id: String,
    val title: String,
    val subtitle: String,
    val iconType: MyMapItemIconType,
    val quickAction: MyMapQuickAction,
    val placeId: String? = null,
)

data class MyMapSectionUiModel(
    val id: String,
    val title: String,
    val items: List<MyMapItemUiModel>,
)

data class MyMapSummaryUiModel(
    val savedCount: Int,
    val offlineAreaCount: Int,
)
