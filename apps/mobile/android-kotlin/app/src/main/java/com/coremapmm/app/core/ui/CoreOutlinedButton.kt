package com.coremapmm.app.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CoreOutlinedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .height(CoreMapSpacing.buttonHeight),
        shape = CoreButtonShape,
        border = BorderStroke(1.dp, CoreMapColors.Border),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 1.dp),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}

@Preview
@Composable
private fun CoreOutlinedButtonPreview() {
    CoreMapTheme {
        CoreOutlinedButton(text = "Swap", onClick = {})
    }
}
