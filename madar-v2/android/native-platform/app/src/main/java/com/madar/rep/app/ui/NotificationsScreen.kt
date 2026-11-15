package com.madar.rep.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.db.NotificationEntity
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal

@Composable
fun NotificationsScreen(
    notifications: List<NotificationEntity>,
    unreadCount: Int,
    loading: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onMarkRead: (Long) -> Unit,
    onMarkAllRead: () -> Unit,
    onDismiss: (Long) -> Unit,
) {
    Scaffold(
        topBar = {
            MadarTopBar(
                title = "الإشعارات",
                subtitle = if (unreadCount > 0) "$unreadCount غير مقروء" else "كل الإشعارات مقروءة",
                onBack = onBack,
                actions = {
                    if (unreadCount > 0) {
                        IconButton(onClick = onMarkAllRead) {
                            Icon(Icons.Default.DoneAll, contentDescription = "تعليم الكل كمقروء")
                        }
                    }
                    IconButton(onClick = onRefresh) {
                        if (loading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(Icons.Default.Notifications, contentDescription = "تحديث")
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (notifications.isEmpty()) {
            Box(
                Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
                contentAlignment = Alignment.Center,
            ) {
                EmptyState(
                    "لا توجد إشعارات",
                    "ستظهر هنا تحديثات المشرف والزيارات الجديدة.",
                    action = { TextButton(onClick = onRefresh) { Text("تحديث") } },
                )
            }
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(notifications, key = { it.localKey }) { item ->
                NotificationCard(
                    item = item,
                    onOpen = {
                        if (!item.read) onMarkRead(item.id)
                    },
                    onDismiss = { onDismiss(item.id) },
                )
            }
        }
    }
}

@Composable
private fun NotificationCard(
    item: NotificationEntity,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
) {
    val whenText = MadarTime.parseIso(item.occurredAt)?.let { MadarTime.displayDateTime(it) }
        ?: item.occurredAt.ifBlank { item.createdAt }
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (item.read) MaterialTheme.colorScheme.surface else MadarTeal.copy(alpha = 0.08f),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(
                if (item.read) Icons.Default.NotificationsNone else Icons.Default.Notifications,
                contentDescription = null,
                tint = if (item.read) MadarMuted else MadarTeal,
                modifier = Modifier.size(22.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    item.message.ifBlank { item.type },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (item.read) FontWeight.Normal else FontWeight.SemiBold,
                )
                if (whenText.isNotBlank()) {
                    Text(whenText, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                }
                if (!item.read) {
                    TextButton(onClick = onOpen, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                        Text("تعليم كمقروء")
                    }
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Default.Close, contentDescription = "إخفاء الإشعار", tint = MadarMuted)
            }
        }
    }
    Spacer(Modifier.size(2.dp))
}
