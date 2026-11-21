package com.madar.rep.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterCenterFocus
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.madar.rep.app.core.GeoBounds
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.core.TileMath
import com.madar.rep.app.core.TileViewport
import com.madar.rep.app.data.api.RouteMachine
import com.madar.rep.app.data.db.MapPackEntity
import com.madar.rep.app.data.db.MapPackState
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.map.MapRepository
import com.madar.rep.app.data.map.MbTileKey
import com.madar.rep.app.data.map.MbTilesStore
import com.madar.rep.app.data.repo.RouteView
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning
import java.io.File
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private data class MapMarker(
    val machine: RouteMachine,
    val latitude: Double,
    val longitude: Double,
    val hasLocalVisit: Boolean,
)

/**
 * Offline raster map. Tiles come only from the locally installed, licence-checked
 * MBTiles pack. No online tile provider and no Google Maps component is used. The
 * governorate outlines come from the bundled licensed GeoJSON and are drawn as a
 * reference layer, never as a substitute for a missing map pack.
 */
@Composable
fun MapScreen(
    vm: MadarViewModel,
    mapRepository: MapRepository,
    governorates: GovernorateIndex,
    routeView: RouteView?,
    openVisits: List<VisitEntity>,
    onOpenMachine: (RouteMachine) -> Unit,
) {
    val packs by vm.mapPacks.collectAsStateWithLifecycle()
    val download by vm.mapDownload.collectAsStateWithLifecycle()
    val catalogState by vm.mapCatalogState.collectAsStateWithLifecycle()
    val serverPoints by vm.mapPoints.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.refreshMapPoints() }

    var selectedPackId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<MapPackEntity?>(null) }
    var mapSize by remember { mutableStateOf(IntSize.Zero) }
    var centerLat by rememberSaveable { mutableStateOf(26.82) }
    var centerLon by rememberSaveable { mutableStateOf(30.80) }
    var zoom by rememberSaveable { mutableStateOf(6) }
    var fittedKey by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedMarker by remember { mutableStateOf<MapMarker?>(null) }

    val verified = packs.filter { it.state == MapPackState.VERIFIED }
    val activePack = verified.firstOrNull { it.id == selectedPackId } ?: verified.firstOrNull()
    val minZoom = (activePack?.minZoom ?: 5).coerceIn(0, 22)
    val maxZoom = (activePack?.maxZoom ?: 12).coerceIn(minZoom, 22)

    LaunchedEffect(verified.map { it.id }) {
        if (selectedPackId == null) selectedPackId = verified.firstOrNull()?.id
    }
    LaunchedEffect(activePack?.id) {
        zoom = zoom.coerceIn(minZoom, maxZoom)
    }

    val markers = remember(routeView, openVisits, serverPoints) {
        val openCards = openVisits.map { it.cardId }.toSet()
        val remoteByCardId = serverPoints.associateBy { it.cardId }
        routeView?.route?.regions.orEmpty().flatMap { region ->
            region.machines.mapNotNull { machine ->
                val remote = remoteByCardId[machine.cardId]
                val latitude = remote?.latitude ?: machine.approvedLocation?.latitude ?: machine.latitude
                val longitude = remote?.longitude ?: machine.approvedLocation?.longitude ?: machine.longitude
                if (latitude == null || longitude == null) null
                else MapMarker(machine, latitude, longitude, machine.cardId in openCards)
            }
        }
    }

    val routeBounds = remember(markers) {
        if (markers.isEmpty()) return@remember null
        val minLat = markers.minOf { it.latitude }
        val maxLat = markers.maxOf { it.latitude }
        val minLon = markers.minOf { it.longitude }
        val maxLon = markers.maxOf { it.longitude }
        val span = max(maxLat - minLat, maxLon - minLon)
        val pad = max(span * 0.18, 0.01)
        GeoBounds(
            west = (minLon - pad).coerceAtLeast(-180.0),
            south = (minLat - pad).coerceAtLeast(-85.0),
            east = (maxLon + pad).coerceAtMost(180.0),
            north = (maxLat + pad).coerceAtMost(85.0),
        )
    }
    val packBounds = activePack?.let { mapRepository.boundsOf(it) }
    val viewport = TileViewport(centerLat, centerLon, zoom.toDouble(), mapSize.width, mapSize.height)

    LaunchedEffect(activePack?.id, mapSize, routeBounds, packBounds) {
        if (mapSize.width <= 0 || mapSize.height <= 0) return@LaunchedEffect
        val bounds = routeBounds ?: packBounds ?: return@LaunchedEffect
        val key = "${activePack?.id ?: "none"}:${bounds.west}:${bounds.south}:${bounds.east}:${bounds.north}"
        if (fittedKey == key) return@LaunchedEffect
        val fitted = TileMath.fitBounds(bounds, mapSize.width, mapSize.height, minZoom, maxZoom)
        centerLat = fitted.centerLatitude
        centerLon = fitted.centerLongitude
        zoom = fitted.zoom.roundToInt().coerceIn(minZoom, maxZoom)
        fittedKey = key
    }

    val storeState = produceState<MbTilesStore?>(initialValue = null, activePack?.id, activePack?.path, activePack?.state) {
        val pack = activePack
        value = if (pack == null) {
            null
        } else {
            withContext(Dispatchers.IO) {
                runCatching { MbTilesStore(File(pack.path)).open(readOnly = true) }.getOrNull()
            }
        }
    }
    val store = storeState.value
    DisposableEffect(store) {
        onDispose { store?.closeQuietly() }
    }

    val cache = remember(activePack?.id) { mutableStateMapOf<MbTileKey, ImageBitmap>() }
    val visibleTiles = remember(viewport, minZoom, maxZoom, store) {
        if (store == null) emptyList() else TileMath.visibleTiles(viewport, minZoom, maxZoom)
    }

    LaunchedEffect(store, visibleTiles) {
        val currentStore = store ?: return@LaunchedEffect
        val keys = visibleTiles.map { MbTileKey(it.z, it.x, it.y) }.distinct()
        val missing = keys.filter { it !in cache }
        if (missing.isEmpty()) return@LaunchedEffect
        delay(40)
        val loaded = withContext(Dispatchers.IO) {
            missing.mapNotNull { key ->
                val bytes = runCatching { currentStore.readTile(key.z, key.x, key.y) }.getOrNull()
                    ?: return@mapNotNull null
                val bitmap = runCatching {
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }.getOrNull() ?: return@mapNotNull null
                key to bitmap.asImageBitmap()
            }
        }
        loaded.forEach { (key, image) -> cache[key] = image }
        if (cache.size > 240) {
            val keep = keys.toSet()
            cache.keys.filter { it !in keep }
                .take((cache.size - 200).coerceAtLeast(1))
                .forEach { cache.remove(it) }
        }
    }

    LaunchedEffect(markers) {
        val selected = selectedMarker ?: return@LaunchedEffect
        if (markers.none { it.machine.cardId == selected.machine.cardId }) selectedMarker = null
    }

    val viewportState = rememberUpdatedState(viewport)
    val markersState = rememberUpdatedState(markers)
    val minZoomState = rememberUpdatedState(minZoom)
    val maxZoomState = rememberUpdatedState(maxZoom)

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .onSizeChanged { mapSize = it }
                .pointerInput(activePack?.id) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var lastCentroid = down.position
                        var total = Offset.Zero
                        var pointers = 1
                        var zoomAccumulator = 1f
                        var zoomed = false
                        var event = awaitPointerEvent()
                        while (event.changes.any { it.pressed }) {
                            val pressed = event.changes.filter { it.pressed }
                            if (pressed.isEmpty()) break
                            pointers = maxOf(pointers, pressed.size)
                            val centroid = pressed.fold(Offset.Zero) { acc, change -> acc + change.position } /
                                pressed.size.toFloat()
                            val pan = centroid - lastCentroid
                            if (pressed.size >= 2) {
                                val factor = event.calculateZoom()
                                if (factor.isFinite() && factor > 0f) zoomAccumulator *= factor
                                if (zoomAccumulator > 1.3f) {
                                    zoom = (zoom + 1).coerceIn(minZoomState.value, maxZoomState.value)
                                    zoomAccumulator = 1f
                                    zoomed = true
                                } else if (zoomAccumulator < 0.77f) {
                                    zoom = (zoom - 1).coerceIn(minZoomState.value, maxZoomState.value)
                                    zoomAccumulator = 1f
                                    zoomed = true
                                }
                                total += pan
                            } else if (pan != Offset.Zero) {
                                val current = viewportState.value
                                if (current.widthPx > 0 && current.heightPx > 0) {
                                    val next = TileMath.screenToLatLon(
                                        current.widthPx / 2.0 - pan.x,
                                        current.heightPx / 2.0 - pan.y,
                                        current,
                                    )
                                    centerLat = next.first.coerceIn(-80.0, 80.0)
                                    centerLon = wrapLongitude(next.second)
                                    total += pan
                                }
                            }
                            lastCentroid = centroid
                            event.changes.forEach { change -> if (change.positionChanged()) change.consume() }
                            event = awaitPointerEvent()
                        }
                        if (pointers == 1 && !zoomed && total.getDistance() < 16.dp.toPx()) {
                            val current = viewportState.value
                            val tap = down.position
                            selectedMarker = markersState.value.mapNotNull { marker ->
                                val (x, y) = TileMath.worldToScreen(marker.latitude, marker.longitude, current)
                                val distance = hypot(x - tap.x, y - tap.y)
                                if (distance <= 30.dp.toPx()) marker to distance else null
                            }.minByOrNull { it.second }?.first
                        }
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                drawRect(Color(0xFFE7EDF1))

                for (tile in visibleTiles) {
                    val image = cache[MbTileKey(tile.z, tile.x, tile.y)] ?: continue
                    drawImage(
                        image = image,
                        dstOffset = IntOffset(tile.leftPx.roundToInt(), tile.topPx.roundToInt()),
                        dstSize = IntSize(tile.sizePx.roundToInt() + 1, tile.sizePx.roundToInt() + 1),
                        filterQuality = FilterQuality.Low,
                    )
                }

                if (mapSize.width > 0 && mapSize.height > 0) {
                    val northWest = TileMath.screenToLatLon(0.0, 0.0, viewport)
                    val southEast = TileMath.screenToLatLon(
                        mapSize.width.toDouble(),
                        mapSize.height.toDouble(),
                        viewport,
                    )
                    val visibleBounds = GeoBounds(
                        west = northWest.second,
                        south = southEast.first,
                        east = southEast.second,
                        north = northWest.first,
                    )
                    for (governorate in governorates.all()) {
                            for (polygon in governorate.polygons) {
                                if (!polygon.bounds.intersects(visibleBounds)) continue
                                for (ring in polygon.rings) {
                                    if (ring.points.size < 3) continue
                                    val path = Path()
                                    var started = false
                                    for (point in ring.points) {
                                        val (x, y) = TileMath.worldToScreen(
                                            point.latitude,
                                            point.longitude,
                                            viewport,
                                        )
                                        if (!started) {
                                            path.moveTo(x.toFloat(), y.toFloat())
                                            started = true
                                        } else {
                                            path.lineTo(x.toFloat(), y.toFloat())
                                        }
                                    }
                                    if (started) {
                                        path.close()
                                        drawPath(
                                            path = path,
                                            color = MadarTeal.copy(alpha = 0.5f),
                                            style = Stroke(width = 1.1.dp.toPx()),
                                        )
                                    }
                                }
                            }
                    }
                }

                for (marker in markers) {
                    val (x, y) = TileMath.worldToScreen(marker.latitude, marker.longitude, viewport)
                    if (x !in -40.0..(mapSize.width + 40.0) || y !in -40.0..(mapSize.height + 40.0)) continue
                    drawCircle(Color.White, radius = 10.dp.toPx(), center = Offset(x.toFloat(), y.toFloat()))
                    drawCircle(
                        markerColor(marker),
                        radius = 6.5.dp.toPx(),
                        center = Offset(x.toFloat(), y.toFloat()),
                    )
                }
            }

            if (activePack == null) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                    tonalElevation = 2.dp,
                    modifier = Modifier.align(Alignment.TopCenter).padding(12.dp),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "لا توجد حزمة بلاطات مرخصة مفعّلة",
                            style = MaterialTheme.typography.titleSmall,
                            color = MadarWarning,
                        )
                        Text(
                            "تُعرض حدود المحافظات ومواقع الماكينات فقط. نزّل حزمة خريطة مرخصة من الأسفل لرؤية الطرق.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                        )
                    }
                }
            }

            Column(
                Modifier.align(Alignment.TopEnd).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SmallFloatingActionButton(
                    onClick = { zoom = (zoom + 1).coerceIn(minZoom, maxZoom) },
                    containerColor = MaterialTheme.colorScheme.surface,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "تكبير")
                }
                SmallFloatingActionButton(
                    onClick = { zoom = (zoom - 1).coerceIn(minZoom, maxZoom) },
                    containerColor = MaterialTheme.colorScheme.surface,
                ) {
                    Icon(Icons.Default.Remove, contentDescription = "تصغير")
                }
                SmallFloatingActionButton(
                    onClick = {
                        val bounds = routeBounds ?: packBounds
                        if (bounds != null && mapSize.width > 0) {
                            val fitted = TileMath.fitBounds(
                                bounds,
                                mapSize.width,
                                mapSize.height,
                                minZoom,
                                maxZoom,
                            )
                            centerLat = fitted.centerLatitude
                            centerLon = fitted.centerLongitude
                            zoom = fitted.zoom.roundToInt().coerceIn(minZoom, maxZoom)
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.surface,
                ) {
                    Icon(Icons.Default.FilterCenterFocus, contentDescription = "ملاءمة المسار")
                }
            }

            activePack?.attribution?.takeIf { it.isNotBlank() }?.let { attribution ->
                Text(
                    attribution,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(6.dp)
                        .background(Color.White.copy(alpha = 0.78f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    fontSize = 10.sp,
                    color = MadarMuted,
                )
            }

            selectedMarker?.let { marker ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 4.dp,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp).fillMaxWidth(),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                marker.machine.machineCode,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                marker.machine.arabicName?.takeIf { it.isNotBlank() }
                                    ?: marker.machine.clientName.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MadarMuted,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when {
                                    marker.hasLocalVisit -> "لديك زيارة محلية غير مغلقة"
                                    marker.machine.isCompleted -> "مكتملة"
                                    marker.machine.isSubmitted -> "بانتظار المشرف"
                                    marker.machine.canVisit -> "متاحة للزيارة"
                                    else -> "غير متاحة الآن"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = markerColor(marker),
                            )
                        }
                        Button(
                            onClick = { onOpenMachine(marker.machine) },
                            enabled = marker.hasLocalVisit || marker.machine.canVisit,
                        ) {
                            Text("فتح")
                        }
                        IconButton(onClick = { selectedMarker = null }) {
                            Icon(Icons.Default.Close, contentDescription = "إغلاق")
                        }
                    }
                }
            }
        }

        MapPackPanel(
            packs = packs,
            activePack = activePack,
            download = download,
            catalogState = catalogState,
            onRefresh = { vm.refreshMapCatalog() },
            onDownload = { vm.downloadMapPack(it) },
            onSelect = { selectedPackId = it },
            onDelete = { pendingDelete = it },
        )
    }

    pendingDelete?.let { pack ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("حذف حزمة الخريطة؟") },
            text = {
                Text(
                    "سيُحذف ملف ${pack.name} المحلي. يمكن تنزيله مرة أخرى من الخادم عند توفر الشبكة."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.deleteMapPack(pack.id)
                        if (selectedPackId == pack.id) selectedPackId = null
                        pendingDelete = null
                    }
                ) { Text("حذف") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("إلغاء") }
            },
        )
    }
}

