package com.coremapmm.app.core.fake

import com.coremapmm.app.feature.transit.PopularBusRouteUiModel
import com.coremapmm.app.feature.transit.RecentRouteUiModel
import com.coremapmm.app.feature.transit.RoutePlaceResultUiModel
import com.coremapmm.app.feature.transit.TransitStopUiModel

object FakeTransitData {
    val defaultFrom = "Current location"
    val defaultTo = "Kyauktan Market"

    val nearbyStops: List<TransitStopUiModel> = listOf(
        TransitStopUiModel(id = "stop-kyauktan-main", name = "Kyauktan Main Road", distanceText = "180 m"),
        TransitStopUiModel(id = "stop-thanlyin", name = "Thanlyin Terminal", distanceText = "1.2 km"),
        TransitStopUiModel(id = "stop-strand", name = "Strand Road Stop", distanceText = "2.4 km"),
    )

    val popularBusRoutes: List<PopularBusRouteUiModel> = listOf(
        PopularBusRouteUiModel(id = "ybs-43", name = "YBS 43", corridor = "Downtown → Kyauktan"),
        PopularBusRouteUiModel(id = "ybs-58", name = "YBS 58", corridor = "Sule → Thanlyin"),
        PopularBusRouteUiModel(id = "local-12", name = "Local 12", corridor = "Lanmadaw → Downtown"),
    )

    val recentRoutes: List<RecentRouteUiModel> = listOf(
        RecentRouteUiModel(
            id = "recent-1",
            from = "Downtown Yangon",
            to = "Kyauktan Market",
            modeLabel = "Bus",
        ),
        RecentRouteUiModel(
            id = "recent-2",
            from = "Current location",
            to = "Thanlyin Bridge",
            modeLabel = "Motorbike",
        ),
    )

    val routePlaceResults: List<RoutePlaceResultUiModel> = listOf(
        RoutePlaceResultUiModel(
            id = "route-place-current",
            title = "Current location",
            subtitle = "Use approximate device location placeholder",
            distanceText = null,
        ),
        RoutePlaceResultUiModel(
            id = "route-place-kyauktan-market",
            title = "Kyauktan Market",
            subtitle = "Market · Kyauktan · Yangon Region",
            distanceText = "18 km",
        ),
        RoutePlaceResultUiModel(
            id = "route-place-thanlyin-bridge",
            title = "Thanlyin Bridge",
            subtitle = "Bridge · Thanlyin · Yangon Region",
            distanceText = "12 km",
        ),
        RoutePlaceResultUiModel(
            id = "route-place-ygh",
            title = "Yangon General Hospital",
            subtitle = "Hospital · Lanmadaw · Yangon Region",
            distanceText = "3.1 km",
        ),
    )
}
