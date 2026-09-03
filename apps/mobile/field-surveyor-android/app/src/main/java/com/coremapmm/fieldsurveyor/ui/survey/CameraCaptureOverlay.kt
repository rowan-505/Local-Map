package com.coremapmm.fieldsurveyor.ui.survey

import android.graphics.BitmapFactory
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun CameraCaptureOverlay(
    onCaptured: (File) -> Unit,
    onClose: () -> Unit,
    onError: (String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val imageCapture = remember {
        ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .setJpegQuality(95)
            .build()
    }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var zoomRatio by remember { mutableFloatStateOf(1f) }
    var reviewFile by remember { mutableStateOf<File?>(null) }
    var capturing by remember { mutableStateOf(false) }
    val previewView = remember {
        PreviewView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }
    val scaleDetector = remember {
        ScaleGestureDetector(
            context,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    val active = camera ?: return false
                    val state = active.cameraInfo.zoomState.value ?: return false
                    val next = (state.zoomRatio * detector.scaleFactor)
                        .coerceIn(state.minZoomRatio, state.maxZoomRatio)
                    active.cameraControl.setZoomRatio(next)
                    zoomRatio = next
                    return true
                }
            },
        )
    }
    val mainExecutor: Executor = remember { ContextCompat.getMainExecutor(context) }

    DisposableEffect(lifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        val listener = Runnable {
            runCatching {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                provider.unbindAll()
                camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture,
                )
            }.onFailure { onError(it.message ?: "Camera could not start") }
        }
        future.addListener(listener, mainExecutor)
        onDispose {
            runCatching { future.get().unbindAll() }
        }
    }

    var downX = remember { 0f }
    var downY = remember { 0f }
    DisposableEffect(previewView, camera) {
        previewView.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                }
                MotionEvent.ACTION_UP -> {
                    if (!scaleDetector.isInProgress && abs(event.x - downX) < 24f && abs(event.y - downY) < 24f) {
                        val point = previewView.meteringPointFactory.createPoint(event.x, event.y)
                        val action = FocusMeteringAction.Builder(
                            point,
                            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE,
                        ).setAutoCancelDuration(3, TimeUnit.SECONDS).build()
                        camera?.cameraControl?.startFocusAndMetering(action)
                    }
                }
            }
            true
        }
        onDispose { previewView.setOnTouchListener(null) }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
        reviewFile?.let { file ->
            val bitmap = remember(file.absolutePath) { loadPreviewBitmap(file) }
            if (bitmap != null) {
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = tr("Captured photo preview"),
                    modifier = Modifier.fillMaxSize().background(Color.Black),
                    contentScale = ContentScale.Fit,
                )
            }
        }

        Surface(
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 18.dp),
            shape = RoundedCornerShape(100.dp),
            color = Color.Black.copy(alpha = 0.68f),
        ) {
            Text(
                if (reviewFile == null) {
                    "${tr("Tap to focus · pinch to zoom")} · ${"%.1f".format(zoomRatio)}×"
                } else {
                    tr("Review photo")
                },
                color = Color.White,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }

        TextButton(
            onClick = {
                reviewFile?.delete()
                onClose()
            },
            modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
        ) { Text(tr("Close"), color = Color.White) }

        if (reviewFile == null) {
            Button(
                onClick = {
                    if (capturing) return@Button
                    capturing = true
                    val file = File(context.cacheDir, "field-capture-${System.currentTimeMillis()}.jpg")
                    val options = ImageCapture.OutputFileOptions.Builder(file).build()
                    imageCapture.takePicture(
                        options,
                        mainExecutor,
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                capturing = false
                                reviewFile = file
                            }

                            override fun onError(exception: ImageCaptureException) {
                                capturing = false
                                file.delete()
                                onError(exception.message ?: "Camera failed")
                            }
                        },
                    )
                },
                enabled = !capturing,
                modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp),
            ) { Text(tr(if (capturing) "Capturing…" else "Take photo")) }
        } else {
            Row(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(20.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        reviewFile?.delete()
                        reviewFile = null
                    },
                    modifier = Modifier.weight(1f),
                ) { Text(tr("Retake")) }
                Button(
                    onClick = {
                        val accepted = reviewFile ?: return@Button
                        reviewFile = null
                        onCaptured(accepted)
                    },
                    modifier = Modifier.weight(1f),
                ) { Text(tr("Use photo")) }
            }
        }
    }
}

private fun loadPreviewBitmap(file: File) = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
    BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
}.getOrNull()
