package com.coremapmm.app.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = CoreMapColors.PrimaryGreen,
    onPrimary = Color.White,
    primaryContainer = CoreMapColors.SoftGreenBackground,
    onPrimaryContainer = CoreMapColors.DeepGreenText,
    secondary = CoreMapColors.AccentBlue,
    onSecondary = Color.White,
    secondaryContainer = CoreMapColors.SoftBlueBackground,
    onSecondaryContainer = CoreMapColors.MapBlueDark,
    tertiary = CoreMapColors.WarningOrange,
    onTertiary = Color.White,
    tertiaryContainer = CoreMapColors.SoftWarningBackground,
    onTertiaryContainer = CoreMapColors.WarningOrange,
    error = CoreMapColors.DestinationRed,
    onError = Color.White,
    background = CoreMapColors.AppBackground,
    onBackground = CoreMapColors.NeutralText,
    surface = CoreMapColors.Surface,
    onSurface = CoreMapColors.NeutralText,
    surfaceVariant = CoreMapColors.MutedSurface,
    onSurfaceVariant = CoreMapColors.SecondaryText,
    outline = CoreMapColors.Border,
    outlineVariant = CoreMapColors.Border,
)

private val DarkColorScheme = darkColorScheme(
    primary = CoreMapColors.FreshGreen,
    onPrimary = CoreMapColors.DeepGreenText,
    primaryContainer = Color(0xFF14532D),
    onPrimaryContainer = CoreMapColors.SoftGreenBackground,
    secondary = CoreMapColors.AccentBlue,
    onSecondary = Color.White,
    secondaryContainer = CoreMapColors.MapBlueDark,
    onSecondaryContainer = CoreMapColors.SoftBlueBackground,
    tertiary = CoreMapColors.WarningOrange,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFF7C2D12),
    onTertiaryContainer = Color(0xFFFED7AA),
    error = CoreMapColors.DestinationRed,
    onError = Color.White,
    background = CoreMapColors.MapSurfaceDark,
    onBackground = Color.White,
    surface = Color(0xFF1A2129),
    onSurface = Color.White,
    surfaceVariant = CoreMapColors.MapPlaceholderGridDark,
    onSurfaceVariant = Color(0xFFB8C2CC),
    outline = Color(0xFF3D4A57),
    outlineVariant = Color(0xFF2A3440),
)

@Composable
fun CoreMapTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = CoreMapTypography,
        content = content,
    )
}
