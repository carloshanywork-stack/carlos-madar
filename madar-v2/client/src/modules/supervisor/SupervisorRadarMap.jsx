import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { smoothPolyline } from './trajectory-smoothing.js';

const STATUS = {
  active: { label: 'على المسار', color: '#10b981', bg: '#ecfdf5', text: '#065f46' },
  onsite: { label: 'في موقع صيانة', color: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
  stationary: { label: 'في الوردية · ثابت', color: '#3b82f6', bg: '#eff6ff', text: '#1e40af' },
  offline: { label: 'خارج الوردية / أوفلاين', color: '#6b7280', bg: '#f3f4f6', text: '#374151' },
};

const TILE_PRESETS = {
  localEgypt: {
    id: 'localEgypt',
    name: 'خريطة مصر من سيرفر MADAR',
    icon: '🗺️',
    url: '/api/supervisor/map/overview/{z}/{x}/{y}',
    attribution: '&copy; OpenStreetMap contributors · MADAR',
    maxZoom: 20,
    maxNativeZoom: 11,
    minNativeZoom: 5,
    bounds: [[21.5, 24.5], [32.6, 37.3]],
  },
  googleHybrid: {
    id: 'googleHybrid',
    name: 'قمر صناعي تفصيلي (Google)',
    icon: '🛰️',
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps &mdash; Satellite & Streets',
    maxZoom: 20,
    subdomains: ['0', '1', '2', '3'],
  },
  googleStreets: {
    id: 'googleStreets',
    name: 'شوارع تفصيلية (Google)',
    icon: '🗺️',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps',
    maxZoom: 20,
    subdomains: ['0', '1', '2', '3'],
  },
  satellite: {
    id: 'satellite',
    name: 'قمر صناعي (Esri)',
    icon: '🌍',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; High-Resolution Satellite',
    maxZoom: 19,
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  streets: {
    id: 'streets',
    name: 'خريطة الشوارع (OSM)',
    icon: '🌐',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  carto: {
    id: 'carto',
    name: 'خريطة مضيئة (Carto)',
    icon: '🏢',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  },
};

function formatTime(value) {
  if (!value) return 'لا توجد إشارة مسجلة';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function timeSince(dateString) {
  if (!dateString) return '';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'الآن';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

function formatSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} كم/س` : '0 كم/س';
}


/**
 * Creates high-precision HTML marker with a razor-sharp target needle and reticle
 */
function createPrecisionRepMarkerHtml(rep, isSelected, offsetIndex = 0) {
  const status = STATUS[rep.status] ?? STATUS.offline;
  const pulseClass = rep.status === 'active' ? 'radar-pulse-anim' : '';
  const selectedClass = isSelected ? 'is-selected' : '';

  // Stagger horizontally and vertically so multiple reps at the exact same location never overlap
  const lateralShift = offsetIndex === 0
    ? 0
    : offsetIndex % 2 === 1
      ? (Math.ceil(offsetIndex / 2) * 75)
      : (-Math.ceil(offsetIndex / 2) * 75);
  const verticalShift = offsetIndex * 24;

  return `
    <div class="radar-precision-rep-marker ${pulseClass} ${selectedClass}" style="--rep-color: ${status.color};">
      <!-- Target Reticle & Crosshair (Exact Coordinate Point) -->
      <div class="radar-reticle-center">
        <div class="reticle-pulse"></div>
        <div class="reticle-dot"></div>
      </div>

      <!-- Needle Pointer Stem (Connects target to badge with staggered offset) -->
      <div class="radar-needle-stem" style="transform: translate(calc(-50% + ${lateralShift}px), -${verticalShift}px);">
        <div class="needle-line" style="height: ${16 + verticalShift}px;"></div>
        <div class="radar-rep-pin-body">
          <div class="radar-rep-avatar">${(rep.fullName || 'م').slice(0, 1)}</div>
          <div class="radar-rep-pill">
            <span class="rep-name">${(rep.fullName || 'مندوب').slice(0, 16)}</span>
            <span class="rep-badge" style="background: ${status.bg}; color: ${status.text};">${status.label}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createStopMarkerHtml(stop) {
  return `
    <div class="radar-leaflet-stop-marker">
      <div class="radar-stop-pin-dot"></div>
      <div class="radar-stop-pin-badge">${stop.durationMinutes || 0} د</div>
    </div>
  `;
}

function formatMachineLabel(code) {
  if (!code) return 'ماكينة';
  if (code.length > 8) {
    return `#${code.slice(0, 6)}…`;
  }
  return code;
}

function createMachineMarkerHtml(machine) {
  const isApproved = machine.reviewStatus === 'approved';
  const badgeColor = isApproved ? '#10b981' : '#f59e0b';
  return `
    <div class="radar-leaflet-machine-marker" style="--machine-color: ${badgeColor};" title="ماكينة: ${machine.machineCode}">
      <div class="radar-machine-icon">⚙️</div>
      <div class="radar-machine-code">${formatMachineLabel(machine.machineCode)}</div>
    </div>
  `;
}

export default function SupervisorRadarMap({
  representatives = [],
  selectedId = null,
  onSelect = () => {},
  selectedRoute = null,
  showHeatmap = false,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const labelsLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const stopsLayerRef = useRef(null);
  const heatmapLayerRef = useRef(null);
  const isFirstFitRef = useRef(true);
  const addressCacheRef = useRef({});

  const [activeTileType, setActiveTileType] = useState('googleHybrid'); // Default: Google Hybrid Satellite
  const [showLabelsOnSatellite, setShowLabelsOnSatellite] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [addressLoading, setAddressLoading] = useState(false);

  // Extract all valid rep locations with spatial clustering keys
  const activeRepLocations = useMemo(() => {
    const list = representatives
      .filter((rep) => rep.lastLocation && Number.isFinite(rep.lastLocation.latitude) && Number.isFinite(rep.lastLocation.longitude))
      .map((rep) => ({
        ...rep,
        lat: Number(rep.lastLocation.latitude),
        lng: Number(rep.lastLocation.longitude),
        accuracy: Number(rep.lastLocation.accuracy) || 20,
      }));

    // Detect overlapping points (within ~15 meters) and assign offsetIndex
    const groups = new Map();
    list.forEach((item) => {
      const key = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    list.forEach((item) => {
      const key = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
      const cluster = groups.get(key) || [];
      item.clusterIndex = cluster.indexOf(item);
      item.clusterSize = cluster.length;
    });

    return list;
  }, [representatives]);

  // Copy coordinates helper
  const handleCopyCoords = useCallback((lat, lng) => {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopyFeedback(`تم نسخ الإحداثيات: ${text}`);
      window.setTimeout(() => setCopyFeedback(''), 3500);
    }).catch(() => {
      setCopyFeedback(text);
    });
  }, []);

  // Reverse geocode to get exact Arabic street and neighborhood name
  const fetchAddress = useCallback(async (lat, lng) => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (addressCacheRef.current[key]) {
      setSelectedAddress(addressCacheRef.current[key]);
      return;
    }

    setAddressLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error('Geocoding failed');
      const data = await res.json();
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.suburb || data.name || '';
      const district = addr.neighbourhood || addr.suburb || addr.city_district || '';
      const city = addr.city || addr.town || addr.state || '';
      const full = [road, district, city].filter(Boolean).join('، ');

      const resolved = {
        road: road || 'شارع بدون اسم مسجل',
        district: district || city || 'القاهرة',
        display: full || data.display_name || 'موقع محدد بالإحداثيات',
      };
      addressCacheRef.current[key] = resolved;
      setSelectedAddress(resolved);
    } catch {
      setSelectedAddress({ road: 'شارع محدد بالإحداثيات', district: '', display: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    } finally {
      setAddressLoading(false);
    }
  }, []);

  // Initialize Leaflet Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultCenter = [30.0444, 31.2357];
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 14,
      maxZoom: 20,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    stopsLayerRef.current = L.layerGroup().addTo(map);
    heatmapLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    // Invalidate size immediately and after mount/layout paint to prevent blank/white maps
    map.invalidateSize();
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(timer);
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Switch Tile Layer (Satellite vs Streets vs Carto)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (labelsLayerRef.current) {
      map.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }

    const preset = TILE_PRESETS[activeTileType] || TILE_PRESETS.googleHybrid;
    const baseLayer = L.tileLayer(preset.url, {
      maxZoom: preset.maxZoom || 20,
      attribution: preset.attribution,
      maxNativeZoom: preset.maxNativeZoom,
      minNativeZoom: preset.minNativeZoom,
      bounds: preset.bounds,
      subdomains: preset.subdomains || 'abc',
    });
    baseLayer.addTo(map);
    tileLayerRef.current = baseLayer;

    if (preset.labelsUrl && showLabelsOnSatellite) {
      const labelsLayer = L.tileLayer(preset.labelsUrl, {
        maxZoom: preset.maxZoom || 19,
        pane: 'overlayPane',
      });
      labelsLayer.addTo(map);
      labelsLayerRef.current = labelsLayer;
    }
  }, [activeTileType, showLabelsOnSatellite]);

  // Fit Bounds
  const fitAllReps = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeRepLocations.length > 0) {
      const bounds = L.latLngBounds(activeRepLocations.map((r) => [r.lat, r.lng]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    } else {
      map.setView([30.0444, 31.2357], 11);
    }
  }, [activeRepLocations]);

  useEffect(() => {
    if (isFirstFitRef.current && activeRepLocations.length > 0 && mapInstanceRef.current) {
      fitAllReps();
      isFirstFitRef.current = false;
    }
  }, [activeRepLocations, fitAllReps]);

  // Render Representative Precision Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    activeRepLocations.forEach((rep) => {
      const isSelected = selectedId !== null && Number(rep.id) === Number(selectedId);
      const status = STATUS[rep.status] ?? STATUS.offline;

      // Subtle, non-intrusive Accuracy Ring (max 25m, hairline border)
      const displayRadius = Math.min(25, Math.max(8, rep.accuracy));
      const accuracyCircle = L.circle([rep.lat, rep.lng], {
        radius: displayRadius,
        color: status.color,
        fillColor: status.color,
        fillOpacity: isSelected ? 0.08 : 0.03,
        weight: 1,
        dashArray: '3, 4',
      });
      accuracyCircle.addTo(markersLayer);

      // Precision Reticle DivIcon (Laser Needle pointing to exact pixel)
      const icon = L.divIcon({
        className: 'custom-precision-rep-icon',
        html: createPrecisionRepMarkerHtml(rep, isSelected, rep.clusterIndex),
        iconSize: [24, 24],
        iconAnchor: [12, 12], // Centered right on the crosshair dot!
        popupAnchor: [0, -38],
      });

      const marker = L.marker([rep.lat, rep.lng], { icon, zIndexOffset: isSelected ? 2000 : 200 });

      // Rich Interactive Popup
      const googleMapsUrl = `https://www.google.com/maps?q=${rep.lat.toFixed(6)},${rep.lng.toFixed(6)}`;
      const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${rep.lat.toFixed(6)},${rep.lng.toFixed(6)}`;

      const popupHtml = `
        <div class="radar-popup-content" dir="rtl">
          <div class="radar-popup-head">
            <span class="radar-popup-avatar">${(rep.fullName || 'م').slice(0, 1)}</span>
            <div>
              <strong>${rep.fullName}</strong>
              <span class="radar-popup-badge" style="background: ${status.bg}; color: ${status.text};">${status.label}</span>
            </div>
          </div>
          <div class="radar-popup-grid">
            <div class="address-row">
              <small>📍 الموقع الحالي:</small>
              <b id="popup-addr-val">${selectedAddress?.display || 'جارٍ تحديد اسم الشارع...'}</b>
            </div>
            <div><small>آخر إشارة GPS:</small> <b>${formatTime(rep.lastSignal)} (${timeSince(rep.lastSignal)})</b></div>
            <div><small>السرعة اللحظية:</small> <b>${formatSpeed(rep.speedKmh)}</b></div>
            <div><small>دقة الـ GPS:</small> <b>±${Math.round(rep.accuracy)} متر (دقة عالية)</b></div>
            <div class="coords-line"><small>الإحداثيات الدقيقة:</small> <code dir="ltr">${rep.lat.toFixed(6)}, ${rep.lng.toFixed(6)}</code></div>
          </div>
          <div class="radar-popup-actions">
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-popup-gmaps">
              🗺️ فتح الموقع على Google Maps ↗
            </a>
            <a href="${streetViewUrl}" target="_blank" rel="noopener noreferrer" class="btn-popup-streetview">
              🚶 رؤية الشارع ثلاثية الأبعاد (Street View) ↗
            </a>
            <div class="popup-sub-actions">
              <button type="button" class="btn-popup-copy" onclick="window.__madar_copy_coords(${rep.lat}, ${rep.lng})">
                📋 نسخ الإحداثيات
              </button>
              <button type="button" class="btn-popup-focus" onclick="window.__madar_focus_rep(${rep.lat}, ${rep.lng})">
                🔍 تكبير الشارع (Zoom 19)
              </button>
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { maxWidth: 340, className: 'radar-leaflet-popup' });

      marker.on('click', () => {
        onSelect(rep.id);
        fetchAddress(rep.lat, rep.lng);
      });

      marker.addTo(markersLayer);

      if (isSelected) {
        marker.openPopup();
      }
    });
  }, [activeRepLocations, selectedId, onSelect, selectedAddress, fetchAddress]);

  // Expose global callbacks
  useEffect(() => {
    window.__madar_copy_coords = (lat, lng) => handleCopyCoords(lat, lng);
    window.__madar_focus_rep = (lat, lng) => {
      mapInstanceRef.current?.flyTo([lat, lng], 19, { duration: 1.2 });
    };
    return () => {
      delete window.__madar_copy_coords;
      delete window.__madar_focus_rep;
    };
  }, [handleCopyCoords]);

  // Smooth FlyTo and fetch address on rep selection
  useEffect(() => {
    if (!selectedId || !mapInstanceRef.current) {
      setSelectedAddress(null);
      return;
    }
    const target = activeRepLocations.find((r) => Number(r.id) === Number(selectedId));
    if (target) {
      mapInstanceRef.current.flyTo([target.lat, target.lng], 18, { duration: 1.2 });
      fetchAddress(target.lat, target.lng);
    }
  }, [selectedId, activeRepLocations, fetchAddress]);

  // Render Clean Polyline (No jitter), Stops, Visited Machines, and Focused Heatmap
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    const stopsLayer = stopsLayerRef.current;
    const heatmapLayer = heatmapLayerRef.current;
    if (!map || !routeLayer || !stopsLayer || !heatmapLayer) return;

    routeLayer.clearLayers();
    stopsLayer.clearLayers();
    heatmapLayer.clearLayers();

    if (!selectedRoute) return;

    // 1. Cleaned Polyline with Jitter Filtering
    const rawCoords = selectedRoute.polyline || [];
    const cleanedCoords = smoothPolyline(rawCoords, selectedRoute.stops || [])
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [Number(p.latitude), Number(p.longitude)]);

    if (cleanedCoords.length > 1) {
      // Background glow
      L.polyline(cleanedCoords, {
        color: '#1e40af',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 2.0,
      }).addTo(routeLayer);

      // Main route polyline
      L.polyline(cleanedCoords, {
        color: '#38bdf8',
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 2.0,
      }).addTo(routeLayer);
    }

    // 2. Stop Points
    const stops = selectedRoute.stops || [];
    stops.forEach((stop) => {
      if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
      const lat = Number(stop.latitude);
      const lng = Number(stop.longitude);
      const duration = Number(stop.durationMinutes) || 0;

      const stopIcon = L.divIcon({
        className: 'custom-stop-div-icon',
        html: createStopMarkerHtml(stop),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const stopMarker = L.marker([lat, lng], { icon: stopIcon, zIndexOffset: 400 });
      stopMarker.bindTooltip(`🛑 توقف: ${duration} دقيقة<br/>من ${formatTime(stop.arrivedAt)} إلى ${formatTime(stop.departedAt)}`, {
        direction: 'top',
        className: 'radar-stop-tooltip',
      });
      stopMarker.addTo(stopsLayer);

      // Heatmap circles: Focused & subtle (max 35m, fillOpacity: 0.04 per GIS standards so streets remain clear!)
      if (showHeatmap) {
        const radius = Math.min(35, Math.max(14, 10 + duration * 0.6));
        const heatColor = duration >= 30 ? '#ef4444' : duration >= 10 ? '#f59e0b' : '#10b981';
        L.circle([lat, lng], {
          radius,
          color: heatColor,
          fillColor: heatColor,
          fillOpacity: 0.04,
          weight: 1,
        }).addTo(heatmapLayer);
      }
    });

    // 3. Visited Machines
    const visitedMachines = (selectedRoute.visitedMachines || []).filter(
      (m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude)
    );
    visitedMachines.forEach((machine) => {
      const lat = Number(machine.latitude);
      const lng = Number(machine.longitude);
      const machineIcon = L.divIcon({
        className: 'custom-machine-div-icon',
        html: createMachineMarkerHtml(machine),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const machineMarker = L.marker([lat, lng], { icon: machineIcon, zIndexOffset: 500 });
      machineMarker.bindPopup(`
        <div class="radar-machine-popup" dir="rtl">
          <strong>ماكينة ${machine.machineCode}</strong>
          <div>${machine.machineName || 'ماكينة صراف'}</div>
          <div>المنطقة: <b>${machine.regionName || '—'}</b></div>
          <div>التوقيت: <b>${formatTime(machine.capturedAt)}</b></div>
          <div>حالة الزيارة: <b>${machine.reviewStatus === 'approved' ? 'معتمدة ✓' : 'بانتظار المراجعة'}</b></div>
        </div>
      `);
      machineMarker.addTo(stopsLayer);
    });
  }, [selectedRoute, showHeatmap]);

  const toggleFullscreen = () => {
    if (!mapContainerRef.current) return;
    const elem = mapContainerRef.current.parentElement;
    if (!document.fullscreenElement) {
      elem?.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const selectedRepObj = activeRepLocations.find((r) => Number(r.id) === Number(selectedId));

  return (
    <div className={`radar-interactive-map-wrapper ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Top Floating Controls Bar */}
      <div className="radar-map-floating-bar" dir="rtl">
        {/* Layer Switcher */}
        <div className="radar-map-layer-selector">
          {Object.values(TILE_PRESETS).map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`layer-btn ${activeTileType === preset.id ? 'is-active' : ''}`}
              onClick={() => setActiveTileType(preset.id)}
              title={preset.name}
            >
              <span>{preset.icon}</span>
              <b>{preset.name}</b>
            </button>
          ))}
          {Boolean(TILE_PRESETS[activeTileType]?.labelsUrl) && (
            <label className="satellite-labels-toggle" title="إظهار أسماء الشوارع والمعالم على القمر الصناعي">
              <input
                type="checkbox"
                checked={showLabelsOnSatellite}
                onChange={(e) => setShowLabelsOnSatellite(e.target.checked)}
              />
              <span>أسماء الشوارع</span>
            </label>
          )}
        </div>

        {/* Action Tools */}
        <div className="radar-map-actions-group">
          <button
            type="button"
            className="radar-map-tool-btn"
            onClick={fitAllReps}
            title="إظهار كل المناديب وتوسيط الخريطة"
          >
            🎯 إظهار كل المناديب
          </button>
          <button
            type="button"
            className="radar-map-tool-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'إلغاء ملء الشاشة' : 'ملء الشاشة'}
          >
            {isFullscreen ? '⛶ تصغير' : '⛶ ملء الشاشة'}
          </button>
        </div>
      </div>

      {/* Prominent Address Banner (Answers 'هو واقف فين بظبط') */}
      {selectedRepObj && (
        <div className="radar-map-address-banner" dir="rtl">
          <div className="address-banner-content">
            <span className="address-pin-icon">📍</span>
            <div className="address-text-block">
              <strong>{selectedRepObj.fullName} واقف في:</strong>
              <span className="street-highlight">
                {addressLoading ? 'جارٍ تحديد الشارع بدقة من القمر الصناعي...' : (selectedAddress?.display || 'موقع محدد بالإحداثيات')}
              </span>
              <code dir="ltr" className="coords-tag">
                {selectedRepObj.lat.toFixed(6)}, {selectedRepObj.lng.toFixed(6)}
              </code>
            </div>
          </div>
          <div className="address-banner-actions">
            <a
              href={`https://www.google.com/maps?q=${selectedRepObj.lat.toFixed(6)},${selectedRepObj.lng.toFixed(6)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-banner-gmaps"
              title="عرض الموقع على Google Maps"
            >
              🗺️ خرائط Google ↗
            </a>
            <a
              href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selectedRepObj.lat.toFixed(6)},${selectedRepObj.lng.toFixed(6)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-banner-streetview"
              title="فتح رؤية الشارع البانورامية ثلاثية الأبعاد (Google Street View)"
            >
              🚶 رؤية الشارع 360° ↗
            </a>
            <button
              type="button"
              className="btn-banner-copy"
              onClick={() => handleCopyCoords(selectedRepObj.lat, selectedRepObj.lng)}
              title="نسخ الإحداثيات للحافظة"
            >
              📋 نسخ
            </button>
            <button
              type="button"
              className="btn-banner-zoom"
              onClick={() => mapInstanceRef.current?.flyTo([selectedRepObj.lat, selectedRepObj.lng], 19, { duration: 1.0 })}
              title="تكبير لأقصى دقة شارع ومبنى"
            >
              🔍 أقصى تكبير (19)
            </button>
          </div>
        </div>
      )}

      {/* Copy Feedback Toast */}
      {copyFeedback && (
        <div className="radar-map-copy-toast" role="status">
          ✓ {copyFeedback}
        </div>
      )}

      {/* Leaflet Map Div */}
      <div ref={mapContainerRef} className="radar-leaflet-container" />
    </div>
  );
}
