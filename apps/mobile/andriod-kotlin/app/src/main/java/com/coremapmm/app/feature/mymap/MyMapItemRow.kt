package com.coremapmm.app.feature.mymap

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakeMyMapData

@Composable
fun MyMapItemRow(
    item: MyMapItemUiModel,
    onClick: () -> Unit,
    onQuickAction: () -> Unit,
    modifier: Modifier = Modifier,
    showDivider: Boolean = true,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = CoreMapSpacing.item),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = item.iconType.toIcon(),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = CoreMapSpacing.item),
            ) {
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = item.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(
                onClick = onQuickAction,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    imageVector = item.quickAction.toIcon(),
                    contentDescription = quickActionLabel(item.quickAction),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (showDivider) {
            HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
        }
    }
}

@Composable
private fun quickActionLabel(action: MyMapQuickAction): String {
    return when (action) {
        MyMapQuickAction.Open -> stringResource(R.string.mymap_action_open)
        MyMapQuickAction.Navigate -> stringResource(R.string.mymap_action_navigate)
        MyMapQuickAction.More -> stringResource(R.string.mymap_action_more)
        MyMapQuickAction.Download -> stringResource(R.string.mymap_action_download)
        MyMapQuickAction.Remove -> stringResource(R.string.mymap_action_remove)
    }
}

private fun MyMapItemIconType.toIcon(): ImageVector = when (this) {
    MyMapItemIconType.Place -> Icons.Default.Place
    MyMapItemIconType.Route -> Icons.Default.Menu
    MyMapItemIconType.Search -> Icons.Default.Search
    MyMapItemIconType.Offline -> Icons.Default.Add
    MyMapItemIconType.Alert -> Icons.Default.Warning
    MyMapItemIconType.Pin -> Icons.Default.Star
    MyMapItemIconType.Cache -> Icons.Default.Place
    MyMapItemIconType.Report -> Icons.Default.Warning
}

private fun MyMapQuickAction.toIcon(): ImageVector = when (this) {
    MyMapQuickAction.Open -> Icons.Default.Place
    MyMapQuickAction.Navigate -> Icons.Default.Place
    MyMapQuickAction.More -> Icons.Default.Menu
    MyMapQuickAction.Download -> Icons.Default.Add
    MyMapQuickAction.Remove -> Icons.Default.Warning
}

@Preview(showBackground = true)
@Composable
private fun MyMapItemRowPreview() {
    CoreMapTheme {
        MyMapItemRow(
            item = FakeMyMapData.savedPlaces.first(),
            onClick = {},
            onQuickAction = {},
        )
    }
}
