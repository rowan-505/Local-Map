package com.coremapmm.app.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapComponentColors
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.model.CoreMapTab

@Composable
fun CoreBottomNav(
    selectedTab: CoreMapTab,
    onTabSelected: (CoreMapTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        CoreMapTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
                colors = CoreMapComponentColors.navigationBarItemColors(),
                icon = {
                    Icon(
                        imageVector = when (tab) {
                            CoreMapTab.Discover -> Icons.Default.Search
                            CoreMapTab.Transit -> Icons.Default.Place
                            CoreMapTab.MyMap -> Icons.Default.Star
                            CoreMapTab.Settings -> Icons.Default.Settings
                        },
                        contentDescription = tab.label,
                    )
                },
                label = {
                    Text(text = tabLabel(tab))
                },
            )
        }
    }
}

@Composable
private fun tabLabel(tab: CoreMapTab): String {
    return when (tab) {
        CoreMapTab.Discover -> stringResource(R.string.tab_discover)
        CoreMapTab.Transit -> stringResource(R.string.tab_transit)
        CoreMapTab.MyMap -> stringResource(R.string.tab_my_map)
        CoreMapTab.Settings -> stringResource(R.string.tab_settings)
    }
}

@Preview
@Composable
private fun CoreBottomNavPreview() {
    CoreMapTheme {
        CoreBottomNav(
            selectedTab = CoreMapTab.Discover,
            onTabSelected = {},
        )
    }
}
