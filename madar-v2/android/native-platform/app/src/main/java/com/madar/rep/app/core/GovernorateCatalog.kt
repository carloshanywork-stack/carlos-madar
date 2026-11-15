package com.madar.rep.app.core

import android.content.Context

/**
 * Arabic display names for the licensed geoBoundaries ADM1 units. The geometry
 * remains the licensed source; only the display labels are localized here.
 */
object GovernorateCatalog {
    const val ASSET = "egypt-adm1.geojson"
    const val LICENSE_ASSET = "egypt-adm1.LICENSE.txt"

    val arabicNames: Map<String, String> = mapOf(
        "EG-ALX" to "الإسكندرية",
        "EG-ASN" to "أسوان",
        "EG-AST" to "أسيوط",
        "EG-BA" to "البحر الأحمر",
        "EG-BH" to "البحيرة",
        "EG-BNS" to "بني سويف",
        "EG-C" to "القاهرة",
        "EG-DK" to "الدقهلية",
        "EG-DT" to "دمياط",
        "EG-FYM" to "الفيوم",
        "EG-GH" to "الغربية",
        "EG-GZ" to "الجيزة",
        "EG-IS" to "الإسماعيلية",
        "EG-JS" to "جنوب سيناء",
        "EG-KB" to "القليوبية",
        "EG-KFS" to "كفر الشيخ",
        "EG-KN" to "قنا",
        "EG-LX" to "الأقصر",
        "EG-MN" to "المنيا",
        "EG-MNF" to "المنوفية",
        "EG-MT" to "مطروح",
        "EG-PTS" to "بورسعيد",
        "EG-SHG" to "سوهاج",
        "EG-SHR" to "الشرقية",
        "EG-SIN" to "شمال سيناء",
        "EG-SUZ" to "السويس",
        "EG-WAD" to "الوادي الجديد",
    )

    @Volatile private var cached: GovernorateIndex? = null

    fun load(context: Context): GovernorateIndex {
        cached?.let { return it }
        return synchronized(this) {
            cached ?: runCatching {
                val raw = context.assets.open(ASSET).bufferedReader(Charsets.UTF_8).use { it.readText() }
                GovernorateIndex(GovernorateGeoJson.parse(raw, arabicNames))
            }.getOrElse { GovernorateIndex.EMPTY }.also { cached = it }
        }
    }

    fun license(context: Context): String = runCatching {
        context.assets.open(LICENSE_ASSET).bufferedReader(Charsets.UTF_8).use { it.readText().trim() }
    }.getOrDefault("")
}
