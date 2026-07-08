package com.coremapmm.app.core.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.unit.Velocity

/**
 * Connects scrollable sheet content to discrete [SheetLevel] transitions.
 *
 * - Pulling down at scroll top collapses the sheet one step.
 * - Pulling up after content scroll is exhausted expands the sheet one step.
 */
internal class SheetNestedScrollConnection(
  private val level: SheetLevel,
  private val onLevelChange: (SheetLevel) -> Unit,
) : NestedScrollConnection {
    private var accumulatedPx = 0f

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        if (available.y <= 0f || level == SheetLevel.Hidden) {
            accumulatedPx = 0f
            return Offset.Zero
        }

        accumulatedPx += available.y
        if (accumulatedPx >= SheetScrollStepThresholdPx) {
            accumulatedPx = 0f
            val next = level.collapsed()
            if (next != level) {
                onLevelChange(next)
                return available
            }
        }
        return Offset.Zero
    }

    override fun onPostScroll(
        consumed: Offset,
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        if (available.y >= 0f || level == SheetLevel.Full) {
            accumulatedPx = 0f
            return Offset.Zero
        }

        accumulatedPx += -available.y
        if (accumulatedPx >= SheetScrollStepThresholdPx) {
            accumulatedPx = 0f
            val next = level.expanded()
            if (next != level) {
                onLevelChange(next)
                return available
            }
        }
        return Offset.Zero
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        return when {
            available.y > SheetFlingVelocityThreshold && level != SheetLevel.Hidden -> {
                onLevelChange(level.collapsed())
                available
            }
            available.y < -SheetFlingVelocityThreshold && level != SheetLevel.Full -> {
                onLevelChange(level.expanded())
                available
            }
            else -> Velocity.Zero
        }
    }
}
