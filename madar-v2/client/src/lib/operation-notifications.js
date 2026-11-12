/** Business notifications only. GPS updates remain map events and never flood the supervisor. */
export function operationNotification(event) {
  if (!event || event.type === 'rep.tracking.updated' || event.type?.startsWith('system.')) return null;
  const rep = event.repName || event.employeeName || (event.userId ? `المندوب ${event.userId}` : 'المندوب');
  const known = {
    'attendance.changed': [event.action === 'out' ? `سجّل ${rep} الانصراف.` : event.action === 'in' ? `سجّل ${rep} الحضور.` : `تحديث حضور ${rep}.`, '/accounting'],
    'rep.visit.submitted': [`وصلت زيارة ميدانية جديدة من ${rep} للمراجعة.`, '/supervisor'],
    'rep.visit.reviewed': [event.status === 'approved' ? 'تم اعتماد الزيارة الميدانية.' : 'طُلبت إعادة تصوير زيارة ميدانية.', '/supervisor'],
    'rep.machine.location-requested': [`طلب ${rep} اعتماد موقع ماكينة.`, '/supervisor'],
    'rep.machine.location-reviewed': [event.status === 'approved' ? 'تم اعتماد موقع الماكينة.' : 'تم رفض موقع الماكينة المقترح.', '/supervisor'],
    'rep.machine.correction-submitted': [`بلاغ تصحيح ماكينة ${event.reportedCode || ''} من ${rep}.`, '/maintenance?view=machines&review=corrections'],
    'maintenance.order.assigned': [`تم تحديث تكليف أمر التشغيل ${event.orderCode || ''}.`, '/supervisor'],
    'overtime.pending': [`طلب أوفر تايم جديد ${event.employeeName || ''} بانتظار الاعتماد.`, '/accounting'],
  };
  const entry = known[event.type];
  return entry ? { id: event.id, text: entry[0], href: entry[1], occurredAt: event.occurredAt } : null;
}
