package com.coremapmm.app.feature.discover

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.fake.FakeSearchData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class SearchUiState(
    val query: String = "",
    val selectedFilter: SearchFilter = SearchFilter.All,
    val recentSearches: List<String> = FakeSearchData.recentSearches,
    val results: List<SearchResultUiModel> = FakeSearchData.results,
)

class SearchViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    fun updateQuery(query: String) {
        _uiState.update { state ->
            state.copy(
                query = query,
                results = filterResults(query, state.selectedFilter),
            )
        }
    }

    fun selectFilter(filter: SearchFilter) {
        _uiState.update { state ->
            state.copy(
                selectedFilter = filter,
                results = filterResults(state.query, filter),
            )
        }
    }

    private fun filterResults(query: String, filter: SearchFilter): List<SearchResultUiModel> {
        return FakeSearchData.results.filter { result ->
            val matchesFilter = filter == SearchFilter.All || result.type == filter
            val matchesQuery = query.isBlank() ||
                result.title.contains(query, ignoreCase = true) ||
                result.township.contains(query, ignoreCase = true) ||
                result.region.contains(query, ignoreCase = true)
            matchesFilter && matchesQuery
        }
    }
}
