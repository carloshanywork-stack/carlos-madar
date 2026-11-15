package com.madar.rep.app.data.repo

import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.api.NotificationDto
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.NotificationEntity
import com.madar.rep.app.data.session.Session
import kotlinx.coroutines.flow.Flow

class NotificationRepository(private val database: MadarDatabase) {
    fun observe(repId: Long): Flow<List<NotificationEntity>> = database.notifications().observe(repId)

    fun observeUnread(repId: Long): Flow<Int> = database.notifications().observeUnread(repId)

    suspend fun refresh(session: Session, api: MadarApi) {
        val response = api.getNotifications(session.token)
        val ownerId = session.ownerScopeId
        val existing = database.notifications().list(ownerId).associateBy { it.id }
        val merged = response.notifications.map { dto -> dto.toEntity(ownerId, existing[dto.id]) }
        database.notifications().upsertAll(merged)
        if (merged.isNotEmpty()) {
            database.notifications().deleteMissing(ownerId, merged.map { it.id })
        }
    }

    suspend fun markRead(session: Session, api: MadarApi, id: Long) {
        api.markNotificationRead(session.token, id)
        database.notifications().markRead(session.ownerScopeId, id, com.madar.rep.app.core.MadarTime.isoUtc(System.currentTimeMillis()))
    }

    suspend fun markAllRead(session: Session, api: MadarApi) {
        api.markAllNotificationsRead(session.token)
        database.notifications().markAllRead(session.ownerScopeId, com.madar.rep.app.core.MadarTime.isoUtc(System.currentTimeMillis()))
    }

    suspend fun dismiss(session: Session, api: MadarApi, id: Long) {
        api.dismissNotification(session.token, id)
        database.notifications().dismiss(session.ownerScopeId, id)
    }

    private fun NotificationDto.toEntity(repId: Long, previous: NotificationEntity?): NotificationEntity {
        val localReadAt = previous?.readAt
        val selectedReadAt = readAt ?: localReadAt
        return NotificationEntity(
            id = id,
            ownerRepId = repId,
            eventId = eventId,
            type = type,
            message = message,
            href = href,
            occurredAt = occurredAt,
            read = read || previous?.read == true,
            readAt = selectedReadAt,
            dismissed = previous?.dismissed == true,
            createdAt = createdAt,
            localKey = "$repId:$id",
        )
    }
}
