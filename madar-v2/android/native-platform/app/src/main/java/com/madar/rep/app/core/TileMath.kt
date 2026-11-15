package com.madar.rep.app.core

import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.tan

data class TileCoordinate(val z: Int, val x: Int, val y: Int)

data class WebMercatorPoint(val worldX: Double, val worldY: Double, val scale: Double)

data class TileViewport(
    val centerLatitude: Double,
    val centerLongitude: Double,
    val zoom: Double,
    val widthPx: Int,
    val heightPx: Int,
)

data class VisibleTile(val z: Int, val x: Int, val y: Int, val leftPx: Double, val topPx: Double, val sizePx: Double)

/**
 * XYZ/slippy tile math used by both the MBTiles packer and the Compose canvas.
 * MBTiles stores TMS rows, so the writer converts with [tmsY].
 */
object TileMath {
    const val TILE_SIZE = 256.0
    const val MAX_LATITUDE = 85.05112878

    fun lonToTileX(longitude: Double, zoom: Int): Int {
        val count = 1 shl zoom
        return floor((longitude + 180.0) / 360.0 * count).toInt().coerceIn(0, count - 1)
    }

    fun latToTileY(latitude: Double, zoom: Int): Int {
        val count = 1 shl zoom
        val radians = Math.toRadians(latitude.coerceIn(-MAX_LATITUDE, MAX_LATITUDE))
        return floor((1.0 - asinh(tan(radians)) / PI) / 2.0 * count).toInt().coerceIn(0, count - 1)
    }

    fun tileToLon(x: Int, zoom: Int): Double = x.toDouble() / (1 shl zoom) * 360.0 - 180.0

    fun tileToLat(y: Int, zoom: Int): Double {
        val n = PI - 2.0 * PI * y.toDouble() / (1 shl zoom)
        return Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(n)))
    }

    fun tmsY(xyzY: Int, zoom: Int): Int = (1 shl zoom) - 1 - xyzY

    fun xyzY(tmsRow: Int, zoom: Int): Int = (1 shl zoom) - 1 - tmsRow

    fun tilesForBounds(
        west: Double,
        south: Double,
        east: Double,
        north: Double,
        minZoom: Int,
        maxZoom: Int,
    ): List<TileCoordinate> {
        val tiles = ArrayList<TileCoordinate>()
        for (zoom in minZoom..maxZoom) {
            val minX = lonToTileX(west, zoom)
            val maxX = lonToTileX(east, zoom)
            val minY = latToTileY(north, zoom)
            val maxY = latToTileY(south, zoom)
            for (x in minX..maxX) {
                for (y in minY..maxY) tiles.add(TileCoordinate(zoom, x, y))
            }
        }
        return tiles
    }

    /** Converts screen pixels to a slippy-map world position for a viewport. */
    fun viewportToWorld(viewport: TileViewport): WebMercatorPoint {
        val scale = TILE_SIZE * Math.pow(2.0, viewport.zoom)
        val worldX = (viewport.centerLongitude + 180.0) / 360.0 * scale
        val latitude = viewport.centerLatitude.coerceIn(-MAX_LATITUDE, MAX_LATITUDE)
        val worldY = (1.0 - asinh(tan(Math.toRadians(latitude))) / PI) / 2.0 * scale
        return WebMercatorPoint(worldX, worldY, scale)
    }

    fun visibleTiles(viewport: TileViewport, minZoom: Int, maxZoom: Int): List<VisibleTile> {
        if (viewport.widthPx <= 0 || viewport.heightPx <= 0) return emptyList()
        val zoom = viewport.zoom.coerceIn(minZoom.toDouble(), maxZoom.toDouble())
        val z = floor(zoom).toInt().coerceIn(minZoom, maxZoom)
        val center = viewportToWorld(viewport.copy(zoom = z.toDouble()))
        val leftWorld = center.worldX - viewport.widthPx / 2.0
        val topWorld = center.worldY - viewport.heightPx / 2.0
        val minX = floor(leftWorld / TILE_SIZE).toInt()
        val maxX = floor((leftWorld + viewport.widthPx) / TILE_SIZE).toInt()
        val minY = floor(topWorld / TILE_SIZE).toInt()
        val maxY = floor((topWorld + viewport.heightPx) / TILE_SIZE).toInt()
        val count = 1 shl z
        val result = ArrayList<VisibleTile>()
        for (x in minX..maxX) {
            for (y in minY..maxY) {
                if (y < 0 || y >= count) continue
                val wrappedX = ((x % count) + count) % count
                result.add(
                    VisibleTile(
                        z = z,
                        x = wrappedX,
                        y = y,
                        leftPx = x * TILE_SIZE - leftWorld,
                        topPx = y * TILE_SIZE - topWorld,
                        sizePx = TILE_SIZE,
                    )
                )
            }
        }
        return result
    }

    fun worldToScreen(latitude: Double, longitude: Double, viewport: TileViewport): Pair<Double, Double> {
        val center = viewportToWorld(viewport)
        val scale = TILE_SIZE * Math.pow(2.0, viewport.zoom)
        val x = (longitude + 180.0) / 360.0 * scale
        val y = (1.0 - asinh(tan(Math.toRadians(latitude.coerceIn(-MAX_LATITUDE, MAX_LATITUDE)))) / PI) / 2.0 * scale
        return Pair(
            viewport.widthPx / 2.0 + (x - center.worldX),
            viewport.heightPx / 2.0 + (y - center.worldY),
        )
    }

    fun screenToLatLon(x: Double, y: Double, viewport: TileViewport): Pair<Double, Double> {
        val center = viewportToWorld(viewport)
        val worldX = center.worldX + (x - viewport.widthPx / 2.0)
        val worldY = center.worldY + (y - viewport.heightPx / 2.0)
        val scale = TILE_SIZE * Math.pow(2.0, viewport.zoom)
        val longitude = worldX / scale * 360.0 - 180.0
        val n = PI - 2.0 * PI * worldY / scale
        val latitude = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(n)))
        return Pair(latitude, longitude)
    }

    /** Fit a viewport to a route bounds without exceeding the pack zoom range. */
    fun fitBounds(
        bounds: GeoBounds,
        widthPx: Int,
        heightPx: Int,
        minZoom: Int,
        maxZoom: Int,
        paddingPx: Double = 72.0,
    ): TileViewport {
        val centerLat = (bounds.south + bounds.north) / 2.0
        val centerLon = (bounds.west + bounds.east) / 2.0
        var zoom = maxZoom.toDouble()
        while (zoom > minZoom) {
            val viewport = TileViewport(centerLat, centerLon, zoom, widthPx, heightPx)
            val leftTop = worldToScreen(bounds.north, bounds.west, viewport)
            val rightBottom = worldToScreen(bounds.south, bounds.east, viewport)
            val fits = leftTop.first >= paddingPx && leftTop.second >= paddingPx &&
                rightBottom.first <= widthPx - paddingPx && rightBottom.second <= heightPx - paddingPx
            if (fits) break
            zoom -= 0.5
        }
        return TileViewport(centerLat, centerLon, zoom.coerceIn(minZoom.toDouble(), maxZoom.toDouble()), widthPx, heightPx)
    }
}
