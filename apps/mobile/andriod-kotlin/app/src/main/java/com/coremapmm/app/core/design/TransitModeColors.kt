package com.coremapmm.app.core.design

import androidx.compose.ui.graphics.Color
import com.coremapmm.app.core.model.RouteSegmentColorType
import com.coremapmm.app.core.model.TravelMode

object TransitModeColors {
    /** Gray — walking / inactive segments */
    val Walk = CoreMapColors.InactiveGray

    /** Green — local bus / brand transit */
    val Bus = CoreMapColors.PrimaryGreen

    /** Blue — drive / navigation accent */
    val Car = CoreMapColors.AccentBlue

    /** Purple — express / long-distance */
    val Express = Color(0xFF7C3AED)

    /** Teal — motorcycle */
    val Motorbike = Color(0xFF14B8A6)

    /** Orange — transfers / warnings */
    val Warning = CoreMapColors.WarningOrange
}

fun RouteSegmentColorType.toTransitColor(): Color {
    return when (this) {
        RouteSegmentColorType.Walk -> TransitModeColors.Walk
        RouteSegmentColorType.Drive -> TransitModeColors.Car
        RouteSegmentColorType.Motorcycle -> TransitModeColors.Motorbike
        RouteSegmentColorType.Bus -> TransitModeColors.Bus
        RouteSegmentColorType.ExpressBus -> TransitModeColors.Express
        RouteSegmentColorType.Transfer -> TransitModeColors.Warning
    }
}

fun TravelMode.toTransitColor(): Color {
    return when (this) {
        TravelMode.Walk -> TransitModeColors.Walk
        TravelMode.Drive -> TransitModeColors.Car
        TravelMode.Motorcycle -> TransitModeColors.Motorbike
        TravelMode.Bus -> TransitModeColors.Bus
        TravelMode.ExpressBus -> TransitModeColors.Express
    }
}
