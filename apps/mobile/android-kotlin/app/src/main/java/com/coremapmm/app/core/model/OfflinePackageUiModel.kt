package com.coremapmm.app.core.model

data class OfflinePackageUiModel(
    val id: String,
    val areaName: String,
    val areaType: OfflineAreaType,
    val packageType: OfflinePackageType,
    val fileSizeText: String,
    val lastUpdatedText: String,
    val status: OfflinePackageStatus,
    val warningText: String?,
    val downloadedDateText: String? = null,
    val latestUpdateDateText: String? = null,
)
