package com.rowan.townmap.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.rowan.townmap.core.model.Place
import com.rowan.townmap.feature.map.presentation.MapScreen
import com.rowan.townmap.feature.places.navigation.PlaceNavigationStore
import com.rowan.townmap.feature.places.presentation.PlaceDetailScreen
import com.rowan.townmap.feature.search.presentation.SearchScreen
import com.rowan.townmap.feature.settings.presentation.SettingsScreen

@Composable
fun TownMapNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = TownMapRoutes.MAP,
        modifier = modifier
    ) {
        townMapGraph(navController)
    }
}

private fun NavGraphBuilder.townMapGraph(navController: NavHostController) {
    fun openPlaceDetail(place: Place) {
        PlaceNavigationStore.remember(place)
        navController.navigate(TownMapRoutes.placeDetail(place.id))
    }

    composable(TownMapRoutes.MAP) {
        MapScreen(
            onPlaceSelected = { place -> openPlaceDetail(place) },
            onSearchClick = { navController.navigate(TownMapRoutes.SEARCH) },
            onSettingsClick = { navController.navigate(TownMapRoutes.SETTINGS) },
            onMyLocationClick = { /* reserved for future map SDK */ }
        )
    }
    composable(TownMapRoutes.SEARCH) {
        SearchScreen(
            onNavigateUp = navController::navigateUp,
            onPlaceSelected = { place -> openPlaceDetail(place) }
        )
    }
    composable(
        route = TownMapRoutes.PLACE_DETAIL,
        arguments = listOf(
            navArgument(TownMapRoutes.PLACE_ID_ARG) { type = NavType.StringType }
        )
    ) { backStackEntry ->
        val placeIdRaw = backStackEntry.arguments?.getString(TownMapRoutes.PLACE_ID_ARG).orEmpty()
        val placeId = Uri.decode(placeIdRaw)
        PlaceDetailScreen(
            placeId = placeId,
            onNavigateUp = navController::navigateUp
        )
    }
    composable(TownMapRoutes.SETTINGS) {
        SettingsScreen(
            onNavigateUp = navController::navigateUp
        )
    }
}
