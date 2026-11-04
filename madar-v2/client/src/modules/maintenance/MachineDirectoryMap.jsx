import { useEffect, useMemo, useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import { listOfflineMapPacks } from '../rep/offline-store.js';
import OfflineRouteMap from '../rep/OfflineRouteMap.jsx';
import './machine-directory-map.css';

const FALLBACK_BOUNDS = { west: 24.5, south: 21.5, east: 37.2, north: 31.8 };

async function fetchLocalServerTile(_pack, tile) {
  const response = await fetch(`/api/supervisor/map/tiles/${tile.z}/${tile.x}/${tile.y}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`تعذر تحميل بلاطة الخريطة المحلية (${response.status}).`);
  return response.blob();
}

export default function MachineDirectoryMap({ machines = [], counts = {}, locationStatus = 'all' }) {
  const [packs, setPacks] = useState([]);
  const [packId, setPackId] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listOfflineMapPacks().catch(() => []),
      fetch('/api/supervisor/map/status', { credentials: 'include', cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null),
    ]).then(([saved, serverMap]) => {
      if (!active) return;
      const localPacks = saved.filter((pack) => pack.status === 'ready');
      const choices = serverMap?.renderable ? [{
        ...serverMap,
        id: 'server-local',
        packId: 'server-local',
        name: serverMap.name || 'خريطة الخادم المحلية',
        tileCount: Number(serverMap.tileCount) || 0,
        minZoom: Number(serverMap.minZoom) || 1,
        maxZoom: Number(serverMap.maxZoom) || 8,
        bounds: serverMap.bounds || FALLBACK_BOUNDS,
        serverSource: true,
      }, ...localPacks] : localPacks;
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
        cardId: `machine-${machine.id}`,
        machineCode: machine.code,
        arabicName: machine.name_ar,
        regionName: machine.area,
        canVisit: true,
        isCompleted: false,
        latest_visit: machine.latest_visit,
      };
      if (Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude)) {
        points.push({ ...base, ...machine, ...base, isUnverifiedPin: !machine.is_location_locked });
      }
      if (Number.isFinite(machine.correction_latitude) && Number.isFinite(machine.correction_longitude)) {
        points.push({
          ...base,
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
        <OfflineRouteMap pack={selectedPack} machines={mapMachines} gps={null} onMachineSelect={setSelectedPoint}
          tileLoader={selectedPack.serverSource ? fetchLocalServerTile : undefined} />
        {selectedPoint && <p className="madar-machine-map-selection" role="status">
          <b>{selectedPoint.isCorrectionPin ? 'موقع مقترح في بلاغ' : selectedPoint.isUnverifiedPin ? 'موقع غير مؤكد' : 'موقع الماكينة'}:</b>
          {' '}<span dir="ltr">{selectedPoint.machineCode}</span> · {selectedPoint.arabicName} · {selectedPoint.regionName}
          {selectedPoint.isCorrectionPin && <small> — الإحداثيات دليل للمراجعة فقط، ولم تغيّر موقع سجل الماكينة.</small>}
          <br /><small>{selectedPoint.latest_visit
            ? `آخر زيارة: ${new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(selectedPoint.latest_visit.captured_at))} · أمر ${selectedPoint.latest_visit.order_code} · ${selectedPoint.latest_visit.representative_name}`
            : 'لا توجد زيارة ميدانية مسجلة لهذه الماكينة بعد.'}</small>
        </p>}
      </> : <Alert tone="info">
        لا توجد حزمة MBTiles محلية جاهزة على هذا الجهاز. نزّل حزمة عبر لوحة خرائط المندوب أو أضف ملف الخريطة المحلي أولاً؛ سيظل دليل الماكينات والفلاتر متاحاً دون الخريطة.
      </Alert>}
    </section>
  );
}
