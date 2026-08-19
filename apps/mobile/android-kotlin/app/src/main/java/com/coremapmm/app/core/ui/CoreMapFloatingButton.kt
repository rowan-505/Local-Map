package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CoreMapFloatingButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(CoreMapSpacing.mapControlSize),
        shape = CoreMapControlShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 4.dp,
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = CoreMapColors.Border,
        ),
    ) {
        Box(
            modifier = Modifier.size(CoreMapSpacing.mapControlSize),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview
@Composable
private fun CoreMapFloatingButtonPreview() {
    CoreMapTheme {
        CoreMapFloatingButton(
            icon = Icons.Default.LocationOn,
            contentDescription = "Location",
            onClick = {},
        )
    }
}
