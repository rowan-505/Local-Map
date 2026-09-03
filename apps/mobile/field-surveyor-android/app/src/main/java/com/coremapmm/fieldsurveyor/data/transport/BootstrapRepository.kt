package com.coremapmm.fieldsurveyor.data.transport

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.auth.AuthRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed class BootstrapRefreshResult {
    data class Unchanged(val snapshotRevision: String) : BootstrapRefreshResult()
    data class Updated(val snapshotRevision: String, val variantCount: Int) : BootstrapRefreshResult()
    data class Failed(
        val message: String,
        val keptRevision: String?,
        val keptVariantCount: Int,
    ) : BootstrapRefreshResult()
}

class BootstrapRepository(
    private val auth: AuthRepository,
    private val api: FieldBootstrapApi,
    private val cache: TransportCacheDao,
) {
    suspend fun snapshotRevision(): String? = cache.snapshotRevision()

    suspend fun variantCount(): Int = cache.variantCount()

    suspend fun listSelections(): List<RouteSelectionRow> = cache.listRouteSelections()

    suspend fun variantsForRoute(routePublicId: String) = cache.variantsForRoute(routePublicId)

    suspend fun orderedStops(variantPublicId: String) = cache.orderedStops(variantPublicId)

    suspend fun routePathJson(variantPublicId: String) = cache.routePathJson(variantPublicId)

    suspend fun stopById(stopPublicId: String) = cache.stopById(stopPublicId)

    suspend fun searchRoutesByCode(query: String) = cache.searchRoutesByCode(query)

    /**
     * Full-snapshot refresh only. Matching revision skips download. A failed
     * download or validate leaves the previous cache and revision untouched.
     */
    suspend fun refresh(): BootstrapRefreshResult {
        val keptRevision = cache.snapshotRevision()
        val keptVariants = cache.variantCount()
        return try {
            val token = auth.validAccessToken()
            val payload = withContext(Dispatchers.IO) { api.fetch(token, keptRevision) }
            when (payload) {
                is BootstrapPayload.Unchanged -> BootstrapRefreshResult.Unchanged(payload.snapshotRevision)
                is BootstrapPayload.Dataset -> {
                    val validated = SnapshotValidator.validate(BootstrapJson.parseDataset(payload.raw))
                    cache.replaceSnapshot(validated)
                    BootstrapRefreshResult.Updated(validated.snapshotRevision, validated.variants.size)
                }
            }
        } catch (error: AuthException) {
            BootstrapRefreshResult.Failed(
                message = error.message ?: "Auth failed",
                keptRevision = keptRevision,
                keptVariantCount = keptVariants,
            )
        } catch (error: SnapshotParseException) {
            BootstrapRefreshResult.Failed(
                message = error.message ?: "Invalid snapshot",
                keptRevision = keptRevision,
                keptVariantCount = keptVariants,
            )
        } catch (error: Exception) {
            BootstrapRefreshResult.Failed(
                message = error.message ?: "Refresh failed",
                keptRevision = keptRevision,
                keptVariantCount = keptVariants,
            )
        }
    }
}
