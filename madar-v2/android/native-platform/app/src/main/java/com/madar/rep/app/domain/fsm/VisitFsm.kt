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
)

object VisitFsm {
    fun arrivalDecision(visit: VisitEntity, location: GeoPoint?, nowMillis: Long = System.currentTimeMillis()): LocationDecision {
        if (!visit.locationLocked || visit.machineLatitude == null || visit.machineLongitude == null) {
            return LocationDecision.Invalid("موقع الماكينة غير مثبت. اعتمد موقعها أولًا.")
        }
        return GeoPolicy.evaluate(
            location,
            visit.machineLatitude,
            visit.machineLongitude,
            visit.geofenceRadiusMeters,
            nowMillis = nowMillis,
            maxAgeMillis = 30_000L,
            maxAccuracyMeters = GeoPolicy.MAX_FIELD_CONFIRMATION_ACCURACY_METERS,
        )
    }

    fun maintenanceComplete(visit: VisitEntity): Boolean = when (visit.machineCondition) {
        "working" -> true
        "faulty", "preventive_maintenance" -> visit.reasonIdsCsv.isNotBlank()
        else -> false
    }

    fun evaluate(
        visit: VisitEntity,
        photos: List<PhotoEntity>,
    ): VisitFsmState {
        val beforeCount = photos.count { it.phase == "before" }
        val afterCount = photos.count { it.phase == "after" }
        val arrived = visit.locationLocked && visit.arrivalConfirmedAt != null
        val maintenanceComplete = maintenanceComplete(visit)

        val determinedStep = when {
            visit.state != VisitState.DRAFT -> VisitStep.SUMMARY
            !arrived -> VisitStep.EN_ROUTE
            beforeCount == 0 -> VisitStep.BEFORE_PHOTOS
            !maintenanceComplete -> VisitStep.MAINTENANCE
            afterCount == 0 -> VisitStep.AFTER_PHOTOS
            else -> VisitStep.SUMMARY
        }

        return VisitFsmState(
            currentStep = determinedStep,
            isArrivalConfirmed = arrived,
            beforePhotosCount = beforeCount,
            afterPhotosCount = afterCount,
            hasConditionSelected = maintenanceComplete,
            isReadyToSubmit = arrived && maintenanceComplete && PhotoPolicy.validVisit(beforeCount, afterCount),
        )
    }
}
