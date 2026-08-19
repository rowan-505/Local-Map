package com.coremapmm.app.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing

val CoreFloatingCardShape: Shape = RoundedCornerShape(24.dp)
val CoreSmallFloatingShape: Shape = RoundedCornerShape(18.dp)
val CoreSheetTopShape: Shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
val CoreChipShape: Shape = RoundedCornerShape(20.dp)
val CoreFieldShape: Shape = RoundedCornerShape(20.dp)
val CoreButtonShape: Shape = RoundedCornerShape(20.dp)
val CoreMapControlShape: Shape = RoundedCornerShape(24.dp)

object CoreBottomSheetStyle {
    val shape: Shape = CoreSheetTopShape
    val elevation: Dp = 10.dp
    val dragHandleWidth: Dp = 40.dp
    val dragHandleHeight: Dp = 4.dp
}

fun Modifier.coreFloatingCard(
    elevation: Dp = 3.dp,
    shape: Shape = CoreFloatingCardShape,
): Modifier = shadow(
    elevation = elevation,
    shape = shape,
    spotColor = CoreMapColors.MapShadow,
    ambientColor = CoreMapColors.MapShadow,
)

fun Modifier.coreFloatingBorder(
    shape: Shape = CoreFloatingCardShape,
    selected: Boolean = false,
): Modifier = border(
    width = 1.dp,
    color = if (selected) {
        CoreMapColors.PrimaryGreen.copy(alpha = 0.35f)
    } else {
        CoreMapColors.Border.copy(alpha = 0.72f)
    },
    shape = shape,
)

fun Modifier.coreFloatingSurface(
    elevation: Dp = 3.dp,
    shape: Shape = CoreFloatingCardShape,
    selected: Boolean = false,
): Modifier = coreFloatingCard(
    elevation = elevation,
    shape = shape,
)
    .coreFloatingBorder(shape = shape, selected = selected)
    .clip(shape)
    .background(
        if (selected) {
            CoreMapColors.SoftGreenBackground
        } else {
            CoreMapColors.Surface
        },
    )

@Composable
fun CoreFloatingCard(
    modifier: Modifier = Modifier,
    elevation: Dp = 3.dp,
    shape: Shape = CoreFloatingCardShape,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    if (onClick != null) {
        Surface(
            onClick = onClick,
            modifier = modifier,
            shape = shape,
            color = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
            shadowElevation = elevation,
            border = androidx.compose.foundation.BorderStroke(
                width = 1.dp,
                color = if (selected) {
                    CoreMapColors.PrimaryGreen.copy(alpha = 0.35f)
                } else {
                    CoreMapColors.Border.copy(alpha = 0.72f)
                },
            ),
        ) {
            Box(content = content)
        }
    } else {
        Box(
            modifier = modifier
                .coreFloatingSurface(elevation = elevation, shape = shape, selected = selected),
            content = content,
        )
    }
}
