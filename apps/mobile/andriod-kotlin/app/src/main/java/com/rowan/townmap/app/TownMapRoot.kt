package com.rowan.townmap.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import com.rowan.townmap.navigation.TownMapNavHost

@Composable
fun TownMapRoot() {
    val navController = rememberNavController()
    TownMapNavHost(
        navController = navController,
        modifier = Modifier.fillMaxSize()
    )
}
