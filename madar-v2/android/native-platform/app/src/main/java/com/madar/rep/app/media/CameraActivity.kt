package com.madar.rep.app.media

import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.MadarTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

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
import com.madar.rep.app.core.SupportDiagnostics
import com.madar.rep.app.data.api.DiagnosticFailure
import com.madar.rep.app.data.api.DiagnosticOperation
import com.madar.rep.app.data.sync.diagnosticFailureFor
import com.madar.rep.app.data.db.VisitState
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CameraActivity : ComponentActivity() {
    private var imageCapture: ImageCapture? = null
    private val executor = Executors.newSingleThreadExecutor()
    private var cameraPermissionGranted by mutableStateOf(false)
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
        if (!cameraPermissionGranted) permissionLauncher.launch(Manifest.permission.CAMERA)
        setContent {
            if (cameraPermissionGranted) {
                CameraScreen(
                    phase = phase,
                    machineCode = intent.getStringExtra(EXTRA_MACHINE_CODE).orEmpty(),
                    machineName = intent.getStringExtra(EXTRA_MACHINE_NAME).orEmpty(),
                    existingCount = intent.getIntExtra(EXTRA_EXISTING_COUNT, 0) + capturedCount,
                    onClose = { if(capturedCount > 0) setResult(RESULT_OK); finish() },
                    onCapture = { onCapture(visitUuid, phase) },
                )
            } else {
                Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    Text("بانتظار إذن الكاميرا…", color = Color.White)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        (application as? MadarApplication)?.container?.locationProvider?.startVisitTracking()
    }

    override fun onStop() {
        (application as? MadarApplication)?.container?.locationProvider?.stopVisitTracking()
        super.onStop()
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun onCapture(visitUuid: String, phase: String) {
        val capture = imageCapture ?: run {
            Toast.makeText(this, "الكاميرا غير جاهزة", Toast.LENGTH_SHORT).show()
            return
        }
        capture.targetRotation = currentDisplayRotation()
        val container = (application as MadarApplication).container
        val ownerRepId = container.sessions.session.value?.ownerScopeId
        val state = CaptureUiState.busy
        assignCaptureState(state)
        val capturedAt = System.currentTimeMillis()
        val frozenLocation = container.locationProvider.lastKnownValid(20_000L)
            ?: livePoint?.takeIf { it.isFresh(capturedAt, 30_000L) && !it.isMock }
        val captureFile = try {
            container.photoStore.newCaptureFile(visitUuid, phase)
        } catch (error: Exception) {
            if (diagnosticFailureFor(error) != null) reportCaptureFailure(ownerRepId)
            assignCaptureState(CaptureUiState.error("تعذر تجهيز ملف الصورة."))
            return
        }
        capture.takePicture(
            ImageCapture.OutputFileOptions.Builder(captureFile).build(),
            executor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
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
                        val location = frozenLocation

                        // Fast durable step: Commits immutable original and journal to disk immediately (<300ms)
                        val durablePhoto = container.photoStore.commitFastDurable(
                            visitUuid = visitUuid,
                            phase = phase,
                            position = position,
                            capturedFile = captureFile,
                            capturedAtMillis = capturedAt,
                            location = location,
                            machineCode = visit.machineCode,
                            machineName = visit.machineName,
                            regionName = visit.regionName,
                            areaName = visit.areaName,
                        )
                        kotlinx.coroutines.runBlocking { container.visitRepo.addPhoto(visitUuid, durablePhoto) }

                        // Immediately unblock the shutter and show preview to allow the next shot
                        runOnUiThread {
                            setResult(
                                RESULT_OK,
                                Intent().putExtra("photoId", durablePhoto.id).putExtra("phase", phase)
                            )
                            capturedCount += 1
                            previewPath = durablePhoto.originalPath
                            assignCaptureState(CaptureUiState.idle)
                        }

                        // Run watermarking, compression, SHA-256, and gallery export off-thread with bounded concurrency
                        PhotoProcessingPipeline.enqueue(
                            photo = durablePhoto,
                            machineCode = visit.machineCode,
                            ownerRepId = visit.ownerRepId,
                            container = container,
                            onComplete = { processed ->
                                runOnUiThread {
                                    if (previewPath == durablePhoto.originalPath) {
                                        previewPath = processed.processedPath
                                    }
                                }
                            },
                            onGalleryError = {
                                runOnUiThread {
                                    Toast.makeText(this@CameraActivity, "تم حفظ الصورة داخل التطبيق، لكن تعذر نسخها إلى Pictures/MADAR.", Toast.LENGTH_LONG).show()
                                }
                            }
                        )
                    } catch (error: Exception) {
                        if (diagnosticFailureFor(error) != null) reportCaptureFailure(ownerRepId)
                        // The raw capture remains durable for recovery on processing failure.
                        val message = error.message ?: "تعذر حفظ الصورة"
                        runOnUiThread {
                            assignCaptureState(CaptureUiState.error(message))
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    captureFile.delete()
                    if (exception.imageCaptureError != ImageCapture.ERROR_CAMERA_CLOSED && !isFinishing && !isDestroyed) {
                        reportCaptureFailure(ownerRepId)
                    }
                    runOnUiThread {
                        assignCaptureState(CaptureUiState.error(exception.message ?: "تعذر التصوير"))
                    }
                }
            }
        )
    }

    private fun reportCaptureFailure(ownerRepId: Long?) {
        SupportDiagnostics.record("camera", "capture_err")
        (application as MadarApplication).container.automaticDiagnostics.recordAsync(
            ownerRepId, DiagnosticOperation.CAMERA_CAPTURE, DiagnosticFailure.CAPTURE_FAILED,
        )
    }

    @Suppress("DEPRECATION")
    private fun currentDisplayRotation(): Int = windowManager.defaultDisplay.rotation

    private fun displayRotation(): Int = when (currentDisplayRotation()) {
        Surface.ROTATION_90 -> 90
        Surface.ROTATION_180 -> 180
        Surface.ROTATION_270 -> 270
        else -> 0
    }

    private fun assignCaptureState(value: CaptureUiState) {
        captureState = value
    }

    companion object {
        const val EXTRA_VISIT_UUID = "visitUuid"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_MACHINE_CODE = "machineCode"
        const val EXTRA_MACHINE_NAME = "machineName"
        const val EXTRA_EXISTING_COUNT = "existingCount"
    }

    private var capturedCount by mutableStateOf(0)
    private var previewPath by mutableStateOf<String?>(null)
    private var livePoint by mutableStateOf<GeoPoint?>(null)
    private var captureState by mutableStateOf<CaptureUiState>(CaptureUiState.idle)

    private sealed interface CaptureUiState {
        data object idle : CaptureUiState
        data object busy : CaptureUiState
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
        var clock by remember { mutableStateOf(System.currentTimeMillis()) }
        LaunchedEffect(Unit) { while (kotlinx.coroutines.currentCoroutineContext().isActive) { clock=System.currentTimeMillis(); delay(1000) } }
        LaunchedEffect(Unit) {
            val container = (application as MadarApplication).container
            livePoint = container.locationProvider.lastKnownValid()
            container.locationProvider.visitStatus.collect { status ->
                when (status) {
                    is com.madar.rep.app.location.VisitLocationStatus.HighAccuracy -> livePoint = status.point
                    is com.madar.rep.app.location.VisitLocationStatus.Provisional -> livePoint = status.point
                    else -> Unit
                }
            }
        }
        LaunchedEffect(Unit) {
            val ownerRepId = (application as MadarApplication).container.sessions.session.value?.ownerScopeId
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
                    if (!isFinishing && !isDestroyed) {
                        if (diagnosticFailureFor(error) != null) reportCaptureFailure(ownerRepId)
                        Toast.makeText(context, "تعذر تشغيل الكاميرا: ${error.message}", Toast.LENGTH_LONG).show()
                    }
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
                            "$machineCode · ${machineName.ifBlank { "ماكينة" }} · ${existingCount}/${PhotoPolicy.MAX_PER_PHASE}",
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
                    val stampPoint=livePoint?.takeIf { it.isFresh(clock) && !it.isMock }
                    Column(Modifier.fillMaxWidth().background(Color.Black.copy(alpha=0.7f)).padding(8.dp)) {
                        val brand=remember { runCatching { assets.open("watermark-logo.png").use(android.graphics.BitmapFactory::decodeStream) }.getOrNull() }
                        brand?.let { Image(it.asImageBitmap(),contentDescription="A to Z",modifier=Modifier.height(40.dp)) }
                        Text("A to Z · $machineCode · ${MadarTime.watermark(clock).time}",color=Color.White)
                        Text(stampPoint?.let { "GPS ${it.latitude}, ${it.longitude} ±${it.accuracyMeters.toInt()}م" } ?: "الموقع غير متاح · الصورة ستظل محفوظة",color=Color.White)
                        stampPoint?.let { (application as MadarApplication).container.governorates.find(it.latitude,it.longitude)?.nameAr }?.let { Text("المحافظة: $it",color=Color.White) }
                    }
                    previewPath?.let { path ->
                        val bitmap=remember(path) { android.graphics.BitmapFactory.decodeFile(path) }
                        bitmap?.let { Image(it.asImageBitmap(), contentDescription="آخر صورة محفوظة بالواترمارك",modifier=Modifier.height(100.dp)) }
                    }
                    if (capturedCount > 0) Button(onClick=onClose) { Text("تم · الرجوع للصور المحفوظة") }
                    if (state is CaptureUiState.error) {
                        Text(
                            state.message,
                            color = Color(0xFFFFCDD2),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.background(Color.Black.copy(alpha = 0.55f)).padding(10.dp)
                        )
                    }
                    Button(
                        onClick = onCapture,
                        enabled = state !is CaptureUiState.busy && existingCount < PhotoPolicy.MAX_PER_PHASE,
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
