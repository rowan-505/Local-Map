package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CoreSelectableChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .height(CoreMapSpacing.chipHeight)
            .coreFloatingCard(elevation = if (selected) 2.dp else 1.dp, shape = CoreChipShape),
        shape = CoreChipShape,
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        shadowElevation = if (selected) 2.dp else 1.dp,
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = if (selected) {
                CoreMapColors.PrimaryGreen.copy(alpha = 0.35f)
            } else {
                CoreMapColors.Border
            },
        ),
    ) {
        Box(
            modifier = Modifier
                .widthIn(min = CoreMapSpacing.chipHeight)
                .padding(horizontal = CoreMapSpacing.md, vertical = CoreMapSpacing.xs),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

@Preview
@Composable
private fun CoreSelectableChipPreview() {
    CoreMapTheme {
        CoreSelectableChip(label = "Landmark", selected = true, onClick = {})
    }
}
