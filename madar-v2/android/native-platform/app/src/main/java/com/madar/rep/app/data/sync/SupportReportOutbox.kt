package com.madar.rep.app.data.sync

import com.madar.rep.app.core.MadarError

data class SupportReportQueueItem(
    val reportUuid: String,
    val payloadJson: String,
    val attachmentPath: String?,
    val attempts: Int,
)

data class SupportReportFlushSummary(
    val sent: Int = 0,
    val retried: Int = 0,
    val needsReview: Int = 0,
    val needsLogin: Boolean = false,
)

/** Shared deterministic drain used by SyncEngine and unit tests. The UUID remains the server idempotency key. */
suspend fun flushSupportReportOutbox(
    items: List<SupportReportQueueItem>,
    send: suspend (SupportReportQueueItem) -> String,
    markSent: suspend (SupportReportQueueItem) -> Unit,
    markRetry: suspend (SupportReportQueueItem, String) -> Unit,
    markNeedsReview: suspend (SupportReportQueueItem, String) -> Unit,
    markNeedsLogin: suspend (SupportReportQueueItem) -> Unit,
): SupportReportFlushSummary {
    var sent = 0
    var retried = 0
    var needsReview = 0
    for (item in items) {
        try {
            val acknowledgedUuid = send(item)
            if (!item.reportUuid.equals(acknowledgedUuid, ignoreCase = true)) {
                markNeedsReview(item, "لم يطابق إقرار الخادم معرّف البلاغ؛ بقي البلاغ محليًا للمراجعة.")
                needsReview += 1
            } else {
                markSent(item)
                sent += 1
            }
        } catch (error: MadarError.SessionExpired) {
            markNeedsLogin(item)
            return SupportReportFlushSummary(sent, retried, needsReview, needsLogin = true)
        } catch (error: MadarError.Network) {
            markRetry(item, error.message ?: "تعذر الاتصال بالخادم.")
            retried += 1
        } catch (error: MadarError.Server) {
            markRetry(item, error.message ?: "الخادم غير متاح مؤقتًا.")
            retried += 1
        } catch (error: Exception) {
            markNeedsReview(item, error.message ?: "تعذر إرسال البلاغ؛ احتُفظ به للمراجعة.")
            needsReview += 1
        }
    }
    return SupportReportFlushSummary(sent, retried, needsReview)
}
