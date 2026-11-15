package com.madar.rep.app.media

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Surface
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.madar.rep.app.MadarApplication
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.db.VisitState
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CameraActivity : ComponentActivity() {
    private var imageCapture: ImageCapture? = null
    private val executor = Executors.newSingleThreadExecutor()
    private var cameraPermissionGranted by mutableStateOf(false)
    private var savedPhotoCount by mutableStateOf(0)
    private var savedInThisSession = false
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraPermissionGranted = granted
        if (!granted) {
            setResult(RESULT_CANCELED, Intent().putExtra("error", "يلزم إذن الكاميرا للتصوير."))
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val visitUuid = intent.getStringExtra(EXTRA_VISIT_UUID)
        val phase = intent.getStringExtra(EXTRA_PHASE)
        if (visitUuid.isNullOrBlank() || (phase != "before" && phase != "after")) {
            setResult(RESULT_CANCELED, Intent().putExtra("error", "طلب تصوير غير صالح"))
            finish()
            return
        }
        cameraPermissionGranted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        savedPhotoCount = intent.getIntExtra(EXTRA_EXISTING_COUNT, 0).coerceAtLeast(0)
        if (!cameraPermissionGranted) permissionLauncher.launch(Manifest.permission.CAMERA)
        setContent {
            if (cameraPermissionGranted) {
                CameraScreen(
                    phase = phase,
                    machineCode = intent.getStringExtra(EXTRA_MACHINE_CODE).orEmpty(),
                    machineName = intent.getStringExtra(EXTRA_MACHINE_NAME).orEmpty(),
                    existingCount = intent.getIntExtra(EXTRA_EXISTING_COUNT, 0),
                    onClose = { finishCaptureSession() },
                    onCapture = { onCapture(visitUuid, phase) },
                )
            } else {
                Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    Text("بانتظار إذن الكاميرا…", color = Color.White)
                }
            }
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun finishCaptureSession() {
        if (savedInThisSession) {
            setResult(RESULT_OK, Intent().putExtra("phase", intent.getStringExtra(EXTRA_PHASE)))
        }
        finish()
    }

    private fun onCapture(visitUuid: String, phase: String) {
        val capture = imageCapture ?: run {
            Toast.makeText(this, "الكاميرا غير جاهزة", Toast.LENGTH_SHORT).show()
            return
        }
        capture.targetRotation = display?.rotation ?: Surface.ROTATION_0
        val capturedAtMillis = System.currentTimeMillis()
        val container = (application as MadarApplication).container
        val state = CaptureUiState.busy
        updateCaptureState(state)
        val captureFile = container.photoStore.newCaptureFile(visitUuid, phase)
        capture.takePicture(
            ImageCapture.OutputFileOptions.Builder(captureFile).build(),
            executor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    executor.execute {
                        try {
                            val visit = kotlinx.coroutines.runBlocking { container.visitRepo.find(visitUuid) }
                                ?: throw MadarError.Validation("الزيارة غير موجودة")
                            if (visit.state != VisitState.DRAFT) throw MadarError.Validation("الزيارة أُرسلت بالفعل")
                            val existingPhotos = kotlinx.coroutines.runBlocking { container.visitRepo.photos(visitUuid) }
                                .filter { it.phase == phase }
                            if (!PhotoPolicy.validCount(existingPhotos.size + 1)) {
                                throw MadarError.Validation("الحد الأقصى ${PhotoPolicy.MAX_PER_PHASE} صورة لكل مرحلة")
                            }
                            val usedPositions = existingPhotos.map { it.position }.toSet()
                            val position = (0 until PhotoPolicy.MAX_PER_PHASE).firstOrNull { it !in usedPositions }
                                ?: throw MadarError.Validation("بلغت الحد التقني لصور هذه المرحلة")
                            val candidateLocation = when (val fix = kotlinx.coroutines.runBlocking { container.locationProvider.currentFix(7_000) }) {
                                is com.madar.rep.app.location.LocationResult.Success -> fix.point
                                else -> container.locationProvider.lastKnown()
                            }
                            // A cached fix is useful only when it is still demonstrably fresh and valid.
                            // Missing/stale GPS must not be stamped as the current capture location.
                            val location = candidateLocation?.takeIf { point ->
                                point.isFresh(capturedAtMillis) && !point.isMock &&
                                    point.latitude.isFinite() && point.longitude.isFinite() &&
                                    point.latitude in -90.0..90.0 && point.longitude in -180.0..180.0 &&
                                    point.accuracyMeters.isFinite() && point.accuracyMeters >= 0f
                            }
                            val photo = container.photoStore.commit(
                                visitUuid = visitUuid,
                                phase = phase,
                                position = position,
                                capturedFile = captureFile,
                                capturedAtMillis = capturedAtMillis,
                                location = location,
                                machineCode = visit.machineCode,
                                machineName = visit.machineName,
                                regionName = visit.regionName,
                                areaName = visit.areaName,
                            )
                            kotlinx.coroutines.runBlocking { container.visitRepo.addPhoto(visitUuid, photo) }
                            captureFile.delete()
                            runOnUiThread {
                                savedInThisSession = true
                                savedPhotoCount = existingPhotos.size + 1
                                updateCaptureState(CaptureUiState.saved)
                            }
                        } catch (error: Exception) {
                            val message = error.message ?: "تعذر حفظ الصورة"
                            runOnUiThread {
                                updateCaptureState(CaptureUiState.error(message))
                            }
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    runOnUiThread {
                        updateCaptureState(CaptureUiState.error(exception.message ?: "تعذر التصوير"))
                    }
                }
            }
        )
    }

    private fun displayRotation(): Int = when (display?.rotation) {
        Surface.ROTATION_90 -> 90
        Surface.ROTATION_180 -> 180
        Surface.ROTATION_270 -> 270
        else -> 0
    }

    private fun updateCaptureState(value: CaptureUiState) {
        captureState = value
    }

    companion object {
        const val EXTRA_VISIT_UUID = "visitUuid"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_MACHINE_CODE = "machineCode"
        const val EXTRA_MACHINE_NAME = "machineName"
        const val EXTRA_EXISTING_COUNT = "existingCount"
    }

    private var captureState by mutableStateOf<CaptureUiState>(CaptureUiState.idle)

    private sealed interface CaptureUiState {
        data object idle : CaptureUiState
        data object busy : CaptureUiState
        data object saved : CaptureUiState
        data class error(val message: String) : CaptureUiState
    }

    @Composable
    private fun CameraScreen(
        phase: String,
        machineCode: String,
        machineName: String,
        existingCount: Int,
        onClose: () -> Unit,
        onCapture: () -> Unit,
    ) {
        val context = LocalContext.current
        val lifecycleOwner = LocalLifecycleOwner.current
        val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
        val state = captureState
        LaunchedEffect(Unit) {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                try {
                    val provider = future.get()
                    val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                    imageCapture = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .setJpegQuality(92)
                        .build()
                    provider.unbindAll()
                    provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                } catch (error: Exception) {
                    Toast.makeText(context, "تعذر تشغيل الكاميرا: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }, ContextCompat.getMainExecutor(context))
        }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
            Column(
                Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose, modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), CircleShape)) {
                        Icon(Icons.Default.Close, contentDescription = "إغلاق", tint = Color.White)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            if (phase == "before") "تصوير قبل الصيانة" else "تصوير بعد الصيانة",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        )
                        Text(
                            "$machineCode · ${machineName.ifBlank { "ماكينة" }} · ${savedPhotoCount}/${PhotoPolicy.MAX_PER_PHASE}",
                            color = Color.White.copy(alpha = 0.85f),
                            fontSize = 13.sp
                        )
                    }
                    Spacer(Modifier.size(48.dp))
                }
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (state is CaptureUiState.error) {
                        Text(
                            state.message,
                            color = Color(0xFFFFCDD2),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.background(Color.Black.copy(alpha = 0.55f)).padding(10.dp)
                        )
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Button(
                            onClick = onCapture,
                            enabled = state !is CaptureUiState.busy && savedPhotoCount < PhotoPolicy.MAX_PER_PHASE,
                            modifier = Modifier.size(84.dp),
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)
                        ) {
                            if (state is CaptureUiState.busy) {
                                CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(32.dp))
                            } else {
                                Box(Modifier.size(54.dp).background(Color(0xFFDCAA52), CircleShape))
                            }
                        }
                        Button(
                            onClick = onClose,
                            enabled = state !is CaptureUiState.busy,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF187B68)),
                        ) {
                            Text(if (savedPhotoCount > 0) "إنهاء · $savedPhotoCount صورة" else "إغلاق")
                        }
                    }
                    if (state == CaptureUiState.saved) {
                        Text("تم حفظ الصورة. يمكنك التقاط صورة أخرى.", color = Color(0xFFC8E6C9), textAlign = TextAlign.Center)
                    }
                    Text(
                        "سيتم ختم التاريخ والوقت والماكينة والموقع على الصورة",
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
            }
        }
    }
}
