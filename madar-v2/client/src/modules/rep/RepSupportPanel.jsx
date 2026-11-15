import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

function sanitizeClientLogs(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|token|secret|authorization|cookie|session(?:_?id)?)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .slice(0, 24000);
}

function createReportUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export default function RepSupportPanel({ onClose }) {
  const [reports, setReports] = useState([]);
  const [category, setCategory] = useState('bug');
  const [severity, setSeverity] = useState('normal');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const formRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.get('/api/rep/support/reports').then((payload) => { if (active) setReports(payload.reports ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const report = {
        reportUuid: createReportUuid(),
        category, severity, description,
        screenName: 'مسار المندوب', appVersion: 'MADAR V2',
        deviceModel: navigator.userAgent.slice(0, 150), androidVersion: 'غير معروف',
        logs: sanitizeClientLogs(`online=${navigator.onLine}; language=${navigator.language}; platform=${navigator.platform}`),
      };
      const form = new FormData();
      form.append('report', JSON.stringify(report));
      if (attachment) form.append('attachment', attachment);
      const response = await api.upload('/api/rep/support/reports', form);
      setReports((current) => [response.report, ...current.filter((item) => item.id !== response.report.id)]);
      setDescription(''); setAttachment(null);
      formRef.current?.reset();
      setMessage('تم حفظ البلاغ بأمان. يستطيع المدير مراجعته من لوحة الدعم.');
    } catch (caught) { setError(caught?.message || 'تعذر إرسال البلاغ.'); }
    finally { setBusy(false); }
  }

  return <div className="rep-support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="rep-support-dialog" role="dialog" aria-modal="true" aria-labelledby="rep-support-title" dir="rtl">
      <header><div><span className="rep-eyebrow">مساعدة ودعم</span><h2 id="rep-support-title">إرسال بلاغ</h2></div><button type="button" onClick={onClose} aria-label="إغلاق">×</button></header>
      <p>سيُحفظ البلاغ على خادم MADAR المحلي. لن يُنشأ issue خارجي إلا بطلب صريح من المدير.</p>
      <form ref={formRef} onSubmit={submit}>
        <label>نوع البلاغ<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="bug">مشكلة بالتطبيق</option><option value="sync">مزامنة</option><option value="location">الموقع</option><option value="camera">الكاميرا والصور</option><option value="account">الحساب</option><option value="other">أخرى</option></select></label>
        <label>الأهمية<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="critical">حرجة</option></select></label>
        <label>وصف المشكلة<textarea value={description} onChange={(event) => setDescription(event.target.value)} required minLength={5} maxLength={8000} rows={5} placeholder="اذكر ما حدث والخطوات التي سبقت المشكلة" /></label>
        <label>صورة توضيحية (اختياري)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>
        {error && <p role="alert" className="rep-support-error">{error}</p>}{message && <p role="status" className="rep-support-success">{message}</p>}
        <div className="rep-support-actions"><button type="button" onClick={onClose}>إغلاق</button><button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ وإرسال البلاغ'}</button></div>
      </form>
      {!!reports.length && <div className="rep-support-history"><h3>بلاغاتك السابقة</h3><ul>{reports.slice(0, 5).map((report) => <li key={report.id}><span>{report.description}</span><b>{({ new: 'جديد', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' })[report.status] || report.status}</b></li>)}</ul></div>}
    </section>
  </div>;
}
