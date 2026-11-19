package com.madar.rep.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.ui.theme.MadarDanger

data class ServiceExceptionReason(val code: String, val labelAr: String)

val UNABLE_TO_SERVICE_REASONS = listOf(
    ServiceExceptionReason("LOCATION_CLOSED", "الموقع / المحل مغلق تماماً"),
    ServiceExceptionReason("POWER_OUTAGE", "انقطاع التيار الكهربائي عن الموقع"),
    ServiceExceptionReason("MACHINE_MOVED", "الماكينة منقولة أو غير متواجدة بالمكان"),
    ServiceExceptionReason("ACCESS_DENIED", "تعذر الدخول أو رفض العميل/الأمن"),
    ServiceExceptionReason("MAJOR_BREAKDOWN", "عطل جسيم يستوجب سحب الماكينة للورشة"),
    ServiceExceptionReason("OTHER", "سبب ميداني آخر (أدخل التفاصيل بالأسفل)"),
)

@Composable
fun UnableToServiceDialog(
    visit: VisitEntity,
    onDismiss: () -> Unit,
    onSubmitException: (reasonCode: String, reasonLabel: String, notes: String) -> Unit,
) {
    var selectedReason by remember { mutableStateOf(UNABLE_TO_SERVICE_REASONS.first().code) }
    var notes by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(20.dp),
        icon = {
            Icon(Icons.Default.Warning, contentDescription = null, tint = MadarDanger)
        },
        title = {
            Text("إثبات تعذر الصيانة للمشرف", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "نمط أمازون فليكس: في حال تعذر إتمام الزيارة لأسباب خارجة عن إرادتك، حدد السبب لإخطار المشرف وتوثيق الواقعة رسمياً.",
                    style = MaterialTheme.typography.bodySmall,
                )

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UNABLE_TO_SERVICE_REASONS.forEach { reason ->
                        val isSelected = selectedReason == reason.code
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)
                            else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { selectedReason = reason.code },
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(
                                    selected = isSelected,
                                    onClick = { selectedReason = reason.code },
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(reason.labelAr, fontSize = 13.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                            }
                        }
                    }
                }

                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it.take(1000) },
                    label = { Text("تفاصيل وملاحظات إضافية للمشرف") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val label = UNABLE_TO_SERVICE_REASONS.firstOrNull { it.code == selectedReason }?.labelAr ?: selectedReason
                    onSubmitException(selectedReason, label, notes)
                },
                colors = ButtonDefaults.buttonColors(containerColor = MadarDanger),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("إرسال تقرير التعذر للمشرف", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("إلغاء")
            }
        },
    )
}
