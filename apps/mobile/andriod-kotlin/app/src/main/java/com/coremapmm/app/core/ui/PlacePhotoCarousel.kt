package com.coremapmm.app.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.core.design.CoreMapColors
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakePlaces

@Composable
fun PlacePhotoCarousel(
    photoUrls: List<String>,
    modifier: Modifier = Modifier,
    placeholderLabel: String = "Photo",
) {
    if (photoUrls.isEmpty()) {
        PlacePhotoPlaceholderCard(
            label = "No photos",
            modifier = modifier
                .height(160.dp)
                .fillMaxSize(),
        )
        return
    }

    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.sm),
        contentPadding = PaddingValues(horizontal = CoreMapSpacing.md),
    ) {
        itemsIndexed(photoUrls, key = { index, url -> "$index-$url" }) { index, _ ->
            PlacePhotoPlaceholderCard(
                label = "$placeholderLabel ${index + 1}",
                modifier = Modifier
                    .width(240.dp)
                    .height(160.dp),
            )
        }
    }
}

@Composable
private fun PlacePhotoPlaceholderCard(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .coreFloatingCard(elevation = 4.dp)
            .clip(CoreFloatingCardShape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = CoreMapColors.MapOnSurfaceMuted,
        )
    }
}

@Preview
@Composable
private fun PlacePhotoCarouselPreview() {
    CoreMapTheme {
        PlacePhotoCarousel(
            photoUrls = FakePlaces.discoverPlaces.first().photoUrls,
        )
    }
}
