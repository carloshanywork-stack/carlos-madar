import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { regionAccessLabel } from '../../lib/regions.js';
import './supervisor-radar.css';
import LocationReviews from './LocationReviews.jsx';

const STATUS = {
  active: { label: 'على المسار', color: '#168569' },
  onsite: { label: 'في موقع صيانة', color: '#d3931b' },
  offline: { label: 'أوفلاين / خارج التغطية', color: '#88939d' },
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

function projectToWorld(location, zoom) {
  const latitude = Math.max(-85.051129, Math.min(85.051129, Number(location.latitude)));
  const longitude = Number(location.longitude);
  const size = 256 * (2 ** zoom);
  const sine = Math.sin(latitude * Math.PI / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

function TrackMap({ representatives, selectedId, onSelect, selectedRoute }) {
  const routeMatchesSelection = selectedId !== null && selectedRoute?.representative?.id === selectedId;
  const positions = [
    ...(selectedId === null
      ? representatives.flatMap((rep) => rep.trail?.length ? rep.trail : rep.lastLocation ? [rep.lastLocation] : [])
      : routeMatchesSelection
        ? selectedRoute.polyline ?? []
        : representatives.filter((rep) => rep.id === selectedId)
          .flatMap((rep) => rep.trail?.length ? rep.trail : rep.lastLocation ? [rep.lastLocation] : [])),
    ...(routeMatchesSelection ? selectedRoute.stops ?? [] : []),
    ...(routeMatchesSelection ? selectedRoute.visitedMachines ?? [] : []).filter((visit) => Number.isFinite(visit.latitude) && Number.isFinite(visit.longitude)),
  ];
  const [mapStatus, setMapStatus] = useState(null);
  useEffect(() => {
    let active = true;
    api.get('/api/supervisor/map/status', { timeoutMs: 4000 })
      .then((result) => { if (active) setMapStatus(result); })
      .catch(() => { if (active) setMapStatus({ available: false, renderable: false }); });
    return () => { active = false; };
  }, []);

  const geometry = useMemo(() => {
    const focus = positions.length ? positions : [{ latitude: 30.0444, longitude: 31.2357 }];
    const atZero = focus.map((location) => projectToWorld(location, 0));
    const minX0 = Math.min(...atZero.map((item) => item.x));
    const maxX0 = Math.max(...atZero.map((item) => item.x));
    const minY0 = Math.min(...atZero.map((item) => item.y));
    const maxY0 = Math.max(...atZero.map((item) => item.y));
    const spanX0 = Math.max(maxX0 - minX0, 0.45);
    const spanY0 = Math.max(maxY0 - minY0, 0.45);
    const desiredZoom = Math.floor(Math.log2(Math.min(812 / spanX0, 412 / spanY0)));
    const minZoom = mapStatus?.renderable ? mapStatus.minZoom : 0;
    const maxZoom = mapStatus?.renderable ? mapStatus.maxZoom : 18;
    const zoom = Math.max(minZoom, Math.min(maxZoom, desiredZoom));
    const projected = focus.map((location) => projectToWorld(location, zoom));
    const minX = Math.min(...projected.map((item) => item.x));
    const maxX = Math.max(...projected.map((item) => item.x));
    const minY = Math.min(...projected.map((item) => item.y));
    const maxY = Math.max(...projected.map((item) => item.y));
    const spanX = Math.max(maxX - minX, 24);
    const spanY = Math.max(maxY - minY, 24);
    const scale = Math.min(812 / (spanX * 1.3), 412 / (spanY * 1.3));
    return { zoom, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, scale };
  }, [mapStatus, positions]);

  const point = (location) => {
    const projected = projectToWorld(location, geometry.zoom);
    return {
      x: 450 + (projected.x - geometry.centerX) * geometry.scale,
      y: 250 + (projected.y - geometry.centerY) * geometry.scale,
    };
  };
  const tileImages = useMemo(() => {
    if (!mapStatus?.renderable || !geometry.scale) return [];
    const worldTiles = 2 ** geometry.zoom;
    const left = geometry.centerX - 450 / geometry.scale;
    const right = geometry.centerX + 450 / geometry.scale;
    const top = geometry.centerY - 250 / geometry.scale;
    const bottom = geometry.centerY + 250 / geometry.scale;
    const images = [];
    for (let tileY = Math.max(0, Math.floor(top / 256)); tileY <= Math.min(worldTiles - 1, Math.floor(bottom / 256)); tileY += 1) {
      for (let tileX = Math.floor(left / 256); tileX <= Math.floor(right / 256); tileX += 1) {
        const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
        images.push({
          key: `${geometry.zoom}/${tileX}/${tileY}`,
          href: `/api/supervisor/map/tiles/${geometry.zoom}/${wrappedX}/${tileY}`,
          x: 450 + (tileX * 256 - geometry.centerX) * geometry.scale,
          y: 250 + (tileY * 256 - geometry.centerY) * geometry.scale,
          size: 256 * geometry.scale,
        });
      }
    }
    return images;
  }, [geometry, mapStatus]);
  const bounds = useMemo(() => {
    const focus = positions.length ? positions : [{ latitude: 30.0444, longitude: 31.2357 }];
    const lats = focus.map((item) => Number(item.latitude));
    const lons = focus.map((item) => Number(item.longitude));
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
  }, [positions]);

  return (
    <div className="radar-map-wrap">
      <svg className="radar-map" viewBox="0 0 900 500" role="img" aria-label="مسارات GPS للمندوبين على شبكة إحداثيات محلية">
        <defs>
          <pattern id="radar-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#dce5e5" strokeWidth="1" />
          </pattern>
          <pattern id="radar-minor-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#edf1f0" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="900" height="500" fill="#f7faf8" />
        {tileImages.map((tile) => <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.size} height={tile.size} preserveAspectRatio="none" />)}
        {!mapStatus?.renderable && <>
          <rect x="0" y="0" width="900" height="500" fill="url(#radar-minor-grid)" />
          <rect x="0" y="0" width="900" height="500" fill="url(#radar-grid)" />
          <path d="M0 375 C180 330 245 404 415 350 S690 287 900 325" fill="none" stroke="#e2e9e5" strokeWidth="24" />
          <path d="M90 0 C130 145 210 231 190 500 M570 0 C520 151 630 324 590 500 M0 130 C230 165 420 120 900 183" fill="none" stroke="#fff" strokeWidth="10" />
          <path d="M90 0 C130 145 210 231 190 500 M570 0 C520 151 630 324 590 500 M0 130 C230 165 420 120 900 183" fill="none" stroke="#e2e9e5" strokeWidth="1.2" />
        </>}
        <text x="18" y="481" className="radar-map-caption">{mapStatus?.renderable ? `${mapStatus.name} · خريطة محلية بلا اتصال` : 'لا توجد حزمة MBTiles محلية · لا اتصال بمزوّد خرائط خارجي'}</text>
        {!positions.length && <text x="450" y="250" textAnchor="middle" className="radar-map-empty">بانتظار أول إشارة GPS</text>}
        {routeMatchesSelection && selectedRoute.polyline?.length > 1 && <polyline
          points={selectedRoute.polyline.map((location) => {
            const xy = point(location);
            return `${xy.x},${xy.y}`;
          }).join(' ')}
          fill="none" stroke="#1769e0" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="1 0" opacity=".9"
        />}
        {(routeMatchesSelection ? selectedRoute.stops ?? [] : []).map((stop, index) => {
          const xy = point(stop);
          return <g key={`${stop.arrivedAt}-${index}`} className="radar-stop-pin">
            <circle cx={xy.x} cy={xy.y} r="11" fill="#fff" stroke="#ce5a31" strokeWidth="4" />
            <circle cx={xy.x} cy={xy.y} r="3" fill="#ce5a31" />
            <title>{`${stop.name || 'توقف'} · ${stop.durationMinutes} دقيقة`}</title>
            <rect x={xy.x + 11} y={xy.y - 23} width="48" height="17" rx="7" fill="#7d351e" />
            <text x={xy.x + 35} y={xy.y - 11} textAnchor="middle" className="radar-stop-label">{stop.durationMinutes} د</text>
          </g>;
        })}
        {(routeMatchesSelection ? selectedRoute.visitedMachines ?? [] : []).filter((visit) => Number.isFinite(visit.latitude) && Number.isFinite(visit.longitude)).map((visit, index) => {
          const xy = point(visit);
          return <g key={`visit-${visit.visitUuid ?? index}`}>
            <circle cx={xy.x} cy={xy.y} r="10" fill="#fff" stroke="#6944a3" strokeWidth="3" />
            <text x={xy.x} y={xy.y + 3.5} textAnchor="middle" className="radar-stop-label">م</text>
            <title>{`${visit.machineCode} · ${visit.machineName || ''} · ${formatTime(visit.capturedAt)}`}</title>
          </g>;
        })}
        {representatives.filter((rep) => selectedId === null || rep.id === selectedId).map((rep) => {
          const points = routeMatchesSelection && selectedRoute.representative?.id === rep.id
            ? selectedRoute.polyline ?? []
            : rep.trail?.length ? rep.trail : rep.lastLocation ? [rep.lastLocation] : [];
          const status = STATUS[rep.status] ?? STATUS.offline;
          const xy = points.map(point);
          const last = xy.at(-1);
          if (!last) return null;
          const line = xy.map((item) => `${item.x},${item.y}`).join(' ');
          return (
            <g key={rep.id} className="radar-map-rep" onClick={() => onSelect(rep.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(rep.id); } }} role="button" tabIndex="0" aria-pressed={selectedId === rep.id} aria-label={`عرض مسار ${rep.fullName} · ${status.label}`}>
              {xy.length > 1 && <polyline points={line} fill="none" stroke={status.color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity=".73" />}
              {xy.filter((_, index) => index % Math.max(1, Math.ceil(xy.length / 18)) === 0).map((stop, index) => (
                <circle key={`${rep.id}-trail-${index}`} cx={stop.x} cy={stop.y} r="2.7" fill={status.color} opacity=".48" />
              ))}
              <circle cx={last.x} cy={last.y} r="13" fill={status.color} opacity=".15" />
              <circle cx={last.x} cy={last.y} r="7" fill={status.color} stroke="#fff" strokeWidth="2.5" />
              <title>{`${rep.fullName} · ${status.label} · ${formatTime(rep.lastSignal)}`}</title>
              <rect x={last.x - 46} y={last.y - 53} width="92" height="16" rx="7" fill={status.color} />
              <text x={last.x} y={last.y - 42} textAnchor="middle" className="radar-map-status">{status.label}</text>
              <rect x={last.x - 42} y={last.y - 34} width="84" height="17" rx="7" fill="#173148" />
              <text x={last.x} y={last.y - 22} textAnchor="middle" className="radar-map-name">{rep.fullName.slice(0, 14)}</text>
              {selectedId === rep.id && <circle cx={last.x} cy={last.y} r="17" fill="none" stroke="#183a53" strokeWidth="1.5" strokeDasharray="3 3" />}
            </g>
          );
        })}
      </svg>
      <div className="radar-coordinate-legend"><span>خط العرض {bounds.minLat.toFixed(3)}° – {bounds.maxLat.toFixed(3)}°</span><span>خط الطول {bounds.minLon.toFixed(3)}° – {bounds.maxLon.toFixed(3)}°</span></div>
    </div>
  );
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
  const [reviewNotes, setReviewNotes] = useState({});
  const [loading, setLoading] = useState(true);
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
      <header className="supervisor-page-head">
        <div>
          <span className="supervisor-eyebrow">FIELD OPERATIONS · SUPERVISOR</span>
          <h1>رادار الإشراف الميداني</h1>
          <p>متابعة إشارات الوردية ومراجعة صور الزيارات قبل اعتمادها للتقارير.</p>
        </div>
        <div className="supervisor-head-actions">
          <a className="supervisor-export" href="/api/supervisor/reports/approved-visits.xlsx">تنزيل Excel المعتمد ↓</a>
          <button className="supervisor-refresh" type="button" onClick={() => { setLoading(true); void refresh(); }}>تحديث الرادار ↻</button>
        </div>
      </header>

      {error && <div className="supervisor-alert" role="alert">{error}</div>}
      {notice && <div className="supervisor-notice" role="status">✓ {notice}</div>}
      {overdueAttendance.length > 0 && <div className="supervisor-overdue-warning" role="alert">
        <strong>تنبيه انصراف متأخر</strong>
        <span>{overdueAttendance.map((record) => `${record.name} · تجاوز موعد الانصراف بـ ${record.overdue_hours} ساعة`).join('　 |　 ')}</span>
      </div>}

      <section className="supervisor-kpis" aria-label="ملخص الوردية">
        <article><span>المناديب المسجلون</span><strong>{representatives.length}</strong><small>حسابات ميدانية فعالة أو محفوظة</small></article>
        <article><span>على المسار الآن</span><strong>{representatives.filter((rep) => rep.status === 'active').length}</strong><small>إشارة حديثة ووردية مفتوحة</small></article>
        <article><span>في موقع صيانة</span><strong>{representatives.filter((rep) => rep.status === 'onsite').length}</strong><small>زيارة تنتظر الفحص الميداني</small></article>
        <article className="qa-kpi"><span>طابور مراجعة الصور</span><strong>{visits.length}</strong><small>لا تدخل التقارير قبل الاعتماد</small></article>
      </section>

      <LocationReviews />
      <div className="supervisor-main-grid">
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
            {selectedRep !== null && <button type="button" className="radar-overview-button" onClick={() => setSelectedRep(null)}>العودة إلى كل المندوبين</button>}
            <span>{selectedRep === null ? `${representatives.length} مندوب · الحالة وآخر إشارة على الخريطة` : routeLoading ? 'جارٍ تحميل كامل نقاط المسار…' : `${visibleRoute?.polyline?.length ?? 0} نقطة مسجلة · ${visibleRoute?.stops?.length ?? 0} توقف · ${visibleRoute?.visitedMachines?.length ?? 0} زيارة`}</span>
          </div>
          <TrackMap representatives={representatives} selectedId={selectedRep} onSelect={setSelectedRep} selectedRoute={visibleRoute} />
          {visibleRoute && <div className="radar-speed-summary" aria-label="سرعة المندوب في اليوم المختار">
            <span>متوسط السرعة أثناء الحركة · {visibleRoute.date}: <strong>{formatSpeed(visibleRoute.speedSummary?.averageKmh)}</strong></span>
            <span>أعلى قراءة: <strong>{formatSpeed(visibleRoute.speedSummary?.maxKmh)}</strong></span>
            <small>من {visibleRoute.speedSummary?.sampleCount ?? 0} قراءة GPS صالحة أثناء الحركة</small>
          </div>}
          {visibleRoute && <div className="radar-stops-list" aria-label="توقفات المندوب المحدد">
            <strong>التوقفات · {visibleRoute.date}</strong>
            {visibleRoute.stops.length ? visibleRoute.stops.map((stop, index) => <span key={`${stop.arrivedAt}-${index}`}>
              <b>{stop.name || `توقف ${index + 1}`}</b>
              <small>وصول {formatTime(stop.arrivedAt)} · مغادرة {formatTime(stop.departedAt)} · {stop.durationMinutes} دقيقة</small>
            </span>) : <small>لم تُسجّل توقفات متصلة لأكثر من 5 دقائق في هذا اليوم.</small>}
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
                  <div className="qa-visit-selection"><label><input type="checkbox" checked={selectedBulkIds.has(Number(visit.id))} onChange={(event) => setSelectedBulkIds((current) => { const next = new Set(current); if (event.target.checked) next.add(Number(visit.id)); else next.delete(Number(visit.id)); return next; })} /> ضمن الاعتماد الجماعي</label><span className="qa-pending-badge">بانتظار الاعتماد</span></div>
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
                  <button type="button" className="qa-approve" disabled={busyVisit === visit.id} onClick={() => void review(visit, 'approve')}>اعتماد الزيارة ✓</button>
                  <button type="button" className="qa-reshoot" disabled={busyVisit === visit.id || !(reviewNotes[visit.id] ?? '').trim()} onClick={() => void review(visit, 'reshoot')}>طلب إعادة تصوير ↻</button>
                </div>
                </article>;
              })}
            </div>
            </>
          )}
        </section>
      </div>

      {selectedVisit?.zoomPhoto && <div className="qa-zoom-backdrop" role="presentation" onClick={() => setSelectedVisit(null)}>
        <section role="dialog" aria-modal="true" aria-label="تكبير صورة الزيارة" onClick={(event) => event.stopPropagation()}>
          <header><strong>ماكينة {selectedVisit.machineCode} · {selectedVisit.zoomPhoto === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}</strong><button type="button" onClick={() => setSelectedVisit(null)} aria-label="إغلاق">×</button></header>
          {(() => {
            const photos = selectedVisit.zoomPhoto === 'before'
              ? (selectedVisit.beforePhotos ?? (selectedVisit.beforePhotoUrl ? [{ url: selectedVisit.beforePhotoUrl }] : []))
              : (selectedVisit.afterPhotos ?? (selectedVisit.afterPhotoUrl ? [{ url: selectedVisit.afterPhotoUrl }] : []));
            const photo = photos[selectedVisit.zoomPhotoIndex ?? 0] ?? photos[0];
            return photo
              ? <><img src={photo.url} alt={`صورة ${selectedVisit.zoomPhoto} للماكينة ${selectedVisit.machineCode}`} /><small>{formatTime(photo.capturedAt)} · {selectedVisit.repName}</small></>
              : <p className="qa-photo-missing">لا توجد صور بعد الصيانة؛ هذه المرحلة اختيارية.</p>;
          })()}
        </section>
      </div>}
    </div>
  );
}
