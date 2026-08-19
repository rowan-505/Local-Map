package com.coremapmm.app.feature.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakePlaces
import com.coremapmm.app.core.model.PlaceUiModel
import com.coremapmm.app.core.ui.CoreFloatingCardShape
import com.coremapmm.app.core.ui.coreFloatingCard

private val PhotoShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)

@Composable
fun HotspotPlaceCard(
    place: PlaceUiModel,
    isSaved: Boolean,
    onClick: () -> Unit,
    onSaveClick: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .coreFloatingCard(elevation = 3.dp)
            .clickable(onClick = onClick),
        shape = CoreFloatingCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            PhotoPlaceholder(
                place = place,
                isSaved = isSaved,
                onSaveClick = onSaveClick,
                compact = compact,
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = CoreMapSpacing.sm,
                        vertical = CoreMapSpacing.sm,
                    ),
                verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.xs),
            ) {
                Text(
                    text = place.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = place.category,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (place.verified) {
                        VerifiedBadge(modifier = Modifier.padding(start = CoreMapSpacing.xs))
                    }
                }
                Text(
                    text = distanceOrRegion(place),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun PhotoPlaceholder(
    place: PlaceUiModel,
    isSaved: Boolean,
    onSaveClick: () -> Unit,
    compact: Boolean,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(if (compact) 76.dp else 112.dp)
            .clip(PhotoShape)
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.surfaceVariant,
                        CoreMapColors.PrimaryGreen.copy(alpha = 0.12f),
                    ),
                ),
            ),
    ) {
        Icon(
            imageVector = Icons.Default.Place,
            contentDescription = null,
            tint = CoreMapColors.MapOnSurfaceMuted.copy(alpha = 0.5f),
            modifier = Modifier
                .align(Alignment.Center)
                .size(28.dp),
        )
        SaveStar(
            isSaved = isSaved,
            onClick = onSaveClick,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun VerifiedBadge(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.widthIn(max = 76.dp),
        shape = RoundedCornerShape(50),
        color = CoreMapColors.SoftGreenBackground,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = CoreMapSpacing.xs, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = stringResource(R.string.discover_verified),
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(12.dp),
            )
            Text(
                text = stringResource(R.string.discover_verified).substringBefore(" "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SaveStar(
    isSaved: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(32.dp),
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
        shadowElevation = 1.dp,
    ) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(
                imageVector = Icons.Default.Star,
                contentDescription = stringResource(R.string.discover_save_place),
                tint = if (isSaved) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
                },
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

private fun distanceOrRegion(place: PlaceUiModel): String {
    val distance = place.distanceText
    return if (distance.isBlank() || distance == "—") place.region else distance
}

@Preview
@Composable
private fun HotspotPlaceCardPreview() {
    CoreMapTheme {
        HotspotPlaceCard(
            place = FakePlaces.countryHotspots.first(),
            isSaved = true,
            onClick = {},
            onSaveClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
