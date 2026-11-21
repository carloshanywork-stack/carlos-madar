import { useEffect, useMemo, useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import { listOfflineMapPacks } from '../rep/offline-store.js';
import OfflineRouteMap from '../rep/OfflineRouteMap.jsx';
import './machine-directory-map.css';

const FALLBACK_BOUNDS = { west: 24.5, south: 21.5, east: 37.2, north: 31.8 };

async function fetchLocalServerTile(pack, tile) {
  const endpoint = pack?.serverPackId
    ? `/api/rep/map/tiles/${pack.serverPackId}/${tile.z}/${tile.x}/${tile.y}`
    : `/api/supervisor/map/tiles/${tile.z}/${tile.x}/${tile.y}`;
  const response = await fetch(endpoint, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`تعذر تحميل بلاطة الخريطة المحلية (${response.status}).`);
  return response.blob();
}

export default function MachineDirectoryMap({
  machines = [],
  counts = {},
  locationStatus = 'all',
  selectedMachineId = null,
  onSelectMachine = null,
}) {
  const [packs, setPacks] = useState([]);
  const [packId, setPackId] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listOfflineMapPacks().catch(() => []),
      fetch('/api/supervisor/map/status', { credentials: 'include', cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null),
      fetch('/api/rep/map/packs', { credentials: 'include', cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null),
    ]).then(([saved, serverMap, repCatalog]) => {
      if (!active) return;
      const localPacks = saved.filter((pack) => pack.status === 'ready');
      const serverRegionalPacks = (repCatalog?.packs || [])
        .filter((p) => p.available)
        .map((p) => ({
          ...p,
          id: p.id,
          packId: `server-${p.id}`,
          serverPackId: p.id,
          name: p.name,
          tileCount: Number(p.tileCount) || 0,
          minZoom: Number(p.minZoom) || 5,
          maxZoom: Number(p.maxZoom) || 14,
          bounds: p.coverageBounds || p.bounds || FALLBACK_BOUNDS,
          serverSource: true,
        }));
      const fallbackOverview = serverMap?.renderable ? [{
        ...serverMap,
        id: 'server-local',
        packId: 'server-local',
        name: serverMap.name || 'خريطة مصر العامة',
        tileCount: Number(serverMap.tileCount) || 0,
        minZoom: Number(serverMap.minZoom) || 5,
        maxZoom: Number(serverMap.maxZoom) || 11,
        bounds: serverMap.bounds || FALLBACK_BOUNDS,
        serverSource: true,
      }] : [];
      const choices = serverRegionalPacks.length > 0
        ? [...serverRegionalPacks, ...localPacks]
        : [...fallbackOverview, ...localPacks];
      setPacks(choices);
      setPackId((current) => choices.some((pack) => pack.packId === current) ? current : choices[0]?.packId ?? '');
    }).catch(() => {
      if (active) setPacks([]);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selectedPack = packs.find((pack) => pack.packId === packId);
  const mapMachines = useMemo(() => {
    const points = [];
    for (const machine of machines) {
      const base = {
        id: machine.id,
        machineId: machine.id,
        cardId: `machine-${machine.id}`,
        machineCode: machine.code,
        code: machine.code,
        arabicName: machine.name_ar,
        name_ar: machine.name_ar,
        regionName: machine.area,
        area: machine.area,
        canVisit: true,
        isCompleted: false,
        latest_visit: machine.latest_visit,
        is_location_locked: Boolean(machine.is_location_locked),
        isLocationLocked: Boolean(machine.is_location_locked),
      };
      if (Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude)) {
        points.push({ ...base, ...machine, ...base, isUnverifiedPin: !machine.is_location_locked });
      }
      if (Number.isFinite(machine.correction_latitude) && Number.isFinite(machine.correction_longitude)) {
        points.push({
          ...base,
          id: machine.id,
          machineId: machine.id,
          cardId: `correction-${machine.id}`,
          machineCode: `بلاغ ${machine.correction_reported_code || machine.code}`,
          arabicName: machine.correction_reported_name || 'موقع مقترح من بلاغ مندوب',
          latitude: machine.correction_latitude,
          longitude: machine.correction_longitude,
          isCorrectionPin: true,
        });
      }
    }
    return points;
  }, [machines]);

  // Synchronize selection if selectedMachineId is supplied from parent table
  useEffect(() => {
    if (selectedMachineId) {
      const match = mapMachines.find((m) => m.id === selectedMachineId && !m.isCorrectionPin);
      if (match) setSelectedPoint(match);
    }
  }, [selectedMachineId, mapMachines]);

  // Fetch actual recorded GPS route on machine selection
  useEffect(() => {
    const targetMachineId = selectedPoint?.id;
    if (!targetMachineId) {
      setRouteData(null);
      setRouteLoading(false);
      setRouteError(null);
      return;
    }

    const controller = new AbortController();
    setRouteLoading(true);
    setRouteError(null);

    fetch(`/api/maintenance/machines/${targetMachineId}/route`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) return null;
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `تعذر جلب مسار المندوب (${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        setRouteData(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('Failed to fetch machine route:', err);
        setRouteError(err.message || 'تعذر تحميل مسار المندوب');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRouteLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedPoint?.id]);

  function handlePointSelect(point) {
    setSelectedPoint(point);
    if (onSelectMachine) {
      onSelectMachine(point ? { id: point.id, code: point.code || point.machineCode } : null);
    }
  }

  function handleClearSelection() {
    setSelectedPoint(null);
    setRouteData(null);
    setRouteError(null);
    if (onSelectMachine) {
      onSelectMachine(null);
    }
  }

  return (
    <section className="madar-panel madar-section madar-machine-map-section" aria-label="خريطة دليل الماكينات">
      <div className="madar-machine-map-heading">
        <div><strong>خريطة الماكينات</strong><small>تُعرض بلاطات MBTiles المحفوظة محلياً فقط؛ لا تُرسل المواقع إلى مزوّد خرائط.</small></div>
        {selectedPack && <label className="madar-machine-map-pack">حزمة الخريطة
          <select value={packId} onChange={(event) => setPackId(event.target.value)}>
            {packs.map((pack) => <option key={pack.packId} value={pack.packId}>{pack.name}</option>)}
          </select>
        </label>}
      </div>
      {loading ? <p className="madar-muted">جارٍ فحص حزم الخرائط المحلية…</p> : selectedPack ? <>
        <div className="madar-machine-map-legend">
          <span><i className="machine-pin" />موقع الماكينة</span>
          <span><i className="correction-pin" />موقع وارد في بلاغ تصحيح</span>
          <small>الإجمالي {counts.total ?? machines.length} · مواقع مثبتة {counts.located ?? '—'} · غير مثبتة {counts.unlocated ?? '—'} · بلاغات معلقة {counts.pending_correction ?? '—'} · نقاط بهذه التصفية {mapMachines.length}{locationStatus !== 'all' ? ` (${locationStatus})` : ''}</small>
        </div>
        {!mapMachines.length && <p className="madar-machine-map-unlocated">لا توجد نقاط بإحداثيات في هذه التصفية؛ الماكينات غير المحددة ستظهر بعد تسجيل GPS، بينما تظل متاحة في جدول الدليل.</p>}
        <OfflineRouteMap
          pack={selectedPack}
          machines={mapMachines}
          selectedMachine={selectedPoint}
          routeData={routeData}
          routeLoading={routeLoading}
          gps={null}
          onMachineSelect={handlePointSelect}
          tileLoader={selectedPack.serverSource ? fetchLocalServerTile : undefined}
        />
        {selectedPoint && (
          <div className="madar-machine-map-route-panel" role="status">
            <div className="madar-machine-map-route-header">
              <div className="madar-machine-map-route-title">
                <span className={`madar-pin-badge ${selectedPoint.isCorrectionPin ? 'correction' : selectedPoint.isUnverifiedPin ? 'unverified' : 'locked'}`}>
                  {selectedPoint.isCorrectionPin ? 'موقع مقترح في بلاغ' : selectedPoint.isUnverifiedPin ? 'موقع غير مؤكد' : 'موقع مثبت ومغلق'}
                </span>
                <strong><span dir="ltr">{selectedPoint.machineCode}</span> — {selectedPoint.arabicName}</strong>
                <small>({selectedPoint.regionName || selectedPoint.area})</small>
              </div>
              <button
                type="button"
                className="madar-machine-map-reset-btn"
                onClick={handleClearSelection}
                title="إلغاء التحديد وتوسيع الخريطة"
              >
                إلغاء التحديد ✕
              </button>
            </div>

            <div className="madar-machine-map-route-coords">
              <span>الإحداثيات: <code>{Number(selectedPoint.latitude).toFixed(6)}, {Number(selectedPoint.longitude).toFixed(6)}</code></span>
              {selectedPoint.isCorrectionPin && (
                <span className="madar-muted"> — الإحداثيات دليل للمراجعة فقط، ولم تغيّر موقع سجل الماكينة.</span>
              )}
            </div>

            {routeLoading && (
              <div className="madar-machine-route-loading">
                <span className="madar-spinner-icon" /> جارٍ استرجاع مسار تتبع المندوب المسجل ميدانياً…
              </div>
            )}

            {routeError && (
              <div className="madar-machine-route-error">
                <small>{routeError}</small>
              </div>
            )}

            {!routeLoading && routeData?.summary?.hasRoute && (
              <div className="madar-machine-route-summary">
                <div className="madar-machine-route-summary-badge">
                  <i className="route-line-icon" /> المسار الميداني المسجل
                </div>
                <div className="madar-machine-route-stats">
                  <div><strong>المندوب:</strong> {routeData.visit?.representative_name || routeData.route?.rep_name || 'مندوب الصيانة'}</div>
                  {routeData.visit?.captured_at && (
                    <div><strong>توقيت الزيارة:</strong> {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(routeData.visit.captured_at))}</div>
                  )}
                  {routeData.visit?.order_code && (
                    <div><strong>أمر الصيانة:</strong> {routeData.visit.order_code}</div>
                  )}
                  <div><strong>إجمالي المسافة:</strong> {routeData.summary.totalDistanceKm} كم</div>
                  <div><strong>متوسط السرعة:</strong> {routeData.summary.averageSpeedKmh} كم/س</div>
                  <div><strong>نقاط الـ GPS:</strong> {routeData.summary.pointCount} نقطة مسجلة</div>
                  <div><strong>القطاعات:</strong> {routeData.summary.segmentCount}</div>
                  {routeData.visit?.geofence_verified !== undefined && (
                    <div>
                      <strong>التحقق الجغرافي:</strong>{' '}
                      <span className={routeData.visit.geofence_verified ? 'text-success' : 'text-warning'}>
                        {routeData.visit.geofence_verified ? 'تم التحقق داخل 50م' : 'وصول غير مؤكد'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!routeLoading && !routeError && !routeData?.summary?.hasRoute && (
              <div className="madar-machine-route-empty">
                <small>
                  {selectedPoint.latest_visit
                    ? `آخر زيارة مسجلة: ${new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(selectedPoint.latest_visit.captured_at))} (${selectedPoint.latest_visit.order_code}) — ولكن لم تُحفظ نقاط تتبع GPS لهذه الزيارة.`
                    : 'لا تتوفر زيارة ميدانية بنقاط تتبع GPS مسجلة لهذه الماكينة حتى الآن. الموقع الجغرافي محدد في الدليل وسيرسم المسار فور إتمام الزيارة.'}
                </small>
              </div>
            )}
          </div>
        )}
      </> : <Alert tone="info">
        لا توجد حزمة MBTiles محلية جاهزة على هذا الجهاز. نزّل حزمة عبر لوحة خرائط المندوب أو أضف ملف الخريطة المحلي أولاً؛ سيظل دليل الماكينات والفلاتر متاحاً دون الخريطة.
      </Alert>}
    </section>
  );
}
