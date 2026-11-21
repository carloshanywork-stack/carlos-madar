import { useMemo, useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import OperationalImageViewer from '../../components/ui/OperationalImageViewer.jsx';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';

const STATUS_LABELS = { new: 'جديد', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };
const SEVERITY_LABELS = { low: 'منخفض', normal: 'عادي', high: 'مرتفع', critical: 'حرج' };

export default function RepSupportAdminPage() {
  const [view, setView] = useState('reports');
  const [status, setStatus] = useState('all');
  const [exportCategory, setExportCategory] = useState('all');
  const [exportSeverity, setExportSeverity] = useState('all');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [viewingSupportPhoto, setViewingSupportPhoto] = useState(null);
  const reportsUrl = `/api/system/rep-support/reports?status=${encodeURIComponent(status)}`;
  const { data: reportData, loading: reportsLoading, error: reportsError, reload: reloadReports } = useApi(reportsUrl, { enabled: view === 'reports' });
  const { data: locationData, loading: locationsLoading, error: locationsError, reload: reloadLocations } = useApi('/api/system/rep-location-changes?status=pending', { enabled: view === 'locations' });
  const { data: releaseData, loading: releasesLoading, error: releasesError, reload: reloadReleases } = useApi('/api/system/rep-releases', { enabled: view === 'releases' });
  const reports = useMemo(() => reportData?.reports ?? [], [reportData]);
  const requests = useMemo(() => locationData?.requests ?? [], [locationData]);
  const releases = useMemo(() => releaseData?.releases ?? [], [releaseData]);

  async function updateReport(report, nextStatus) {
    const key = `report-${report.id}`;
    setBusy(key); setError('');
    try { await api.patch(`/api/system/rep-support/reports/${report.id}`, { status: nextStatus }); await reloadReports(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function createIssue(report) {
    const key = `github-${report.id}`;
    setBusy(key); setError('');
    try { await api.post(`/api/system/rep-support/reports/${report.id}/github-issue`, {}); await reloadReports(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function runDiagnosis(report) {
    const key = `diag-${report.id}`;
    setBusy(key); setError('');
    try { await api.post(`/api/system/rep-support/reports/${report.id}/diagnose`, {}); await reloadReports(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function exportWorkbook() {
    setBusy('export-xlsx'); setError('');
    try {
      const query = new URLSearchParams({ status, category: exportCategory, severity: exportSeverity });
      if (exportFrom) query.set('from', exportFrom);
      if (exportTo) query.set('to', exportTo);
      await api.download(`/api/system/rep-support/reports/export.xlsx?${query}`, 'rep-support-reports.xlsx');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function exportPackage(report) {
    setBusy(`export-${report.id}`); setError('');
    try {
      await api.download(`/api/system/rep-support/reports/${report.id}/package.zip`, `rep-bug-report-${report.id}.zip`);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function reviewLocation(request, decision) {
    const note = window.prompt(decision === 'approved' ? 'ملاحظة اعتماد الموقع (اختياري)' : 'سبب رفض تغيير الموقع (اختياري)');
    if (note === null) return;
    const key = `location-${request.id}`;
    setBusy(key); setError('');
    try { await api.post(`/api/system/rep-location-changes/${request.id}/${decision}`, { note }); await reloadLocations(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function publishRelease() {
    if (!window.confirm('سيتم تسجيل APK الإصدار المحلي المتحقق منه كسجل إصدار متاح للمندوبين. لم يتم رفعه أو توزيعه خارج الشبكة المحلية. متابعة؟')) return;
    setBusy('publish-release'); setError('');
    try { await api.post('/api/system/rep-releases/publish', { notes: releaseNotes }); setReleaseNotes(''); await reloadReleases(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function withdrawRelease(release) {
    if (!window.confirm(`سحب الإصدار ${release.versionName}؟ سيتوقف تحميله فوراً ولن يستطيع المندوبون التحديث إليه.`)) return;
    setBusy(`withdraw-${release.id}`); setError('');
    try { await api.post(`/api/system/rep-releases/${release.id}/withdraw`, {}); await reloadReleases(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  return (
    <div className="madar-page">
      <PageHeader kicker="تطبيق المندوبين" title="الدعم ومراجعة المواقع" description="إدارة بلاغات التطبيق ومراجعة طلبات تغيير المواقع قبل تعديل بيانات الآلات." />
      <div className="madar-section" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant={view === 'reports' ? 'primary' : 'secondary'} onClick={() => setView('reports')}>بلاغات التطبيق</Button>
        <Button variant={view === 'locations' ? 'primary' : 'secondary'} onClick={() => setView('locations')}>طلبات تغيير المواقع</Button>
        <Button variant={view === 'releases' ? 'primary' : 'secondary'} onClick={() => setView('releases')}>سجل إصدارات APK</Button>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}

      {view === 'reports' && <>
        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>بلاغات المندوبين</h2><p>تُحفظ البلاغات محلياً؛ إنشاء تذكرة GitHub يتم يدوياً عند طلب المدير فقط.</p></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>الحالة <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">الكل</option><option value="new">جديد</option><option value="in_progress">قيد المعالجة</option><option value="resolved">تم الحل</option><option value="closed">مغلق</option></select></label>
              <label>تصنيف التصدير <select value={exportCategory} onChange={(event) => setExportCategory(event.target.value)}><option value="all">الكل</option>{['bug', 'sync', 'location', 'camera', 'account', 'other'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>الخطورة <select value={exportSeverity} onChange={(event) => setExportSeverity(event.target.value)}><option value="all">الكل</option>{['low', 'normal', 'high', 'critical'].map((value) => <option key={value} value={value}>{SEVERITY_LABELS[value]}</option>)}</select></label>
              <label>من <input type="date" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} /></label>
              <label>إلى <input type="date" value={exportTo} onChange={(event) => setExportTo(event.target.value)} /></label>
              <Button variant="secondary" disabled={busy === 'export-xlsx'} onClick={exportWorkbook}>{busy === 'export-xlsx' ? 'جارٍ التصدير…' : 'تصدير Excel'}</Button>
            </div>
          </div>
          {reportsError && <div className="madar-panel-body"><Alert tone="error">{reportsError}</Alert></div>}
          {reportsLoading ? <LoadingState label="جارٍ تحميل البلاغات" /> : reports.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>البلاغ</th><th>المندوب</th><th>التطبيق والجهاز</th><th>المرفقات</th><th>الحالة / GitHub</th><th>الإجراء</th></tr></thead><tbody>
            {reports.map((report) => <tr key={report.id}>
              <td>
                <strong>{report.category} · {SEVERITY_LABELS[report.severity] ?? report.severity}</strong>
                <p>{report.description}</p>
                {report.diagnosis && (
                  <div style={{ margin: '6px 0', padding: '6px 8px', background: '#e0f2f1', borderRadius: '6px', fontSize: '11px', color: '#004d40' }}>
                    <strong>🤖 تشخيص AI:</strong> {report.diagnosis.rootCause}
                    {report.diagnosis.selfHealed && <span style={{ marginRight: '6px', padding: '1px 5px', background: '#c8e6c9', borderRadius: '4px', color: '#1b5e20', fontSize: '10px' }}>تم الإصلاح ذاتياً</span>}
                    {report.diagnosis.findings?.map((f, i) => <div key={i} style={{ marginTop: '2px' }}>• {f}</div>)}
                    {report.diagnosis.actionTaken && <div style={{ marginTop: '2px', fontStyle: 'italic' }}>الإجراء: {report.diagnosis.actionTaken}</div>}
                  </div>
                )}
                <small>{new Date(report.createdAt).toLocaleString('ar')}</small>
              </td>
              <td>{report.representativeName || report.username}</td>
              <td>{report.appVersion}<br />{report.deviceModel} · Android {report.androidVersion}</td>
              <td>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {report.attachments.map((attachment) => attachment.downloadUrl ? (
                    <Button
                      key={attachment.id}
                      size="small"
                      variant="ghost"
                      onClick={() => setViewingSupportPhoto({
                        title: `مرفق بلاغ: ${report.category}`,
                        subtitle: `${report.representativeName || report.username} · ${report.appVersion || ''}`,
                        photos: [{
                          id: attachment.id,
                          url: attachment.downloadUrl,
                          filename: attachment.filename || `MADAR_support_${report.id}_${attachment.id}.jpg`,
                          caption: `صورة مرفقة (${Math.ceil((attachment.byteSize || 0) / 1024)} KB)`
                        }]
                      })}
                    >
                      صورة ({Math.ceil(attachment.byteSize / 1024)} KB)
                    </Button>
                  ) : (
                    <span key={attachment.id} className="madar-muted">انتهت مدة الاحتفاظ</span>
                  ))}
                </div>
              </td>
              <td><Badge>{STATUS_LABELS[report.status] ?? report.status}</Badge><p>{report.githubStatus === 'created' && report.githubIssueUrl ? <a href={report.githubIssueUrl} target="_blank" rel="noreferrer">تذكرة GitHub</a> : `GitHub: ${report.githubStatus}`}</p>{report.githubLastError && <small>{report.githubLastError}</small>}</td>
              <td><div style={{ display: 'grid', gap: 6 }}>
                <Button size="small" variant="secondary" disabled={busy === `export-${report.id}`} onClick={() => exportPackage(report)}>{busy === `export-${report.id}` ? 'جارٍ التجهيز…' : 'تنزيل ZIP'}</Button>
                <select aria-label="تغيير حالة البلاغ" value={report.status} disabled={busy === `report-${report.id}`} onChange={(event) => updateReport(report, event.target.value)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <Button size="small" variant="secondary" disabled={busy === `diag-${report.id}`} onClick={() => runDiagnosis(report)}>{busy === `diag-${report.id}` ? 'جارٍ الفحص…' : '🤖 تشخيص ذكي'}</Button>
                {report.githubStatus !== 'created' && <Button size="small" variant="secondary" disabled={busy === `github-${report.id}`} onClick={() => createIssue(report)}>{busy === `github-${report.id}` ? 'جارٍ الإرسال…' : 'إنشاء GitHub issue'}</Button>}
              </div></td>
            </tr>)}
          </tbody></table></div> : <EmptyState title="لا توجد بلاغات" description="ستظهر هنا البلاغات التي يرسلها مستخدمو التطبيق الميداني." />}
        </section>
      </>}

      {view === 'locations' && <section className="madar-panel madar-section">
        <div className="madar-panel-header"><div><h2>طلبات تغيير مواقع الآلات</h2><p>لن يتغير الموقع المثبت حتى يعتمد المدير الطلب.</p></div><Button variant="secondary" onClick={reloadLocations}>تحديث</Button></div>
        {locationsError && <div className="madar-panel-body"><Alert tone="error">{locationsError}</Alert></div>}
        {locationsLoading ? <LoadingState label="جارٍ تحميل طلبات المواقع" /> : requests.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الآلة / أمر الصيانة</th><th>المندوب</th><th>الموقع الحالي</th><th>الموقع المقترح</th><th>الدليل</th><th>قرار الإدارة</th></tr></thead><tbody>
          {requests.map((request) => <tr key={request.id}><td>{request.machineCode} · {request.machineName}<br /><small>{request.orderCode}</small></td><td>{request.representativeName}</td>
            <td>{request.oldLocation ? `${request.oldLocation.latitude}, ${request.oldLocation.longitude}` : '—'}</td>
            <td>{request.proposedLocation.latitude}, {request.proposedLocation.longitude}<br /><small>دقة GPS: {request.proposedLocation.accuracy} م · بُعد: {Math.round(request.distanceMeters)} م</small></td>
            <td>{request.hasEvidence ? (
              <Button
                size="small"
                variant="ghost"
                onClick={() => setViewingSupportPhoto({
                  title: `دليل تغيير موقع: ${request.machineCode}`,
                  subtitle: `${request.machineName} · ${request.representativeName}`,
                  machineCode: request.machineCode,
                  phaseLabel: 'تغيير موقع',
                  photos: [{
                    id: `loc-${request.id}`,
                    url: `/api/system/rep-location-changes/${request.id}/evidence`,
                    filename: `MADAR_${request.machineCode}_location_evidence.jpg`,
                    caption: `إحداثيات مقترحة: ${request.proposedLocation.latitude}, ${request.proposedLocation.longitude}`
                  }]
                })}
              >
                عرض الصورة
              </Button>
            ) : 'لا يوجد'}</td>
            <td><div style={{ display: 'flex', gap: 6 }}><Button size="small" disabled={busy === `location-${request.id}`} onClick={() => reviewLocation(request, 'approved')}>اعتماد</Button><Button size="small" variant="danger" disabled={busy === `location-${request.id}`} onClick={() => reviewLocation(request, 'rejected')}>رفض</Button></div>{request.note && <small>{request.note}</small>}</td>
          </tr>)}
        </tbody></table></div> : <EmptyState title="لا توجد طلبات معلقة" description="طلبات تغيير المواقع الجديدة ستظهر هنا للمراجعة." />}
      </section>}

      {view === 'releases' && <section className="madar-panel madar-section">
        <div className="madar-panel-header"><div><h2>سجل إصدارات تطبيق المندوب</h2><p>التسجيل يتطلب APK نظيفاً متحققاً وموقّعاً ببصمة المفتاح المعتمدة في إعداد الخادم.</p></div><Button variant="secondary" onClick={reloadReleases}>تحديث</Button></div>
        <div className="madar-panel-body" style={{ display: 'grid', gap: 10 }}>
          <Alert tone="info">لا يؤدي التسجيل إلى نشر خارجي أو تثبيت تلقائي. يسري التسجيل على التحميل والتحديث من داخل التطبيق: الإصدار المسجّل «available» فقط هو الذي يُقدَّم، وسحب الإصدار يوقف تقديمه فوراً. توافق التحديث داخل التطبيق يتطلب بقاء مفتاح التوقيع نفسه.</Alert>
          <label>ملاحظات الإصدار (اختياري)<textarea rows={2} maxLength={2000} value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} /></label>
          <div><Button disabled={busy === 'publish-release'} onClick={publishRelease}>{busy === 'publish-release' ? 'جارٍ التحقق…' : 'التحقق وتسجيل APK المحلي'}</Button></div>
        </div>
        {releasesError && <div className="madar-panel-body"><Alert tone="error">{releasesError}</Alert></div>}
        {releasesLoading ? <LoadingState label="جارٍ تحميل سجل الإصدارات" /> : releases.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الإصدار</th><th>المراجعة</th><th>SHA-256</th><th>الحالة</th><th>تاريخ التسجيل</th><th>إجراء</th></tr></thead><tbody>
          {releases.map((release) => <tr key={release.id}><td>{release.versionName} <small>({release.versionCode})</small></td><td dir="ltr">{release.sourceRevision.slice(0, 12)}</td><td dir="ltr">{release.apkSha256.slice(0, 20)}…</td><td>{release.status}</td><td>{new Date(release.publishedAt).toLocaleString('ar')}</td><td>{release.status !== 'withdrawn' && <Button size="small" variant="danger" disabled={busy === `withdraw-${release.id}`} onClick={() => withdrawRelease(release)}>سحب</Button>}</td></tr>)}
        </tbody></table></div> : <EmptyState title="لا توجد إصدارات مسجلة" description="بعد توفير أداة Android وبصمة التوقيع المعتمدة، يمكن للمدير تسجيل ملف الإصدار المحلي المتحقق منه." />}
      </section>}

      {viewingSupportPhoto && (
        <OperationalImageViewer
          isOpen={Boolean(viewingSupportPhoto)}
          onClose={() => setViewingSupportPhoto(null)}
          title={viewingSupportPhoto.title}
          subtitle={viewingSupportPhoto.subtitle}
          machineCode={viewingSupportPhoto.machineCode}
          phaseLabel={viewingSupportPhoto.phaseLabel}
          photos={viewingSupportPhoto.photos}
        />
      )}
    </div>
  );
}
