package com.rowan.townmap.core.model

data class OfflineRegion(
    val id: String,
    val name: String,
    val isDownloaded: Boolean,
    val sizeBytes: Long
)
