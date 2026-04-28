package com.rowan.townmap.core.common

sealed class AppResult<out T> {
    data object Loading : AppResult<Nothing>()
    data class Success<T>(val data: T) : AppResult<T>()
    data class Failure(val error: AppError) : AppResult<Nothing>()
}
