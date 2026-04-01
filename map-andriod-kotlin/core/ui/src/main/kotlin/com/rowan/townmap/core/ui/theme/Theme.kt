package com.rowan.townmap.core.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val LightColorScheme = lightColorScheme(
    primary = TownMapPrimary,
    onPrimary = TownMapOnPrimary,
    secondary = TownMapSecondary,
    onSecondary = TownMapOnSecondary,
    background = TownMapBackground,
    onBackground = TownMapOnBackground,
    surface = TownMapSurface,
    onSurface = TownMapOnSurface
)

private val DarkColorScheme = darkColorScheme(
    primary = TownMapPrimaryDark,
    onPrimary = TownMapOnPrimaryDark,
    secondary = TownMapSecondaryDark,
    onSecondary = TownMapOnSecondaryDark,
    background = TownMapBackgroundDark,
    onBackground = TownMapOnBackgroundDark,
    surface = TownMapSurfaceDark,
    onSurface = TownMapOnSurfaceDark
)

@Composable
fun TownMapTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = TownMapTypography,
        content = content
    )
}
