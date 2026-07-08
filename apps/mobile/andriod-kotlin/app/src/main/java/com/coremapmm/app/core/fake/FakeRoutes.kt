package com.coremapmm.app.core.fake

import com.coremapmm.app.core.model.RouteBadge
import com.coremapmm.app.core.model.RouteSegmentColorType
import com.coremapmm.app.core.model.RouteSegmentUiModel
import com.coremapmm.app.core.model.RouteStepUiModel
import com.coremapmm.app.core.model.RouteUiModel
import com.coremapmm.app.core.model.TravelMode

object FakeRoutes {
  val ybsBusRoute: RouteUiModel = RouteUiModel(
    id = "route-ybs-43-kyauktan",
    title = "YBS 43 to Kyauktan Market",
    totalDurationText = "52 min",
    distanceText = "18.4 km",
    fareText = "300 MMK (unverified)",
    mode = TravelMode.Bus,
    summarySegments = listOf(
      RouteSegmentUiModel(
        mode = TravelMode.Walk,
        label = "Walk",
        durationText = "6 min",
        colorType = RouteSegmentColorType.Walk,
        durationMinutes = 6,
      ),
      RouteSegmentUiModel(
        mode = TravelMode.Bus,
        label = "YBS 43",
        durationText = "38 min",
        colorType = RouteSegmentColorType.Bus,
        durationMinutes = 38,
      ),
      RouteSegmentUiModel(
        mode = TravelMode.Walk,
        label = "Walk",
        durationText = "8 min",
        colorType = RouteSegmentColorType.Walk,
        durationMinutes = 8,
      ),
    ),
    steps = listOf(
      RouteStepUiModel(
        title = "Walk to YBS 43 stop",
        subtitle = "Near Sule Pagoda Road",
        mode = TravelMode.Walk,
        durationText = "6 min",
        distanceText = "420 m",
      ),
      RouteStepUiModel(
        title = "Take YBS 43",
        subtitle = "Toward Thanlyin / Kyauktan",
        mode = TravelMode.Bus,
        durationText = "38 min",
        distanceText = "16.8 km",
      ),
      RouteStepUiModel(
        title = "Walk to Kyauktan Market",
        subtitle = "Main Road entrance",
        mode = TravelMode.Walk,
        durationText = "8 min",
        distanceText = "580 m",
      ),
    ),
    isRecommended = true,
    badge = RouteBadge.Recommended,
  )

  val motorbikeRoute: RouteUiModel = RouteUiModel(
    id = "route-motorcycle-thanlyin-bridge",
    title = "Motorbike to Thanlyin Bridge",
    totalDurationText = "24 min",
    distanceText = "12.1 km",
    fareText = "—",
    mode = TravelMode.Motorcycle,
    summarySegments = listOf(
      RouteSegmentUiModel(
        mode = TravelMode.Motorcycle,
        label = "Motorbike",
        durationText = "24 min",
        colorType = RouteSegmentColorType.Motorcycle,
        durationMinutes = 24,
      ),
    ),
    steps = listOf(
      RouteStepUiModel(
        title = "Head southeast on Strand Road",
        subtitle = "Toward Thanlyin Bridge",
        mode = TravelMode.Motorcycle,
        durationText = "12 min",
        distanceText = "6.2 km",
      ),
      RouteStepUiModel(
        title = "Cross Thanlyin Bridge",
        subtitle = "Continue on main road",
        mode = TravelMode.Motorcycle,
        durationText = "5 min",
        distanceText = "2.8 km",
      ),
      RouteStepUiModel(
        title = "Arrive at Thanlyin Bridge viewpoint",
        subtitle = "Destination on the right",
        mode = TravelMode.Motorcycle,
        durationText = "7 min",
        distanceText = "3.1 km",
      ),
    ),
    isRecommended = false,
    badge = RouteBadge.Fastest,
  )

