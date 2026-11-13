/**
 * Business notifications derived from durable operations events.
 *
 * This module is shared by the API (which persists one copy per recipient) and
 * the clients (which render live notifications), so message text and links stay
 * identical on both sides. GPS updates remain map events and never flood the
 * supervisor or the notification inbox.
 */
export function operationNotification(event) {
  if (!event || event.type === 'rep.tracking.updated' || event.type?.startsWith('system.')) return null;
  const rep = event.repName || event.employeeName || (event.userId ? `المندوب ${event.userId}` : 'المندوب');
  const known = {
    'attendance.changed': [
      event.action === 'out'
        ? `سجّل ${rep} الانصراف.`
        : event.action === 'in'
          ? `سجّل ${rep} الحضور.`
          : event.action === 'cancelled'
            ? `أُلغي تسجيل حضور ${rep} لهذا اليوم.`
            : `تحديث حضور ${rep}.`,
      '/accounting',
    ],
    'rep.visit.submitted': [`وصلت زيارة ميدانية جديدة من ${rep} للمراجعة.`, '/supervisor'],
    'rep.visit.reviewed': [event.status === 'approved' ? 'تم اعتماد الزيارة الميدانية.' : 'طُلبت إعادة تصوير زيارة ميدانية.', '/supervisor'],
    'rep.machine.location-requested': [`طلب ${rep} اعتماد موقع ماكينة.`, '/supervisor'],
    'rep.machine.location-reviewed': [event.status === 'approved' ? 'تم اعتماد موقع الماكينة.' : 'تم رفض موقع الماكينة المقترح.', '/supervisor'],
    'rep.machine.correction-submitted': [`بلاغ تصحيح ماكينة ${event.reportedCode || ''} من ${rep}.`, '/maintenance?view=machines&review=corrections'],
    'maintenance.order.assigned': [`تم تحديث تكليف أمر التشغيل ${event.orderCode || ''}.`, '/supervisor'],
    'overtime.pending': [`طلب أوفر تايم جديد ${event.employeeName || ''} بانتظار الاعتماد.`, '/accounting'],
    'overtime.requested': [`طلب ${rep} فتح جلسة أوفرتايم إضافية بانتظار موافقة المشرف.`, '/accounting'],
    'overtime.reviewed': [
      event.decision === 'approved'
        ? 'تم اعتماد طلب الأوفرتايم.'
        : event.decision === 'rejected'
          ? 'تم رفض طلب الأوفرتايم.'
          : event.decision === 'cancelled'
            ? 'أُلغي طلب الأوفرتايم.'
            : 'تم تحديث طلب الأوفرتايم.',
      '/accounting',
    ],
  };
  const entry = known[event.type];
  return entry ? { id: event.id, text: entry[0], href: entry[1], occurredAt: event.occurredAt } : null;
}
