package com.madar.rep.app.migration

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.setContent
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.madar.rep.app.AppContainer
import com.madar.rep.app.MadarApplication
import com.madar.rep.app.ui.InfoRow
import com.madar.rep.app.ui.InlineMessage
import com.madar.rep.app.ui.MadarTopBar
import com.madar.rep.app.ui.MessageTone
import com.madar.rep.app.ui.SectionCard
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning
import com.madar.rep.app.ui.theme.MadarTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * One-time import of the Capacitor-era data. The old SQLite queue is copied by
 * [com.madar.rep.app.data.migration.LegacySqliteImporter]; the IndexedDB queue is
 * exported through an invisible WebView served from `https://localhost`, which is
 * exactly the origin the old Capacitor app used. Neither importer deletes the old
 * files, and every item is recorded in the idempotency ledger.
 */
class LegacyMigrationActivity : FragmentActivity() {
    private val container: AppContainer by lazy { (application as MadarApplication).container }
    private val manager get() = container.migrationManager

    private var busy by mutableStateOf(false)
    private var done by mutableStateOf(false)
    private var errorMessage by mutableStateOf<String?>(null)
    private var showSkipConfirm by mutableStateOf(false)
    private var activeBridge: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MadarTheme {
                val progress by manager.state.collectAsStateWithLifecycle()
                LaunchedEffect(Unit) {
                    manager.refreshMarkers()
                    if (!manager.shouldRun()) {
                        done = true
                    } else {
                        startMigration()
                    }
                }
                MigrationScreen(
                    progress = progress,
                    busy = busy,
                    done = done,
                    error = errorMessage,
                    onStart = { startMigration() },
                    onFinish = { finish() },
                    onSkip = { showSkipConfirm = true },
                    onOpenReport = { manager.writeReport() },
                )
                if (showSkipConfirm) {
                    AlertDialog(
                        onDismissRequest = { showSkipConfirm = false },
                        title = { Text("المتابعة دون استعادة؟") },
                        text = {
                            Text(
                                "ستبقى بيانات التطبيق القديم وصوره في مكانها دون حذف. لن تُستعاد الزيارات المعلّقة الآن، وسيُعرض عليك الترحيل مرة أخرى عند إعادة فتح التطبيق. يمكنك أيضًا فتح هذه الشاشة من تبويب المزامنة لاحقًا."
                            )
                        },
                        confirmButton = {
                            TextButton(
                                onClick = {
                                    showSkipConfirm = false
                                    manager.addWarning(
                                        "تم تخطي الاستعادة بواسطة المندوب؛ لم تُحذف أي بيانات قديمة."
                                    )
                                    manager.writeReport()
                                    finish()
                                }
                            ) { Text("متابعة الآن", color = MadarWarning) }
                        },
                        dismissButton = {
                            TextButton(onClick = { showSkipConfirm = false }) { Text("إلغاء") }
                        },
                    )
                }
            }
        }
    }

    private fun startMigration() {
        if (busy) return
        busy = true
        errorMessage = null
        lifecycleScope.launch {
            try {
                manager.runSqlite()
                if (manager.needsBrowserBridge()) {
                    val raw = exportIndexedDb()
                    manager.runBrowser(raw)
                }
                manager.finish()
                done = true
            } catch (error: TimeoutCancellationException) {
                errorMessage = "انتهت مهلة قراءة تخزين المتصفح القديم. أعد المحاولة؛ لم يُحذف أي شيء."
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                errorMessage = error.message ?: "تعذر إكمال الاستعادة"
            } finally {
                busy = false
                manager.writeReport()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private suspend fun exportIndexedDb(): String = withContext(Dispatchers.Main) {
        val deferred = CompletableDeferred<String>()
        val loader = WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this@LegacyMigrationActivity))
            .build()
        val webView = WebView(this@LegacyMigrationActivity)
        activeBridge = webView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webView.alpha = 0f
        webView.isFocusable = false
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "localhost"

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    deferred.completeExceptionally(
                        IllegalStateException("تعذر تحميل جسر الاستعادة: ${error.description}")
                    )
                }
            }
        }
        webView.addJavascriptInterface(
            MigrationBridge { text -> deferred.complete(text) },
            "MadarLegacyBridge",
        )
        webView.resumeTimers()
        webView.onResume()
        addContentView(webView, ViewGroup.LayoutParams(1, 1))
        webView.loadUrl("https://localhost/legacy-bridge.html")
        try {
            withTimeout(300_000) { deferred.await() }
        } finally {
            runCatching { webView.stopLoading() }
            runCatching { webView.removeJavascriptInterface("MadarLegacyBridge") }
            runCatching { (webView.parent as? ViewGroup)?.removeView(webView) }
            runCatching { webView.destroy() }
            activeBridge = null
        }
    }

    override fun onDestroy() {
        runCatching {
            activeBridge?.let { webView ->
                runCatching { (webView.parent as? ViewGroup)?.removeView(webView) }
                runCatching { webView.destroy() }
            }
        }
        activeBridge = null
        super.onDestroy()
    }
}

/** Public JS bridge target; the method name is referenced by legacy-bridge.html. */
class MigrationBridge(private val sink: (String) -> Unit) {
    @JavascriptInterface
    fun onResult(text: String) {
        sink(text)
    }
}