  val walkAndBusRoute: RouteUiModel = RouteUiModel(
    id = "route-walk-bus-ygh",
    title = "Walk + local bus to Yangon General Hospital",
    totalDurationText = "35 min",
    distanceText = "5.6 km",
    fareText = "200 MMK (unverified)",
    mode = TravelMode.Bus,
    summarySegments = listOf(
      RouteSegmentUiModel(
        mode = TravelMode.Walk,
        label = "Walk",
        durationText = "10 min",
        colorType = RouteSegmentColorType.Walk,
        durationMinutes = 10,
      ),
      RouteSegmentUiModel(
        mode = TravelMode.Bus,
        label = "Local bus",
        durationText = "18 min",
        colorType = RouteSegmentColorType.Bus,
        durationMinutes = 18,
      ),
      RouteSegmentUiModel(
        mode = TravelMode.Walk,
        label = "Walk",
        durationText = "7 min",
        colorType = RouteSegmentColorType.Walk,
        durationMinutes = 7,
      ),
    ),
    steps = listOf(
      RouteStepUiModel(
        title = "Walk to bus stop",
        subtitle = "Near downtown Yangon",
        mode = TravelMode.Walk,
        durationText = "10 min",
        distanceText = "750 m",
      ),
      RouteStepUiModel(
        title = "Take local bus toward Lanmadaw",
        subtitle = "Route number unverified",
        mode = TravelMode.Bus,
        durationText = "18 min",
        distanceText = "4.2 km",
      ),
      RouteStepUiModel(
        title = "Walk to Yangon General Hospital",
        subtitle = "Bogyoke Aung San Road",
        mode = TravelMode.Walk,
        durationText = "7 min",
        distanceText = "650 m",
      ),
    ),
    isRecommended = false,
    badge = RouteBadge.LessWalking,
  )

  val walkRoute: RouteUiModel = RouteUiModel(
    id = "route-walk-kyauktan",
    title = "Walk to Kyauktan Market",
    totalDurationText = "3 hr 10 min",
    distanceText = "18.0 km",
    fareText = "—",
    mode = TravelMode.Walk,
    summarySegments = listOf(
      RouteSegmentUiModel(
        mode = TravelMode.Walk,
        label = "Walk",
        durationText = "3 hr 10 min",
        colorType = RouteSegmentColorType.Walk,
        durationMinutes = 190,
      ),
    ),
    steps = listOf(
      RouteStepUiModel(
        title = "Walk north on main road",
        subtitle = "Estimated · data not verified",
        mode = TravelMode.Walk,
        durationText = "3 hr 10 min",
        distanceText = "18.0 km",
      ),
    ),
    isRecommended = false,
    badge = null,
  )

  val carRoute: RouteUiModel = RouteUiModel(
    id = "route-car-kyauktan",
    title = "Drive to Kyauktan Market",
    totalDurationText = "32 min",
    distanceText = "17.8 km",
    fareText = "—",
    mode = TravelMode.Drive,
    summarySegments = listOf(
      RouteSegmentUiModel(
        mode = TravelMode.Drive,
        label = "Car",
        durationText = "32 min",
        colorType = RouteSegmentColorType.Drive,
        durationMinutes = 32,
      ),
    ),
    steps = listOf(
      RouteStepUiModel(
        title = "Head southeast on Strand Road",
        subtitle = "Estimated · data not verified",
        mode = TravelMode.Drive,
        durationText = "18 min",
        distanceText = "10.2 km",
      ),
      RouteStepUiModel(
        title = "Continue toward Kyauktan",
        subtitle = "Via Thanlyin corridor",
        mode = TravelMode.Drive,
        durationText = "14 min",
        distanceText = "7.6 km",
      ),
    ),
    isRecommended = false,
    badge = RouteBadge.Fastest,
  )

  val sampleRoutes: List<RouteUiModel> = listOf(
    ybsBusRoute,
    motorbikeRoute,
    walkAndBusRoute,
    walkRoute,
    carRoute,
  )

  fun byId(routeId: String): RouteUiModel? = sampleRoutes.find { it.id == routeId }
}