@Composable
private fun MapPackPanel(
    packs: List<MapPackEntity>,
    activePack: MapPackEntity?,
    download: MapDownloadState,
    catalogState: MapCatalogState,
    onRefresh: () -> Unit,
    onDownload: (String) -> Unit,
    onSelect: (String) -> Unit,
    onDelete: (MapPackEntity) -> Unit,
) {
    Surface(tonalElevation = 3.dp, color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("حزم الخرائط المرخصة", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                if (download.activeId != null || catalogState.loading) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                TextButton(onClick = onRefresh, enabled = !catalogState.loading && download.activeId == null) {
                    Text(if (catalogState.loading) "جارٍ التحديث…" else "تحديث القائمة")
                }
            }

            if (catalogState.error != null) {
                Text(
                    catalogState.error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarDanger,
                )
            } else if (catalogState.message != null && packs.isNotEmpty()) {
                Text(
                    catalogState.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarTeal,
                )
            }

            if (packs.isEmpty()) {
                Text(
                    "لم تُحمّل قائمة الحزم من الخادم بعد. لا تُعرض خرائط من خدمات خارجية.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
            } else {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(end = 4.dp),
                ) {
                    items(packs, key = { it.id }) { pack ->
                        MapPackCard(
                            pack = pack,
                            selected = activePack?.id == pack.id,
                            downloading = download.activeId == pack.id,
                            download = download,
                            onSelect = { onSelect(pack.id) },
                            onDownload = { onDownload(pack.id) },
                            onDelete = { onDelete(pack) },
                        )
                    }
                }
            }

            if (download.message != null) {
                Text(download.message, style = MaterialTheme.typography.bodySmall, color = MadarTeal)
            }
            if (download.error != null) {
                Text(download.error, style = MaterialTheme.typography.bodySmall, color = MadarDanger)
            }
            activePack?.let { pack ->
                val license = pack.license.ifBlank { "غير متوفر" }
                Text(
                    "المصدر: ${pack.sourceName ?: pack.name} · الترخيص: $license · ${formatBytes(pack.sizeBytes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun MapPackCard(
    pack: MapPackEntity,
    selected: Boolean,
    downloading: Boolean,
    download: MapDownloadState,
    onSelect: () -> Unit,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = when {
            selected -> MadarTeal.copy(alpha = 0.09f)
            else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
        },
        modifier = Modifier.width(268.dp),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pack.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                StatusPill(mapPackPill(pack.state))
            }
            Text(
                "ترخيص: ${pack.license.ifBlank { "غير متوفر" }}",
                style = MaterialTheme.typography.bodySmall,
                color = if (pack.license.isBlank()) MadarDanger else MadarMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${pack.downloadedTiles}/${pack.tileCount} بلاطة · ${formatBytes(pack.sizeBytes)}",
                style = MaterialTheme.typography.bodySmall,
                color = MadarMuted,
            )
            if (pack.lastError != null) {
                Text(
                    pack.lastError,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (pack.state == MapPackState.FAILED) MadarDanger else MadarWarning,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (downloading) {
                val progress = if (download.total > 0) {
                    (download.downloaded.toFloat() / download.total).coerceIn(0f, 1f)
                } else {
                    null
                }
                if (progress != null) {
                    LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (pack.state == MapPackState.VERIFIED) {
                    TextButton(onClick = onSelect, enabled = !selected) {
                        Text(if (selected) "مفعّلة" else "عرض")
                    }
                    TextButton(onClick = onDelete) { Text("حذف") }
                } else {
                    Button(
                        onClick = onDownload,
                        enabled = download.activeId == null,
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text(if (pack.state == MapPackState.FAILED) "إعادة التنزيل" else "تنزيل")
                    }
                }
            }
        }
    }
}

private fun markerColor(marker: MapMarker): Color = when {
    marker.hasLocalVisit -> MadarGold
    marker.machine.isCompleted -> MadarMuted
    marker.machine.isSubmitted -> MadarWarning
    marker.machine.canVisit -> MadarTeal
    else -> MadarDanger
}

private fun wrapLongitude(value: Double): Double {
    var longitude = value
    while (longitude > 180.0) longitude -= 360.0
    while (longitude < -180.0) longitude += 360.0
    return longitude
}
