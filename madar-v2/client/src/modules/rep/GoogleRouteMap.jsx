import { useEffect, useMemo, useRef, useState } from 'react';
import { googleMapsNavigationUrl } from './map-utils.js';
import { loadGoogleMaps } from './google-maps-loader.js';

const CAIRO_CENTER = Object.freeze({ latitude: 30.0444, longitude: 31.2357 });

function hasCoordinates(machine) {
  return machine?.latitude != null && machine?.longitude != null
    && Number.isFinite(Number(machine.latitude)) && Number.isFinite(Number(machine.longitude));
}

function machinePosition(machine) {
  return { lat: Number(machine.latitude), lng: Number(machine.longitude) };
}

function gpsPosition(gps) {
  return Number.isFinite(Number(gps?.latitude)) && Number.isFinite(Number(gps?.longitude))
    ? { lat: Number(gps.latitude), lng: Number(gps.longitude) }
    : null;
}

function resolveCenter(machines, gps) {
  const current = gpsPosition(gps);
  if (current) return current;
  const located = machines.filter(hasCoordinates);
  if (!located.length) return { lat: CAIRO_CENTER.latitude, lng: CAIRO_CENTER.longitude };
  return {
    lat: located.reduce((total, machine) => total + Number(machine.latitude), 0) / located.length,
    lng: located.reduce((total, machine) => total + Number(machine.longitude), 0) / located.length,
  };
}

function machineColor(machine) {
  if (machine.isCompleted || machine.reviewStatus === 'approved') return '#168267';
  if (machine.isSubmitted || ['pending', 'reshoot'].includes(machine.reviewStatus)) return '#d39b10';
  return '#7b8791';
}

/**
 * Embedded Google map for the representative route. A configured JavaScript API
 * key renders the interactive layer; without one the panel falls back to the
 * keyless Google Maps quick view. The offline MBTiles map stays available from
 * the parent panel whenever there is no connection.
 */
