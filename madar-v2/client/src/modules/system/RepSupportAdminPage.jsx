import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
import RepAutomaticDiagnostics from './RepAutomaticDiagnostics.jsx';

const STATUS_LABELS = { new: 'جديد', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };
const SEVERITY_LABELS = { low: 'منخفض', normal: 'عادي', high: 'مرتفع', critical: 'حرج' };
const LOCATION_STATUS_LABELS = {
  pending: 'قيد المراجعة',
  approved: 'معتمد كموقع أساسي جديد',
  exception_only: 'استثناء للزيارة فقط',
  rejected: 'مرفوض',
};

function LocationDiffMapModal({ isOpen, onClose, request }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !request || !mapRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const oldLat = request.oldLocation?.latitude;
    const oldLng = request.oldLocation?.longitude;
    const propLat = request.proposedLocation.latitude;
    const propLng = request.proposedLocation.longitude;

    const map = L.map(mapRef.current);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const bounds = [];

    // Red pin for registered location
    if (oldLat != null && oldLng != null) {
      bounds.push([oldLat, oldLng]);
      const oldIcon = L.divIcon({
        className: 'madar-map-pin-old',
        html: '<div style="background:#d32f2f;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.4)">📍</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([oldLat, oldLng], { icon: oldIcon })
        .addTo(map)
        .bindPopup(`<b>الموقع المسجل للماكينة</b><br/>${oldLat.toFixed(6)}, ${oldLng.toFixed(6)}`);
    }

    // Green pin for proposed / confirmed visit location
    bounds.push([propLat, propLng]);
    const propIcon = L.divIcon({
      className: 'madar-map-pin-prop',
      html: '<div style="background:#007A3D;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.4)">✨</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([propLat, propLng], { icon: propIcon })
      .addTo(map)
      .bindPopup(`<b>الموقع الفعلي / المقترح للزيارة</b><br/>${propLat.toFixed(6)}, ${propLng.toFixed(6)}<br/>دقة: ±${Math.round(request.proposedLocation.accuracy)} م`);

    if (oldLat != null && oldLng != null) {
      L.polyline([[oldLat, oldLng], [propLat, propLng]], {
        color: '#ff9800',
        dashArray: '5, 10',
        weight: 3,
      }).addTo(map);
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    } else {
      map.setView([propLat, propLng], 16);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, request]);

  if (!isOpen || !request) return null;

  return (
    <div className="madar-modal-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="madar-modal" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '750px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '90vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>مقارنة المواقع الجغرافية للماكينة</h3>
            <p style={{ margin: '4px 0 0', color: '#666', fontSize: '13px' }}>
              ماكينة {request.machineCode} · {request.machineName} (المسافة المحسوبة بين الموقعين: {Math.round(request.distanceMeters)} متر)
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>✕</Button>
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#d32f2f', display: 'inline-block' }} />
            <span>الموقع المسجل: {request.oldLocation ? `${request.oldLocation.latitude.toFixed(6)}, ${request.oldLocation.longitude.toFixed(6)}` : 'غير محدد'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#007A3D', display: 'inline-block' }} />
            <span>الموقع الفعلي للزيارة: {request.proposedLocation.latitude.toFixed(6)}, {request.proposedLocation.longitude.toFixed(6)} (دقة: ±{Math.round(request.proposedLocation.accuracy)}م)</span>
          </div>
        </div>
        <div ref={mapRef} style={{ width: '100%', height: '380px', borderRadius: '8px', border: '1px solid #ddd' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>إغلاق الخريطة</Button>
        </div>
      </div>
    </div>
  );
}

export default function RepSupportAdminPage({ isAdmin = false }) {
  const [view, setView] = useState('reports');
  const [status, setStatus] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [exportCategory, setExportCategory] = useState('all');
  const [exportSeverity, setExportSeverity] = useState('all');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [viewingSupportPhoto, setViewingSupportPhoto] = useState(null);
  const [locationStatus, setLocationStatus] = useState('pending');
  const [mapModalRequest, setMapModalRequest] = useState(null);
  const reportsUrl = `/api/system/rep-support/reports?status=${encodeURIComponent(status)}`;
  const { data: reportData, loading: reportsLoading, error: reportsError, reload: reloadReports } = useApi(reportsUrl, { enabled: view === 'reports' });
  const { data: locationData, loading: locationsLoading, error: locationsError, reload: reloadLocations } = useApi(`/api/system/rep-location-changes?status=${encodeURIComponent(locationStatus)}`, { enabled: view === 'locations' });
  const { data: releaseData, loading: releasesLoading, error: releasesError, reload: reloadReleases } = useApi('/api/system/rep-releases', { enabled: view === 'releases' });
  const { data: devicesData, loading: devicesLoading, error: devicesError, reload: reloadDevices } = useApi('/api/system/rep-support/devices', { enabled: view === 'devices' });
  const reports = useMemo(() => reportData?.reports ?? [], [reportData]);
  const requests = useMemo(() => locationData?.requests ?? [], [locationData]);
  const releases = useMemo(() => releaseData?.releases ?? [], [releaseData]);
  const devices = useMemo(() => devicesData?.devices ?? [], [devicesData]);
  const latestRelease = useMemo(() => devicesData?.latestRelease ?? null, [devicesData]);

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      if (deviceSearch) {
        const query = deviceSearch.toLowerCase();
        const matchName = (d.representativeName || '').toLowerCase().includes(query);
        const matchUser = (d.representativeUsername || '').toLowerCase().includes(query);
        const matchModel = `${d.deviceManufacturer || ''} ${d.deviceModel || ''}`.toLowerCase().includes(query);
        if (!matchName && !matchUser && !matchModel) return false;
      }
      if (deviceFilter === 'outdated') return d.isOutdatedBuild;
      if (deviceFilter === 'clock') return d.clockMismatchDetected;
      if (deviceFilter === 'permission') return d.isMissingPermission;
      if (deviceFilter === 'error') return Boolean(d.lastLocationError);
      return true;
    });
  }, [devices, deviceSearch, deviceFilter]);

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
    if (decision === 'approved' && request.hasLocationChanged) {
      const confirmPermanent = window.confirm(
        '⚠️ تحذير: موقع الماكينة المسجل في النظام تغيّر بعد إنشاء هذا الطلب!\n\n' +
        `الموقع وقت تقديم الطلب: ${request.oldLocation ? `${request.oldLocation.latitude}, ${request.oldLocation.longitude}` : 'غير محدد'}\n` +
        `الموقع المسجل حالياً: ${request.currentMachineLocation ? `${request.currentMachineLocation.latitude}, ${request.currentMachineLocation.longitude}` : 'غير محدد'}\n\n` +
        'هل أنت متأكد من اعتماد هذا الموقع كموقع أساسي جديد واستبدال إحداثيات الماكينة الحالية؟'
      );
      if (!confirmPermanent) return;
    }
    const promptMessage = decision === 'approved'
      ? 'ملاحظة اعتماد الموقع كموقع أساسي جديد (اختياري)'
      : (decision === 'exception_only'
        ? 'ملاحظة تسجيل استثناء لهذه الزيارة فقط دون تغيير موقع الماكينة (اختياري)'
        : 'سبب رفض تغيير الموقع (اختياري)');
    const note = window.prompt(promptMessage);
    if (note === null) return;
    const key = `location-${request.id}`;
    setBusy(key); setError('');
    try {
      await api.post(`/api/system/rep-location-changes/${request.id}/${decision}`, { note });
      await reloadLocations();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
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
        {isAdmin && <Button variant={view === 'diagnostics' ? 'primary' : 'secondary'} onClick={() => setView('diagnostics')}>التشخيص التلقائي</Button>}
        <Button variant={view === 'devices' ? 'primary' : 'secondary'} onClick={() => setView('devices')}>الأجهزة وإصدارات التطبيق</Button>
        <Button variant={view === 'locations' ? 'primary' : 'secondary'} onClick={() => setView('locations')}>تغييرات مواقع الماكينات</Button>
        <Button variant={view === 'releases' ? 'primary' : 'secondary'} onClick={() => setView('releases')}>سجل إصدارات APK</Button>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}

      {isAdmin && view === 'diagnostics' && <RepAutomaticDiagnostics />}

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
        <div className="madar-panel-header">
          <div>
            <h2>تغييرات مواقع الماكينات</h2>
            <p>مراجعة التغييرات والاستثناءات الجغرافية المقدمة من المندوبين أثناء الزيارات الميدانية.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>تصفية الحالة:
              <select value={locationStatus} onChange={(event) => setLocationStatus(event.target.value)} style={{ marginRight: 6 }}>
                <option value="pending">قيد المراجعة (معلق)</option>
                <option value="approved">معتمد كموقع أساسي</option>
                <option value="exception_only">استثناء للزيارة فقط</option>
                <option value="rejected">مرفوض</option>
                <option value="all">الكل</option>
              </select>
            </label>
            <Button variant="secondary" onClick={reloadLocations}>تحديث</Button>
          </div>
        </div>
        {locationsError && <div className="madar-panel-body"><Alert tone="error">{locationsError}</Alert></div>}
        {locationsLoading ? <LoadingState label="جارٍ تحميل تغييرات المواقع" /> : requests.length ? <div className="madar-table-wrap"><table className="madar-table">
          <thead>
            <tr>
              <th>الآلة / أمر الصيانة</th>
              <th>المندوب ووقت الالتقاط</th>
              <th>الموقع المسجل للماكينة</th>
              <th>الموقع الفعلي / المقترح</th>
              <th>السبب / الملاحظات</th>
              <th>الصور والخريطة</th>
              <th>قرار الإدارة</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>
                  <strong>{request.machineCode} · {request.machineName}</strong>
                  <br /><small>{request.orderCode}</small>
                  {request.visitUuid && <div><small className="madar-muted">مرتبط بزيارة: {request.visitUuid.slice(0, 8)}…</small></div>}
                </td>
                <td>
                  <div>{request.representativeName}</div>
                  <small className="madar-muted">{new Date(request.capturedAt).toLocaleString('ar')}</small>
                </td>
                <td>
                  {request.oldLocation ? `${request.oldLocation.latitude.toFixed(6)}, ${request.oldLocation.longitude.toFixed(6)}` : '—'}
                  {request.hasLocationChanged && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ background: '#ffebee', color: '#c62828', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>
                        ⚠️ تغيّر الموقع المسجل بعد الطلب!
                      </span>
                      {request.currentMachineLocation && (
                        <div style={{ fontSize: 11, color: '#c62828' }}>
                          الحالي: {request.currentMachineLocation.latitude.toFixed(6)}, {request.currentMachineLocation.longitude.toFixed(6)}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <strong>{request.proposedLocation.latitude.toFixed(6)}, {request.proposedLocation.longitude.toFixed(6)}</strong>
                  <br /><small>دقة GPS: ±{Math.round(request.proposedLocation.accuracy)} م · بُعد: {Math.round(request.distanceMeters)} م</small>
                </td>
                <td>
                  {request.note ? <span>{request.note}</span> : <span className="madar-muted">—</span>}
                </td>
                <td>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <Button size="small" variant="secondary" onClick={() => setMapModalRequest(request)}>
                      🗺️ عرض على الخريطة
                    </Button>
                    {request.hasEvidence && (
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => setViewingSupportPhoto({
                          title: `دليل تغيير موقع: ${request.machineCode}`,
                          subtitle: `${request.machineName} · ${request.representativeName}`,
                          machineCode: request.machineCode,
                          phaseLabel: 'دليل الموقع',
                          photos: [{
                            id: `loc-ev-${request.id}`,
                            url: `/api/system/rep-location-changes/${request.id}/evidence`,
                            filename: `MADAR_${request.machineCode}_location_evidence.jpg`,
                            caption: `إحداثيات مقترحة: ${request.proposedLocation.latitude}, ${request.proposedLocation.longitude}`
                          }]
                        })}
                      >
                        📷 صورة الدليل
                      </Button>
                    )}
                    {request.visitPhotos && request.visitPhotos.length > 0 && (
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => setViewingSupportPhoto({
                          title: `صور الزيارة: ${request.machineCode}`,
                          subtitle: `${request.machineName} · ${request.representativeName}`,
                          machineCode: request.machineCode,
                          photos: request.visitPhotos.map((vp, idx) => ({
                            id: vp.id || `vp-${idx}`,
                            url: vp.url,
                            filename: `MADAR_${request.machineCode}_visit_${idx + 1}.jpg`,
                            caption: `${vp.phase || ''} (${new Date(vp.capturedAt).toLocaleString('ar')})`
                          }))
                        })}
                      >
                        📸 صور الزيارة ({request.visitPhotos.length})
                      </Button>
                    )}
                  </div>
                </td>
                <td>
                  {request.status === 'pending' ? (
                    <div style={{ display: 'grid', gap: 6, minWidth: 160 }}>
                      <Button
                        size="small"
                        variant="primary"
                        disabled={busy === `location-${request.id}`}
                        onClick={() => reviewLocation(request, 'approved')}
                      >
                        اعتماد كموقع أساسي جديد
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy === `location-${request.id}`}
                        onClick={() => reviewLocation(request, 'exception_only')}
                      >
                        تسجيل كاستثناء للزيارة فقط
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        disabled={busy === `location-${request.id}`}
                        onClick={() => reviewLocation(request, 'rejected')}
                      >
                        رفض تغيير الموقع
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <Badge tone={request.status === 'approved' ? 'success' : (request.status === 'exception_only' ? 'info' : 'error')}>
                        {LOCATION_STATUS_LABELS[request.status] ?? request.status}
                      </Badge>
                      {request.reviewerName && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                          بواسطة: {request.reviewerName}
                        </div>
                      )}
                      {request.reviewNote && (
                        <div style={{ fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>
                          «{request.reviewNote}»
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div> : <EmptyState title="لا توجد طلبات في هذه الحالة" description="تغييرات واستثناءات مواقع الماكينات ستظهر هنا للمراجعة." />}
      </section>}

      {view === 'devices' && <section className="madar-panel madar-section">
        <div className="madar-panel-header">
          <div>
            <h2>أجهزة المندوبين وإصدارات التطبيق</h2>
            <p>مراقبة الأجهزة المستخدمة لكل حساب، التحقق من حداثة البناء ومزامنة التوقيت وصلاحيات GPS.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>البحث <input type="text" placeholder="اسم المندوب أو طراز الهاتف…" value={deviceSearch} onChange={(e) => setDeviceSearch(e.target.value)} /></label>
            <label>تصفية الحالة <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
              <option value="all">كل الأجهزة</option>
              <option value="outdated">إصدار قديم بحاجة لتحديث</option>
              <option value="clock">فارق في التوقيت (&gt; 1 دقيقة)</option>
              <option value="permission">صلاحية الموقع الدقيق مفقودة</option>
              <option value="error">يوجد خطأ موقع مسجل</option>
            </select></label>
            <Button variant="secondary" onClick={reloadDevices}>تحديث</Button>
          </div>
        </div>

        {latestRelease && (
          <div className="madar-panel-body" style={{ paddingBottom: 0 }}>
            <Alert tone="info">
              الإصدار الأحدث المعتمد على الخادم: <strong>{latestRelease.version_name} (بناء {latestRelease.version_code})</strong>. يتم تنبيه المندوبين أصحاب الإصدارات القديمة عند المزامنة.
            </Alert>
          </div>
        )}

        {devicesError && <div className="madar-panel-body"><Alert tone="error">{devicesError}</Alert></div>}
        {devicesLoading ? <LoadingState label="جارٍ تحميل سجل الأجهزة" /> : filteredDevices.length ? (
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead>
                <tr>
                  <th>المندوب</th>
                  <th>الجهاز والنظام</th>
                  <th>إصدار MADAR</th>
                  <th>إذن وخدمة الموقع</th>
                  <th>فارق التوقيت</th>
                  <th>نتيجة آخر فحص</th>
                  <th>آخر ظهور</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map((dev) => (
                  <tr key={dev.id}>
                    <td>
                      <strong>{dev.representativeName}</strong>
                      <div><small style={{ color: '#666' }}>@{dev.representativeUsername}</small></div>
                      {dev.isLatestForRep && <Badge tone="success">أحدث جهاز نشط</Badge>}
                    </td>
                    <td>
                      <strong>{dev.deviceManufacturer} {dev.deviceModel}</strong>
                      <div><small>Android {dev.osVersion} (API {dev.apiLevel})</small></div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{dev.appVersionName} <small>({dev.appVersionCode})</small></span>
                        {dev.isOutdatedBuild ? (
                          <Badge tone="error">قديم</Badge>
                        ) : (
                          <Badge tone="success">الأحدث</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <div>
                        {dev.hasFinePermission ? (
                          <Badge tone="success">موقع دقيق ✓</Badge>
                        ) : (
                          <Badge tone="error">تقريبي فقط ✗</Badge>
                        )}
                        {' '}
                        {dev.isGpsEnabled ? (
                          <Badge tone="neutral">GPS مفعل</Badge>
                        ) : (
                          <Badge tone="error">GPS معطل</Badge>
                        )}
                      </div>
                      <small style={{ color: '#888' }}>مزود: {dev.locationProvider || 'غير محدد'}</small>
                    </td>
                    <td>
                      {dev.clockMismatchDetected ? (
                        <div>
                          <Badge tone="error">فارق توقيت كبير</Badge>
                          <div><small style={{ color: '#d32f2f' }}>{Math.round(dev.clockOffsetMs / 1000)} ثانية</small></div>
                        </div>
                      ) : (
                        <div style={{ color: '#2e7d32' }}><small>متطابق ({Math.round(dev.clockOffsetMs / 1000)} ث)</small></div>
                      )}
                    </td>
                    <td>
                      {dev.lastLocationError ? (
                        <span style={{ color: '#c62828', fontSize: '12px' }}>{dev.lastLocationError}</span>
                      ) : (
                        <span style={{ color: '#2e7d32', fontSize: '12px' }}>سليم ✓</span>
                      )}
                    </td>
                    <td>
                      <small>{new Date(dev.lastSeenAt).toLocaleString('ar')}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="لا توجد أجهزة مسجلة" description="ستظهر هنا الأجهزة بمجرد فتح تطبيق المندوبين المحدث وإرسال التقرير التشخيصي." />
        )}
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

      {mapModalRequest && (
        <LocationDiffMapModal
          isOpen={Boolean(mapModalRequest)}
          onClose={() => setMapModalRequest(null)}
          request={mapModalRequest}
        />
      )}
    </div>
  );
}