@Composable
private fun MigrationScreen(
    progress: com.madar.rep.app.data.migration.MigrationProgress,
    busy: Boolean,
    done: Boolean,
    error: String?,
    onStart: () -> Unit,
    onFinish: () -> Unit,
    onSkip: () -> Unit,
    onOpenReport: () -> Unit,
) {
    androidx.compose.material3.Scaffold(
        topBar = {
            MadarTopBar(
                title = "استعادة بيانات MADAR",
                subtitle = "ترحيل لمرة واحدة دون حذف الأصل",
                onBack = { if (!busy) onFinish() },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = when {
                        error != null -> MadarDanger.copy(alpha = 0.1f)
                        done -> MadarTeal.copy(alpha = 0.12f)
                        else -> MaterialTheme.colorScheme.primary
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            when {
                                error != null -> Icon(
                                    Icons.Default.ErrorOutline,
                                    contentDescription = null,
                                    tint = MadarDanger,
                                )
                                done -> Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = MadarTeal,
                                )
                                else -> Icon(
                                    Icons.Default.HourglassTop,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onPrimary,
                                )
                            }
                            Spacer(Modifier.size(10.dp))
                            Text(
                                when {
                                    error != null -> "تحتاج الاستعادة إلى تدخل"
                                    done -> "اكتملت الاستعادة"
                                    busy -> "جارٍ نسخ البيانات القديمة…"
                                    else -> "الاستعادة جاهزة"
                                },
                                style = MaterialTheme.typography.titleLarge,
                                color = when {
                                    error != null -> MadarDanger
                                    done -> MadarTeal
                                    else -> MaterialTheme.colorScheme.onPrimary
                                },
                            )
                        }
                        Text(
                            when {
                                error != null -> "ملفات التطبيق القديم ما زالت في مكانها. أصلح السبب ثم أعد المحاولة."
                                done -> "الزيارات والصور والحالات المعلّقة نُسخت بسجل منع تكرار. لم تُحذف أي بيانات قديمة."
                                busy -> "تُقرأ قاعدة SQLite ثم تخزين المتصفح القديم. لا تغلق التطبيق."
                                else -> "ابدأ الاستعادة لنسخ الزيارات المعلّقة والصور قبل استخدام التطبيق الجديد."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = when {
                                error != null -> MadarDanger
                                done -> MadarTeal
                                else -> MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f)
                            },
                        )
                        if (busy) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                        }
                    }
                }
            }

            if (error != null) {
                item { InlineMessage(error, MessageTone.Error) }
            }

            item {
                SectionCard(title = "مراحل الترحيل") {
                    StepRow(
                        title = "قاعدة بيانات SQLite القديمة",
                        subtitle = "madar_rep_local.db والصور في MADAR/uploads",
                        complete = progress.sqliteDone,
                        active = busy && progress.phase == "sqlite",
                    )
                    StepRow(
                        title = "تخزين المتصفح (IndexedDB)",
                        subtitle = "أصل https://localhost نفسه الذي استخدمه تطبيق Capacitor",
                        complete = progress.browserDone,
                        active = busy && progress.phase == "browser",
                    )
                    StepRow(
                        title = "إغلاق الترحيل",
                        subtitle = "تسجيل علامة لمرة واحدة وكتابة تقرير",
                        complete = progress.finished,
                        active = busy && progress.phase.isBlank() && progress.sqliteDone && progress.browserDone,
                    )
                }
            }

            item {
                SectionCard(title = "ما تم نسخه حتى الآن") {
                    InfoRow("الزيارات", progress.counts.visits.toString(), emphasize = progress.counts.visits > 0)
                    InfoRow("الصور", progress.counts.photos.toString(), emphasize = progress.counts.photos > 0)
                    InfoRow("إجراءات الماكينات", progress.counts.machineActions.toString())
                    InfoRow("إجراءات الحضور", progress.counts.attendance.toString())
                    InfoRow("لقطات المسار", progress.counts.routeSnapshots.toString())
                    InfoRow("أسباب الأعطال", progress.counts.reasons.toString())
                    InfoRow("عناصر متخطاة (مكررة)", progress.counts.skipped.toString())
                    if (progress.current.isNotBlank()) {
                        Text(
                            "جارٍ الآن: ${progress.current}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                        )
                    }
                }
            }

            if (progress.warnings.isNotEmpty() || progress.errors.isNotEmpty()) {
                item {
                    SectionCard(title = "ملاحظات وتنبيهات") {
                        progress.warnings.forEach { warning ->
                            InlineMessage(warning, MessageTone.Warning)
                        }
                        progress.errors.forEach { item ->
                            InlineMessage(item, MessageTone.Error)
                        }
                    }
                }
            }

            item {
                SectionCard(title = "تقرير الترحيل") {
                    Text(
                        "ملف التقرير: ${progress.counts.visits} زيارة، ${progress.counts.photos} صورة، ${progress.counts.skipped} عنصرًا مكررًا.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                    OutlinedButton(onClick = onOpenReport, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Storage, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("إعادة كتابة ملف التقرير")
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (error != null) {
                        Button(
                            onClick = onStart,
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) { Text("إعادة المحاولة", fontWeight = FontWeight.Bold) }
                    }
                    if (done) {
                        Button(
                            onClick = onFinish,
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) { Text("فتح التطبيق", fontWeight = FontWeight.Bold) }
                    }
                    if (!done && !busy) {
                        Button(
                            onClick = onStart,
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) { Text("بدء الاستعادة", fontWeight = FontWeight.Bold) }
                        OutlinedButton(
                            onClick = onSkip,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("المتابعة دون استعادة الآن", color = MadarGold) }
                    }
                    Text(
                        "لا تُحذف قاعدة البيانات القديمة ولا صورها. كل عنصر يُسجَّل في سجل منع التكرار، لذا يمكن إيقاف الاستعادة وإعادة تشغيلها بأمان.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                }
            }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun StepRow(title: String, subtitle: String, complete: Boolean, active: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (active) {
            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        } else {
            Icon(
                if (complete) Icons.Default.CheckCircle else Icons.Default.HourglassTop,
                contentDescription = null,
                tint = if (complete) MadarTeal else MadarMuted,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
        }
    }
}
