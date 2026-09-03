package com.coremapmm.fieldsurveyor.net

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

object FieldHttp {
    fun client(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    /** Large Yangon PMTiles (~730 MB). Zero timeout means no limit in OkHttp. */
    fun downloadClient(): OkHttpClient {
        return client().newBuilder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}
