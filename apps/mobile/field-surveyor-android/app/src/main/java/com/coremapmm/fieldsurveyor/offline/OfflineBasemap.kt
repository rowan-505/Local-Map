package com.coremapmm.fieldsurveyor.offline

import android.content.Context
import java.io.File

object OfflineBasemap {
    const val ASSET_OVERVIEW = "basemap/overview.pmtiles"
    const val ASSET_STYLE_OVERVIEW = "style/overview-map.json"
    const val ASSET_STYLE_YANGON = "style/base-map.json"
    const val LOCAL_OVERVIEW_NAME = "overview.pmtiles"

    fun overviewFile(context: Context): File =
        File(File(context.filesDir, "basemap").apply { mkdirs() }, LOCAL_OVERVIEW_NAME)

    fun yangonFile(context: Context): File =
        File(File(context.filesDir, "basemap").apply { mkdirs() }, YangonBasemapStore.FILE_NAME)

    fun materializeOverview(context: Context): File {
        val dest = overviewFile(context)
        context.assets.open(ASSET_OVERVIEW).use { input ->
            val expected = input.available().toLong()
            if (dest.exists() && dest.length() == expected && expected > 0L) {
                return dest
            }
            dest.outputStream().use { output -> input.copyTo(output) }
        }
        require(dest.exists() && dest.length() > 0L) {
            "Failed to copy $ASSET_OVERVIEW into ${dest.absolutePath}"
        }
        return dest
    }

    fun loadRewrittenStyle(context: Context): String {
        val yangon = yangonFile(context)
        return if (YangonBasemapStore.isComplete(yangon)) {
            rewriteAsset(context, ASSET_STYLE_YANGON, yangon)
        } else {
            rewriteAsset(context, ASSET_STYLE_OVERVIEW, materializeOverview(context))
        }
    }

    private fun rewriteAsset(context: Context, assetStyle: String, archive: File): String {
        val template = context.assets.open(assetStyle).bufferedReader().use { it.readText() }
        val json = OfflineStyle.rewrite(template, archive.absolutePath)
        val http = OfflineStyle.httpBasemapUrls(json)
        require(http.isEmpty()) {
            "Style still contains HTTP URLs: $http"
        }
        return json
    }
}
