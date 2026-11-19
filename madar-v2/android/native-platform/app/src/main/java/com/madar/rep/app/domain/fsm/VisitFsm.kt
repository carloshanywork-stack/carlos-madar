package com.madar.rep.app.domain.fsm

import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState

/**
 * Amazon Flex Paradigm: Strict Declarative Finite State Machine for Machine Visits.
 * Defines explicit sequential steps of field service execution.
 */
enum class VisitStep(val stepNumber: Int, val titleAr: String) {
    EN_ROUTE(1, "الوصول"),
    BEFORE_PHOTOS(2, "صور قبل"),
    MAINTENANCE(3, "الصيانة"),
    AFTER_PHOTOS(4, "صور بعد"),
    SUMMARY(5, "الاعتماد");

    val isFirst: Boolean get() = this == EN_ROUTE
    val isLast: Boolean get() = this == SUMMARY
}

data class VisitFsmState(
    val currentStep: VisitStep,
    val isArrivalConfirmed: Boolean,
    val beforePhotosCount: Int,
    val afterPhotosCount: Int,
    val hasConditionSelected: Boolean,
    val isReadyToSubmit: Boolean,
    val distanceMeters: Double?,
    val locationDecision: LocationDecision,
)

object VisitFsm {
    fun evaluate(
        visit: VisitEntity,
        photos: List<PhotoEntity>,
        userLocation: GeoPoint?,
        manualArrivalConfirmed: Boolean = false,
        nowMillis: Long = System.currentTimeMillis(),
    ): VisitFsmState {
        val before = photos.filter { it.phase == "before" }
        val after = photos.filter { it.phase == "after" }
        val beforeCount = before.size
        val afterCount = after.size

        val decision = GeoPolicy.evaluate(
            userLocation,
            visit.machineLatitude,
            visit.machineLongitude,
            visit.geofenceRadiusMeters,
            nowMillis = nowMillis,
        )

        val distance = if (userLocation != null && visit.machineLatitude != null && visit.machineLongitude != null) {
            GeoPolicy.distanceMeters(
                userLocation.latitude, userLocation.longitude,
                visit.machineLatitude, visit.machineLongitude
            )
        } else null

        // Arrival is confirmed if:
        // 1. Manually confirmed by pressing "I've Arrived"
        // 2. Or already inside geofence (LocationDecision.Valid)
        // 3. Or photos already exist (resuming existing draft)
        // 4. Or machine location has not been locked by admin yet
        val arrivalConfirmed = manualArrivalConfirmed ||
            !visit.locationLocked ||
            beforeCount > 0 ||
            afterCount > 0 ||
            decision is LocationDecision.Valid

        val readyToSubmit = PhotoPolicy.validVisit(beforeCount, afterCount) &&
            visit.locationLocked

        val determinedStep = when {
            visit.state != VisitState.DRAFT -> VisitStep.SUMMARY
            !arrivalConfirmed && distance != null && distance > visit.geofenceRadiusMeters -> VisitStep.EN_ROUTE
            beforeCount == 0 -> VisitStep.BEFORE_PHOTOS
            visit.machineCondition.isBlank() -> VisitStep.MAINTENANCE
            afterCount == 0 -> VisitStep.AFTER_PHOTOS
            else -> VisitStep.SUMMARY
        }

        return VisitFsmState(
            currentStep = determinedStep,
            isArrivalConfirmed = arrivalConfirmed,
            beforePhotosCount = beforeCount,
            afterPhotosCount = afterCount,
            hasConditionSelected = visit.machineCondition.isNotBlank(),
            isReadyToSubmit = readyToSubmit,
            distanceMeters = distance,
            locationDecision = decision,
        )
    }
}
