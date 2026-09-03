import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

val repoRoot = rootProject.projectDir.resolve("../../..")
val overviewPmtiles = repoRoot.resolve(
    "infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles",
)
val webFonts = repoRoot.resolve("apps/web/public/fonts")
/** Concrete File, not a Provider — AGP 9 forbids Provider in SourceSet.srcDir. */
val generatedAssetsDir = file("build/generated/offlineAssets")

fun localProperty(name: String): String? {
    val file = rootProject.file("local.properties")
    if (!file.isFile) {
        return null
    }
    val props = Properties()
    file.inputStream().use { props.load(it) }
    return props.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
}

fun apiBaseUrlFor(buildType: String): String {
    val fromCli = gradle.startParameter.projectProperties["fieldApiBaseUrl"]?.trim().orEmpty()
    if (fromCli.isNotEmpty()) {
        return fromCli.trimEnd('/')
    }
    if (buildType == "debug") {
        val fromLocal = localProperty("fieldApiBaseUrl")
        if (!fromLocal.isNullOrEmpty()) {
            return fromLocal.trimEnd('/')
        }
    }
    val fromGradle = (project.findProperty("fieldApiBaseUrl") as String?)?.trim().orEmpty()
    if (fromGradle.isNotEmpty()) {
        return fromGradle.trimEnd('/')
    }
    return if (buildType == "debug") {
        "http://10.0.2.2:3001"
    } else {
        "https://api.invalid.coremap.local"
    }
}

fun yangonPmtilesUrl(): String {
    val fromProperty = (project.findProperty("fieldYangonPmtilesUrl") as String?)?.trim().orEmpty()
    if (fromProperty.isNotEmpty()) {
        return fromProperty
    }
    return "https://tiles.coremapmm.com/basemaps/yangon/v1/basemap.pmtiles"
}

android {
    namespace = "com.coremapmm.fieldsurveyor"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.coremapmm.fieldsurveyor"
        minSdk = 31
        targetSdk = 35
        versionCode = 6
        versionName = "0.6.0-media"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrlFor("release")}\"")
            buildConfigField("String", "YANGON_PMTILES_URL", "\"${yangonPmtilesUrl()}\"")
        }
        debug {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrlFor("debug")}\"")
            buildConfigField("String", "YANGON_PMTILES_URL", "\"${yangonPmtilesUrl()}\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        named("main") {
            assets.srcDir(generatedAssetsDir)
        }
    }
}

val prepareOfflineAssets by tasks.registering(Copy::class) {
    description = "Copy CoreMap overview PMTiles, style JSON, and glyph PBFs into generated assets."
    group = "build"
    doFirst {
        check(overviewPmtiles.isFile) {
            "Missing $overviewPmtiles. Build or copy myanmar-overview-v1.pmtiles first."
        }
        check(webFonts.resolve("NotoSansMyanmar-Regular").isDirectory) {
            "Missing Myanmar glyphs at $webFonts/NotoSansMyanmar-Regular"
        }
    }
    from(overviewPmtiles) {
        into("basemap")
        rename { "overview.pmtiles" }
    }
    from(repoRoot.resolve("packages/map-style/overview-map.json")) {
        into("style")
    }
    from(repoRoot.resolve("packages/map-style/base-map.json")) {
        into("style")
    }
    from(webFonts.resolve("NotoSansMyanmar-Regular")) {
        into("fonts/NotoSansMyanmar-Regular")
    }
    into(generatedAssetsDir)
}

tasks.named("preBuild").configure {
    dependsOn(prepareOfflineAssets)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation("androidx.compose.material:material-icons-extended")
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.maplibre.android)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