export default function GoogleRouteMap({ apiKey, machines = [], gps, onMachineSelect }) {
  const locatedMachines = useMemo(() => machines.filter(hasCoordinates), [machines]);
  const initialCenterRef = useRef(null);
  if (!initialCenterRef.current) initialCenterRef.current = resolveCenter(machines, gps);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedRef = useRef(false);
  const [mapsApi, setMapsApi] = useState(null);
  const [mapStatus, setMapStatus] = useState(apiKey ? 'loading' : 'iframe');
  const [error, setError] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [focusedMachineId, setFocusedMachineId] = useState(null);

  useEffect(() => {
    if (!apiKey) {
      setMapsApi(null);
      setMapStatus('iframe');
      return undefined;
    }
    let cancelled = false;
    setMapStatus('loading');
    setError('');
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !containerRef.current) return;
      const map = new maps.Map(containerRef.current, {
        center: initialCenterRef.current,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      mapRef.current = map;
      setMapsApi(maps);
      setMapStatus('ready');
    }).catch((caught) => {
      if (cancelled) return;
      setError(caught.message || 'تعذر تحميل خريطة Google التفاعلية.');
      setMapStatus('iframe');
    });
    return () => {
      cancelled = true;
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    const maps = mapsApi;
    const map = mapRef.current;
    if (!maps || !map) return undefined;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const bounds = new maps.LatLngBounds();
    const routePath = [];

    locatedMachines.forEach((machine) => {
      const position = machinePosition(machine);
      const marker = new maps.Marker({
        map,
        position,
        title: `${machine.machineCode} · ${machine.arabicName ?? ''}`,
        zIndex: 5,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: machineColor(machine),
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      });
      marker.addListener('click', () => setSelectedMachine(machine));
      markersRef.current.push(marker);
      bounds.extend(position);
      routePath.push(position);
    });

    if (routePath.length > 1) {
      markersRef.current.push(new maps.Polyline({
        map,
        path: routePath,
        geodesic: true,
        strokeColor: '#14805d',
        strokeOpacity: 0.62,
        strokeWeight: 3,
      }));
    }

    const currentGps = gpsPosition(gps);
    if (currentGps) {
      markersRef.current.push(new maps.Marker({
        map,
        position: currentGps,
        title: 'موقع GPS الحالي',
        zIndex: 10,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#0875d1',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      }));
      bounds.extend(currentGps);
    }

    if (!fittedRef.current && !bounds.isEmpty()) {
      map.fitBounds(bounds, 46);
      fittedRef.current = true;
    }
    return undefined;
  }, [locatedMachines, gps, mapsApi]);

  useEffect(() => {
    const maps = mapsApi;
    const map = mapRef.current;
    if (!maps || !map || focusedMachineId === null) return;
    const target = locatedMachines.find((machine) => Number(machine.machineId) === Number(focusedMachineId));
    if (!target) return;
    map.panTo(machinePosition(target));
    map.setZoom(15);
  }, [focusedMachineId, locatedMachines, mapsApi]);

  const iframeCenter = useMemo(() => {
    const target = locatedMachines.find((machine) => Number(machine.machineId) === Number(focusedMachineId));
    return target ? machinePosition(target) : initialCenterRef.current;
  }, [focusedMachineId, locatedMachines]);
  const iframeSrc = `https://maps.google.com/maps?q=${iframeCenter.lat},${iframeCenter.lng}&hl=ar&z=${selectedMachine ? 15 : 12}&output=embed`;
  const interactive = Boolean(apiKey) && mapStatus !== 'iframe';

  function focusMachine(machine) {
    setFocusedMachineId(machine.machineId);
    setSelectedMachine(machine);
  }

  return (
    <section className="rep-google-map-panel" aria-label="خريطة Google لمسار اليوم">
      {error && <p className="rep-map-warning" role="status">{error} يجري عرض النسخة السريعة المضمّنة، وتبقى الخريطة المحلية متاحة من تبويب «الخريطة المحلية».</p>}
      <div className="rep-google-map-frame">
        {interactive ? (
          <div className="rep-google-map-canvas" ref={containerRef} role="application" aria-label="خريطة Google التفاعلية لمسار اليوم">
            {mapStatus === 'loading' && <span className="rep-google-map-loading">جارٍ تحميل خريطة Google…</span>}
          </div>
        ) : (
          <iframe
            className="rep-google-map-iframe"
            title="عرض Google Maps المضمّن لمسار اليوم"
            src={iframeSrc}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
        {selectedMachine && (
          <aside className="rep-map-machine-popup" role="dialog" aria-label={`تفاصيل الماكينة ${selectedMachine.machineCode}`}>
            <button type="button" className="rep-map-machine-popup-close" aria-label="إغلاق تفاصيل الماكينة" onClick={() => setSelectedMachine(null)}>×</button>
            <strong>{selectedMachine.machineCode} · {selectedMachine.arabicName ?? 'ماكينة'}</strong>
            <small>{selectedMachine.address || 'العنوان غير مسجل'}{selectedMachine.regionName ? ` · ${selectedMachine.regionName}` : ''}</small>
            <button type="button" className="rep-button rep-button-primary" disabled={selectedMachine.canVisit === false}
              onClick={() => onMachineSelect?.({ ...selectedMachine, regionName: selectedMachine.regionName })}>
              {selectedMachine.canVisit === false ? 'الزيارة غير متاحة حالياً' : 'ابدأ الزيارة'}
            </button>
            {googleMapsNavigationUrl(selectedMachine) && <a className="rep-map-link" href={googleMapsNavigationUrl(selectedMachine)} target="_blank" rel="noopener noreferrer">⌖ الملاحة في Google Maps</a>}
          </aside>
        )}
      </div>
      {locatedMachines.length > 0 && (
        <div className="rep-google-map-chips" role="group" aria-label="ماكينات معروضة على خريطة Google">
          {locatedMachines.map((machine) => (
            <button key={`${machine.cardId}-${machine.machineCode}`} type="button"
              className={Number(machine.machineId) === Number(focusedMachineId) ? 'active' : ''}
              onClick={() => focusMachine(machine)}>
              <b dir="ltr">{machine.machineCode}</b>
              <small>{machine.arabicName || machine.regionName || 'ماكينة'}</small>
            </button>
          ))}
        </div>
      )}
      <p className="rep-map-attribution">
        بيانات الخرائط © Google{interactive ? ' · الطبقة التفاعلية عبر Maps JavaScript API' : ' · عرض سريع مضمّن بدون طبقة تفاعلية'}
        {locatedMachines.length > 1 ? ' · اضغط على ماكينة لعرض تفاصيلها والملاحة.' : ''}
      </p>
    </section>
  );
}
