package com.coremapmm.app.core.fake

import com.coremapmm.app.feature.discover.SearchFilter
import com.coremapmm.app.feature.discover.SearchResultIconType
import com.coremapmm.app.feature.discover.SearchResultUiModel

object FakeSearchData {
    val recentSearches: List<String> = listOf(
        "Kyauktan Market",
        "Shwedagon Pagoda",
        "YBS 43",
        "Thanlyin Bridge",
    )

    val results: List<SearchResultUiModel> = listOf(
        SearchResultUiModel(
            id = "search-shwedagon",
            title = "Shwedagon Pagoda",
            type = SearchFilter.Places,
            township = "Dagon",
            region = "Yangon Region",
            distanceText = "2.4 km",
            placeId = "place-shwedagon-pagoda",
            iconType = SearchResultIconType.Place,
        ),
        SearchResultUiModel(
            id = "search-kyauktan-market",
            title = "Kyauktan Market",
            type = SearchFilter.Places,
            township = "Kyauktan",
            region = "Yangon Region",
            distanceText = "18 km",
            placeId = "place-kyauktan-market",
            iconType = SearchResultIconType.Place,
        ),
        SearchResultUiModel(
            id = "search-ybs-43",
            title = "YBS 43 to Kyauktan",
            type = SearchFilter.Bus,
            township = "Kyauktan",
            region = "Yangon Region",
            distanceText = null,
            placeId = "place-kyauktan-market",
            iconType = SearchResultIconType.Bus,
        ),
        SearchResultUiModel(
            id = "search-strand-road",
            title = "Strand Road",
            type = SearchFilter.Roads,
            township = "Kyauktada",
            region = "Yangon Region",
            distanceText = "1.2 km",
            placeId = "place-yangon-general-hospital",
            iconType = SearchResultIconType.Road,
        ),
        SearchResultUiModel(
            id = "search-bogyoke-address",
            title = "Bogyoke Aung San Road",
            type = SearchFilter.Address,
            township = "Lanmadaw",
            region = "Yangon Region",
            distanceText = "3.1 km",
            placeId = "place-yangon-general-hospital",
            iconType = SearchResultIconType.Address,
        ),
        SearchResultUiModel(
            id = "search-kyauktan-township",
            title = "Kyauktan Township",
            type = SearchFilter.Township,
            township = "Kyauktan",
            region = "Yangon Region",
            distanceText = null,
            placeId = "place-kyauktan-market",
            iconType = SearchResultIconType.Township,
        ),
        SearchResultUiModel(
            id = "search-thanlyin-bridge",
            title = "Thanlyin Bridge",
            type = SearchFilter.Places,
            township = "Thanlyin",
            region = "Yangon Region",
            distanceText = "12 km",
            placeId = "place-thanlyin-bridge",
            iconType = SearchResultIconType.Place,
        ),
        SearchResultUiModel(
            id = "search-ygh",
            title = "Yangon General Hospital",
            type = SearchFilter.Places,
            township = "Lanmadaw",
            region = "Yangon Region",
            distanceText = "3.1 km",
            placeId = "place-yangon-general-hospital",
            iconType = SearchResultIconType.Place,
        ),
    )
}
