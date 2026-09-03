package com.coremapmm.fieldsurveyor.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun FieldBottomBar(
    currentRoute: String?,
    onRoutes: () -> Unit,
    onSurvey: () -> Unit,
    onSettings: () -> Unit,
) {
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        NavigationBarItem(
            selected = currentRoute == FieldRoutes.Routes,
            onClick = onRoutes,
            icon = { Icon(Icons.Outlined.Route, contentDescription = tr("Routes")) },
            label = { Text(tr("Routes")) },
        )
        NavigationBarItem(
            selected = currentRoute == FieldRoutes.Survey,
            onClick = onSurvey,
            icon = { Icon(Icons.Outlined.Map, contentDescription = tr("Survey")) },
            label = { Text(tr("Survey")) },
        )
        NavigationBarItem(
            selected = FieldRoutes.settingsSection(currentRoute),
            onClick = onSettings,
            icon = { Icon(Icons.Outlined.Settings, contentDescription = tr("Settings")) },
            label = { Text(tr("Settings")) },
        )
    }
}
