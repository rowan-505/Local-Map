package com.coremapmm.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.lifecycle.viewmodel.compose.viewModel
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.fake.FakePlaces
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.model.CoreMapTab
import com.coremapmm.app.core.ui.CoreBottomNav
import com.coremapmm.app.core.ui.CoreDraggableSheet
import com.coremapmm.app.core.ui.CoreTopMapOverlay
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.feature.discover.DiscoverViewModel
import com.coremapmm.app.feature.discover.DiscoverSearchFullScreen
import com.coremapmm.app.feature.discover.DiscoverSheetContent
import com.coremapmm.app.feature.discover.SearchResultUiModel
import com.coremapmm.app.feature.discover.SearchSheet
import com.coremapmm.app.feature.discover.SearchViewModel
import com.coremapmm.app.feature.place.ActivePlaceSheet
import com.coremapmm.app.feature.place.PlaceDetailSheet
import com.coremapmm.app.feature.place.PlaceViewModel
import com.coremapmm.app.feature.place.RandomPointSheet
import com.coremapmm.app.feature.report.ReportIssueSheet
import com.coremapmm.app.feature.transit.RouteDetailSheet
import com.coremapmm.app.feature.transit.RouteResultSheet
import com.coremapmm.app.feature.transit.TransitSheet
import com.coremapmm.app.feature.transit.TransitSheetMode
import com.coremapmm.app.feature.transit.TransitViewModel
import com.coremapmm.app.feature.mymap.MyMapItemUiModel
import com.coremapmm.app.feature.mymap.MyMapSheet
import com.coremapmm.app.feature.mymap.SubmitCommunityInfoSheet
import com.coremapmm.app.feature.settings.SettingsService
import com.coremapmm.app.feature.settings.SettingsSheet
import com.coremapmm.app.feature.settings.SettingsViewModel
import com.coremapmm.app.map.MapControls
import com.coremapmm.app.map.MapPlaceholder
import com.coremapmm.app.map.MapUiState

