package com.madar.rep.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.domain.fsm.VisitStep
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal

@Composable
fun VisitStepBar(
    currentStep: VisitStep,
    onStepClick: (VisitStep) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val steps = VisitStep.values()
            steps.forEachIndexed { index, step ->
                val isCurrent = step == currentStep
                val isCompleted = step.stepNumber < currentStep.stepNumber

                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onStepClick(step) }
                        .padding(horizontal = 2.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    isCompleted -> MadarTeal
                                    isCurrent -> MadarGold
                                    else -> MaterialTheme.colorScheme.surfaceVariant
                                }
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isCompleted) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(16.dp),
                            )
                        } else {
                            Text(
                                text = "${step.stepNumber}",
                                fontSize = 12.sp,
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                                color = if (isCurrent) MadarInk else MadarMuted,
                            )
                        }
                    }
                    Text(
                        text = step.titleAr,
                        fontSize = 11.sp,
                        fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                        color = when {
                            isCurrent -> MadarTeal
                            isCompleted -> MadarInk
                            else -> MadarMuted
                        },
                        maxLines = 1,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }

                if (index < steps.size - 1) {
                    Box(
                        modifier = Modifier
                            .height(2.dp)
                            .weight(0.4f)
                            .background(
                                if (step.stepNumber < currentStep.stepNumber) MadarTeal.copy(alpha = 0.6f)
                                else MaterialTheme.colorScheme.surfaceVariant
                            )
                    )
                }
            }
        }
    }
}
