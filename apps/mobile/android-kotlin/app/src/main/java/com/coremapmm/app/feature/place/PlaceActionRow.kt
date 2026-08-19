package com.coremapmm.app.feature.place

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreButtonShape

enum class PlaceActionId {
    From,
    To,
    Save,
    Share,
    Call,
    Report,
}

internal data class PlaceActionItem(
    val id: PlaceActionId,
    val label: String,
)

@Composable
internal fun PlaceActionRow(
    actions: List<PlaceActionItem>,
    onActionClick: (PlaceActionItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        actions.forEach { action ->
            PlaceActionChip(
                action = action,
                onClick = { onActionClick(action) },
            )
        }
    }
}

@Composable
private fun PlaceActionChip(
    action: PlaceActionItem,
    onClick: () -> Unit,
) {
    val isDestination = action.id == PlaceActionId.To
    val isSaved = action.id == PlaceActionId.Save && action.label.contains("Saved", ignoreCase = true)

    val borderColor = when {
        isDestination -> CoreMapColors.DestinationRed
        isSaved -> CoreMapColors.PrimaryGreen
        else -> CoreMapColors.Border
    }
    val textColor = when {
        isDestination -> CoreMapColors.DestinationRed
        isSaved -> CoreMapColors.PrimaryGreen
        else -> MaterialTheme.colorScheme.onSurface
    }
    val containerColor = when {
        isDestination -> CoreMapColors.DestinationRed.copy(alpha = 0.06f)
        isSaved -> CoreMapColors.SoftGreenBackground
        else -> MaterialTheme.colorScheme.surface
    }

    Surface(
        onClick = onClick,
        modifier = Modifier.height(CoreMapSpacing.chipHeight),
        shape = CoreButtonShape,
        color = containerColor,
        shadowElevation = 1.dp,
        border = BorderStroke(1.dp, borderColor.copy(alpha = 0.72f)),
    ) {
        Text(
            text = action.label,
            style = MaterialTheme.typography.labelLarge,
            color = textColor,
            modifier = Modifier.padding(horizontal = CoreMapSpacing.md, vertical = CoreMapSpacing.xs),
        )
    }
}

@Preview
@Composable
private fun PlaceActionRowPreview() {
    CoreMapTheme {
        PlaceActionRow(
            actions = listOf(
                PlaceActionItem(PlaceActionId.From, "From"),
                PlaceActionItem(PlaceActionId.To, "To"),
                PlaceActionItem(PlaceActionId.Save, "Saved"),
                PlaceActionItem(PlaceActionId.Share, "Share"),
                PlaceActionItem(PlaceActionId.Call, "Call"),
                PlaceActionItem(PlaceActionId.Report, "Report"),
            ),
            onActionClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
