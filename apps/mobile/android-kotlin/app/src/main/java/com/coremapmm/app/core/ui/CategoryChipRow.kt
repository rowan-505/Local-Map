package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme

@Composable
fun CategoryChipRow(
    categories: List<String>,
    selectedCategory: String?,
    onCategorySelected: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = CoreMapSpacing.screenHorizontal),
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = contentPadding,
    ) {
        items(categories, key = { it }) { category ->
            CoreSelectableChip(
                label = category,
                selected = category == selectedCategory,
                onClick = { onCategorySelected(category) },
            )
        }
    }
}

@Preview
@Composable
private fun CategoryChipRowPreview() {
    CoreMapTheme {
        CategoryChipRow(
            categories = listOf("All", "Landmark", "Market", "Hospital", "Bridge"),
            selectedCategory = "Landmark",
            onCategorySelected = {},
        )
    }
}
