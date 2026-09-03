package com.coremapmm.fieldsurveyor.nav

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.coremapmm.fieldsurveyor.AppGraph
import androidx.compose.runtime.rememberCoroutineScope
import com.coremapmm.fieldsurveyor.ui.login.LoginScreen
import com.coremapmm.fieldsurveyor.ui.outbox.OutboxScreen
import com.coremapmm.fieldsurveyor.ui.routes.RoutesScreen
import com.coremapmm.fieldsurveyor.ui.settings.ProfileScreen
import com.coremapmm.fieldsurveyor.ui.settings.SettingsHomeScreen
import com.coremapmm.fieldsurveyor.ui.settings.SettingsPage
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences
import com.coremapmm.fieldsurveyor.ui.settings.tr
import com.coremapmm.fieldsurveyor.ui.setup.SetupSyncScreen
import com.coremapmm.fieldsurveyor.ui.survey.SurveyScreen
import com.coremapmm.fieldsurveyor.work.FieldWork
import kotlinx.coroutines.launch

@Composable
fun FieldNavHost(graph: AppGraph, display: FieldPreferences) {
    val session by graph.auth.session.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val start = when {
        session == null -> FieldRoutes.Login
        !graph.yangon.isReady() -> FieldRoutes.Setup
        else -> FieldRoutes.Routes
    }
    val backStack by navController.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    val showTabs = current in FieldRoutes.mainTabs || FieldRoutes.settingsSection(current)

    fun loggedOut() {
        navController.navigate(FieldRoutes.Login) {
            popUpTo(navController.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }

    Scaffold(
        bottomBar = {
            if (showTabs) {
                FieldBottomBar(
                    currentRoute = current,
                    onRoutes = { navController.openTab(FieldRoutes.Routes) },
                    onSurvey = { navController.openTab(FieldRoutes.Survey) },
                    onSettings = { navController.openTab(FieldRoutes.Settings) },
                )
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = start,
            modifier = Modifier.padding(padding),
        ) {
            composable(FieldRoutes.Login) {
                val context = LocalContext.current
                LoginScreen(
                    auth = graph.auth,
                    apiBaseUrl = graph.apiBaseUrl,
                    onLoggedIn = {
                        FieldWork.enqueue(context)
                        navController.navigate(FieldRoutes.Setup) {
                            popUpTo(FieldRoutes.Login) { inclusive = true }
                        }
                    },
                )
            }
            composable(FieldRoutes.Setup) {
                SetupSyncScreen(
                    bootstrap = graph.bootstrap,
                    yangon = graph.yangon,
                    onDisplaySettings = { navController.navigate(FieldRoutes.Settings) },
                    onContinue = {
                        navController.navigate(FieldRoutes.Routes) {
                            popUpTo(FieldRoutes.Setup) { inclusive = true }
                        }
                    },
                )
            }
            composable(FieldRoutes.Routes) {
                val scope = rememberCoroutineScope()
                RoutesScreen(
                    bootstrap = graph.bootstrap,
                    onNeedSync = { navController.navigate(FieldRoutes.Infra) },
                    onSelectVariant = { row ->
                        scope.launch {
                            graph.survey.selectVariant(row)
                            navController.openTab(FieldRoutes.Survey)
                        }
                    },
                )
            }
            composable(FieldRoutes.Survey) { SurveyScreen(graph.survey) }
            composable(FieldRoutes.Settings) {
                SettingsHomeScreen(
                    language = display.language,
                    themeMode = display.themeMode,
                    onLanguage = display::updateLanguage,
                    onThemeMode = display::updateThemeMode,
                    onProfile = { navController.navigate(FieldRoutes.Profile) },
                    onOutbox = { navController.navigate(FieldRoutes.Outbox) },
                    onInfra = { navController.navigate(FieldRoutes.Infra) },
                )
            }
            composable(FieldRoutes.Profile) {
                SettingsPage(title = tr("Profile"), onBack = { navController.popBackStack() }) {
                    ProfileScreen(
                        auth = graph.auth,
                        apiBaseUrl = graph.apiBaseUrl,
                        onLoggedOut = { loggedOut() },
                    )
                }
            }
            composable(FieldRoutes.Outbox) {
                OutboxScreen(
                    reports = graph.reports,
                    photos = graph.photos,
                    reportMedia = graph.reportMedia,
                    onBack = { navController.popBackStack() },
                )
            }
            composable(FieldRoutes.Infra) {
                SettingsPage(title = tr("Infra"), onBack = { navController.popBackStack() }) {
                    SetupSyncScreen(
                        bootstrap = graph.bootstrap,
                        yangon = graph.yangon,
                        title = "",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(FieldRoutes.Routes) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
