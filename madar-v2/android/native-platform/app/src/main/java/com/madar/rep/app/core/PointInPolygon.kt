package com.madar.rep.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class GeoRing(val points: List<GeoVertex>) {
    /**
     * Ray casting with the standard half-open rule. Points exactly on an edge are
     * treated as inside so a location on a governorate border is not reported as
     * "unavailable" solely because of floating point noise.
     */
    fun contains(latitude: Double, longitude: Double): Boolean {
        if (points.size < 3) return false
        var inside = false
        var previous = points.last()
        for (current in points) {
            if (onSegment(previous, current, latitude, longitude)) return true
            val crosses = (current.latitude > latitude) != (previous.latitude > latitude)
            if (crosses) {
                val intersection = (previous.longitude - current.longitude) *
                    (latitude - current.latitude) / (previous.latitude - current.latitude) + current.longitude
                if (longitude < intersection) inside = !inside
            }
            previous = current
        }
        return inside
    }

    private fun onSegment(a: GeoVertex, b: GeoVertex, latitude: Double, longitude: Double): Boolean {
        val cross = (b.longitude - a.longitude) * (latitude - a.latitude) -
            (b.latitude - a.latitude) * (longitude - a.longitude)
        if (kotlin.math.abs(cross) > 1e-12) return false
        return longitude >= minOf(a.longitude, b.longitude) - 1e-12 &&
            longitude <= maxOf(a.longitude, b.longitude) + 1e-12 &&
            latitude >= minOf(a.latitude, b.latitude) - 1e-12 &&
            latitude <= maxOf(a.latitude, b.latitude) + 1e-12
    }
}

data class GeoVertex(val latitude: Double, val longitude: Double)

data class GeoPolygon(
    /** First ring is the outer boundary; every following ring is a hole. */
    val rings: List<GeoRing>,
    val bounds: GeoBounds,
) {
    fun contains(latitude: Double, longitude: Double): Boolean {
        if (!bounds.contains(latitude, longitude)) return false
        if (rings.isEmpty() || !rings.first().contains(latitude, longitude)) return false
        return rings.drop(1).none { it.contains(latitude, longitude) }
    }
}

data class GeoBounds(
    val west: Double,
    val south: Double,
    val east: Double,
    val north: Double,
) {
    fun contains(latitude: Double, longitude: Double): Boolean =
        latitude in south..north && longitude in west..east

    fun intersects(other: GeoBounds): Boolean =
        west <= other.east && east >= other.west && south <= other.north && north >= other.south
}

data class Governorate(
    val code: String,
    val nameEn: String,
    val nameAr: String,
    val polygons: List<GeoPolygon>,
) {
    fun contains(latitude: Double, longitude: Double): Boolean =
        polygons.any { it.contains(latitude, longitude) }
}

/**
 * Parses the bundled geoBoundaries ADM1 GeoJSON (ODbL 1.0). Geometry is kept in
 * WGS84 and every ring after the first is treated as a hole, which matters for
 * governorates with enclaves or coastal lagoons.
 */
object GovernorateGeoJson {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(raw: String, arabicNames: Map<String, String>): List<Governorate> {
        val root = json.parseToJsonElement(raw).jsonObject
        val features = root["features"]?.jsonArray ?: return emptyList()
        return features.mapNotNull { feature ->
            val properties = feature.jsonObject["properties"]?.jsonObject ?: return@mapNotNull null
            val geometry = feature.jsonObject["geometry"]?.jsonObject ?: return@mapNotNull null
            val code = properties["shapeISO"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val nameEn = properties["shapeName"]?.jsonPrimitive?.contentOrNull.orEmpty()
            if (code.isBlank() || nameEn.isBlank()) return@mapNotNull null
            val polygons = when (geometry["type"]?.jsonPrimitive?.contentOrNull) {
                "Polygon" -> listOf(parsePolygon(geometry["coordinates"] ?: return@mapNotNull null))
                "MultiPolygon" -> (geometry["coordinates"] as? JsonArray)?.map { parsePolygon(it) }.orEmpty()
                else -> return@mapNotNull null
            }.filter { it.rings.isNotEmpty() }
            if (polygons.isEmpty()) return@mapNotNull null
            Governorate(
                code = code,
                nameEn = nameEn,
                nameAr = arabicNames[code] ?: nameEn,
                polygons = polygons,
            )
        }
    }

    private fun parsePolygon(element: JsonElement): GeoPolygon {
        val rings = element.jsonArray.map { ringElement ->
            val points = ringElement.jsonArray.mapNotNull { pair ->
                val coordinates = pair.jsonArray
                val longitude = (coordinates.getOrNull(0) as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
                val latitude = (coordinates.getOrNull(1) as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
                GeoVertex(latitude, longitude)
            }
            GeoRing(points)
        }
        val all = rings.flatMap { it.points }
        val bounds = if (all.isEmpty()) {
            GeoBounds(0.0, 0.0, 0.0, 0.0)
        } else {
            GeoBounds(
                west = all.minOf { it.longitude },
                south = all.minOf { it.latitude },
                east = all.maxOf { it.longitude },
                north = all.maxOf { it.latitude },
            )
        }
        return GeoPolygon(rings, bounds)
    }
}

class GovernorateIndex(private val governorates: List<Governorate>) {
    fun find(latitude: Double, longitude: Double): Governorate? =
        governorates.firstOrNull { it.contains(latitude, longitude) }

    fun all(): List<Governorate> = governorates

    companion object {
        val EMPTY = GovernorateIndex(emptyList())
    }
}
