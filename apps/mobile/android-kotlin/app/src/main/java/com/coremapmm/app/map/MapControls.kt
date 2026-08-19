package com.coremapmm.app.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Star
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreMapFloatingButton

@Composable
fun MapControls(
    modifier: Modifier = Modifier,
    onLayersClick: () -> Unit = {},
    onSavedClick: () -> Unit = {},
    onCurrentLocationClick: () -> Unit = {},
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.sm),
    ) {
        CoreMapFloatingButton(
            icon = Icons.Default.Menu,
            contentDescription = "Map layers",
            onClick = onLayersClick,
        )
        CoreMapFloatingButton(
            icon = Icons.Default.Star,
            contentDescription = "Saved places",
            onClick = onSavedClick,
        )
        CoreMapFloatingButton(
            icon = Icons.Default.LocationOn,
            contentDescription = "Current location",
            onClick = onCurrentLocationClick,
        )
    }
}

@Preview
@Composable
private fun MapControlsPreview() {
    CoreMapTheme {
        MapControls()
    }
}
