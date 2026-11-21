import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getOfflineMapTile,
} from './offline-store.js';
import {
  getVisibleTileCoordinates,
  projectToWorld,
  unprojectFromWorld,
  computeFitBounds,
  suppressStationaryJitter,
} from './map-utils.js';
import { isFreshGpsFix, orderMachinesByStraightLineDistance } from './location-review.js';

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 500;

function getDefaultZoom(pack) {
  const isOverview = ['all-egypt', 'server-local', 'egypt-overview'].includes(pack.id || pack.packId)
    || pack.serverSource
    || (pack.maxZoom <= 10);
  const targetZoom = isOverview ? 8 : 12;
  return Math.min(pack.maxZoom, Math.max(pack.minZoom, targetZoom));
}

function parseBounds(bounds) {
  if (!bounds) return null;
  if (Array.isArray(bounds) && bounds.length === 4) {
    const [west, south, east, north] = bounds.map(Number);
    return { west, south, east, north };
  }
  if (typeof bounds === 'string') {
    const parts = bounds.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [west, south, east, north] = parts;
      return { west, south, east, north };
    }
  }
  if (typeof bounds === 'object') {
    const { west, south, east, north } = bounds;
    if ([west, south, east, north].every(Number.isFinite)) return { west, south, east, north };
  }
  return null;
}

function routeCenter(machines, pack) {
  const located = machines.filter((machine) => Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude));
  if (located.length) {
    return {
      latitude: located.reduce((total, machine) => total + machine.latitude, 0) / located.length,
      longitude: located.reduce((total, machine) => total + machine.longitude, 0) / located.length,
    };
  }
  const parsed = parseBounds(pack.bounds);
  if (parsed) {
    return {
      latitude: (parsed.north + parsed.south) / 2,
      longitude: (parsed.east + parsed.west) / 2,
    };
  }
  return { latitude: 30.0444, longitude: 31.2357 };
}

