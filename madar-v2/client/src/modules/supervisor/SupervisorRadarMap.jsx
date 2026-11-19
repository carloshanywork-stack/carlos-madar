import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const STATUS = {
  active: { label: 'على المسار', color: '#10b981', bg: '#ecfdf5', text: '#065f46' },
  onsite: { label: 'في موقع صيانة', color: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
  stationary: { label: 'في الوردية · ثابت', color: '#3b82f6', bg: '#eff6ff', text: '#1e40af' },
  offline: { label: 'خارج الوردية / أوفلاين', color: '#6b7280', bg: '#f3f4f6', text: '#374151' },
};

const TILE_PRESETS = {
  satellite: {
    id: 'satellite',
    name: 'القمر الصناعي',
    icon: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19,
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  streets: {
    id: 'streets',
    name: 'خريطة الشوارع',
    icon: '🗺️',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  carto: {
    id: 'carto',
    name: 'خريطة مضيئة',
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

function createRepMarkerHtml(rep, isSelected) {
  const status = STATUS[rep.status] ?? STATUS.offline;
  const pulseClass = rep.status === 'active' ? 'radar-pulse-anim' : '';
  const selectedClass = isSelected ? 'is-selected' : '';

  return `
    <div class="radar-leaflet-rep-marker ${pulseClass} ${selectedClass}" style="--rep-color: ${status.color};">
      <div class="radar-rep-pin-body">
        <div class="radar-rep-avatar">${(rep.fullName || 'م').slice(0, 1)}</div>
        <div class="radar-rep-pill">
          <span class="rep-name">${(rep.fullName || 'مندوب').slice(0, 16)}</span>
          <span class="rep-badge" style="background: ${status.bg}; color: ${status.text};">${status.label}</span>
        </div>
      </div>
      <div class="radar-rep-pin-arrow"></div>
    </div>
  `;
}

function createStopMarkerHtml(stop, index) {
  return `
    <div class="radar-leaflet-stop-marker">
      <div class="radar-stop-pin-badge">${stop.durationMinutes || 0} د</div>
      <div class="radar-stop-pin-dot"></div>
    </div>
  `;
}

function createMachineMarkerHtml(machine) {
  const isApproved = machine.reviewStatus === 'approved';
  const badgeColor = isApproved ? '#10b981' : '#f59e0b';
  return `
    <div class="radar-leaflet-machine-marker" style="--machine-color: ${badgeColor};">
      <div class="radar-machine-icon">م</div>
      <div class="radar-machine-code">${machine.machineCode}</div>
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

  const [activeTileType, setActiveTileType] = useState('satellite'); // Default: Satellite per user approval!
  const [showLabelsOnSatellite, setShowLabelsOnSatellite] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');

  // Extract all currently valid rep locations
  const activeRepLocations = useMemo(() => {
    return representatives
      .filter((rep) => rep.lastLocation && Number.isFinite(rep.lastLocation.latitude) && Number.isFinite(rep.lastLocation.longitude))
      .map((rep) => ({
        ...rep,
        lat: Number(rep.lastLocation.latitude),
        lng: Number(rep.lastLocation.longitude),
        accuracy: Number(rep.lastLocation.accuracy) || 20,
      }));
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

  // Initialize Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center Cairo, Egypt
    const defaultCenter = [30.0444, 31.2357];
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });

    // Add zoom control in bottom-left
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Attribution control in bottom-right
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

    // Layer groups for markers, routes, and stops
    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    stopsLayerRef.current = L.layerGroup().addTo(map);
    heatmapLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Switch Base Tile Layer (Satellite vs Streets vs Carto)
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

    const preset = TILE_PRESETS[activeTileType] || TILE_PRESETS.satellite;
    const baseLayer = L.tileLayer(preset.url, {
      maxZoom: preset.maxZoom || 19,
      attribution: preset.attribution,
      subdomains: preset.subdomains || 'abc',
    });
    baseLayer.addTo(map);
    tileLayerRef.current = baseLayer;

    // Optional labels overlay for Satellite view
    if (preset.labelsUrl && showLabelsOnSatellite) {
      const labelsLayer = L.tileLayer(preset.labelsUrl, {
        maxZoom: preset.maxZoom || 19,
        pane: 'overlayPane',
      });
      labelsLayer.addTo(map);
      labelsLayerRef.current = labelsLayer;
    }
  }, [activeTileType, showLabelsOnSatellite]);

  // Fit Bounds to all representatives
  const fitAllReps = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeRepLocations.length > 0) {
      const bounds = L.latLngBounds(activeRepLocations.map((r) => [r.lat, r.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else {
      map.setView([30.0444, 31.2357], 11);
    }
  }, [activeRepLocations]);

  // Initial fit bounds when representatives first load
  useEffect(() => {
    if (isFirstFitRef.current && activeRepLocations.length > 0 && mapInstanceRef.current) {
      fitAllReps();
      isFirstFitRef.current = false;
    }
  }, [activeRepLocations, fitAllReps]);

  // Render Representative Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    activeRepLocations.forEach((rep) => {
      const isSelected = selectedId !== null && Number(rep.id) === Number(selectedId);
      const status = STATUS[rep.status] ?? STATUS.offline;

      // Accuracy Circle
      const circle = L.circle([rep.lat, rep.lng], {
        radius: Math.max(15, rep.accuracy),
        color: status.color,
        fillColor: status.color,
        fillOpacity: isSelected ? 0.22 : 0.12,
        weight: isSelected ? 2 : 1,
      });
      circle.addTo(markersLayer);

      // Custom DivIcon
      const icon = L.divIcon({
        className: 'custom-rep-div-icon',
        html: createRepMarkerHtml(rep, isSelected),
        iconSize: [120, 48],
        iconAnchor: [60, 48],
        popupAnchor: [0, -50],
      });

      const marker = L.marker([rep.lat, rep.lng], { icon, zIndexOffset: isSelected ? 1000 : 100 });

      // Rich Interactive Popup
      const googleMapsUrl = `https://www.google.com/maps?q=${rep.lat.toFixed(6)},${rep.lng.toFixed(6)}`;
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
            <div><small>آخر إشارة:</small> <b>${formatTime(rep.lastSignal)} (${timeSince(rep.lastSignal)})</b></div>
            <div><small>السرعة اللحظية:</small> <b>${formatSpeed(rep.speedKmh)}</b></div>
            <div><small>متوسط اليوم:</small> <b>${formatSpeed(rep.averageSpeedKmh)}</b></div>
            <div><small>دقة الـ GPS:</small> <b>±${Math.round(rep.accuracy)} متر</b></div>
            <div class="coords-line"><small>الإحداثيات:</small> <code dir="ltr">${rep.lat.toFixed(5)}, ${rep.lng.toFixed(5)}</code></div>
          </div>
          <div class="radar-popup-actions">
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-popup-gmaps">
              📍 فتح في Google Maps ↗
            </a>
            <button type="button" class="btn-popup-copy" onclick="window.__madar_copy_coords(${rep.lat}, ${rep.lng})">
              📋 نسخ الإحداثيات
            </button>
            <button type="button" class="btn-popup-focus" onclick="window.__madar_focus_rep(${rep.lat}, ${rep.lng})">
              🔍 تكبير الشارع
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { maxWidth: 320, className: 'radar-leaflet-popup' });

      marker.on('click', () => {
        onSelect(rep.id);
      });

      marker.addTo(markersLayer);

      // Auto-open popup if selected
      if (isSelected) {
        marker.openPopup();
      }
    });
  }, [activeRepLocations, selectedId, onSelect]);

  // Expose global callback for popup buttons safely
  useEffect(() => {
    window.__madar_copy_coords = (lat, lng) => handleCopyCoords(lat, lng);
    window.__madar_focus_rep = (lat, lng) => {
      mapInstanceRef.current?.flyTo([lat, lng], 18, { duration: 1.2 });
    };
    return () => {
      delete window.__madar_copy_coords;
      delete window.__madar_focus_rep;
    };
  }, [handleCopyCoords]);

  // Smooth FlyTo when selectedRep changes
  useEffect(() => {
    if (!selectedId || !mapInstanceRef.current) return;
    const target = activeRepLocations.find((r) => Number(r.id) === Number(selectedId));
    if (target) {
      mapInstanceRef.current.flyTo([target.lat, target.lng], 17, { duration: 1.2 });
    }
  }, [selectedId, activeRepLocations]);

  // Render Route Polyline, Stops, Visited Machines, and Heatmap
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

    // 1. Polyline of today's movement
    const polylineCoords = (selectedRoute.polyline || [])
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [Number(p.latitude), Number(p.longitude)]);

    if (polylineCoords.length > 1) {
      // Glow background line
      L.polyline(polylineCoords, {
        color: '#1d4ed8',
        weight: 8,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeLayer);

      // Main route polyline
      const routeLine = L.polyline(polylineCoords, {
        color: '#38bdf8',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      });
      routeLine.addTo(routeLayer);
    }

    // 2. Stop Points
    const stops = selectedRoute.stops || [];
    stops.forEach((stop, index) => {
      if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
      const lat = Number(stop.latitude);
      const lng = Number(stop.longitude);
      const duration = Number(stop.durationMinutes) || 0;

      // Stop Marker
      const stopIcon = L.divIcon({
        className: 'custom-stop-div-icon',
        html: createStopMarkerHtml(stop, index),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      const stopMarker = L.marker([lat, lng], { icon: stopIcon, zIndexOffset: 300 });
      stopMarker.bindTooltip(`🛑 توقف: ${duration} دقيقة<br/>من ${formatTime(stop.arrivedAt)} إلى ${formatTime(stop.departedAt)}`, {
        direction: 'top',
        className: 'radar-stop-tooltip',
      });
      stopMarker.addTo(stopsLayer);

      // Heatmap circles if enabled
      if (showHeatmap) {
        const radius = Math.min(250, Math.max(50, 40 + duration * 6));
        const heatColor = duration >= 30 ? '#ef4444' : duration >= 10 ? '#f59e0b' : '#10b981';
        L.circle([lat, lng], {
          radius,
          color: heatColor,
          fillColor: heatColor,
          fillOpacity: 0.38,
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
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const machineMarker = L.marker([lat, lng], { icon: machineIcon, zIndexOffset: 400 });
      machineMarker.bindPopup(`
        <div class="radar-machine-popup" dir="rtl">
          <strong>ماكينة ${machine.machineCode}</strong>
          <div>${machine.machineName || 'ماكينة صراف / موقع'}</div>
          <div>المنطقة: <b>${machine.regionName || '—'}</b></div>
          <div>التوقيت: <b>${formatTime(machine.capturedAt)}</b></div>
          <div>حالة الزيارة: <b>${machine.reviewStatus === 'approved' ? 'معتمدة ✓' : 'بانتظار المراجعة'}</b></div>
        </div>
      `);
      machineMarker.addTo(stopsLayer);
    });
  }, [selectedRoute, showHeatmap]);

  // Fullscreen toggle handler
  const toggleFullscreen = () => {
    if (!mapContainerRef.current) return;
    const elem = mapContainerRef.current.parentElement;
    if (!document.fullscreenElement) {
      elem?.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className={`radar-interactive-map-wrapper ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Top Controls Toolbar */}
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
          {activeTileType === 'satellite' && (
            <label className="satellite-labels-toggle" title="إظهار أسماء الشوارع والمدن على القمر الصناعي">
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
