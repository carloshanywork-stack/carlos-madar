import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { regionAccessLabel } from '../../lib/regions.js';
import './supervisor-radar.css';
import LocationReviews from './LocationReviews.jsx';
import SupervisorRadarMap from './SupervisorRadarMap.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Alert from '../../components/ui/Alert.jsx';
import OperationalImageViewer from '../../components/ui/OperationalImageViewer.jsx';

const STATUS = {
  active: { label: 'على المسار', color: '#168569' },
  onsite: { label: 'في موقع صيانة', color: '#d3931b' },
  stationary: { label: 'في الوردية · ثابت', color: '#2563eb' },
  offline: { label: 'خارج الوردية / أوفلاين', color: '#88939d' },
};

function formatTime(value) {
  if (!value) return 'لا توجد إشارة مسجلة';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'غير متاح';
  if (seconds < 60) return `${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} س ` : ''}${minutes % 60} د`;
}

function formatSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} كم/س` : 'غير متاحة';
}

function currentLocalDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function SupervisorRadarPage() {
  const [radar, setRadar] = useState(null);
  const [visits, setVisits] = useState([]);
  const [overdueAttendance, setOverdueAttendance] = useState([]);
  const [selectedRep, setSelectedRep] = useState(null);
  const [routeDate, setRouteDate] = useState(currentLocalDate);
  const manuallySelectedRouteDate = useRef(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeRevision, setRouteRevision] = useState(0);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState('map');
  const [busyVisit, setBusyVisit] = useState(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [radarData, queueData, attendanceData] = await Promise.all([
        api.get('/api/supervisor/radar'),
        api.get('/api/supervisor/qa/queue'),
        api.get('/api/attendance/today').catch(() => null),
      ]);
      setRadar(radarData);
      const nextVisits = queueData.visits ?? [];
      const nextIds = new Set(nextVisits.map((visit) => Number(visit.id)));
      setSelectedBulkIds((current) => new Set([...current].filter((id) => nextIds.has(id))));
      setVisits(nextVisits);
      setOverdueAttendance(attendanceData?.overdue ?? []);
      setRouteRevision((revision) => revision + 1);
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل بيانات الرادار والمراجعة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The authenticated app shell owns one SSE connection; this refresh reconciles reconnect gaps.
    const timer = window.setInterval(refresh, 60_000);
    const onOperationsEvent = (message) => {
      const event = message.detail;
      if (['system.reconcile-required', 'rep.machine.location-requested', 'rep.machine.location-reviewed', 'rep.machine.correction-submitted', 'rep.tracking.updated', 'rep.visit.submitted', 'rep.visit.reviewed', 'attendance.changed', 'overtime.pending'].includes(event?.type)) {
        void refresh();
      }
    };
    window.addEventListener('madar:operations-event', onOperationsEvent);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('madar:operations-event', onOperationsEvent);
    };
  }, [refresh]);

  const representatives = radar?.representatives ?? [];
  const focusedRep = representatives.find((rep) => rep.id === selectedRep) ?? null;

  useEffect(() => {
    if (radar?.businessDate && !manuallySelectedRouteDate.current) setRouteDate(radar.businessDate);
  }, [radar?.businessDate]);

  useEffect(() => {
    if (!selectedRep) {
      setSelectedRoute(null);
      return undefined;
    }
    let active = true;
    setRouteLoading(true);
    api.get(`/api/supervisor/reps/${selectedRep}/route?date=${encodeURIComponent(routeDate)}`)
      .then((result) => { if (active) setSelectedRoute(result); })
      .catch((requestError) => { if (active) setError(requestError.message || 'تعذر تحميل خط سير المندوب.'); })
      .finally(() => { if (active) setRouteLoading(false); });
    return () => { active = false; };
  }, [routeDate, routeRevision, selectedRep]);

  const review = async (visit, action) => {
    const reviewNote = reviewNotes[visit.id] ?? '';
    setBusyVisit(visit.id);
    setError('');
    try {
      const reviewPath = visit.source === 'office' ? `/api/supervisor/card-photos/${visit.cardId}/review` : `/api/supervisor/visits/${visit.id}/review`;
      const result = await api.post(reviewPath, {
        action,
        ...(visit.source === 'office' ? { revision: visit.revision } : {}),
        note: action === 'reshoot' ? reviewNote.trim() : reviewNote.trim() || undefined,
      });
      setVisits((current) => current.filter((item) => item.id !== visit.id));
      setSelectedBulkIds((current) => { const next = new Set(current); next.delete(Number(visit.id)); return next; });
      setReviewNotes((current) => { const next = { ...current }; delete next[visit.id]; return next; });
      setSelectedVisit(null);
      setNotice(result.status === 'approved' ? `اعتُمدت زيارة الماكينة ${visit.machineCode}.` : `أُرسل طلب إعادة التصوير للمندوب ${visit.repName}.`);
      window.setTimeout(() => setNotice(''), 4500);
      void refresh();
    } catch (requestError) {
      setError(requestError.message || 'تعذر حفظ قرار المراجعة.');
    } finally {
      setBusyVisit(null);
    }
  };

  const approveDisplayedVisits = async () => {
    const visibleIds = visits.map((visit) => Number(visit.id));
    const visitIds = visibleIds.filter((id) => selectedBulkIds.has(id));
    if (!visitIds.length) {
      setError('حدد زيارة واحدة على الأقل من العناصر الظاهرة في طابور المراجعة.');
      return;
    }
    const confirmed = window.confirm(`اعتماد ${visitIds.length} زيارة محددة من القائمة الظاهرة؟\nسيتم الاعتماد ذرياً؛ إذا تعذر أحد المتطلبات فلن يُعتمد أي عنصر. لن تُؤرشف أوامر الصيانة.`);
    if (!confirmed) return;
    setBulkBusy(true);
    setError('');
    try {
      const selected = visits.filter((visit) => visitIds.includes(Number(visit.id)));
      const repVisitIds = selected.filter((visit) => visit.source !== 'office').map((visit) => Number(visit.id));
      const cardReviews = selected.filter((visit) => visit.source === 'office').map((visit) => ({ cardId: visit.cardId, revision: visit.revision }));
      const result = await api.post('/api/supervisor/visits/approve-all', { visitIds: repVisitIds, cardReviews });
      if (!result?.success || !Array.isArray(result.visitIds)
          || result.visitIds.some((id) => !repVisitIds.includes(Number(id)))
          || (result.cardIds ?? []).some((id) => !cardReviews.some((item) => item.cardId === Number(id)))) {
        throw new Error('استجابة الاعتماد لا تطابق الزيارات التي اخترتها. حدّث القائمة للتحقق من الحالة.');
      }
      const approvedCount = Number(result.approvedCount) || 0;
      const alreadyApprovedCount = Number(result.alreadyApprovedCount) || 0;
      setNotice(`اكتمل اعتماد ${approvedCount} زيارة جديدة${alreadyApprovedCount ? `؛ ${alreadyApprovedCount} كانت معتمدة سابقاً` : ''}. لم تُؤرشف أوامر الصيانة.`);
      setSelectedVisit(null);
      setSelectedBulkIds((current) => new Set([...current].filter((id) => !visitIds.includes(id))));
      await refresh();
    } catch (requestError) {
      const prerequisiteMessage = requestError.status === 409
        ? `لم يُعتمد أي عنصر؛ راجع متطلبات الزيارات المحددة (مثل وجود طلب إعادة تصوير أو أكثر من زيارة للبطاقة نفسها). ${requestError.message || ''}`
        : requestError.message || 'تعذر اعتماد الزيارات المحددة؛ لم يتم اعتماد أي زيارة بحسب الاستجابة.';
      setError(prerequisiteMessage);
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const mapStatus = focusedRep ? STATUS[focusedRep.status] ?? STATUS.offline : null;
  const visibleRoute = selectedRoute?.representative?.id === selectedRep && selectedRoute?.date === routeDate
    ? selectedRoute : null;

  return (
    <div className="supervisor-page" dir="rtl">
      <PageHeader
        kicker="FIELD OPERATIONS · SUPERVISOR"
        title="رادار الإشراف الميداني"
        description="متابعة إشارات الوردية ومراجعة صور الزيارات قبل اعتمادها للتقارير."
        actions={
          <div className="supervisor-head-actions">
            <a className="supervisor-export" href="/api/supervisor/reports/approved-visits.xlsx">تنزيل Excel المعتمد ↓</a>
            <Button variant="secondary" onClick={() => { setLoading(true); void refresh(); }}>تحديث الرادار ↻</Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {overdueAttendance.length > 0 && (
        <Alert tone="warning">
          <strong>تنبيه انصراف متأخر: </strong>
          <span>{overdueAttendance.map((record) => `${record.name} · تجاوز موعد الانصراف بـ ${record.overdue_hours} ساعة`).join('　 |　 ')}</span>
        </Alert>
      )}

      <section className="supervisor-kpis" aria-label="ملخص الوردية">
        <article><span>المناديب المسجلون</span><strong>{representatives.length}</strong><small>إجمالي حسابات المناديب</small></article>
        <article><span>في الوردية اليوم</span><strong>{representatives.filter((rep) => rep.onDuty).length}</strong><small>تم تسجيل الحضور ومتابعة اليوم</small></article>
        <article><span>على المسار الآن</span><strong>{representatives.filter((rep) => rep.status === 'active').length}</strong><small>إشارة حديثة وحركة مستمرة</small></article>
        <article><span>في موقع صيانة / ثابت</span><strong>{representatives.filter((rep) => rep.status === 'onsite' || rep.status === 'stationary').length}</strong><small>في موقع عميل أو انتظار إشارة</small></article>
        <article className="qa-kpi"><span>طابور مراجعة الصور</span><strong>{visits.length}</strong><small>لا تدخل التقارير قبل الاعتماد</small></article>
      </section>

      <LocationReviews />

      <div className="supervisor-mobile-tabs" role="tablist" aria-label="أقسام الرادار للهواتف">
        <button
          type="button"
          className={`supervisor-mobile-tab ${mobileTab === 'map' ? 'active' : ''}`}
          onClick={() => setMobileTab('map')}
        >
          🗺️ الخريطة والمسار
        </button>
        <button
          type="button"
          className={`supervisor-mobile-tab ${mobileTab === 'qa' ? 'active' : ''}`}
          onClick={() => setMobileTab('qa')}
        >
          📋 مراجعة الصور ({visits.length})
        </button>
      </div>

      <div className={`supervisor-main-grid show-mobile-${mobileTab}`}>
        <section className="supervisor-panel radar-panel">
          <div className="supervisor-panel-head">
            <div><span className="supervisor-eyebrow">GPS · LAST SIGNAL</span><h2>الخريطة ومسارات اليوم</h2></div>
            <span className="live-pill"><i /> تحديث فوري · تحقق احتياطي كل دقيقة</span>
          </div>
          <div className="radar-route-controls">
            <label>المندوب<select value={selectedRep ?? ''} onChange={(event) => setSelectedRep(event.target.value ? Number(event.target.value) : null)}>
              <option value="">كل المندوبين · نظرة عامة</option>
              {representatives.map((rep) => <option key={rep.id} value={rep.id}>{rep.fullName}</option>)}
            </select></label>
            <label>التاريخ<input type="date" value={routeDate} onChange={(event) => { manuallySelectedRouteDate.current = true; setRouteDate(event.target.value); }} /></label>
            <button
              type="button"
              className={`radar-heatmap-btn ${showHeatmap ? 'is-active' : ''}`}
              onClick={() => {
                const next = !showHeatmap;
                setShowHeatmap(next);
                if (next && selectedRep === null && representatives.length > 0) {
                  setSelectedRep(representatives[0].id);
                }
              }}
              title="تبديل عرض خريطة الكثافة والتوقفات الحرارية"
            >
              🔥 {showHeatmap ? 'إخفاء الخريطة الحرارية' : 'خريطة الكثافة والوقفات (Heat Map)'}
            </button>
            {selectedRep !== null && <button type="button" className="radar-overview-button" onClick={() => setSelectedRep(null)}>العودة إلى كل المندوبين</button>}
            <span>{selectedRep === null ? `${representatives.length} مندوب · الحالة وآخر إشارة على الخريطة` : routeLoading ? 'جارٍ تحميل كامل نقاط المسار…' : `${visibleRoute?.polyline?.length ?? 0} نقطة مسجلة · ${visibleRoute?.stops?.length ?? 0} توقف · ${visibleRoute?.visitedMachines?.length ?? 0} زيارة`}</span>
          </div>
          <SupervisorRadarMap representatives={representatives} selectedId={selectedRep} onSelect={setSelectedRep} selectedRoute={visibleRoute} showHeatmap={showHeatmap} />
          {visibleRoute && showHeatmap && (
            <div className="radar-heatmap-analytics">
              <div className="heatmap-metric-card">
                <span className="metric-icon">⏱️</span>
                <div>
                  <strong>{Math.floor((visibleRoute.stops?.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0) || 0) / 60)} س {(visibleRoute.stops?.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0) || 0) % 60} د</strong>
                  <small>إجمالي فترات التوقف والانتظار</small>
                </div>
              </div>
              <div className="heatmap-metric-card">
                <span className="metric-icon">📍</span>
                <div>
                  <strong>{visibleRoute.stops?.length ?? 0} نقطة</strong>
                  <small>إجمالي الوقفات المسجلة</small>
                </div>
              </div>
              <div className="heatmap-metric-card">
                <span className="metric-icon">🛑</span>
                <div>
                  <strong>{visibleRoute.stops?.length ? Math.max(...visibleRoute.stops.map((s) => Number(s.durationMinutes) || 0)) : 0} دقيقة</strong>
                  <small>أطول فترة توقف متصلة</small>
                </div>
              </div>
            </div>
          )}
          {visibleRoute && <div className="radar-speed-summary" aria-label="سرعة المندوب في اليوم المختار">
            <span>متوسط السرعة أثناء الحركة · {visibleRoute.date}: <strong>{formatSpeed(visibleRoute.speedSummary?.averageKmh)}</strong></span>
            <span>أعلى قراءة: <strong>{formatSpeed(visibleRoute.speedSummary?.maxKmh)}</strong></span>
            <small>من {visibleRoute.speedSummary?.sampleCount ?? 0} قراءة GPS صالحة أثناء الحركة</small>
          </div>}
          {visibleRoute && <div className="radar-stops-list" aria-label="توقفات المندوب المحدد">
            <strong>التوقفات والوقفات · {visibleRoute.date}</strong>
            {visibleRoute.stops.length ? visibleRoute.stops.map((stop, index) => <span key={`${stop.arrivedAt}-${index}`} className={showHeatmap ? 'heatmap-active-stop' : ''}>
              <b>{stop.name || `توقف ${index + 1}`}</b>
              <small>وصول {formatTime(stop.arrivedAt)} · مغادرة {formatTime(stop.departedAt)} · {stop.durationMinutes} دقيقة</small>
            </span>) : <small>لم تُسجّل توقفات متصلة لأكثر من 3 دقائق في هذا اليوم.</small>}
          </div>}
          {visibleRoute && <div className="radar-visited-list" aria-label="الماكينات التي زارها المندوب">
            <strong>الماكينات التي زارها · {visibleRoute.visitedMachines?.length ?? 0}</strong>
            {visibleRoute.visitedMachines?.length ? visibleRoute.visitedMachines.map((visit, index) => <span key={visit.visitUuid ?? index}>
              <b dir="ltr">{visit.machineCode}</b>
              <small>{visit.machineName || 'ماكينة'} · {visit.regionName} · {formatTime(visit.capturedAt)} · {visit.reviewStatus === 'approved' ? 'معتمدة' : visit.reviewStatus === 'reshoot_requested' ? 'إعادة تصوير' : 'بانتظار المراجعة'}</small>
            </span>) : <small>لا توجد زيارات مسجلة لهذا المندوب في اليوم المحدد.</small>}
          </div>}
          <div className="radar-below">
            <div className="radar-rep-list">
              {representatives.map((rep) => {
                const status = STATUS[rep.status] ?? STATUS.offline;
                return <button className={`radar-rep-row ${selectedRep === rep.id ? 'selected' : ''}`} key={rep.id} type="button" onClick={() => setSelectedRep(rep.id)}>
                  <i style={{ '--rep-status': status.color }} />
                  <span><strong>{rep.fullName}</strong><small>{status.label} · {regionAccessLabel(rep.assignedRegions)}</small><small className="radar-rep-speed">الآن: {formatSpeed(rep.speedKmh)} · متوسط اليوم: {formatSpeed(rep.averageSpeedKmh)}</small></span>
                  <b>{rep.distanceKm.toFixed(1)} كم</b>
                </button>;
              })}
              {!representatives.length && <p className="supervisor-empty-small">لا توجد حسابات مندوبين حتى الآن.</p>}
            </div>
            {focusedRep && <aside className="radar-rep-details">
              <div className="rep-details-title"><span className="rep-avatar">{focusedRep.fullName.slice(0, 1)}</span><div><strong>{focusedRep.fullName}</strong><small style={{ color: mapStatus?.color }}>{mapStatus?.label}</small></div></div>
              <dl>
                <div><dt>الهاتف</dt><dd dir="ltr">{focusedRep.phone || 'غير مسجل'}</dd></div>
                <div><dt>المناطق</dt><dd>{regionAccessLabel(focusedRep.assignedRegions)}</dd></div>
                <div><dt>زيارات معتمدة اليوم</dt><dd>{focusedRep.completedToday}</dd></div>
                <div><dt>بانتظار المراجعة</dt><dd>{focusedRep.pendingReview}</dd></div>
                <div><dt>المسافة التقديرية</dt><dd>{focusedRep.distanceKm.toFixed(1)} كم</dd></div>
                <div><dt>السرعة الآن · آخر إشارة حديثة</dt><dd>{formatSpeed(focusedRep.speedKmh)}</dd></div>
                <div><dt>متوسط السرعة أثناء الحركة اليوم</dt><dd>{formatSpeed(focusedRep.averageSpeedKmh)}</dd></div>
                <div><dt>آخر إشارة GPS</dt><dd>{formatTime(focusedRep.lastSignal)}</dd></div>
                <div><dt>بداية الوردية</dt><dd>{formatTime(focusedRep.dutyStartedAt)}</dd></div>
              </dl>
              <p className="estimate-note">السرعة الحالية من آخر إشارة GPS خلال دقيقتين ووردية مفتوحة. المتوسط لقراءات الحركة الصالحة فقط، ولا يشمل التوقفات. الأرقام تقديرية وقد تتأثر بالتغطية أو التلاعب بالجهاز ولا تصلح وحدها لإثبات بدل انتقال.</p>
            </aside>}
          </div>
          {loading && <div className="supervisor-loading">جارٍ تحديث بيانات المندوبين…</div>}
        </section>

        <section className="supervisor-panel qa-panel">
          <div className="supervisor-panel-head">
            <div><span className="supervisor-eyebrow">QUALITY ASSURANCE · BEFORE REPORTS</span><h2>طابور اعتماد الزيارات</h2></div>
            <span className="queue-count">{visits.length}</span>
          </div>
          {!visits.length ? <div className="supervisor-qa-empty"><span>✓</span><strong>لا توجد زيارات تنتظر المراجعة</strong><small>ستظهر هنا الزيارات بعد مزامنتها من تطبيق المندوب.</small></div> : (
            <>
            <div className="qa-bulk-toolbar">
              <label><input type="checkbox" checked={visits.length > 0 && visits.every((visit) => selectedBulkIds.has(Number(visit.id)))} onChange={(event) => setSelectedBulkIds(event.target.checked ? new Set(visits.map((visit) => Number(visit.id))) : new Set())} /> تحديد كل الزيارات الظاهرة ({visits.length})</label>
              <button type="button" className="qa-approve-all" disabled={bulkBusy || !visits.some((visit) => selectedBulkIds.has(Number(visit.id)))} onClick={() => void approveDisplayedVisits()}>
                {bulkBusy ? 'جارٍ اعتماد المحدد…' : `اعتماد كل الزيارات المحددة (${visits.filter((visit) => selectedBulkIds.has(Number(visit.id))).length})`}
              </button>
              <small>يرسل المعرفات المحددة الظاهرة فقط. الاعتماد ذري ولا يؤرشف أوامر الصيانة.</small>
            </div>
            <div className="qa-visit-list">
              {visits.map((visit) => {
                const beforePhotos = visit.beforePhotos ?? (visit.beforePhotoUrl ? [{ url: visit.beforePhotoUrl }] : []);
                const afterPhotos = visit.afterPhotos ?? (visit.afterPhotoUrl ? [{ url: visit.afterPhotoUrl }] : []);
                return <article className="qa-visit-card" key={visit.id}>
                <div className="qa-visit-heading">
                  <div><span className="qa-machine-code" dir="ltr">{visit.machineCode}</span><h3>{visit.machineName}</h3><p>{visit.regionName} · {visit.orderCode}</p></div>
                  <div className="qa-visit-selection"><label><input type="checkbox" checked={selectedBulkIds.has(Number(visit.id))} onChange={(event) => setSelectedBulkIds((current) => { const next = new Set(current); if (event.target.checked) next.add(Number(visit.id)); else next.delete(Number(visit.id)); return next; })} /> ضمن الاعتماد الجماعي</label><Badge tone="warning">بانتظار الاعتماد</Badge></div>
                </div>
                <div className="qa-photo-pair">
                  {beforePhotos.map((photo, index) => <button key={`before-${index}`} type="button" onClick={() => setSelectedVisit({ ...visit, zoomPhoto: 'before', zoomPhotoIndex: index })} aria-label={`تكبير صورة قبل الصيانة ${index + 1}`}><img src={photo.thumbnailUrl || photo.url} loading="lazy" decoding="async" alt={`قبل الصيانة ${visit.machineCode} ${index + 1}`} /><span>قبل الصيانة · {index + 1} ↗</span></button>)}
                  {afterPhotos.length
                    ? afterPhotos.map((photo, index) => <button key={`after-${index}`} type="button" onClick={() => setSelectedVisit({ ...visit, zoomPhoto: 'after', zoomPhotoIndex: index })} aria-label={`تكبير صورة بعد الصيانة ${index + 1}`}><img src={photo.thumbnailUrl || photo.url} loading="lazy" decoding="async" alt={`بعد الصيانة ${visit.machineCode} ${index + 1}`} /><span>بعد الصيانة · {index + 1} ↗</span></button>)
                    : <div className="qa-photo-missing" role="note"><strong>لا توجد صور بعد الصيانة</strong><small>توثيق هذه المرحلة اختياري للمندوب.</small></div>}
                </div>
                <div className="qa-visit-meta">
                  <span>{visit.source === 'office' ? 'رفع من السيستم بواسطة' : 'المندوب'} <b>{visit.repName}</b></span>
                  <span>حالة الماكينة <b>{visit.machineCondition === 'faulty' ? 'عطلانة' : visit.machineCondition === 'preventive_maintenance' ? 'صيانة وقائية' : 'تعمل'}</b></span>
                  <span>المدة بين الصورتين <b>{formatDuration(visit.siteDurationSeconds)}</b></span>
                  <span>الرفع <b>{formatTime(visit.capturedAt)}</b></span>
                </div>
                <div className="qa-reasons"><strong>أسباب الصيانة</strong><span>{visit.reasonNames.length ? visit.reasonNames.join('، ') : 'لم يُحدد سبب'}</span></div>
                {visit.maintenanceLines?.length > 0 && (
                  <div className="qa-reasons qa-quantities" style={{ marginTop: '4px' }}>
                    <strong>القطع المستبدلة والكميات</strong>
                    <span style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}>
                      {visit.maintenanceLines.map((line) => (
                        <span
                          key={line.reasonId}
                          style={{
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {line.label} (العدد: {line.quantity} {line.unit === 'piece' ? 'قطعة' : line.unit === 'set' ? 'طقم' : (line.unit || 'قطعة')})
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {visit.notes && <p className="qa-rep-note"><strong>ملاحظة المندوب:</strong> {visit.notes}</p>}
                <label className="qa-review-note"><span>ملاحظة المراجعة <small>مطلوبة عند طلب إعادة التصوير</small></span><textarea value={reviewNotes[visit.id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [visit.id]: event.target.value }))} placeholder="مثال: أعد تصوير اللوحة من زاوية أوضح مع إضاءة كافية" maxLength={1000} rows={2} /></label>
                <div className="qa-actions">
                  <Button variant="primary" className="qa-approve" disabled={busyVisit === visit.id} onClick={() => void review(visit, 'approve')}>اعتماد الزيارة ✓</Button>
                  <Button variant="secondary" className="qa-reshoot" disabled={busyVisit === visit.id || !(reviewNotes[visit.id] ?? '').trim()} onClick={() => void review(visit, 'reshoot')}>طلب إعادة تصوير ↻</Button>
                </div>
                </article>;
              })}
            </div>
            </>
          )}
        </section>
      </div>

      {selectedVisit?.zoomPhoto && (() => {
        const beforePhotos = selectedVisit.beforePhotos ?? (selectedVisit.beforePhotoUrl ? [{ url: selectedVisit.beforePhotoUrl, capturedAt: selectedVisit.beforeCapturedAt }] : []);
        const afterPhotos = selectedVisit.afterPhotos ?? (selectedVisit.afterPhotoUrl ? [{ url: selectedVisit.afterPhotoUrl, capturedAt: selectedVisit.afterCapturedAt }] : []);
        const allPhotos = [
          ...beforePhotos.map((p, i) => ({ ...p, phase: 'قبل الصيانة', phaseLabel: 'قبل الصيانة', title: `قبل الصيانة (${i + 1} من ${beforePhotos.length})` })),
          ...afterPhotos.map((p, i) => ({ ...p, phase: 'بعد الصيانة', phaseLabel: 'بعد الصيانة', title: `بعد الصيانة (${i + 1} من ${afterPhotos.length})` })),
        ];
        const startIndex = selectedVisit.zoomPhoto === 'before'
          ? (selectedVisit.zoomPhotoIndex ?? 0)
          : beforePhotos.length + (selectedVisit.zoomPhotoIndex ?? 0);
        const activeIndex = selectedVisit.activePhotoIndex ?? startIndex;
        const activePhoto = allPhotos[activeIndex] || allPhotos[0];

        return (
          <OperationalImageViewer
            isOpen={Boolean(selectedVisit?.zoomPhoto)}
            onClose={() => setSelectedVisit(null)}
            photos={allPhotos}
            currentIndex={activeIndex}
            onIndexChange={(newIdx) => setSelectedVisit((prev) => ({ ...prev, activePhotoIndex: newIdx }))}
            machineCode={selectedVisit.machineCode}
            title={`ماكينة ${selectedVisit.machineCode} · ${selectedVisit.machineName}`}
            subtitle={`${formatTime(activePhoto?.capturedAt || selectedVisit.capturedAt)} · المندوب: ${selectedVisit.repName}`}
            phaseLabel={activePhoto?.phaseLabel}
          />
        );
      })()}
    </div>
  );
}