export default function OfflineRouteMap({
  pack,
  machines = [],
  gps,
  onMachineSelect,
  tileLoader,
  routeData = null,
  selectedMachine = null,
  routeLoading = false,
}) {
  const defaultCenter = useMemo(() => routeCenter(machines, pack), [machines, pack]);
  const [center, setCenter] = useState(() => gps ? { latitude: gps.latitude, longitude: gps.longitude } : defaultCenter);
  const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
  const effectiveMaxZoom = pack.maxZoom;
  const [zoom, setZoom] = useState(() => Math.min(pack.maxZoom, getDefaultZoom(pack)));
  const [tiles, setTiles] = useState([]);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [selectedMachineId, setSelectedMachineId] = useState(() => selectedMachine?.id || selectedMachine?.machineId || null);
  const dragRef = useRef(null);
  const activeCenter = center;
  const worldCenter = useMemo(() => projectToWorld(activeCenter, zoom), [activeCenter, zoom]);
  const tileCoordinates = useMemo(() => getVisibleTileCoordinates(activeCenter, zoom, VIEW_WIDTH, VIEW_HEIGHT), [activeCenter, zoom]);

  const locatedMachines = useMemo(() => {
    return machines.filter((machine) => Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude));
  }, [machines]);

  const needsLocation = useMemo(() => {
    return machines.filter((machine) => !Number.isFinite(machine.latitude) || !Number.isFinite(machine.longitude));
  }, [machines]);

  const distanceGroups = isFreshGpsFix(gps) ? orderMachinesByStraightLineDistance(machines, gps) : null;
  const packBounds = useMemo(() => parseBounds(pack.bounds), [pack.bounds]);

  const outOfBoundsCount = useMemo(() => {
    if (!packBounds || !locatedMachines.length) return 0;
    return locatedMachines.filter((m) =>
      m.longitude < packBounds.west || m.longitude > packBounds.east ||
      m.latitude < packBounds.south || m.latitude > packBounds.north
    ).length;
  }, [packBounds, locatedMachines]);

  // Sync selected machine from props
  useEffect(() => {
    if (selectedMachine?.id || selectedMachine?.machineId) {
      const targetId = Number(selectedMachine.id || selectedMachine.machineId);
      setSelectedMachineId(targetId);
    }
  }, [selectedMachine]);

  // Center or fitBounds when selectedMachine or routeData changes
  useEffect(() => {
    if (!selectedMachine && !routeData) return;

    const pointsToFit = [];

    if (selectedMachine && Number.isFinite(selectedMachine.latitude) && Number.isFinite(selectedMachine.longitude)) {
      pointsToFit.push({ latitude: selectedMachine.latitude, longitude: selectedMachine.longitude });
    }

    if (routeData?.arrivalPoint && Number.isFinite(routeData.arrivalPoint.latitude) && Number.isFinite(routeData.arrivalPoint.longitude)) {
      pointsToFit.push({ latitude: routeData.arrivalPoint.latitude, longitude: routeData.arrivalPoint.longitude });
    }

    if (routeData?.segments?.length) {
      for (const seg of routeData.segments) {
        for (const pt of seg.points) {
          if (Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude)) {
            pointsToFit.push(pt);
          }
        }
      }
    }

    if (pointsToFit.length > 0) {
      const fit = computeFitBounds(pointsToFit, VIEW_WIDTH, VIEW_HEIGHT, pack.minZoom, effectiveMaxZoom);
      if (fit) {
        setCenter(fit.center);
        setZoom(fit.zoom);
      }
    }
  }, [selectedMachine, routeData, pack.minZoom, effectiveMaxZoom]);

  function getMachineStatus(machine) {
    if (machine.isCompleted || machine.reviewStatus === 'approved') return { label: 'تم الفحص', color: '#168267' };
    if (machine.isSubmitted || ['pending', 'reshoot'].includes(machine.reviewStatus)) return { label: 'قيد التنفيذ', color: '#d39b10' };
    return { label: 'لم تبدأ', color: '#7b8791' };
  }

  useEffect(() => {
    if (!selectedMachine && !routeData) {
      setCenter(defaultCenter);
      setZoom(getDefaultZoom(pack));
      setSelectedMachineId(null);
    }
  }, [pack.packId, pack.minZoom, pack.maxZoom]);

  useEffect(() => {
    let active = true;
    const objectUrls = [];
    setTilesLoading(true);
    Promise.allSettled(tileCoordinates.map(async (tile) => {
      let blob = null;
      try {
        blob = tileLoader
          ? await tileLoader(pack, tile)
          : await getOfflineMapTile(pack.packId, tile.z, tile.x, tile.y);
      } catch {
        blob = null;
      }
      // If local tile is unavailable and online, fetch from OpenStreetMap
      if (!blob && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const response = await fetch(`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`, {
            cache: 'force-cache',
          });
          if (response.ok) blob = await response.blob();
        } catch {
          blob = null;
        }
      }
      if (!blob || !active) return null;
      const href = URL.createObjectURL(blob);
      objectUrls.push(href);
      return {
        ...tile,
        href,
        left: VIEW_WIDTH / 2 + tile.x * 256 - worldCenter.x,
        top: VIEW_HEIGHT / 2 + tile.y * 256 - worldCenter.y,
      };
    })).then((results) => {
      if (active) {
        const loaded = results
          .filter((res) => res.status === 'fulfilled' && res.value)
          .map((res) => res.value);
        setTiles(loaded);
      }
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
    setZoom((current) => Math.min(effectiveMaxZoom, Math.max(pack.minZoom, current + delta)));
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

  const allRoutePoints = useMemo(() => {
    return routeData?.segments ? routeData.segments.flatMap((s) => s.points) : [];
  }, [routeData]);

  const firstRoutePoint = allRoutePoints[0] || null;
  const lastRoutePoint = allRoutePoints.length > 1 ? allRoutePoints[allRoutePoints.length - 1] : null;

  return (
    <section className="rep-offline-map" aria-label={`الخريطة المحلية ${pack.name}`}>
      <div className="rep-offline-map-toolbar">
        <span>
          <strong>{pack.name}</strong>
          <small>{pack.serverSource ? 'بلاطات من خادم الخرائط المحلي' : `${Number(pack.tileCount || 0).toLocaleString('ar-EG')} بلاطة محفوظة`}{isOnline ? ' · وضع تفصيلي متصل' : ` · التكبير ${pack.minZoom}–${pack.maxZoom}`}</small>
        </span>
        <div>
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= pack.minZoom} aria-label="تصغير الخريطة">−</button>
          <b>{zoom}</b>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= effectiveMaxZoom} aria-label="تكبير الخريطة">+</button>
          <button
            type="button"
            onClick={() => {
              if (selectedMachine && Number.isFinite(selectedMachine.latitude) && Number.isFinite(selectedMachine.longitude)) {
                setCenter({ latitude: selectedMachine.latitude, longitude: selectedMachine.longitude });
              } else if (gps) {
                setCenter({ latitude: gps.latitude, longitude: gps.longitude });
              } else {
                setCenter(defaultCenter);
              }
            }}
          >
            {selectedMachine ? 'موقع الماكينة' : 'موقعي / المسار'}
          </button>
        </div>
      </div>
      {outOfBoundsCount > 0 && outOfBoundsCount === locatedMachines.length && (
        <p className="rep-map-warning" role="alert">
          تنبيه: مواقع الماكينات تقع خارج نطاق حزمة &quot;{pack.name}&quot;. اختر خريطة مصر العامة أو الحزمة المطابقة لمنطقتك.
        </p>
      )}
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

          {/* 1. Render Representative Actual Recorded Route Segments */}
          {routeData?.segments?.map((segment, sIdx) => {
            const smoothed = suppressStationaryJitter(segment.points, 12);
            if (smoothed.length < 2) return null;

            const pointsStr = smoothed.map((pt) => {
              const p = projectToWorld(pt, zoom);
              const x = VIEW_WIDTH / 2 + p.x - worldCenter.x;
              const y = VIEW_HEIGHT / 2 + p.y - worldCenter.y;
              return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
            }).join(' ');

            return (
              <g key={segment.segmentId || `seg-${sIdx}`}>
                {/* Contrast casing under polyline */}
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.8"
                />
                {/* Primary Route Path */}
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Subtle accuracy overlays */}
                {smoothed.filter((pt) => pt.accuracyMeters && pt.accuracyMeters <= 50).map((pt, pIdx) => {
                  const p = projectToWorld(pt, zoom);
                  const x = VIEW_WIDTH / 2 + p.x - worldCenter.x;
                  const y = VIEW_HEIGHT / 2 + p.y - worldCenter.y;
                  const pxRadius = Math.min(35, Math.max(8, pt.accuracyMeters * (2 ** zoom * 256 / 40075016.686)));
                  return (
                    <circle
                      key={`acc-${segment.segmentId}-${pIdx}`}
                      cx={x}
                      cy={y}
                      r={pxRadius}
                      fill="rgba(2, 132, 199, 0.04)"
                      stroke="rgba(2, 132, 199, 0.2)"
                      strokeWidth="1"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 2. Route Start and End Markers */}
          {firstRoutePoint && (() => {
            const p = projectToWorld(firstRoutePoint, zoom);
            const x = VIEW_WIDTH / 2 + p.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + p.y - worldCenter.y;
            return (
              <g aria-label="بداية المسار" transform={`translate(${x},${y})`}>
                <circle r="9" fill="#10b981" stroke="#ffffff" strokeWidth="2.5" />
                <circle r="3" fill="#ffffff" />
                <title>بداية المسار ({firstRoutePoint.recordedAt})</title>
              </g>
            );
          })()}
          {lastRoutePoint && (() => {
            const p = projectToWorld(lastRoutePoint, zoom);
            const x = VIEW_WIDTH / 2 + p.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + p.y - worldCenter.y;
            return (
              <g aria-label="نهاية المسار" transform={`translate(${x},${y})`}>
                <circle r="9" fill="#ef4444" stroke="#ffffff" strokeWidth="2.5" />
                <circle r="3" fill="#ffffff" />
                <title>نهاية المسار ({lastRoutePoint.recordedAt})</title>
              </g>
            );
          })()}

          {/* 3. Arrival Marker */}
          {routeData?.arrivalPoint && (() => {
            const p = projectToWorld(routeData.arrivalPoint, zoom);
            const x = VIEW_WIDTH / 2 + p.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + p.y - worldCenter.y;
            return (
              <g aria-label="موقع الوصول المسجل للزيارة" transform={`translate(${x},${y})`}>
                <circle r="14" fill="#f59e0b" opacity="0.2" />
                <circle r="8" fill="#d97706" stroke="#ffffff" strokeWidth="2" />
                <circle r="3" fill="#ffffff" />
                <title>موقع الوصول المسجل ({routeData.arrivalPoint.capturedAt})</title>
              </g>
            );
          })()}

          {/* 4. Machine Coordinate Markers */}
          {locatedMachines.map((machine) => {
            const point = projectToWorld(machine, zoom);
            const x = VIEW_WIDTH / 2 + point.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + point.y - worldCenter.y;
            if (x < -30 || x > VIEW_WIDTH + 30 || y < -30 || y > VIEW_HEIGHT + 30) return null;
            const status = getMachineStatus(machine);
            const selected = Number(selectedMachineId) === Number(machine.machineId || machine.id);
            const pinColor = machine.isCorrectionPin
              ? '#ea580c'
              : machine.isUnverifiedPin
                ? '#d97706'
                : (status.color || '#168267');

            return (
              <g
                key={`${machine.cardId || machine.id}-${machine.machineCode || machine.code}`}
                role="button"
                tabIndex="0"
                aria-label={`${machine.machineCode || machine.code} · ${machine.arabicName || machine.name_ar || ''} · ${status.label}`}
                aria-pressed={selected}
                onClick={() => {
                  const mId = Number(machine.machineId || machine.id);
                  setSelectedMachineId(mId);
                  onMachineSelect?.(machine);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const mId = Number(machine.machineId || machine.id);
                    setSelectedMachineId(mId);
                    onMachineSelect?.(machine);
                  }
                }}
              >
                {selected && (
                  <circle cx={x} cy={y} r="22" fill="none" stroke={pinColor} strokeWidth="2.5" strokeDasharray="4,3" />
                )}
                <circle cx={x} cy={y} r={selected ? 15 : 12} fill="#fff" stroke={pinColor} strokeWidth="4" />
                <circle cx={x} cy={y} r="4" fill={pinColor} />
                <title>{`${machine.machineCode || machine.code} · ${machine.arabicName || machine.name_ar || ''} · ${machine.isCorrectionPin ? 'موقع مقترح' : machine.isUnverifiedPin ? 'غير مؤكد' : 'معتمد'}`}</title>
              </g>
            );
          })}

          {/* 5. Real-time GPS Fix */}
          {gps && (() => {
            const point = projectToWorld(gps, zoom);
            const x = VIEW_WIDTH / 2 + point.x - worldCenter.x;
            const y = VIEW_HEIGHT / 2 + point.y - worldCenter.y;
            return (
              <g aria-label="موقع GPS الحالي">
                <circle cx={x} cy={y} r="16" fill="#1185e8" opacity=".2" />
                <circle cx={x} cy={y} r="7" fill="#0875d1" stroke="#fff" strokeWidth="3" />
                <title>موقع GPS الحالي</title>
              </g>
            );
          })()}
        </svg>

        {/* Status Overlays */}
        {tilesLoading && <span className="rep-map-loading">{pack.serverSource ? 'جارٍ تحميل البلاطات من MBTiles المحلي…' : 'جارٍ فتح بلاطات الخريطة من ذاكرة الهاتف…'}</span>}
        {routeLoading && <span className="rep-map-loading" style={{ top: '48px' }}>جارٍ جلب مسار المندوب الفعلي…</span>}

        {!routeLoading && routeData?.summary?.pointCount > 0 && (
          <div className="rep-map-route-summary" style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255, 255, 255, 0.95)', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 800, color: '#0369a1', border: '1px solid #bae6fd', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
            📍 مسار مسجل: {routeData.summary.distanceMeters > 1000 ? `${(routeData.summary.distanceMeters / 1000).toFixed(1)} كم` : `${routeData.summary.distanceMeters} م`} · {routeData.summary.averageSpeedKph} كم/س · {routeData.summary.pointCount} نقطة ({routeData.context.representativeName || 'المندوب'})
          </div>
        )}

        {!routeLoading && selectedMachine && (!routeData || routeData.summary?.pointCount === 0) && (
          <div className="rep-map-route-summary" style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255, 251, 235, 0.95)', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 700, color: '#92400e', border: '1px solid #fde68a', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
            {routeData?.arrivalPoint ? '✓ تم تسجيل موقع الوصول للزيارة · لا يوجد مسار GPS مسجل' : '📍 موقع الماكينة محدد · لا توجد زيارات مسجلة بمسار GPS'}
          </div>
        )}

        {!tilesLoading && !tiles.length && (
          <div className="rep-map-missing" role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <span>لا توجد بلاطات محفوظة لهذا الموضع/التكبير. حرّك الخريطة أو غيّر مستوى التكبير.</span>
            {zoom > pack.minZoom && (
              <button
                type="button"
                className="rep-button rep-button-secondary"
                style={{ padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                onClick={() => setZoom((prev) => Math.max(pack.minZoom, prev - 1))}
              >
                الرجوع لمستوى التكبير السابق ({zoom - 1})
              </button>
            )}
          </div>
        )}
        <small className="rep-map-attribution">{pack.attribution || 'خريطة محلية مخزنة على الجهاز'}</small>
      </div>

      {/* Comprehensive Legend */}
      <p className="rep-map-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <span><i className="machine-pin" style={{ background: '#168267' }} />موقع معتمد</span>
        <span><i className="machine-pin" style={{ background: '#d97706' }} />غير مؤكد</span>
        <span><i className="machine-pin" style={{ background: '#ea580c' }} />مقترح ببلاغ</span>
        <span><i className="gps-pin" style={{ background: '#0284c7', borderRadius: 0, height: '3px', width: '14px' }} />مسار المندوب</span>
        <span><i className="gps-pin" style={{ background: '#10b981' }} />بداية المسار</span>
        <span><i className="gps-pin" style={{ background: '#ef4444' }} />نهاية المسار</span>
        {routeData?.arrivalPoint && <span><i className="gps-pin" style={{ background: '#f59e0b' }} />موقع الوصول</span>}
        {gps && <span><i className="gps-pin" style={{ background: '#0875d1' }} />موقعي</span>}
        <small>اسحب الخريطة لتحريكها؛ تحديد المواقع والمسارات يتم محلياً دون إرسال بياناتك لخوادم خارجية.</small>
      </p>

      {distanceGroups && distanceGroups.located.length > 0 && (
        <section className="rep-map-nearest-list" aria-label="الماكينات مرتبة حسب المسافة المستقيمة">
          <strong>الأقرب إلى موقعك · مسافة خط مستقيم فقط</strong>
          {distanceGroups.located.map((machine) => (
            <button key={`near-${machine.cardId || machine.id}`} type="button" onClick={() => onMachineSelect?.({ ...machine, regionName: machine.regionName })} disabled={machine.canVisit === false}>
              <span><b dir="ltr">{machine.machineCode || machine.code}</b> · {machine.arabicName || machine.name_ar || 'ماكينة'}</span>
              <small>{Math.round(machine.straightLineDistanceMeters)}م مستقيمة · {machine.regionName || machine.area}</small>
            </button>
          ))}
        </section>
      )}

      {needsLocation.length > 0 && (
        <section className="rep-map-needs-location" aria-label="ماكينات تحتاج تثبيت الموقع">
          <strong>الموقع يحتاج تثبيتاً ({needsLocation.length})</strong>
          <small>لا يوجد إحداثي معتمد؛ لم تُحسب مسافة لهذه الماكينات.</small>
          {needsLocation.map((machine) => (
            <button key={`need-${machine.cardId || machine.id}`} type="button" onClick={() => onMachineSelect?.({ ...machine, regionName: machine.regionName })} disabled={machine.canVisit === false}>
              <span><b dir="ltr">{machine.machineCode || machine.code}</b> · {machine.arabicName || machine.name_ar || 'ماكينة'}</span>
              <small>{machine.regionName || machine.area || 'منطقة غير محددة'} · يحتاج GPS أولياً معتمداً</small>
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
