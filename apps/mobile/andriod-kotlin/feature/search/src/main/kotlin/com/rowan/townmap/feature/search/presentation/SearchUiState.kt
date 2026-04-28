package com.rowan.townmap.feature.search.presentation

import com.rowan.townmap.core.model.Place

data class SearchUiState(
    val query: String = "",
    val results: List<Place> = emptyList()
) {
    /** Message for the empty-results panel; only used when [results] is empty. */
    val emptyStateMessage: String
        get() = if (query.isNotBlank()) {
            "No places match your search."
        } else {
            "No places to show."
        }
}
