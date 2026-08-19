package com.coremapmm.app.core.fake

import com.coremapmm.app.feature.mymap.MyMapItemIconType
import com.coremapmm.app.feature.mymap.MyMapItemUiModel
import com.coremapmm.app.feature.mymap.MyMapQuickAction
import com.coremapmm.app.feature.mymap.MyMapSectionUiModel
import com.coremapmm.app.feature.mymap.MyMapSummaryUiModel
import com.coremapmm.app.feature.mymap.CommunityAlertSeverity
import com.coremapmm.app.feature.mymap.CommunityAlertUiModel

object FakeMyMapData {
    val summary = MyMapSummaryUiModel(
        savedCount = 12,
        offlineAreaCount = 2,
    )

    val savedPlaces: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "saved-shwedagon",
            title = "Shwedagon Pagoda",
            subtitle = "Landmark · Dagon · Yangon Region",
            iconType = MyMapItemIconType.Place,
            quickAction = MyMapQuickAction.Navigate,
            placeId = "place-shwedagon-pagoda",
        ),
        MyMapItemUiModel(
            id = "saved-ygh",
            title = "Yangon General Hospital",
            subtitle = "Hospital · Lanmadaw · Yangon Region",
            iconType = MyMapItemIconType.Place,
            quickAction = MyMapQuickAction.Navigate,
            placeId = "place-yangon-general-hospital",
        ),
        MyMapItemUiModel(
            id = "saved-kyauktan-market",
            title = "Kyauktan Market",
            subtitle = "Market · Kyauktan · Yangon Region",
            iconType = MyMapItemIconType.Place,
            quickAction = MyMapQuickAction.Navigate,
            placeId = "place-kyauktan-market",
        ),
    )

    val savedRoutes: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "saved-route-ybs43",
            title = "YBS 43 to Kyauktan Market",
            subtitle = "Bus · 52 min · Estimated",
            iconType = MyMapItemIconType.Route,
            quickAction = MyMapQuickAction.Open,
        ),
        MyMapItemUiModel(
            id = "saved-route-motorcycle",
            title = "Motorbike to Thanlyin Bridge",
            subtitle = "Motorbike · 24 min · Estimated",
            iconType = MyMapItemIconType.Route,
            quickAction = MyMapQuickAction.Open,
        ),
    )

    val recentSearches: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "recent-kyauktan-market",
            title = "Kyauktan Market",
            subtitle = "Place · Kyauktan · Yangon Region",
            iconType = MyMapItemIconType.Search,
            quickAction = MyMapQuickAction.Open,
            placeId = "place-kyauktan-market",
        ),
        MyMapItemUiModel(
            id = "recent-shwedagon",
            title = "Shwedagon Pagoda",
            subtitle = "Place · Dagon · Yangon Region",
            iconType = MyMapItemIconType.Search,
            quickAction = MyMapQuickAction.Open,
            placeId = "place-shwedagon-pagoda",
        ),
        MyMapItemUiModel(
            id = "recent-ybs43",
            title = "YBS 43",
            subtitle = "Bus route · Yangon Region",
            iconType = MyMapItemIconType.Search,
            quickAction = MyMapQuickAction.Open,
        ),
    )

    val downloadedAreas: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "offline-kyauktan-lite",
            title = "Kyauktan Township Lite",
            subtitle = "Township · 48 MB · Downloaded",
            iconType = MyMapItemIconType.Offline,
            quickAction = MyMapQuickAction.More,
        ),
        MyMapItemUiModel(
            id = "offline-yangon-lite",
            title = "Yangon Region Lite",
            subtitle = "Region · 210 MB · Update available",
            iconType = MyMapItemIconType.Offline,
            quickAction = MyMapQuickAction.Download,
        ),
    )

    val communityAlerts: List<CommunityAlertUiModel> = listOf(
        CommunityAlertUiModel(
            id = "alert-thanlyin-bridge-road-work",
            title = "Road work near Thanlyin Bridge",
            area = "Yangon Region",
            category = "Transport",
            severity = CommunityAlertSeverity.Warning,
            updatedText = "Updated 20 min ago",
            sourceText = "Verified by CoreMap",
            message = "Expect slower traffic near the bridge approach.",
            affectedAreaText = "Thanlyin Bridge approach",
        ),
        CommunityAlertUiModel(
            id = "alert-kyauktan-market-relocation",
            title = "Temporary market relocation",
            area = "Kyauktan Township",
            category = "Local notice",
            severity = CommunityAlertSeverity.Notice,
            updatedText = "Today",
            sourceText = "Admin reviewed",
            message = "Some vendors moved near Main Road for the morning market.",
            affectedAreaText = "Kyauktan Market area",
        ),
        CommunityAlertUiModel(
            id = "alert-yangon-south-heavy-rain",
            title = "Heavy rain warning",
            area = "Yangon South",
            category = "Weather",
            severity = CommunityAlertSeverity.Urgent,
            updatedText = "Waiting for verification",
            sourceText = "Community reported",
            message = "Multiple users reported flooded side streets.",
            affectedAreaText = "Low-lying side streets",
        ),
        CommunityAlertUiModel(
            id = "alert-ybs-stop-updated",
            title = "YBS stop location updated",
            area = "Thanlyin",
            category = "Transit",
            severity = CommunityAlertSeverity.Info,
            updatedText = "Yesterday",
            sourceText = "Verified by CoreMap",
            message = "Stop marker corrected near terminal entrance.",
            affectedAreaText = "YBS terminal entrance",
        ),
    )

    val pendingReports: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "report-road-thanlyin",
            title = "Road name missing near Thanlyin Bridge",
            subtitle = "Map issue · Thanlyin · Pending review",
            iconType = MyMapItemIconType.Report,
            quickAction = MyMapQuickAction.More,
        ),
    )

    val pins: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "pin-home",
            title = "Home",
            subtitle = "Pin · Kyauktan · Yangon Region",
            iconType = MyMapItemIconType.Pin,
            quickAction = MyMapQuickAction.Navigate,
        ),
        MyMapItemUiModel(
            id = "pin-work",
            title = "Work",
            subtitle = "Pin · Downtown · Yangon Region",
            iconType = MyMapItemIconType.Pin,
            quickAction = MyMapQuickAction.Navigate,
        ),
    )

    val cachedPlaces: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "cache-thanlyin-bridge",
            title = "Thanlyin Bridge",
            subtitle = "Cached place · Thanlyin · Yangon Region",
            iconType = MyMapItemIconType.Cache,
            quickAction = MyMapQuickAction.Open,
            placeId = "place-thanlyin-bridge",
        ),
        MyMapItemUiModel(
            id = "cache-kyauktan-market",
            title = "Kyauktan Market",
            subtitle = "Cached place · Kyauktan · Yangon Region",
            iconType = MyMapItemIconType.Cache,
            quickAction = MyMapQuickAction.Open,
            placeId = "place-kyauktan-market",
        ),
    )

    val pendingOfflineReports: List<MyMapItemUiModel> = listOf(
        MyMapItemUiModel(
            id = "offline-report-kyauktan-road",
            title = "Kyauktan main road correction",
            subtitle = "Offline report · Kyauktan · Waiting to upload",
            iconType = MyMapItemIconType.Report,
            quickAction = MyMapQuickAction.More,
        ),
    )

    val defaultSections: List<MyMapSectionUiModel> = listOf(
        MyMapSectionUiModel(id = "saved-places", title = "Saved Places", items = savedPlaces),
        MyMapSectionUiModel(id = "saved-routes", title = "Saved Routes", items = savedRoutes),
        MyMapSectionUiModel(id = "recent-searches", title = "Recent Searches", items = recentSearches),
        MyMapSectionUiModel(id = "downloaded-areas", title = "Downloaded Areas", items = downloadedAreas),
    )

    val fullSections: List<MyMapSectionUiModel> = listOf(
        MyMapSectionUiModel(id = "saved-places", title = "Saved Places", items = savedPlaces),
        MyMapSectionUiModel(id = "saved-routes", title = "Saved Routes", items = savedRoutes),
        MyMapSectionUiModel(id = "recent-searches", title = "Recent Searches", items = recentSearches),
        MyMapSectionUiModel(id = "downloaded-areas", title = "Downloaded Areas", items = downloadedAreas),
        MyMapSectionUiModel(id = "pins", title = "Pins", items = pins),
        MyMapSectionUiModel(id = "cached-places", title = "Cached Places", items = cachedPlaces),
    )
}
