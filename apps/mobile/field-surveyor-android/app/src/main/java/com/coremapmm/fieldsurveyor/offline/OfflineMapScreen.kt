package com.coremapmm.fieldsurveyor.offline

import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun OfflineMapScreen() {
    val context = LocalContext.current
    var status by remember { mutableStateOf("Preparing local PMTiles…") }
    val mapView = remember {
        MapView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
            onCreate(null)
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        mapView.onStart()
        mapView.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = {
                mapView.getMapAsync { map ->
                    try {
                        val styleJson = OfflineBasemap.loadRewrittenStyle(context)
                        val yangonReady = OfflineBasemap.yangonFile(context).let {
                            YangonBasemapStore.isComplete(it)
                        }
                        map.setStyle(Style.Builder().fromJson(styleJson)) {
                            map.uiSettings.isRotateGesturesEnabled = false
                            map.cameraPosition = CameraPosition.Builder()
                                .target(LatLng(16.84, 96.17))
                                .zoom(if (yangonReady) 12.0 else 5.5)
                                .build()
                            status = if (yangonReady) {
                                "Offline Yangon streets · pan/zoom enabled"
                            } else {
                                "Offline overview only · download Yangon on Setup for streets"
                            }
                        }
                    } catch (error: Exception) {
                        status = error.message ?: error.toString()
                    }
                }
                mapView
            },
            modifier = Modifier.fillMaxSize(),
        )
        Text(
            text = tr(status),
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.88f))
                .padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
