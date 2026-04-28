package com.rowan.townmap.core.common

data class AppError(
    val message: String,
    val cause: Throwable? = null
)
