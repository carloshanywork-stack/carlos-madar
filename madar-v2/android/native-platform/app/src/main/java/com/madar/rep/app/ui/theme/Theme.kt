package com.madar.rep.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp

val MadarInk = Color(0xFF15243A)
val MadarTeal = Color(0xFF187B68)
val MadarGold = Color(0xFFDCAA52)
val MadarCanvas = Color(0xFFF2F5F8)
val MadarDanger = Color(0xFFB3261E)
val MadarWarning = Color(0xFF8A5A00)
val MadarMuted = Color(0xFF5A6B7C)

// Amazon Flex Operational Palette
val FlexDarkHeader = Color(0xFF0F172A)
val FlexAmazonOrange = Color(0xFFFF9900)
val FlexGreenArrival = Color(0xFF007A3D)
val FlexStopBadge = Color(0xFF1E293B)
val FlexCardBorder = Color(0xFFE2E8F0)
val FlexSurfaceCard = Color(0xFFFFFFFF)

private val LightColors = lightColorScheme(
    primary = MadarTeal,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD6EFE8),
    onPrimaryContainer = Color(0xFF063A31),
    secondary = MadarGold,
    onSecondary = MadarInk,
    secondaryContainer = Color(0xFFF8E8C8),
    onSecondaryContainer = Color(0xFF4A3607),
    tertiary = MadarInk,
    background = MadarCanvas,
    onBackground = MadarInk,
    surface = Color.White,
    onSurface = MadarInk,
    surfaceVariant = Color(0xFFE6ECF1),
    onSurfaceVariant = Color(0xFF445362),
    outline = Color(0xFFBBC7D2),
    error = MadarDanger,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF7FD7C2),
    onPrimary = Color(0xFF00382E),
    primaryContainer = Color(0xFF0E5A4C),
    onPrimaryContainer = Color(0xFFD6EFE8),
    secondary = MadarGold,
    onSecondary = MadarInk,
    secondaryContainer = Color(0xFF5B430D),
    onSecondaryContainer = Color(0xFFF8E8C8),
    background = Color(0xFF0E1722),
    onBackground = Color(0xFFE8EDF2),
    surface = Color(0xFF152230),
    onSurface = Color(0xFFE8EDF2),
    surfaceVariant = Color(0xFF26384A),
    onSurfaceVariant = Color(0xFFC5D1DC),
    outline = Color(0xFF52677B),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

private val MadarTypography = Typography().run {
    copy(
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.Bold, fontSize = 26.sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 20.sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
        labelLarge = labelLarge.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = bodyLarge.copy(fontSize = 15.sp),
        bodyMedium = bodyMedium.copy(fontSize = 14.sp),
    )
}

@Composable
fun MadarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = MadarTypography,
            content = content,
        )
    }
}