@Composable
fun CoreMapApp() {
    CoreMapTheme {
        val shellState = rememberMapShellState()
        val placeViewModel: PlaceViewModel = viewModel()
        val transitViewModel: TransitViewModel = viewModel()
        val settingsViewModel: SettingsViewModel = viewModel()
        val searchViewModel: SearchViewModel = viewModel()
        val discoverViewModel: DiscoverViewModel = viewModel()
        val searchState by searchViewModel.uiState.collectAsState()
        val discoverState by discoverViewModel.uiState.collectAsState()
        val placeState by placeViewModel.state.collectAsState()
        val transitState by transitViewModel.uiState.collectAsState()
        val settingsState by settingsViewModel.uiState.collectAsState()
        var reportContext by remember { mutableStateOf<String?>(null) }
        var isCommunityInfoOpen by remember { mutableStateOf(false) }

        val systemBars = WindowInsets.systemBars.asPaddingValues()
        val layoutDirection = LocalLayoutDirection.current
        val endInset = systemBars.calculateEndPadding(layoutDirection)

        fun openPlace(placeId: String) {
            placeViewModel.openPlace(placeId)
            shellState.onMarkerSelected(placeId)
            shellState.updateSheetLevel(SheetLevel.Default)
        }

        fun openRandomPoint() {
            shellState.onMapTapped()
            placeViewModel.openRandomPoint()
            shellState.updateSheetLevel(SheetLevel.Default)
        }

        fun openSearch() {
            placeViewModel.openSearch()
        }

        fun closeSearch() {
            placeViewModel.closeSearch()
        }

        fun onSearchResultClick(result: SearchResultUiModel) {
            result.placeId?.let(::openPlace)
        }

        fun openReport(contextLabel: String) {
            reportContext = contextLabel
        }

        fun closeReport() {
            reportContext = null
        }

        fun openCommunityInfo() {
            isCommunityInfoOpen = true
        }

        fun closeCommunityInfo() {
            isCommunityInfoOpen = false
        }

        val isSearchActive = placeState.activeSheet == ActivePlaceSheet.Search
        val isReportOpen = reportContext != null
        val isMainMapBackedState = placeState.activeSheet == ActivePlaceSheet.None &&
            when (shellState.selectedTab) {
                CoreMapTab.Discover -> true
                CoreMapTab.Transit -> transitState.sheetMode == TransitSheetMode.Planner
                CoreMapTab.MyMap -> true
                CoreMapTab.Settings -> settingsState.activeService == null &&
                    shellState.sheetLevel != SheetLevel.Full
            }
        val showGlobalTopOverlay = !isSearchActive &&
            !isReportOpen &&
            !isCommunityInfoOpen &&
            isMainMapBackedState
        val showDiscoverReportQuickAction = !isSearchActive &&
            !isReportOpen &&
            !isCommunityInfoOpen &&
            shellState.selectedTab == CoreMapTab.Discover &&
            placeState.activeSheet == ActivePlaceSheet.None
        val shouldHandleBack = isCommunityInfoOpen ||
            isReportOpen ||
            isSearchActive ||
            placeState.activeSheet != ActivePlaceSheet.None ||
            transitState.routeResultsHeaderExpanded ||
            transitState.sheetMode != TransitSheetMode.Planner ||
            settingsState.activeService != null ||
            shellState.sheetLevel != SheetLevel.Hidden ||
            shellState.selectedTab != CoreMapTab.Discover

        BackHandler(enabled = shouldHandleBack) {
            when {
                isCommunityInfoOpen -> closeCommunityInfo()
                isReportOpen -> closeReport()
                shellState.selectedTab == CoreMapTab.Transit &&
                    transitState.sheetMode == TransitSheetMode.RouteResults &&
                    transitState.routeResultsHeaderExpanded -> {
                    transitViewModel.collapseRouteResultsHeader()
                }
                isSearchActive -> closeSearch()
                placeState.activeSheet is ActivePlaceSheet.PlaceDetail ||
                    placeState.activeSheet == ActivePlaceSheet.RandomPoint -> {
                    placeViewModel.clearOverlay()
                    shellState.onMapTapped()
                    shellState.updateSheetLevel(SheetLevel.Default)
                }
                shellState.selectedTab == CoreMapTab.Transit &&
                    transitState.sheetMode == TransitSheetMode.RouteInput -> {
                    transitViewModel.closeRouteInput()
                    shellState.updateSheetLevel(SheetLevel.Detail)
                }
                shellState.selectedTab == CoreMapTab.Transit &&
                    transitState.sheetMode == TransitSheetMode.RouteResults -> {
                    transitViewModel.backFromRouteResults()
                    shellState.updateSheetLevel(
                        if (transitState.returnToRouteInputOnResultsBack) {
                            SheetLevel.Full
                        } else {
                            SheetLevel.Detail
                        },
                    )
                }
                shellState.selectedTab == CoreMapTab.Transit &&
                    transitState.sheetMode == TransitSheetMode.RouteDetail &&
                    shellState.sheetLevel == SheetLevel.Full -> {
                    shellState.updateSheetLevel(SheetLevel.Detail)
                }
                shellState.selectedTab == CoreMapTab.Transit &&
                    transitState.sheetMode == TransitSheetMode.RouteDetail -> {
                    if (transitState.routeResults.isNotEmpty()) {
                        transitViewModel.backToResults()
                        shellState.updateSheetLevel(SheetLevel.Full)
                    } else {
                        transitViewModel.backToPlanner()
                        shellState.updateSheetLevel(SheetLevel.Detail)
                    }
                }
                settingsState.activeService != null -> {
                    settingsViewModel.closeService()
                    shellState.updateSheetLevel(SheetLevel.Default)
                }
                shellState.selectedTab == CoreMapTab.MyMap &&
                    shellState.sheetLevel == SheetLevel.Full -> {
                    shellState.updateSheetLevel(SheetLevel.Default)
                }
                shellState.sheetLevel == SheetLevel.Full -> {
                    shellState.updateSheetLevel(SheetLevel.Detail)
                }
                shellState.sheetLevel == SheetLevel.Detail -> {
                    shellState.updateSheetLevel(SheetLevel.Default)
                }
                shellState.sheetLevel == SheetLevel.Default -> {
                    shellState.updateSheetLevel(SheetLevel.Mini)
                }
                shellState.sheetLevel == SheetLevel.Mini -> {
                    shellState.updateSheetLevel(SheetLevel.Hidden)
                }
                shellState.selectedTab != CoreMapTab.Discover -> {
                    shellState.onTabSelected(CoreMapTab.Discover)
                    shellState.updateSheetLevel(SheetLevel.Hidden)
                }
            }
        }

        Box(modifier = Modifier.fillMaxSize()) {
            val mapState = MapUiState(
                selectedMarkerId = shellState.selectedMarkerId,
                routeOverlay = if (shellState.selectedTab == CoreMapTab.Transit) {
                    transitState.routeOverlay
                } else {
                    null
                },
            )
            MapPlaceholder(
                state = mapState,
                modifier = Modifier.fillMaxSize(),
                onMarkerClick = ::openPlace,
                onMapClick = ::openRandomPoint,
            )

            Column(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = endInset + CoreMapSpacing.md),
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                MapControls(
                    onLayersClick = {},
                    onSavedClick = {},
                    onCurrentLocationClick = {},
                )
                if (showDiscoverReportQuickAction) {
                    ReportQuickAction(
                        onClick = { openReport("Map: Discover") },
                    )
                }
            }

            if (showGlobalTopOverlay) {
                CoreTopMapOverlay(
                    selectedTab = shellState.selectedTab,
                    categories = discoverState.categories,
                    selectedCategory = discoverState.selectedCategory,
                    onCategorySelected = discoverViewModel::selectCategory,
                    onSearchClick = ::openSearch,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }

            CoreDraggableSheet(
                level = shellState.sheetLevel,
                onLevelChange = shellState::updateSheetLevel,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = CoreMapSpacing.bottomBarHeight),
            ) {
                SheetContent(
                    selectedTab = shellState.selectedTab,
                    sheetLevel = shellState.sheetLevel,
                    placeViewModel = placeViewModel,
                    transitViewModel = transitViewModel,
                    discoverViewModel = discoverViewModel,
                    onPlaceClick = ::openPlace,
                    onOpenSearch = ::openSearch,
                    onOpenReport = ::openReport,
                    onOpenCommunityInfo = ::openCommunityInfo,
                    onSearchBack = ::closeSearch,
                    onSearchResultClick = ::onSearchResultClick,
                    onPlanRoutes = {
                        transitViewModel.planRoutes()
                        shellState.updateSheetLevel(SheetLevel.Full)
                    },
                    onMyMapItemClick = { item ->
                        item.placeId?.let(::openPlace)
                    },
                    onExpandFull = { shellState.updateSheetLevel(SheetLevel.Full) },
                    onCollapseDefault = { shellState.updateSheetLevel(SheetLevel.Default) },
                    onShowDetail = { shellState.updateSheetLevel(SheetLevel.Detail) },
                    settingsViewModel = settingsViewModel,
                    onOpenSettingsService = { service ->
                        settingsViewModel.openService(service)
                        shellState.updateSheetLevel(SheetLevel.Full)
                    },
                )
            }

            if (isSearchActive) {
                DiscoverSearchFullScreen(
                    uiState = searchState,
                    searchQuery = searchState.query,
                    onSearchQueryChange = searchViewModel::updateQuery,
                    onSearchBack = ::closeSearch,
                    selectedSearchFilter = searchState.selectedFilter,
                    onSearchFilterSelected = searchViewModel::selectFilter,
                    onRecentClick = searchViewModel::updateQuery,
                    onResultClick = ::onSearchResultClick,
                    modifier = Modifier
                        .fillMaxSize()
                        .align(Alignment.TopCenter),
                )
            }

            if (isReportOpen) {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(bottom = CoreMapSpacing.bottomBarHeight),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    ReportIssueSheet(contextLabel = reportContext)
                }
            }

            if (isCommunityInfoOpen) {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(bottom = CoreMapSpacing.bottomBarHeight),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    SubmitCommunityInfoSheet()
                }
            }

            CoreBottomNav(
                selectedTab = shellState.selectedTab,
                onTabSelected = { tab ->
                    placeViewModel.clearOverlay()
                    if (tab != CoreMapTab.Transit) {
                        transitViewModel.clearTransit()
                    }
                    if (tab != CoreMapTab.Settings) {
                        settingsViewModel.closeService()
                    }
                    shellState.onTabSelected(tab)
                },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

@Composable
private fun ReportQuickAction(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ExtendedFloatingActionButton(
        onClick = onClick,
        modifier = modifier,
        icon = {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = null,
            )
        },
        text = { Text(text = "Report") },
    )
}

