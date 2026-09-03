package com.coremapmm.fieldsurveyor.auth

import android.util.Log
import com.coremapmm.fieldsurveyor.BuildConfig
import java.io.IOException

object FieldHttpError {
    fun formatUnreachable(error: IOException, baseUrl: String, action: String = "API"): String {
        val cause = error.message?.trim().orEmpty().ifBlank { error.javaClass.simpleName }
        return "Cannot reach CoreMap $action at $baseUrl ($cause)"
    }

    fun unreachable(error: IOException, baseUrl: String, action: String = "API"): AuthException {
        val message = formatUnreachable(error, baseUrl, action)
        if (BuildConfig.DEBUG) {
            Log.w("FieldHttp", message, error)
        }
        return AuthException(message)
    }
}
