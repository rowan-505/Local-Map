package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CoreTextFieldBox(
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
) {
    CoreFloatingCard(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = CoreMapSpacing.fieldBoxMinHeight),
        elevation = if (active) 4.dp else 2.dp,
        shape = CoreFieldShape,
        selected = active,
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(CoreMapSpacing.md),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = CoreMapSpacing.xs),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun CoreSearchTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String,
    leadingIcon: @Composable (() -> Unit)? = null,
    singleLine: Boolean = true,
    focusedAppearance: Boolean = false,
    requestFocusOnMount: Boolean = false,
) {
    val focusRequester = remember { FocusRequester() }
    val elevation = if (focusedAppearance) 6.dp else 2.dp
    val borderSelected = focusedAppearance

    LaunchedEffect(requestFocusOnMount) {
        if (requestFocusOnMount) {
            focusRequester.requestFocus()
        }
    }

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = CoreMapSpacing.touchTargetMinHeight)
            .focusRequester(focusRequester)
            .coreFloatingCard(elevation = elevation, shape = CoreFieldShape)
            .coreFloatingBorder(shape = CoreFieldShape, selected = borderSelected),
        placeholder = {
            Text(
                text = placeholder,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        leadingIcon = leadingIcon,
        singleLine = singleLine,
        shape = CoreFieldShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedBorderColor = CoreMapColors.PrimaryGreen.copy(alpha = 0.55f),
            unfocusedBorderColor = if (focusedAppearance) {
                CoreMapColors.PrimaryGreen.copy(alpha = 0.35f)
            } else {
                CoreMapColors.Border
            },
            cursorColor = MaterialTheme.colorScheme.primary,
        ),
    )
}

@Preview
@Composable
private fun CoreTextFieldBoxPreview() {
    CoreMapTheme {
        CoreTextFieldBox(
            label = "From",
            value = "Current location",
            onClick = {},
            active = true,
        )
    }
}
