package com.madar.rep.app.data.repo

import com.madar.rep.app.data.api.FaultReason
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.api.RouteResponse
import com.madar.rep.app.data.db.FaultReasonSnapshotEntity
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.RouteSnapshotEntity
import com.madar.rep.app.data.session.Session
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

data class RouteView(
    val route: RouteResponse,
    val fetchedAt: Long,
)

class RouteRepository(private val database: MadarDatabase) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun observe(repId: Long): Flow<RouteView?> =
        database.routes().observe(repId).map { snapshot ->
            snapshot?.let {
                runCatching {
                    RouteView(json.decodeFromString(RouteResponse.serializer(), it.routeJson), it.fetchedAt)
                }.getOrNull()
            }
        }

    suspend fun refresh(session: Session, api: MadarApi): RouteResponse {
        val route = api.getRoute(session.token, session.username)
        val now = System.currentTimeMillis()
        database.routes().put(
            RouteSnapshotEntity(
                ownerRepId = session.ownerScopeId,
                routeJson = json.encodeToString(RouteResponse.serializer(), route),
                fetchedAt = now,
                lastReconciledAt = now,
            )
        )
        return route
    }

    suspend fun refreshFaultReasons(session: Session, api: MadarApi): List<FaultReason> {
        val reasons = api.getFaultReasons(session.token)
        cacheFaultReasons(session.ownerScopeId, reasons)
        return reasons
    }

    suspend fun cached(repId: Long): RouteResponse? {
        val snapshot = database.routes().get(repId) ?: return null
        return runCatching { json.decodeFromString(RouteResponse.serializer(), snapshot.routeJson) }.getOrNull()
    }

    suspend fun cacheFaultReasons(repId: Long, reasons: List<FaultReason>) {
        database.faultReasons().put(
            FaultReasonSnapshotEntity(
                ownerRepId = repId,
                reasonsJson = json.encodeToString(ListSerializer(FaultReason.serializer()), reasons),
                fetchedAt = System.currentTimeMillis(),
            )
        )
    }

    suspend fun cachedFaultReasons(repId: Long): List<FaultReason> {
        val snapshot = database.faultReasons().get(repId) ?: return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(FaultReason.serializer()), snapshot.reasonsJson)
        }.getOrDefault(emptyList())
    }
}
