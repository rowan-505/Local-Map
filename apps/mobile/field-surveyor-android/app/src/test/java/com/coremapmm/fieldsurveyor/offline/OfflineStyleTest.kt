package com.coremapmm.fieldsurveyor.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineStyleTest {
    @Test
    fun rewritesPmtilesGlyphsAndSpriteWithoutHttp() {
        val template = """
            {
              "version": 8,
              "glyphs": "/fonts/{fontstack}/{range}.pbf",
              "sources": {
                "overview": {
                  "type": "vector",
                  "url": "pmtiles://__OVERVIEW_PMTILES_URL__"
                }
              },
              "layers": []
            }
        """.trimIndent()

        val json = OfflineStyle.rewrite(template, "/data/overview.pmtiles")

        assertTrue(json.contains("\"url\": \"pmtiles://file:///data/overview.pmtiles\""))
        assertTrue(json.contains(OfflineStyle.GLYPHS_URI))
        assertTrue(json.contains(OfflineStyle.FONT_FACES_FRAGMENT))
        assertTrue(json.contains(OfflineStyle.SPRITE_URI))
        assertTrue(json.contains("field-basemap-background"))
        assertTrue(OfflineStyle.httpBasemapUrls(json).isEmpty())
        assertEquals(
            "pmtiles://file:///data/overview.pmtiles",
            OfflineStyle.pmtilesFileUri("/data/overview.pmtiles"),
        )
    }

    @Test
    fun rewritesYangonHttpsPmtilesToLocalFile() {
        val template = """
            {
              "version": 8,
              "glyphs": "/fonts/{fontstack}/{range}.pbf",
              "sources": {
                "local-basemap": {
                  "type": "vector",
                  "url": "pmtiles://https://tiles.coremapmm.com/basemaps/yangon/v1/basemap.pmtiles"
                }
              },
              "layers": [
                { "id": "background", "type": "background", "paint": { "background-color": "#fff" } }
              ]
            }
        """.trimIndent()

        val json = OfflineStyle.rewrite(template, "/data/yangon.pmtiles")

        assertTrue(json.contains("\"url\": \"pmtiles://file:///data/yangon.pmtiles\""))
        assertTrue(!json.contains("https://tiles.coremapmm.com"))
        assertTrue(!json.contains("field-basemap-background"))
        assertTrue(OfflineStyle.httpBasemapUrls(json).isEmpty())
    }

    @Test
    fun keepsMyanmarFirstLabelsAndAddsLocalFontFaces() {
        val template = """{
          "glyphs": "/fonts/{fontstack}/{range}.pbf",
          "sources": {"base": {"type": "vector", "url": "pmtiles://__OVERVIEW_PMTILES_URL__"}},
          "layers": [{"id":"labels","type":"symbol","layout":{
            "text-field": ["coalesce", ["get", "name_mm"], ["get", "name"], ["get", "name_en"]]
          }}]
        }"""

        val json = OfflineStyle.rewrite(template, "/data/overview.pmtiles")

        assertTrue(json.contains("[\"get\", \"name_mm\"]"))
        assertTrue(json.contains(OfflineStyle.FONT_FACES_FRAGMENT))
        assertTrue(json.contains("asset://fonts/NotoSansMyanmar-Regular.ttf"))
        assertTrue(!json.contains("[\"get\", \"name:en\"]"))
    }

    @Test
    fun rejectsHttpBasemapUrls() {
        val leaked = OfflineStyle.httpBasemapUrls(
            """{ "glyphs": "https://tiles.example/fonts/{fontstack}/{range}.pbf" }""",
        )
        assertEquals(listOf("https://tiles.example/fonts/{fontstack}/{range}.pbf"), leaked)
    }
}
