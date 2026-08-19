package com.coremapmm.app.core.ui

import kotlin.math.abs

enum class SheetLevel(val heightFraction: Float) {
    Hidden(0f),
    Mini(1f / 6f),
    Default(2f / 6f),
    Detail(3f / 6f),
    Full(1f),
}

/** Next level when dragging or scrolling up. */
fun SheetLevel.expanded(): SheetLevel = when (this) {
    SheetLevel.Hidden -> SheetLevel.Mini
    SheetLevel.Mini -> SheetLevel.Default
    SheetLevel.Default -> SheetLevel.Detail
    SheetLevel.Detail -> SheetLevel.Full
    SheetLevel.Full -> SheetLevel.Full
}

/** Next level when dragging or scrolling down. */
fun SheetLevel.collapsed(): SheetLevel = when (this) {
    SheetLevel.Hidden -> SheetLevel.Hidden
    SheetLevel.Mini -> SheetLevel.Hidden
    SheetLevel.Default -> SheetLevel.Mini
    SheetLevel.Detail -> SheetLevel.Default
    SheetLevel.Full -> SheetLevel.Detail
}

fun fractionToSheetLevel(fraction: Float): SheetLevel {
    return SheetLevel.entries.minBy { level ->
        abs(level.heightFraction - fraction)
    }
}

/**
 * Resolves a drag gesture into the next discrete sheet level.
 *
 * @param dragDeltaFraction Positive when the finger moves down (sheet shrinks).
 */
fun SheetLevel.resolveDragEnd(
    dragDeltaFraction: Float,
    minStepFraction: Float = 0.04f,
): SheetLevel {
    return when {
        abs(dragDeltaFraction) < minStepFraction -> this
        dragDeltaFraction > 0f -> collapsed()
        else -> expanded()
    }
}

internal const val SheetScrollStepThresholdPx = 48f
internal const val SheetFlingVelocityThreshold = 800f