@Composable
private fun ColumnScope.SheetContent(
    selectedTab: CoreMapTab,
    sheetLevel: SheetLevel,
    placeViewModel: PlaceViewModel,
    transitViewModel: TransitViewModel,
    discoverViewModel: DiscoverViewModel,
    onPlaceClick: (String) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenReport: (String) -> Unit,
    onOpenCommunityInfo: () -> Unit,
    onSearchBack: () -> Unit,
    onSearchResultClick: (SearchResultUiModel) -> Unit,
    onPlanRoutes: () -> Unit,
    onMyMapItemClick: (MyMapItemUiModel) -> Unit,
    onExpandFull: () -> Unit,
    onCollapseDefault: () -> Unit,
    onShowDetail: () -> Unit,
    settingsViewModel: SettingsViewModel,
    onOpenSettingsService: (SettingsService) -> Unit,
) {
    val placeState by placeViewModel.state.collectAsState()
    val transitState by transitViewModel.uiState.collectAsState()

    when (val activeSheet = placeState.activeSheet) {
        ActivePlaceSheet.Search -> {
            SearchSheet(
                sheetLevel = sheetLevel,
                onBack = onSearchBack,
                onResultClick = onSearchResultClick,
            )
        }
        is ActivePlaceSheet.PlaceDetail -> {
            val place = FakePlaces.byId(activeSheet.placeId)
            val detail = placeState.placeDetail
            if (place != null && detail != null) {
                PlaceDetailSheet(
                    sheetLevel = sheetLevel,
                    place = place,
                    isSaved = detail.isSaved,
                    selectedTab = detail.selectedTab,
                    onTabSelected = placeViewModel::selectDetailTab,
                    onToggleSave = placeViewModel::toggleSave,
                    onActionClick = { action ->
                        if (action == "Report") {
                            onOpenReport("Place: ${place.name}")
                        }
                    },
                )
            }
        }
        ActivePlaceSheet.RandomPoint -> {
            RandomPointSheet(
                sheetLevel = sheetLevel,
                randomPoint = placeState.randomPoint,
            )
        }
        ActivePlaceSheet.None -> {
            when (selectedTab) {
                CoreMapTab.Discover -> DiscoverSheetContent(
                    sheetLevel = sheetLevel,
                    onPlaceClick = onPlaceClick,
                    onSearchClick = onOpenSearch,
                    viewModel = discoverViewModel,
                )
                CoreMapTab.Transit -> {
                    when (transitState.sheetMode) {
                        TransitSheetMode.Planner -> TransitSheet(
                            uiState = transitState,
                            sheetLevel = sheetLevel,
                            onModeSelected = transitViewModel::selectPlannerMode,
                            onPlanRoutes = onPlanRoutes,
                            onRecentRouteClick = { onPlanRoutes() },
                            onRouteFieldClick = {
                                transitViewModel.openRouteInput(it)
                                onExpandFull()
                            },
                            onRoutePlaceSelected = transitViewModel::selectRoutePlace,
                            onSwapRouteFields = transitViewModel::swapRouteFields,
                        )
                        TransitSheetMode.RouteInput -> TransitSheet(
                            uiState = transitState,
                            sheetLevel = sheetLevel,
                            onModeSelected = transitViewModel::selectPlannerMode,
                            onPlanRoutes = onPlanRoutes,
                            onRecentRouteClick = { onPlanRoutes() },
                            onRouteFieldClick = transitViewModel::openRouteInput,
                            onRoutePlaceSelected = transitViewModel::selectRoutePlace,
                            onSwapRouteFields = transitViewModel::swapRouteFields,
                            onRouteInputBack = {
                                transitViewModel.closeRouteInput()
                                onCollapseDefault()
                            },
                        )
                        TransitSheetMode.RouteResults -> RouteResultSheet(
                            sheetLevel = sheetLevel,
                            routes = transitState.routeResults,
                            selectedRouteId = transitState.selectedRouteId,
                            fromText = transitState.fromText,
                            toText = transitState.toText,
                            routeInputExpanded = transitState.routeResultsHeaderExpanded,
                            selectedMode = transitState.selectedPlannerMode,
                            onModeSelected = transitViewModel::selectPlannerMode,
                            onRouteInputExpandedChange = transitViewModel::setRouteResultsHeaderExpanded,
                            onFindRoutes = onPlanRoutes,
                            onSwapRouteFields = transitViewModel::swapRouteFields,
                            onRouteSelected = { routeId ->
                                transitViewModel.selectRoute(routeId)
                                onShowDetail()
                            },
                            onRouteOpen = { routeId ->
                                transitViewModel.selectRoute(routeId)
                                onShowDetail()
                            },
                            onBack = {
                                transitViewModel.backFromRouteResults()
                                if (transitState.returnToRouteInputOnResultsBack) {
                                    onExpandFull()
                                } else {
                                    onCollapseDefault()
                                }
                            },
                        )
                        TransitSheetMode.RouteDetail -> {
                            val route = transitState.selectedRouteId?.let(FakeRoutes::byId)
                            if (route != null) {
                                RouteDetailSheet(
                                    route = route,
                                    sheetLevel = sheetLevel,
                                    destinationName = transitState.toText,
                                    onBack = transitViewModel::backToResults,
                                    onReportIssue = { onOpenReport("Route: ${route.title}") },
                                )
                            }
                        }
                    }
                }
                CoreMapTab.MyMap -> MyMapSheet(
                    sheetLevel = sheetLevel,
                    onItemClick = onMyMapItemClick,
                    onMenuSelected = onExpandFull,
                    onSendInfoClick = onOpenCommunityInfo,
                )
                CoreMapTab.Settings -> SettingsSheet(
                    sheetLevel = sheetLevel,
                    onOpenService = onOpenSettingsService,
                    viewModel = settingsViewModel,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                )
            }
        }
    }
}
