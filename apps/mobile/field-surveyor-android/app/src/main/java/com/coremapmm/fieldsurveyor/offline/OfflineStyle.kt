package com.coremapmm.fieldsurveyor.offline

/**
 * Rewrites CoreMap styles so MapLibre Native loads local files only.
 *
 * PMTiles: native `pmtiles://file://<absolute-path>` (MapLibre Android 11.7+).
 * Myanmar labels: Native HarfBuzz via `font-faces` and bundled Noto Sans Myanmar TTF
 * (Android SDK 11.13+; this app uses 12.x).
 */
object OfflineStyle {
    const val GLYPHS_URI = "asset://fonts/{fontstack}/{range}.pbf"
    const val SPRITE_URI = "asset://sprites/empty"
    const val PMTILES_PLACEHOLDER = "pmtiles://__OVERVIEW_PMTILES_URL__"
    const val WEB_GLYPHS_URI = "/fonts/{fontstack}/{range}.pbf"
    /** Matches style `text-font` and `app/src/main/assets/fonts/NotoSansMyanmar-Regular.ttf`. */
    const val FONT_FACES_FRAGMENT =
        "\"font-faces\": {\"NotoSansMyanmar-Regular\": [{\"url\": \"asset://fonts/NotoSansMyanmar-Regular.ttf\"}]},"
    private val HTTPS_PMTILES = Regex("""pmtiles://https://[^"\s]+""")

    fun pmtilesFileUri(absolutePath: String): String = "pmtiles://file://$absolutePath"

    fun rewrite(templateJson: String, pmtilesAbsolutePath: String): String {
        val pmtilesUri = pmtilesFileUri(pmtilesAbsolutePath)
        var json = templateJson
            .replace(WEB_GLYPHS_URI, GLYPHS_URI)
            .replace(PMTILES_PLACEHOLDER, pmtilesUri)
            .replace(HTTPS_PMTILES, pmtilesUri)
        if (!json.contains("\"font-faces\"")) {
            json = json.replaceFirst("\"glyphs\":", "$FONT_FACES_FRAGMENT\n  \"glyphs\":")
        }
        if (!json.contains("\"sprite\"")) {
            json = json.replaceFirst(
                "\"glyphs\":",
                "\"sprite\": \"$SPRITE_URI\",\n  \"glyphs\":",
            )
        }
        if (!json.contains("\"type\": \"background\"") && !json.contains("field-basemap-background")) {
            val background =
                """{"id":"field-basemap-background","type":"background","paint":{"background-color":"#e8ebe0"}}"""
            json = when {
                json.contains("\"layers\": []") -> json.replaceFirst("\"layers\": []", "\"layers\": [$background]")
                else -> json.replaceFirst("\"layers\": [", "\"layers\": [$background,")
            }
        }
        return json
    }

    fun httpBasemapUrls(styleJson: String): List<String> =
        Regex("""https?://[^"\s]+""").findAll(styleJson).map { it.value }.toList()
}
