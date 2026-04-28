pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://api.mapbox.com/downloads/v2/releases/maven")
        }
    }
}

rootProject.name = "TownMap"
include(":app")
include(":core:common")
include(":core:model")
include(":core:network")
include(":core:database")
include(":core:location")
include(":core:ui")
include(":feature:map")
include(":feature:search")
include(":feature:places")
include(":feature:routing")
include(":feature:offline")
include(":feature:settings")
include(":sync")
