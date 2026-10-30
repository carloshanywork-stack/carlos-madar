import { useApi } from '../../lib/useApi.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';

const unavailable = [
  { title: 'إدارة المستخدمين', description: 'خادم V2 لا يوفّر بعد واجهات إدارة المستخدمين أو تسجيل الدخول.', icon: 'users' },
  { title: 'النسخ الاحتياطي والاستعادة', description: 'لا توجد واجهة V2 لإنشاء نسخة أو استعادتها؛ لا يتم عرض بيانات تخمينية.', icon: 'archive' },
  { title: 'صحة التخزين', description: 'لا توجد بعد نقطة API تعرض المساحة أو حالة مجلدات التخزين.', icon: 'boxes' },
];

export default function SettingsPage() {
  const { data: health, loading, error, reload } = useApi('/api/health');
  return (
    <>
      <PageHeader kicker="النظام · الإصدار والتشغيل" title="إعدادات النظام" description="معلومات تشغيل MADAR V2 الحالية وحالة اتصال واجهة الويب بالخادم." />
      <div className="madar-grid madar-grid-2 madar-section">
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">إصدار التطبيق</span><div className="madar-runtime-brand"><span className="madar-brand-mark light">M</span><div><strong>MADAR</strong><small>v2.0.0-release</small></div></div><p className="madar-page-description">نظام إدارة التشغيل والصيانة · نسخة V2 المحلية.</p></section>
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">اتصال API</span>{loading && !health ? <LoadingState label="جارٍ فحص الخادم" /> : error ? <Alert tone="error">{error}</Alert> : <div className="madar-health-row"><span className="madar-health-pulse" /><div><strong>{health?.service ?? 'MADAR V2'}</strong><small>الخادم يستجيب للطلبات.</small></div><Badge tone="success">متصل</Badge></div>}<button type="button" className="madar-button madar-button-secondary madar-button-small" onClick={reload}>إعادة الفحص</button></section>
      </div>
      <div className="madar-section-head madar-section"><div><h2 className="madar-section-title">مساحات لم تُربط بعد بواجهات V2</h2><div className="madar-section-note">لا تُنفذ هذه البطاقات أي تغييرات أو عمليات غير مدعومة.</div></div></div>
      <div className="madar-grid madar-grid-3">
        {unavailable.map((item) => <article className="madar-panel madar-panel-pad madar-disabled-card" key={item.title}><div className="madar-unavailable-icon"><Icon name={item.icon} size={19} /></div><span className="madar-badge">قيد الإتاحة</span><h3 className="madar-unavailable-title">{item.title}</h3><p className="madar-unavailable-description">{item.description}</p></article>)}
      </div>
      <div className="madar-integration-notice madar-section"><Alert tone="info">الخادم الحالي يعمل محلياً، ولا يعرض إعدادات أو بيانات تخزين شخصية للمتصفح. تسجيل الدخول وإدارة الصلاحيات ضمن حدود V2 الحالية لم يكتمل بعد.</Alert></div>
    </>
  );
}
