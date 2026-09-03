package com.coremapmm.fieldsurveyor.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val FieldLightColors = lightColorScheme(
    primary = Color(0xFF007A59),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD5F5E8),
    onPrimaryContainer = Color(0xFF003829),
    secondary = Color(0xFF49685B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE1F1E9),
    tertiary = Color(0xFF336B7D),
    tertiaryContainer = Color(0xFFD8F1FA),
    background = Color(0xFFF5F8F6),
    onBackground = Color(0xFF17201C),
    surface = Color(0xFFFBFDFB),
    onSurface = Color(0xFF17201C),
    surfaceVariant = Color(0xFFE5ECE8),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF8FAF9),
    surfaceContainerHigh = Color(0xFFEDF3EF),
    outline = Color(0xFF708078),
    outlineVariant = Color(0xFFC8D3CD),
    error = Color(0xFFB3261E),
)

private val FieldDarkColors = darkColorScheme(
    primary = Color(0xFF6CDBAC),
    onPrimary = Color(0xFF003827),
    primaryContainer = Color(0xFF005139),
    onPrimaryContainer = Color(0xFF8AF8C7),
    secondary = Color(0xFFAFCDBB),
    secondaryContainer = Color(0xFF314B3F),
    tertiary = Color(0xFFA5CDDF),
    tertiaryContainer = Color(0xFF244C5C),
    background = Color(0xFF101512),
    surface = Color(0xFF101512),
    surfaceVariant = Color(0xFF404943),
    outline = Color(0xFF89938C),
)

private val FieldTypography = Typography(
    headlineLarge = TextStyle(fontSize = 24.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold),
    headlineMedium = TextStyle(fontSize = 22.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontSize = 20.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 19.sp, lineHeight = 29.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 23.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun FieldTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) FieldDarkColors else FieldLightColors,
        typography = FieldTypography,
        content = content,
    )
}
