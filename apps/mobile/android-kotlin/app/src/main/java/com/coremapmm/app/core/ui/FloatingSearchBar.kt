package com.coremapmm.app.core.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun FloatingSearchBar(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = stringResource(R.string.search_placeholder),
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = CoreMapSpacing.touchTargetMinHeight)
            .coreFloatingSurface(elevation = 3.dp, shape = CoreFloatingCardShape)
            .clickable(onClick = onClick)
            .padding(horizontal = CoreMapSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = placeholder,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = CoreMapSpacing.sm),
        )
    }
}

@Preview
@Composable
private fun FloatingSearchBarPreview() {
    CoreMapTheme {
        FloatingSearchBar(onClick = {})
    }
}
