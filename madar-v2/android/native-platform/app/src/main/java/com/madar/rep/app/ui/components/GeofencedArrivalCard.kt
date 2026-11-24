package com.madar.rep.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.ui.InlineMessage
import com.madar.rep.app.ui.LocationUiState
import com.madar.rep.app.ui.MessageTone
import com.madar.rep.app.ui.SectionCard
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning

/**
 * Amazon Flex Paradigm: Geofenced Arrival Verification Card.
 * Requires physical arrival within geofence before unlocking machine operations,
 * with anti-mock GPS detection and supervisor manual override capabilities.
 */
@Composable
fun GeofencedArrivalCard(
    location: LocationUiState,
    visit: VisitEntity,
    isArrivalConfirmed: Boolean,
    approvingMachineLocation: Boolean,
    approvalProgressMessage: String? = null,
    onConfirmArrival: () -> Unit,
    onRefreshLocation: () -> Unit,
    onApproveMachineLocation: () -> Unit,
    onRequestLocationChange: () -> Unit,
    onReportUnableToService: () -> Unit,
    onRequestPermission: () -> Unit,
    onConfirmDifferentLocation: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    SectionCard(
        modifier = modifier,
        title = "التحقق الجغرافي ونطاق الماكينة (Geofence)",
        subtitle = "نمط أمازون فليكس: التحقق التلقائي من التواجد الفعلي عند الماكينة لمنع التزييف",
    ) {
        if (!visit.locationLocked) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                InlineMessage(
                    "موقع الماكينة غير مثبت بعد. يلزم التواجد عند الماكينة واعتماد إحداثياتها لأول مرة.",
                    MessageTone.Warning,
                )
                Button(
                    onClick = onApproveMachineLocation,
                    enabled = !approvingMachineLocation,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    if (approvingMachineLocation) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                        Spacer(Modifier.width(8.dp))
                        Text(approvalProgressMessage ?: "جارٍ تثبيت موقع الماكينة…")
                    } else {
                        Icon(Icons.Default.LocationOn, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("تثبيت واعتماد موقع الماكينة")
                    }
                }
            }
            return@SectionCard
        }

        val point = location.point
        if (point == null) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                InlineMessage("بانتظار إشارة GPS… تأكد من تفعيل خدمة الموقع.", MessageTone.Warning)
                OutlinedButton(onClick = onRefreshLocation, enabled = !location.busy) {
                    Icon(Icons.Default.Refresh, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("تحديث إشارة GPS")
                }
            }
            return@SectionCard
        }

        // Evaluate location against geofence policy
        val decision = GeoPolicy.evaluate(
            point,
            visit.machineLatitude,
            visit.machineLongitude,
            visit.geofenceRadiusMeters,
        )

        val distance = if (visit.machineLatitude != null && visit.machineLongitude != null) {
            GeoPolicy.distanceMeters(point.latitude, point.longitude, visit.machineLatitude, visit.machineLongitude)
        } else null

        val isInsideGeofence = decision is LocationDecision.Valid
        val isMocked = point.isMock || decision is LocationDecision.Mocked

        // Status Banner
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = when {
                isMocked -> MadarDanger.copy(alpha = 0.12f)
                isArrivalConfirmed -> MadarTeal.copy(alpha = 0.12f)
                isInsideGeofence -> Color(0xFF007A3D).copy(alpha = 0.12f)
                else -> MadarWarning.copy(alpha = 0.12f)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    imageVector = when {
                        isMocked -> Icons.Default.Warning
                        isArrivalConfirmed || isInsideGeofence -> Icons.Default.CheckCircle
                        else -> Icons.Default.Navigation
                    },
                    contentDescription = null,
                    tint = when {
                        isMocked -> MadarDanger
                        isArrivalConfirmed || isInsideGeofence -> Color(0xFF007A3D)
                        else -> MadarWarning
                    },
                    modifier = Modifier.size(28.dp),
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        text = when {
                            isMocked -> "تم اكتشاف تزييف الموقع (Mock Location)!"
                            isArrivalConfirmed -> "تم تأكيد الوصول والتواجد عند الماكينة"
                            isInsideGeofence -> "أنت الآن داخل نطاق الماكينة (أقل من 50م)"
                            distance != null -> "أنت على بعد ${distance.toInt()}م من الماكينة"
                            else -> "جارٍ حساب المسافة…"
                        },
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = when {
                            isMocked -> MadarDanger
                            isArrivalConfirmed || isInsideGeofence -> Color(0xFF007A3D)
                            else -> MadarWarning
                        },
                    )
                    Text(
                        text = "الدقة: ±${point.accuracyMeters.toInt()}م · النطاق المسموح: ${visit.geofenceRadiusMeters.toInt()}م",
                        fontSize = 12.sp,
                        color = MadarMuted,
                    )
                }
            }
        }

        // Amazon Flex "I've Arrived" Primary Action Button
        if (!isArrivalConfirmed && !isMocked) {
            Button(
                onClick = onConfirmArrival,
                enabled = isInsideGeofence,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isInsideGeofence) Color(0xFF007A3D) else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (isInsideGeofence) Color.White else MadarMuted,
                ),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Icon(Icons.Default.LocationOn, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isInsideGeofence) "أنا في الموقع (تأكيد الوصول)" else "اقترب من الماكينة لتأكيد الوصول (${distance?.toInt() ?: "?"}م)",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
            }
        }

        // Outside Geofence handling: offer to confirm current location for this visit
        if (!isInsideGeofence && !isArrivalConfirmed && !isMocked) {
            val isAccurateEnough = point.accuracyMeters <= GeoPolicy.MAX_FIELD_CONFIRMATION_ACCURACY_METERS
            if (!isAccurateEnough) {
                InlineMessage(
                    "دقة إشارة GPS الحالية (±${point.accuracyMeters.toInt()}م) غير كافية للتحقق بدقة. يرجى الوقوف في مكان مكشوف للحصول على إشارة أفضل.",
                    MessageTone.Warning,
                )
            } else {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MadarGold.copy(alpha = 0.15f),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(Icons.Default.Warning, contentDescription = null, tint = MadarGold)
                            Text(
                                text = "أنت في موقع مختلف عن الموقع المسجل للماكينة",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = MadarInk,
                            )
                        }
                        Text(
                            text = "المسافة الحالية عن الموقع المسجل: ${distance?.toInt() ?: "?"}م. إذا كانت الماكينة نُقلت أو كان الموقع المسجل غير صحيح، يمكنك اعتماد موقعك الحالي للزيارة والمتابعة فوراً.",
                            fontSize = 12.sp,
                            color = MadarMuted,
                        )
                        Button(
                            onClick = onConfirmDifferentLocation,
                            colors = ButtonDefaults.buttonColors(containerColor = MadarTeal, contentColor = Color.White),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth().height(46.dp),
                        ) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("اعتماد الموقع الحالي للزيارة", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }
                    }
                }
            }
        }

        // Secondary Options: Outside Geofence or Location Inaccurate
        if (!isInsideGeofence && !isArrivalConfirmed) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onRefreshLocation) {
                    Icon(Icons.Default.Refresh, contentDescription = null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("تحديث GPS", fontSize = 12.sp)
                }
                TextButton(onClick = onRequestLocationChange) {
                    Text("طلب تعديل موقع الماكينة", fontSize = 12.sp, color = MadarTeal)
                }
                TextButton(onClick = onReportUnableToService) {
                    Text("تعذر الصيانة؟", fontSize = 12.sp, color = MadarDanger)
                }
            }
        }
    }
}
