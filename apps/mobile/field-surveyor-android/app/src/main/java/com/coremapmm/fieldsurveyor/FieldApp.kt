package com.coremapmm.fieldsurveyor

import android.app.Application
import androidx.work.Configuration
import com.coremapmm.fieldsurveyor.work.FieldWork

class FieldApp : Application(), Configuration.Provider {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph.create(this)
        FieldWork.enqueue(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()
}
