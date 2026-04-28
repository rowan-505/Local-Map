import java.util.Properties

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.rowan.townmap.feature.map"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }
    defaultConfig {
        minSdk = 26
        val localProperties = Properties()
        rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use {
            localProperties.load(it)
        }
        val mapboxToken = localProperties.getProperty("MAPBOX_ACCESS_TOKEN").orEmpty()
        val escaped = mapboxToken
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
        buildConfigField("String", "MAPBOX_ACCESS_TOKEN", "\"$escaped\"")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    jvmToolchain(11)
}

dependencies {
    implementation(project(":core:network"))
    implementation(project(":core:model"))
    implementation(project(":core:ui"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.mapbox.maps.android.ndk27)
    implementation(libs.mapbox.maps.compose.ndk27)
}
