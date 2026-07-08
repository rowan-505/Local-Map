package com.coremapmm.app.core.design

import androidx.compose.ui.graphics.Color

object CoreMapColors {
    // Brand greens
    val PrimaryGreen = Color(0xFF16A34A)
    val FreshGreen = Color(0xFF22C55E)
    val SoftGreenBackground = Color(0xFFECFDF3)
    val DeepGreenText = Color(0xFF14532D)

    // Semantic accents
    val DestinationRed = Color(0xFFEF4444)
    val AccentBlue = Color(0xFF0EA5E9)
    val WarningOrange = Color(0xFFF97316)

    // Neutrals
    val NeutralText = Color(0xFF111827)
    val SecondaryText = Color(0xFF6B7280)
    val InactiveGray = Color(0xFF9CA3AF)
    val Border = Color(0xFFE5E7EB)
    val Surface = Color(0xFFFFFFFF)
    val AppBackground = Color(0xFFF7FAF8)

    // Soft containers derived from accents
    val SoftBlueBackground = Color(0xFFE0F2FE)
    val SoftWarningBackground = Color(0xFFFFF7ED)
    val MutedSurface = Color(0xFFF3F4F6)

    // Map placeholder palette
    val MapBlue = AccentBlue
    val MapBlueDark = Color(0xFF0C4A6E)
    val MapTeal = FreshGreen
    val MapSurface = AppBackground
    val MapSurfaceDark = Color(0xFF121820)
    val MapOnSurface = NeutralText
    val MapOnSurfaceMuted = SecondaryText
    val MapChipBackground = Surface
    val MapShadow = Color(0x1A111827)
    val MapPlaceholderGrid = Border
    val MapPlaceholderGridDark = Color(0xFF2A3440)

    val MapLandLight = AppBackground
    val MapWaterLight = SoftBlueBackground
    val MapParkLight = SoftGreenBackground
    val MapRoadMajor = Surface
    val MapRoadMinor = Color(0xFFF2F4F3)
    val MapRoadCasing = Border
    val MapMarker = DestinationRed
    val MapMarkerSelected = PrimaryGreen
    val MapLabel = SecondaryText
}
