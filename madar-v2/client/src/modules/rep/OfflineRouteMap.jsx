import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getOfflineMapTile,
} from './offline-store.js';
import {
  getVisibleTileCoordinates,
  projectToWorld,
  unprojectFromWorld,
} from './map-utils.js';

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 500;

function routeCenter(machines, pack) {
  const located = machines.filter((machine) => Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude));
  if (located.length) {
    return {
      latitude: located.reduce((total, machine) => total + machine.latitude, 0) / located.length,
      longitude: located.reduce((total, machine) => total + machine.longitude, 0) / located.length,
    };
  }
  return {
    latitude: (pack.bounds.north + pack.bounds.south) / 2,
    longitude: (pack.bounds.east + pack.bounds.west) / 2,
  };
}

export default function OfflineRouteMap({ pack, machines, gps, onMachineSelect, tileLoader }) {
  const defaultCenter = useMemo(() => routeCenter(machines, pack), [machines, pack]);
  const [center, setCenter] = useState(() => gps ? { latitude: gps.latitude, longitude: gps.longitude } : defaultCenter);
  const [zoom, setZoom] = useState(Math.min(pack.maxZoom, pack.id === 'all-egypt' ? 9 : 12));
  const [tiles, setTiles] = useState([]);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [selectedMachineId, setSelectedMachineId] = useState(null);
  const dragRef = useRef(null);
  const activeCenter = center;
  const worldCenter = useMemo(() => projectToWorld(activeCenter, zoom), [activeCenter, zoom]);
  const tileCoordinates = useMemo(() => getVisibleTileCoordinates(activeCenter, zoom, VIEW_WIDTH, VIEW_HEIGHT), [activeCenter, zoom]);
  const locatedMachines = machines.filter((machine) => Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude));
  const selectedMachine = machines.find((machine) => Number(machine.machineId) === Number(selectedMachineId)) ?? null;

  function getMachineStatus(machine) {
    if (machine.isCompleted || machine.reviewStatus === 'approved') return { label: 'تم الفحص', color: '#168267' };
    if (machine.isSubmitted || ['pending', 'reshoot'].includes(machine.reviewStatus)) return { label: 'قيد التنفيذ', color: '#d39b10' };
    return { label: 'لم تبدأ', color: '#7b8791' };
  }

  useEffect(() => {
    setCenter(defaultCenter);
    setZoom(Math.min(pack.maxZoom, Math.max(pack.minZoom, pack.id === 'all-egypt' ? 9 : 12)));
    setSelectedMachineId(null);
  }, [pack.packId, pack.minZoom, pack.maxZoom]);

  useEffect(() => {
    let active = true;
    const objectUrls = [];
    setTilesLoading(true);
    Promise.all(tileCoordinates.map(async (tile) => {
      const blob = tileLoader
        ? await tileLoader(pack, tile)
        : await getOfflineMapTile(pack.packId, tile.z, tile.x, tile.y);
      if (!blob || !active) return null;
      const href = URL.createObjectURL(blob);
      objectUrls.push(href);
      return {
        ...tile,
        href,
        left: VIEW_WIDTH / 2 + tile.x * 256 - worldCenter.x,
        top: VIEW_HEIGHT / 2 + tile.y * 256 - worldCenter.y,
      };
    })).then((loaded) => {
      if (active) setTiles(loaded.filter(Boolean));
    }).catch(() => {
      if (active) setTiles([]);
    }).finally(() => {
      if (active) setTilesLoading(false);
    });
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pack, tileCoordinates, tileLoader, worldCenter]);

  function zoomBy(delta) {
    setZoom((current) => Math.min(pack.maxZoom, Math.max(pack.minZoom, current + delta)));
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, center: worldCenter };
  }

  function onPointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (event.clientX - drag.x) * VIEW_WIDTH / rect.width;
    const dy = (event.clientY - drag.y) * VIEW_HEIGHT / rect.height;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    setCenter(unprojectFromWorld({ x: drag.center.x - dx, y: drag.center.y - dy }, zoom));
  }

  return (
    <section className="rep-offline-map" aria-label={`الخريطة المحلية ${pack.name}`}>
      <div className="rep-offline-map-toolbar">
          <span><strong>{pack.name}</strong><small>{pack.serverSource ? 'بلاطات من خادم الخرائط المحلي' : `${Number(pack.tileCount || 0).toLocaleString('ar-EG')} بلاطة محفوظة`} · التكبير {pack.minZoom}–{pack.maxZoom}</small></span>
        <div>
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= pack.minZoom} aria-label="تصغير الخريطة">−</button>
          <b>{zoom}</b>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= pack.maxZoom} aria-label="تكبير الخريطة">+</button>
          <button type="button" onClick={() => setCenter(gps ? { latitude: gps.latitude, longitude: gps.longitude } : defaultCenter)}>موقعي / المسار</button>
        </div>
      </div>
      {pack.maxZoom < 10 && <p className="rep-map-warning">حزمة الخادم المتاحة منخفضة التفاصيل؛ يلزم ملف MBTiles بمستويات تكبير أعلى لعرض الشوارع بدقة.</p>}
      <div className="rep-offline-map-canvas">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`خريطة أوفلاين مع ${locatedMachines.length} ماكينة محددة الموقع`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#e8efeb" />
          {tiles.map((tile) => <image key={`${tile.z}/${tile.x}/${tile.y}`} href={tile.href}
            x={tile.left} y={tile.top} width="256" height="256" preserveAspectRatio="none" />)}
          {locatedMachines.map((machine) => {
            const point = projectToWorld(machine, zoom);
            const x = VIEW_WIDTH / 2 + point.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + point.y - worldCenter.y;
            if (x < -30 || x > VIEW_WIDTH + 30 || y < -30 || y > VIEW_HEIGHT + 30) return null;
            const status = getMachineStatus(machine);
            const selected = Number(selectedMachineId) === Number(machine.machineId);
            return <g key={`${machine.cardId}-${machine.machineCode}`} role="button" tabIndex="0"
              aria-label={`${machine.machineCode} · ${machine.arabicName ?? ''} · ${status.label}`}
              aria-pressed={selected}
              onClick={() => setSelectedMachineId(Number(machine.machineId))}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedMachineId(Number(machine.machineId)); } }}>
              <circle cx={x} cy={y} r={selected ? 15 : 12} fill="#fff" stroke={machine.isCorrectionPin ? '#bd5a16' : machine.isUnverifiedPin ? '#9a6813' : status.color} strokeWidth="4" />
              <circle cx={x} cy={y} r="4" fill={machine.isCorrectionPin ? '#bd5a16' : machine.isUnverifiedPin ? '#9a6813' : status.color} />
              <title>{`${machine.machineCode} · ${machine.arabicName ?? ''} · ${status.label}`}</title>
            </g>;
          })}
          {gps && (() => {
            const point = projectToWorld(gps, zoom);
            const x = VIEW_WIDTH / 2 + point.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + point.y - worldCenter.y;
            return <g aria-label="موقع GPS الحالي"><circle cx={x} cy={y} r="16" fill="#1185e8" opacity=".2" />
              <circle cx={x} cy={y} r="7" fill="#0875d1" stroke="#fff" strokeWidth="3" /><title>موقع GPS الحالي</title></g>;
          })()}
        </svg>
        {selectedMachine && <aside className="rep-map-machine-popup" role="dialog" aria-label={`تفاصيل الماكينة ${selectedMachine.machineCode}`}>
          <button type="button" className="rep-map-machine-popup-close" aria-label="إغلاق تفاصيل الماكينة" onClick={() => setSelectedMachineId(null)}>×</button>
          <span className="rep-map-machine-status" style={{ '--machine-status-color': getMachineStatus(selectedMachine).color }}>
            <i aria-hidden="true" />{getMachineStatus(selectedMachine).label}
          </span>
          <strong>{selectedMachine.machineCode} · {selectedMachine.arabicName ?? 'ماكينة'}</strong>
          <small>{selectedMachine.address || 'العنوان غير مسجل'}{selectedMachine.regionName ? ` · ${selectedMachine.regionName}` : ''}</small>
          <button type="button" className="rep-button rep-button-primary" disabled={selectedMachine.canVisit === false}
            onClick={() => { if (selectedMachine.canVisit !== false) onMachineSelect({ ...selectedMachine, regionName: selectedMachine.regionName }); }}>
            {selectedMachine.canVisit === false ? 'الزيارة غير متاحة حالياً' : 'ابدأ الزيارة'}
          </button>
        </aside>}
        {tilesLoading && <span className="rep-map-loading">{pack.serverSource ? 'جارٍ تحميل البلاطات من MBTiles المحلي…' : 'جارٍ فتح بلاطات الخريطة من ذاكرة الهاتف…'}</span>}
        {!tilesLoading && !tiles.length && <span className="rep-map-missing">لا توجد بلاطات محفوظة لهذا الموضع/التكبير. حرّك الخريطة أو غيّر مستوى التكبير.</span>}
        <small className="rep-map-attribution">{pack.attribution || 'خريطة محلية مخزنة على الهاتف'}</small>
      </div>
      <p className="rep-map-legend"><span><i className="machine-pin done-pin" />تم الفحص</span><span><i className="machine-pin in-progress-pin" />قيد التنفيذ</span><span><i className="machine-pin not-started-pin" />لم تبدأ</span><span><i className="gps-pin" />موقع GPS الحالي</span><small>اسحب الخريطة لتحريكها؛ تحديد الموقع عبر GPS لا يحتاج إلى إنترنت.</small></p>
    </section>
  );
}
