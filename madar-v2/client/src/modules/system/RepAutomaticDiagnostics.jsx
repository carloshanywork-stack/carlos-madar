import { useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';

const endpoint = '/api/system/rep-support/diagnostics';
const operations = {
  visit_sync: 'مزامنة الزيارة',
  attendance_sync: 'مزامنة الحضور والانصراف',
  machine_sync: 'مزامنة إجراء الماكينة',
  tracking_sync: 'مزامنة المسار',
  camera_capture: 'التقاط صورة',
  photo_processing: 'تجهيز صورة',
  photo_gallery: 'نسخ الصورة إلى المعرض',
  route_refresh: 'تحديث خط السير',
  visit_submit: 'حفظ الزيارة للإرسال',
  app_crash: 'توقف التطبيق',
};
const failureCodes = {
  network: 'تعذّر الاتصال',
  server: 'رد الخادم بخطأ',
  protocol: 'رد غير متوقع من الخادم',
  unexpected: 'خطأ غير متوقع',
  capture_failed: 'تعذّر التقاط الصورة أو حفظها',
  render_failed: 'تعذّرت معالجة الصورة',
  gallery_failed: 'تعذّر حفظ نسخة في المعرض',
  integrity_failed: 'ملف مفقود أو لم يجتز التحقق',
  retry_exhausted: 'تكرّر الفشل أثناء إعادة المحاولة',
  uncaught_exception: 'خطأ أوقف التطبيق',
};

export default function RepAutomaticDiagnostics() {
  const { data, loading, error, reload } = useApi(endpoint);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(null);
  const reports = data?.reports ?? [];

  async function download(id) {
    setDownloading(id);
    setDownloadError('');
    try {
      await api.download(`${endpoint}/${id}/report.json`, `madar-diagnostic-${id}.json`);
    } catch (caught) {
      setDownloadError(errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="madar-panel madar-section">
      <div className="madar-panel-header">
        <div><h2>التشخيص التلقائي للمندوبين</h2><p>أحدث 100 تقرير أرسلها التطبيق عند تعذّر إحدى العمليات.</p></div>
        <Button variant="secondary" onClick={() => reload()}>تحديث التقارير</Button>
      </div>
      {(error || downloadError) && <div className="madar-panel-body"><Alert tone="error">{error || downloadError}</Alert></div>}
      {loading && <LoadingState label="جارٍ تحميل تقارير التشخيص" />}
      {!loading && !error && !reports.length && <EmptyState title="لا توجد تقارير تشخيص تلقائية" />}
      {!loading && reports.length > 0 && (
        <div className="madar-table-wrap">
          <table className="madar-table">
            <thead><tr><th>رقم التقرير</th><th>العملية المتأثرة</th><th>سبب الفشل المسجّل</th><th>وقت الفشل</th><th>إصدار التطبيق</th><th>الملف</th></tr></thead>
            <tbody>{reports.map((report) => (
              <tr key={report.id}>
                <td>{report.id}</td>
                <td>{operations[report.operation] ?? report.operation}</td>
                <td>{failureCodes[report.failureCode] ?? report.failureCode}{report.httpStatus && <small dir="ltr"> · HTTP {report.httpStatus}</small>}</td>
                <td>{new Date(report.occurredAt).toLocaleString('ar-EG')}</td>
                <td dir="ltr">{report.appVersion} ({report.versionCode})</td>
                <td><Button size="small" variant="secondary" disabled={downloading !== null} onClick={() => download(report.id)}>{downloading === report.id ? 'جارٍ التنزيل…' : 'تنزيل التقرير'}</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
