package com.coremapmm.app.feature.place

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.SheetLevel

@Composable
fun RandomPointSheet(
    sheetLevel: SheetLevel,
    randomPoint: RandomPointUiState,
    modifier: Modifier = Modifier,
    onActionClick: (String) -> Unit = {},
) {
    if (sheetLevel == SheetLevel.Hidden) return

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = CoreMapSpacing.fullSheetScrollBottomPadding),
    ) {
        Text(
            text = stringResource(R.string.random_point_title),
            style = MaterialTheme.typography.headlineMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = "${randomPoint.township} · ${randomPoint.region}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.sm),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = stringResource(R.string.random_point_coordinates, randomPoint.coordinatesText),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.sm),
        )
        Text(
            text = stringResource(R.string.random_point_plus_code, randomPoint.plusCode),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
        )
        if (sheetLevel != SheetLevel.Mini) {
            PlaceActionRow(
                actions = listOf(
                    PlaceActionItem(PlaceActionId.Save, stringResource(R.string.random_point_save)),
                    PlaceActionItem(PlaceActionId.From, stringResource(R.string.place_action_from)),
                    PlaceActionItem(PlaceActionId.To, stringResource(R.string.place_action_to)),
                    PlaceActionItem(PlaceActionId.Share, stringResource(R.string.place_action_share)),
                    PlaceActionItem(PlaceActionId.Report, stringResource(R.string.random_point_report)),
                ),
                onActionClick = { action -> onActionClick(action.label) },
                modifier = Modifier.padding(top = CoreMapSpacing.md),
            )
        }
    }
}

@Preview(showBackground = true, heightDp = 200)
@Composable
private fun RandomPointSheetPreview() {
    CoreMapTheme {
        RandomPointSheet(
            sheetLevel = SheetLevel.Default,
            randomPoint = RandomPointUiState(),
        )
    }
}
