import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl } from '../../lib/api.js';
import { distanceBetweenGpsPointsMeters, getAdaptiveGpsInterval, GPS_POLLING } from './gps-adaptive.js';
import { googleMapsNavigationUrl } from './map-utils.js';
import {
  addPendingVisit,
  addPendingMachineAction,
  deleteGpsSamples,
  deletePendingMachineAction,
  deletePendingVisit,
  getSnapshot,
  listGpsSamples,
  listPendingVisits,
  listPendingMachineActions,
  markRouteCardSubmitted,
  requestPersistentStorage,
  saveSnapshot,
  saveGpsSample,
  updatePendingVisit,
  updatePendingMachineAction,
} from './offline-store.js';
import {
  addNativeAppStateListener,
  addNativeBackListener,
  addNativeNetworkListener,
  acknowledgeNativeDutyTracking,
  deleteNativePendingBackup,
  getNativeDutyTrackingState,
  getNativeGpsLocation,
  getNativeNetworkStatus,
  isNativeRepApp,
  restoreNativePendingBackups,
  saveNativePendingBackup,
  startNativeDutyTracking,
  stopNativeDutyTracking,
} from './native-bridges.js';
import './rep.css';

const MachineVisitSheet = lazy(() => import('./MachineVisitSheet.jsx'));
const OfflineMapPanel = lazy(() => import('./OfflineMapPanel.jsx'));

const tutorials = [
  {
    number: '01',
    icon: '▤',
    title: 'مسار اليوم بين يديك',
    body: 'ستجد الماكينات المسندة إليك مرتبة حسب المنطقة. ابحث بالكود أو الاسم، وافتح فولدر المنطقة للوصول إلى بطاقة الماكينة وعنوان العميل.',
    tip: 'حدّث المسار عند بداية الوردية لاستلام أي تكليف جديد.',
  },
  {
    number: '02',
    icon: '◉',
    title: 'صورة قبل الصيانة',
    body: 'قف على بُعد مناسب يقارب مترين، وانتبه للإضاءة والانعكاسات، ثم صوّر واجهة الماكينة كاملة بوضوح قبل بدء العمل.',
    tip: 'تأكد أن الكود والواجهة ظاهران، ويمكنك إعادة التصوير قبل الحفظ.',
  },
  {
    number: '03',
    icon: '✓',
    title: 'صورة بعد الصيانة',
    body: 'بعد الانتهاء، التقط صورة واضحة من زاوية قريبة من صورة «قبل». أضف سبب الصيانة والملاحظة التي يحتاجها المشرف.',
    tip: 'لا تُرسل الزيارة حتى تتوفر صورة قبل وصورة بعد.',
  },
  {
    number: '04',
    icon: '⌁',
    title: 'يعمل حتى دون إنترنت',
    body: 'بعد تسجيل الحضور، يحفظ تطبيق أندرويد نقاط GPS محلياً في الخلفية حتى عند انقطاع الشبكة. تُحفظ الزيارات والصور على الهاتف ثم تُزامن عند عودة الاتصال.',
    tip: 'الختم الظاهر على الصورة معلومات مساعدة من الجهاز، وليس دليلاً غير قابل للتعديل. اسمح بالموقع طوال الوقت وإشعارات التتبع.',
  },
];

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar');
}

function formatTime(value) {
  if (!value) return 'غير معروف';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(value));
  } catch {
    return value;
  }
}

function attendanceHours(record, now = Date.now()) {
  if (!record?.clock_in_time) return 0;
  const start = Date.parse(record.clock_in_time);
  const end = record.clock_out_time ? Date.parse(record.clock_out_time) : now;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 36000) / 100
    : 0;
}

const MAX_CLOCK_ACCURACY_METERS = 250;

function currentBusinessDate() {
  const date = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function formatGps(location) {
  if (!location) return 'الموقع غير متاح';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · دقة ±${Math.round(location.accuracy)}م`;
}

function machineDistance(machine, location) {
  if (!Number.isFinite(machine.latitude) || !Number.isFinite(machine.longitude) || !location) return null;
  return distanceBetweenGpsPointsMeters(location, { latitude: machine.latitude, longitude: machine.longitude });
}

function queuedPhotos(visit, phase) {
  const photos = visit?.[`${phase}Photos`];
  if (Array.isArray(photos)) return photos;
  const legacyPhoto = visit?.[`${phase}Photo`];
  return legacyPhoto ? [legacyPhoto] : [];
}

function visitSubmitted(machine) {
  return Boolean(machine.isCompleted || machine.isSubmitted);
}

function applyPendingMachineLocations(route, actions = []) {
  const pins = new Map();
  const correctionMachineIds = new Set();
  for (const action of actions) {
    if (action.type !== 'confirm_location' || action.status === 'blocked' || pins.has(Number(action.machineId))) continue;
    const location = action.payload?.location;
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) continue;
    pins.set(Number(action.machineId), location);
  }
  for (const action of actions) {
    if (action.type === 'report_correction') correctionMachineIds.add(Number(action.machineId));
  }
  if ((!pins.size && !correctionMachineIds.size) || !route?.regions) return route;
  return {
    ...route,
    regions: route.regions.map((region) => ({
      ...region,
      machines: region.machines.map((machine) => {
        const machineId = Number(machine.machineId);
        const location = pins.get(machineId);
        if (correctionMachineIds.has(machineId)) return { ...machine, correctionPending: true, canVisit: false };
        return location ? {
          ...machine,
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          isLocationLocked: true,
          geofenceRadiusMeters: 50,
          locationConfirmationPending: true,
        } : machine;
      }),
    })),
  };
}

function updateRouteMachineLocation(route, machineId, location, pending = false) {
  if (!route?.regions) return route;
  return {
    ...route,
    regions: route.regions.map((region) => ({
      ...region,
      machines: region.machines.map((machine) => Number(machine.machineId) === Number(machineId) ? {
        ...machine,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        isLocationLocked: true,
        geofenceRadiusMeters: 50,
        locationConfirmationPending: pending,
      } : machine),
    })),
  };
}

function updateRouteMachineCorrection(route, machineId) {
  if (!route?.regions) return route;
  return {
    ...route,
    regions: route.regions.map((region) => ({
      ...region,
      machines: region.machines.map((machine) => Number(machine.machineId) === Number(machineId)
        ? { ...machine, correctionPending: true, canVisit: false }
        : machine),
    })),
  };
}

function createVisitUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto.getRandomValues) crypto.getRandomValues(bytes);
  else bytes.forEach((_value, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function Tutorial({ onFinish, nativeApp }) {
  const [slide, setSlide] = useState(0);
  const current = tutorials[slide];
  const body = current.number === '04' && nativeApp
    ? 'يُحفظ المسار والزيارات على هذا الهاتف. سجّل الحضور من بطاقة البصمة واسمح بالموقع طوال الوقت لتسجيل GPS محلياً في الخلفية؛ وستتم المزامنة عند عودة اتصال الخادم.'
    : current.body;
  const tip = current.number === '04' && nativeApp
    ? 'قد يقيّد النظام التتبع بسبب إعدادات البطارية أو الشركة المصنّعة؛ تحقّق من استمرار إشعار الوردية.'
    : current.tip;
  return (
    <div className="rep-tutorial-wrap">
      <section className="rep-tutorial" dir="rtl" aria-labelledby="rep-tutorial-title">
        <header className="rep-tutorial-brand"><span className="rep-brand-mark">م</span><span><strong>مَــدَارْ</strong><small>دليل المندوب الميداني</small></span></header>
        <div className="rep-tutorial-visual" key={current.number}>
          <span className="rep-tutorial-icon" aria-hidden="true">{current.icon}</span>
          <span className="rep-tutorial-number">{current.number} / 04</span>
          <div className="rep-tutorial-lines"><i /><i /><i /></div>
        </div>
        <div className="rep-tutorial-copy" key={`copy-${current.number}`}>
          <span className="rep-eyebrow">خطوات بسيطة · عمل أسرع</span>
          <h1 id="rep-tutorial-title">{current.title}</h1>
          <p>{body}</p>
          <div className="rep-tutorial-tip"><span aria-hidden="true">✦</span>{tip}</div>
        </div>
        <div className="rep-tutorial-footer">
          <div className="rep-tutorial-dots" aria-label={`الشريحة ${slide + 1} من 4`}>
            {tutorials.map((item, index) => <span key={item.number} className={index === slide ? 'active' : ''} />)}
          </div>
          {slide === tutorials.length - 1 ? (
            <button className="rep-button rep-button-primary rep-tutorial-next" onClick={onFinish} type="button">ابدأ العمل الآن 🚀</button>
          ) : (
            <button className="rep-button rep-button-primary rep-tutorial-next" onClick={() => setSlide((value) => value + 1)} type="button">التالي <span aria-hidden="true">←</span></button>
          )}
          {slide > 0 && <button className="rep-tutorial-back" type="button" onClick={() => setSlide((value) => value - 1)}>السابق</button>}
        </div>
      </section>
    </div>
  );
}

export default function RepApp({ user, offlineOnly = false, onLogout }) {
  const [route, setRoute] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [attendanceLoaded, setAttendanceLoaded] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [reasons, setReasons] = useState([]);
  const [pendingVisits, setPendingVisits] = useState([]);
  const [pendingMachineActions, setPendingMachineActions] = useState([]);
  const [query, setQuery] = useState('');
  const [routeFilter, setRouteFilter] = useState('all');
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [serverState, setServerState] = useState('checking');
  const [routeLoading, setRouteLoading] = useState(false);
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [onDuty, setOnDuty] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showOfflineMap, setShowOfflineMap] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState(null);
  const [toast, setToast] = useState('');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [storagePersistent, setStoragePersistent] = useState(null);
  const [storageError, setStorageError] = useState('');
  const syncingRef = useRef(false);
  const trackingSyncingRef = useRef(false);
  const gpsRef = useRef(null);
  const routeRef = useRef(null);
  const pendingMachineActionsRef = useRef([]);
  const seenReviewNoticesRef = useRef(new Set());
  const nativeBackStateRef = useRef({});
  const userId = Number(user.id);
  const nativeApp = isNativeRepApp();
  routeRef.current = route;

  useEffect(() => {
    if (!attendance?.clock_in_time || attendance.clock_out_time) return undefined;
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(timer);
  }, [attendance?.clock_in_time, attendance?.clock_out_time]);

  const refreshPending = useCallback(async () => {
    const [visits, actions] = await Promise.all([
      listPendingVisits(userId),
      listPendingMachineActions(userId),
    ]);
    pendingMachineActionsRef.current = actions;
    setPendingMachineActions(actions);
    setPendingVisits(visits);
    return { visits, actions };
  }, [userId]);

  const syncTracking = useCallback(async (options = {}) => {
    const duty = options.duty ?? onDuty;
    const hasLocationOverride = Object.hasOwn(options, 'location');
    if (offlineOnly || !navigator.onLine) return false;
    if (trackingSyncingRef.current) return false;
    trackingSyncingRef.current = true;
    try {
      const state = nativeApp ? await getNativeDutyTrackingState() : null;
      const mocked = Boolean(state?.mocked);
      const nativeLocation = state?.lastLocation && !mocked ? {
        latitude: state.lastLocation.latitude,
        longitude: state.lastLocation.longitude,
        accuracy: state.lastLocation.accuracy,
        speed: state.lastLocation.speed ?? 0,
        updatedAt: new Date(state.lastLocation.timestamp).toISOString(),
      } : null;
      const location = mocked
        ? null
        : hasLocationOverride ? options.location : duty ? nativeLocation ?? gpsRef.current : null;
      const browserSamples = nativeApp ? [] : await listGpsSamples(userId);
      const sourceTrail = nativeApp
        ? (state?.trail ?? [])
        : browserSamples.map((sample) => ({ ...sample.location, sampleId: sample.sampleId }));
      const trail = sourceTrail.filter((point) => !point.mocked
        && Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
          speed: point.speed ?? 0,
          updatedAt: point.updatedAt ?? new Date(point.timestamp).toISOString(),
          sampleId: point.sampleId,
          trackId: point.trackId,
        }));
      const chunks = [];
      for (let index = 0; index < trail.length; index += 450) chunks.push(trail.slice(index, index + 450));
      const closeAfterFlush = !duty || options.stop === true;
      for (const [index, chunk] of chunks.entries()) {
        const syncChunk = chunk.map(({ sampleId: _sampleId, trackId: _trackId, ...point }) => point);
        const response = await api.post('/api/rep/location-ping', {
          onDuty: true,
          location: !closeAfterFlush && index === chunks.length - 1 ? location : null,
          trail: syncChunk,
        }, { timeoutMs: 4000 });
        if (!response?.success) return false;
        if (chunk.length) await deleteGpsSamples(chunk.map((point) => point.sampleId).filter(Boolean));
        if (nativeApp && chunk.length) {
          const throughId = Number(chunk.at(-1).trackId);
          if (Number.isSafeInteger(throughId) && throughId > 0) await acknowledgeNativeDutyTracking(throughId);
        }
      }
      if (closeAfterFlush || !chunks.length) {
        const response = await api.post('/api/rep/location-ping', {
          onDuty: closeAfterFlush ? false : Boolean(duty) && !mocked,
          location,
          trail: [],
        }, { timeoutMs: 4000 });
        return Boolean(response?.success);
      }
      return true;
    } catch {
      // Browser/Android GPS queues remain on-device until the server acknowledges them.
      return false;
    } finally {
      trackingSyncingRef.current = false;
    }
  }, [nativeApp, offlineOnly, onDuty, userId]);

  const captureVisitLocation = useCallback(async () => {
    try {
      let location;
      if (nativeApp) {
        location = await getNativeGpsLocation();
      } else if (navigator.geolocation) {
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 12000,
        }));
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed ?? 0,
          updatedAt: new Date(position.timestamp).toISOString(),
        };
      } else {
        location = gpsRef.current;
      }
      const timestamp = Date.parse(location?.updatedAt ?? '');
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
          || !Number.isFinite(location.accuracy) || location.accuracy > MAX_CLOCK_ACCURACY_METERS
          || !Number.isFinite(timestamp) || Date.now() - timestamp > 5 * 60 * 1000 || timestamp - Date.now() > 60 * 1000) {
        throw new Error('تعذر الحصول على موقع حديث بدقة مناسبة؛ فعّل GPS وانتقل إلى مكان مفتوح ثم حاول مجدداً.');
      }
      setGps(location);
      setGpsError('');
      return location;
    } catch (error) {
      setGpsError(error.message || 'تعذر تحديث GPS عند حفظ الزيارة.');
      return null;
    }
  }, [nativeApp]);

  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);

  const loadLocalSnapshots = useCallback(async () => {
    try {
      const recoveredCount = await restoreNativePendingBackups(userId);
      const [savedRoute, savedReasons, visits, actions, savedAttendance] = await Promise.all([
        getSnapshot('route_snapshots', userId),
        getSnapshot('reason_snapshots', userId),
        listPendingVisits(userId),
        listPendingMachineActions(userId),
        getSnapshot('attendance_snapshots', userId),
      ]);
      pendingMachineActionsRef.current = actions;
      setPendingMachineActions(actions);
      if (savedRoute?.route) setRoute(applyPendingMachineLocations({ ...savedRoute.route, cachedAt: savedRoute.cachedAt }, actions));
      if (savedReasons?.reasons) setReasons(savedReasons.reasons);
      if (savedAttendance?.date === currentBusinessDate()) {
        const cachedAttendance = savedAttendance.attendance ?? null;
        setAttendance(cachedAttendance);
        setOnDuty(Boolean(cachedAttendance?.clock_in_time && !cachedAttendance.clock_out_time));
        setAttendanceLoaded(true);
      }
      setPendingVisits(visits);
      if (recoveredCount) setToast(`استُعيدت ${recoveredCount} زيارة من نسخة الهاتف الاحتياطية.`);
      setStorageError('');
    } catch (error) {
      setStorageError(error.message || 'لا يمكن استخدام قاعدة البيانات المحلية لهذا المتصفح.');
    }
  }, [userId]);

  const refreshData = useCallback(async () => {
    if (offlineOnly || !navigator.onLine) return;
    setRouteLoading(true);
    const params = new URLSearchParams({ username: user.username });
    const [routeResult, reasonsResult] = await Promise.allSettled([
          api.get(`/api/rep/today-route?${params.toString()}`, { timeoutMs: 4000 }),
          api.get('/api/rep/fault-reasons', { timeoutMs: 4000 }),
    ]);
    if (routeResult.status === 'fulfilled' && routeResult.value?.success) {
      const cachedRoute = applyPendingMachineLocations(
        { ...routeResult.value, cachedAt: new Date().toISOString() },
        pendingMachineActionsRef.current,
      );
      setRoute(cachedRoute);
      for (const machine of (cachedRoute.regions ?? []).flatMap((region) => region.machines ?? [])) {
        if (machine.reviewStatus !== 'reshoot' || !machine.reviewNote) continue;
        const key = `${machine.cardId}:${machine.reviewNote}`;
        if (seenReviewNoticesRef.current.has(key)) continue;
        seenReviewNoticesRef.current.add(key);
        setToast(`طلب المشرف إعادة تصوير ماكينة ${machine.machineCode}: ${machine.reviewNote}`);
      }
      try {
        await saveSnapshot('route_snapshots', userId, { route: cachedRoute, cachedAt: cachedRoute.cachedAt });
      } catch (error) {
        setStorageError(error.message || 'تعذر حفظ نسخة المسار محلياً.');
      }
    } else if (routeResult.status === 'rejected' && routeResult.reason?.status === 401) {
      setServerState('offline');
      window.dispatchEvent(new Event('madar-auth-expired'));
    }
    if (reasonsResult.status === 'fulfilled' && Array.isArray(reasonsResult.value?.reasons)) {
      setReasons(reasonsResult.value.reasons);
      try {
        await saveSnapshot('reason_snapshots', userId, { reasons: reasonsResult.value.reasons, cachedAt: new Date().toISOString() });
      } catch (error) {
        setStorageError(error.message || 'تعذر حفظ أسباب الصيانة محلياً.');
      }
    }
    if (routeResult.status === 'rejected' && reasonsResult.status === 'rejected') {
      await loadLocalSnapshots();
    }
    setRouteLoading(false);
  }, [loadLocalSnapshots, offlineOnly, user.username, userId]);

  const refreshAttendance = useCallback(async () => {
    if (offlineOnly || !navigator.onLine) return null;
    try {
      const result = await api.get('/api/rep/attendance/today', { timeoutMs: 4000 });
      if (result?.success) {
        const currentAttendance = result.attendance ?? null;
        setAttendance(currentAttendance);
        setOnDuty(Boolean(currentAttendance?.clock_in_time && !currentAttendance.clock_out_time));
        setAttendanceLoaded(true);
        try {
          await saveSnapshot('attendance_snapshots', userId, {
            date: result.date,
            attendance: result.attendance ?? null,
            cachedAt: new Date().toISOString(),
          });
        } catch {
          // The live attendance response remains available for this session.
        }
      }
      return result;
    } catch (error) {
      if (error.status === 401) window.dispatchEvent(new Event('madar-auth-expired'));
      return null;
    }
  }, [offlineOnly, userId]);

  const clockAttendance = useCallback(async (action) => {
    if (offlineOnly || !navigator.onLine || serverState !== 'online') {
      setToast('يلزم الاتصال بالخادم لتسجيل الحضور أو الانصراف.');
      return;
    }
    setAttendanceSaving(true);
    let nativeTrackingStarted = false;
    try {
      const location = await captureVisitLocation();
      if (!location) throw new Error('يلزم تفعيل GPS لتسجيل الحضور أو الانصراف.');
      if (action === 'in' && nativeApp) {
        await startNativeDutyTracking();
        nativeTrackingStarted = true;
      }
      const result = await api.post(`/api/rep/attendance/clock-${action}`, { location }, { timeoutMs: 4000 });
      const currentAttendance = result.attendance ?? null;
      setAttendance(currentAttendance);
      setOnDuty(action === 'in');
      setAttendanceLoaded(true);
      try {
        await saveSnapshot('attendance_snapshots', userId, {
          date: currentAttendance?.work_date,
          attendance: currentAttendance,
          lastLocation: location,
          cachedAt: new Date().toISOString(),
        });
      } catch {
        // The server has already committed the attendance event.
      }
      let trackingSaved = true;
      if (action === 'in') {
        trackingSaved = await syncTracking({ duty: true, location });
      } else {
        trackingSaved = await syncTracking({ duty: false, stop: true, location });
        if (nativeApp) await stopNativeDutyTracking().catch(() => undefined);
      }
      setToast(action === 'in'
        ? trackingSaved ? 'تم تسجيل الحضور وبدأ حفظ خط السير.' : 'تم تسجيل الحضور؛ سيُرسل خط السير المحلي عند عودة الاتصال.'
        : trackingSaved ? 'تم تسجيل الانصراف ومزامنة آخر نقاط المسار.' : 'تم تسجيل الانصراف؛ بقيت نقاط GPS محفوظة محلياً للمزامنة.');
      void refreshAttendance();
    } catch (error) {
      if (action === 'in' && nativeTrackingStarted) await stopNativeDutyTracking().catch(() => undefined);
      setToast(error.message || 'تعذر تسجيل الحضور. حاول مرة أخرى.');
    } finally {
      setAttendanceSaving(false);
    }
  }, [captureVisitLocation, nativeApp, offlineOnly, refreshAttendance, serverState, syncTracking, userId]);

  const checkServer = useCallback(async () => {
    const online = navigator.onLine;
    setNetworkOnline(online);
    if (!online) {
      setServerState('offline');
      return false;
    }
    setServerState('checking');
    try {
      await api.get('/api/health', { timeoutMs: 4000 });
      setServerState('online');
      return true;
    } catch {
      setServerState('offline');
      return false;
    }
  }, []);

  useEffect(() => {
    void loadLocalSnapshots();
    void refreshData();
    void refreshAttendance();
    void requestPersistentStorage().then(setStoragePersistent);
  }, [loadLocalSnapshots, refreshAttendance, refreshData]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const reachable = await checkServer();
      if (!active || !reachable) return;
      await refreshData();
      await refreshAttendance();
      void syncTracking();
    };
    const onOnline = () => { setNetworkOnline(true); void check(); };
    const onOffline = () => { setNetworkOnline(false); setServerState('offline'); };
    void check();
    const interval = window.setInterval(check, 25000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [checkServer, refreshAttendance, refreshData, syncTracking]);

  useEffect(() => {
    // Standalone Android uses CapacitorHttp for credentialed API calls. Its native
    // transport does not proxy EventSource, and periodic refresh already covers it.
    if (offlineOnly || serverState !== 'online' || (nativeApp && apiUrl('/api').startsWith('https://'))) return undefined;
    const events = new EventSource(apiUrl('/api/rep/events'), { withCredentials: true });
    const onOperationsEvent = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.type === 'maintenance.order.assigned') {
          const areas = Array.isArray(event.areas) ? event.areas.filter(Boolean) : [];
          const assigned = !Array.isArray(event.assignedUserIds) || event.assignedUserIds.map(Number).includes(userId);
          const previouslyAssigned = Array.isArray(event.previousUserIds)
            && event.previousUserIds.map(Number).includes(userId);
          setAssignmentNotice({ orderCode: event.orderCode, areas, assigned, previouslyAssigned });
          setToast(!assigned
            ? `لم يعد أمر التشغيل ${event.orderCode} مسنداً إليك.`
            : previouslyAssigned
              ? `تم تحديث تكليف أمر التشغيل ${event.orderCode}.`
              : `أُسند إليك أمر تشغيل ${event.orderCode}${areas.length ? ` لمنطقة ${areas.join('، ')}` : ''}.`);
          void refreshData();
        } else if (event.type === 'rep.visit.reviewed') {
          setToast(event.status === 'approved' ? 'اعتمد المشرف آخر زيارة ميدانية.' : 'طلب المشرف إعادة تصوير الزيارة.');
          void refreshData();
        } else if (event.type === 'attendance.changed') {
          void refreshAttendance();
        }
      } catch {
        // Ignore malformed frames; the regular route refresh remains a fallback.
      }
    };
    events.addEventListener('operations', onOperationsEvent);
    return () => {
      events.removeEventListener('operations', onOperationsEvent);
      events.close();
    };
  }, [nativeApp, offlineOnly, refreshAttendance, refreshData, serverState]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    let networkHandle;
    const initializeNetworkListener = async () => {
      try {
        const status = await getNativeNetworkStatus();
        if (active && status) setNetworkOnline(Boolean(status.connected));
        networkHandle = await addNativeNetworkListener((statusChange) => {
          setNetworkOnline(Boolean(statusChange.connected));
          if (!statusChange.connected) {
            setServerState('offline');
            return;
          }
          void checkServer().then((reachable) => {
            if (reachable) { void refreshData(); void refreshAttendance(); void syncTracking(); }
          });
        });
        if (!active) await networkHandle?.remove();
      } catch {
        // Browser online/offline events remain the fallback on older Android WebViews.
      }
    };
    void initializeNetworkListener();
    return () => {
      active = false;
      void networkHandle?.remove();
    };
  }, [checkServer, nativeApp, refreshAttendance, refreshData, syncTracking]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    return () => {
      // Stop tracking when this representative session is torn down (logout or auth expiry).
      void stopNativeDutyTracking().catch(() => undefined);
    };
  }, [nativeApp]);

  useEffect(() => {
    try {
      setTutorialOpen(window.localStorage.getItem(`tutorial_seen:${userId}`) !== '1');
    } catch {
      setTutorialOpen(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    void getNativeDutyTrackingState().then((state) => {
      if (!active) return;
      if (state.lastLocation && !state.mocked) {
        setGps({
          latitude: state.lastLocation.latitude,
          longitude: state.lastLocation.longitude,
          accuracy: state.lastLocation.accuracy,
          updatedAt: new Date(state.lastLocation.timestamp).toISOString(),
        });
      }
      if (state.active && state.gpsEnabled === false) setGpsError('فعّل GPS بالأقمار الصناعية لاستئناف تتبع الوردية.');
      if (state.mocked) {
        setGps(null);
        setOnDuty(false);
        setGpsError('تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.');
        setToast('تم إيقاف تتبع الوردية بعد رصد موقع مزيف.');
        void syncTracking({ duty: false, location: null });
        return;
      }
      if (!attendanceLoaded) {
        setOnDuty(Boolean(state.active));
        if (state.active) void syncTracking({ duty: true });
        return;
      }
      const attendanceIsOpen = Boolean(attendance?.clock_in_time && !attendance.clock_out_time);
      setOnDuty(attendanceIsOpen);
      if (attendanceIsOpen) {
        if (state.active) void syncTracking({ duty: true });
        else {
          void startNativeDutyTracking().then(() => syncTracking({ duty: true }))
            .catch((error) => setGpsError(error.message || 'تعذر استئناف GPS في الخلفية.'));
        }
      } else if (state.active) {
        void syncTracking({ duty: false, stop: true }).finally(() => stopNativeDutyTracking().catch(() => undefined));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [attendance?.clock_in_time, attendance?.clock_out_time, attendanceLoaded, nativeApp, syncTracking]);

  useEffect(() => {
    nativeBackStateRef.current = { selectedMachine, showQueue, tutorialOpen };
  }, [selectedMachine, showQueue, tutorialOpen]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    let backHandle;
    void addNativeBackListener(() => {
      const current = nativeBackStateRef.current;
      if (current.tutorialOpen) {
        try { window.localStorage.setItem(`tutorial_seen:${userId}`, '1'); } catch { /* Continue without persisting the tutorial state. */ }
        setTutorialOpen(false);
      } else if (current.selectedMachine) {
        setSelectedMachine(null);
      } else if (current.showQueue) {
        setShowQueue(false);
      } else {
        setToast('لن يُغلق التطبيق بزر الرجوع؛ استخدم زر الخروج عند الانتهاء من الوردية.');
      }
    }).then((handle) => {
      if (active) backHandle = handle;
      else void handle.remove();
    }).catch(() => undefined);
    return () => {
      active = false;
      void backHandle?.remove();
    };
  }, [nativeApp, userId]);

  useEffect(() => {
    if (!onDuty && !selectedMachine) {
      setGpsError('فعّل الوردية أو افتح زيارة لتحديث GPS.');
      return undefined;
    }
    if (nativeApp) {
      let active = true;
      let timer;
      let stationarySince = null;
      let previousLocation = null;
      let nextIntervalMs = GPS_POLLING.movingIntervalMs;
      const readNativePosition = async () => {
        try {
          let location;
          if (onDuty) {
            const state = await getNativeDutyTrackingState();
            if (state.mocked) throw new Error('تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.');
            const lastLocation = state.lastLocation;
            if (lastLocation) {
              const timestamp = Number(lastLocation.timestamp);
              location = {
                latitude: lastLocation.latitude,
                longitude: lastLocation.longitude,
                accuracy: lastLocation.accuracy,
                speed: lastLocation.speed ?? 0,
                updatedAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
              };
            }
          }
          location ??= await getNativeGpsLocation();
          if (!active) return;
          const displacementMeters = distanceBetweenGpsPointsMeters(previousLocation, location);
          const speedMetersPerSecond = Number(location.speed) || 0;
          const moving = speedMetersPerSecond >= GPS_POLLING.movementSpeedMetersPerSecond
            || displacementMeters > GPS_POLLING.movementDistanceMeters;
          if (moving) stationarySince = null;
          else if (stationarySince === null) stationarySince = Date.now();
          const stationaryDurationMs = stationarySince === null ? 0 : Date.now() - stationarySince;
          nextIntervalMs = getAdaptiveGpsInterval({ speedMetersPerSecond, displacementMeters, stationaryDurationMs });
          previousLocation = location;
          setGps(location);
          setGpsError('');
          if (onDuty) void syncTracking({ duty: true, location });
        } catch (error) {
          if (!active) return;
          stationarySince = null;
          setGpsError(error.message || 'إشارة GPS غير متاحة حالياً.');
          if (/تزييف الموقع/.test(error.message ?? '')) {
            setGps(null);
            setOnDuty(false);
            void syncTracking({ duty: false, location: null });
          }
          nextIntervalMs = GPS_POLLING.movingIntervalMs;
        } finally {
          if (active) timer = window.setTimeout(readNativePosition, nextIntervalMs);
        }
      };
      void readNativePosition();
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    if (!navigator.geolocation) {
      setGpsError('هذا المتصفح لا يدعم تحديد الموقع.');
      return undefined;
    }
    setGpsError('جارٍ طلب إشارة GPS...');
    let active = true;
    let timer;
    let stationarySince = null;
    let previousLocation = null;
    let nextIntervalMs = GPS_POLLING.movingIntervalMs;
    const readPosition = () => new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      });
    });
    const pollPosition = async () => {
      try {
        const position = await readPosition();
        if (!active) return;
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed ?? 0,
          updatedAt: new Date(position.timestamp).toISOString(),
        };
        const displacementMeters = distanceBetweenGpsPointsMeters(previousLocation, location);
        const speedMetersPerSecond = Number(location.speed) || 0;
        const moving = speedMetersPerSecond >= GPS_POLLING.movementSpeedMetersPerSecond
          || displacementMeters > GPS_POLLING.movementDistanceMeters;
        if (moving) stationarySince = null;
        else if (stationarySince === null) stationarySince = Date.now();
        const stationaryDurationMs = stationarySince === null ? 0 : Date.now() - stationarySince;
        nextIntervalMs = getAdaptiveGpsInterval({ speedMetersPerSecond, displacementMeters, stationaryDurationMs });
        previousLocation = location;
        setGps(location);
        setGpsError('');
        if (onDuty) {
          try { await saveGpsSample(userId, location); }
          catch (error) { setStorageError(error.message || 'تعذر حفظ نقطة GPS محلياً.'); }
          void syncTracking({ duty: true, location });
        }
      } catch (error) {
        if (!active) return;
        stationarySince = null;
        const messages = {
          1: 'اسمح للتطبيق باستخدام الموقع من إعدادات الهاتف.',
          2: 'تعذر تحديد الموقع حالياً؛ يمكنك حفظ الزيارة بدونه.',
          3: 'انتهت مهلة تحديد الموقع؛ سنحاول مجدداً.',
        };
        setGpsError(messages[error.code] || 'إشارة GPS غير متاحة حالياً.');
        nextIntervalMs = GPS_POLLING.movingIntervalMs;
      } finally {
        if (active) timer = window.setTimeout(pollPosition, nextIntervalMs);
      }
    };
    void pollPosition();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [nativeApp, onDuty, selectedMachine, syncTracking]);

  const drainQueue = useCallback(async () => {
    if (syncingRef.current || offlineOnly || !navigator.onLine || serverState !== 'online') return;
    syncingRef.current = true;
    let changedServer = false;
    try {
      const actions = await listPendingMachineActions(userId);
      const pausedCardIds = new Set();
      const pausedMachineIds = new Set();
      let canDrainVisits = true;
      for (const action of actions) {
        if (Number(action.repId) !== userId) continue;
        const cardId = Number(action.payload?.cardId);
        if (action.status === 'blocked') {
          if (Number.isSafeInteger(cardId) && cardId > 0) pausedCardIds.add(cardId);
          if (action.type === 'report_correction') pausedMachineIds.add(Number(action.machineId));
          continue;
        }
        if (action.type === 'report_correction' && Number.isSafeInteger(cardId) && cardId > 0) {
          pausedCardIds.add(cardId);
        }
        if (action.type === 'report_correction') pausedMachineIds.add(Number(action.machineId));
        if (!['confirm_location', 'report_correction'].includes(action.type)) {
          await updatePendingMachineAction(action.actionUuid, {
            status: 'blocked',
            lastError: 'نوع إجراء غير معروف. تواصل مع مسؤول النظام قبل حذف بيانات التطبيق.',
          });
          if (Number.isSafeInteger(cardId) && cardId > 0) pausedCardIds.add(cardId);
          continue;
        }
        await updatePendingMachineAction(action.actionUuid, { status: 'syncing', lastAttemptAt: new Date().toISOString() });
        try {
          let result;
          if (action.type === 'confirm_location') {
            result = await api.post(
              `/api/rep/machines/${encodeURIComponent(action.machineId)}/confirm-location`,
              action.payload,
              { timeoutMs: 12000 },
            );
            if (result?.machine) {
              setRoute((current) => {
                const updated = updateRouteMachineLocation(current, action.machineId, {
                  latitude: result.machine.latitude,
                  longitude: result.machine.longitude,
                }, false);
                void saveSnapshot('route_snapshots', userId, {
                  route: updated,
                  cachedAt: new Date().toISOString(),
                }).catch(() => undefined);
                return updated;
              });
            }
          } else {
            const formData = new FormData();
            formData.append('correction', JSON.stringify(action.payload));
            if (action.evidence) {
              formData.append('evidence', action.evidence, action.evidence.name || `${action.actionUuid}.jpg`);
            }
            result = await api.upload(
              `/api/rep/machines/${encodeURIComponent(action.machineId)}/corrections`,
              formData,
              { timeoutMs: 30000 },
            );
            setRoute((current) => updateRouteMachineCorrection(current, action.machineId));
            setToast(`أُرسل بلاغ اختلاف الماكينة ${action.payload.reportedCode} للإدارة؛ حُفظ سجل الماكينة والصور السابقة دون تغيير.`);
            if (Number.isSafeInteger(cardId) && cardId > 0) pausedCardIds.add(cardId);
          }
          if (!result?.success) throw new Error('لم يؤكد الخادم حفظ إجراء الماكينة.');
          await deletePendingMachineAction(action.actionUuid);
          changedServer = true;
        } catch (error) {
          const permanentClientError = error.status >= 400 && error.status < 500
            && ![408, 425, 429].includes(error.status);
          await updatePendingMachineAction(action.actionUuid, {
            status: permanentClientError ? 'blocked' : 'queued',
            attempts: Number(action.attempts ?? 0) + 1,
            lastError: permanentClientError
              ? `${error.message || 'رفض الخادم إجراء الماكينة.'} راجع المسار أو تواصل مع الإدارة قبل إعادة المحاولة.`
              : error.message || 'تعذرت المزامنة؛ سيظل الإجراء محفوظاً على الهاتف.',
          });
          if (permanentClientError && Number.isSafeInteger(cardId) && cardId > 0) pausedCardIds.add(cardId);
          if (!permanentClientError) {
            canDrainVisits = false;
            if (error.status === 401) {
              setServerState('offline');
              window.dispatchEvent(new Event('madar-auth-expired'));
            }
            break;
          }
        }
      }

      for (const region of routeRef.current?.regions ?? []) {
        for (const machine of region.machines ?? []) {
          if (pausedMachineIds.has(Number(machine.machineId)) && Number.isSafeInteger(Number(machine.cardId))) {
            pausedCardIds.add(Number(machine.cardId));
          }
        }
      }

      const visits = await listPendingVisits(userId);
      setPendingVisits(visits);
      for (const queuedVisit of (canDrainVisits ? visits : [])) {
        // Never send a visit queued by another representative, even after an account switch.
        if (Number(queuedVisit.repId) !== userId || queuedVisit.status === 'blocked') continue;
        if (pausedCardIds.has(Number(queuedVisit.payload.cardId))) continue;
        await updatePendingVisit(queuedVisit.visitUuid, { status: 'syncing', lastAttemptAt: new Date().toISOString() });
        const formData = new FormData();
        formData.append('visit', JSON.stringify(queuedVisit.payload));
        for (const [phase, photos] of [
          ['before', queuedPhotos(queuedVisit, 'before')],
          ['after', queuedPhotos(queuedVisit, 'after')],
        ]) {
          photos.forEach((photo, index) => {
             formData.append(`${phase}Photo`, photo, `${phase}_${index}.jpg`);
          });
        }
        try {
          const result = await api.upload('/api/rep/sync-visit', formData, { timeoutMs: 60_000 });
          if (result?.success && ['pending_review', 'approved', 'reshoot_requested'].includes(result.status)) {
            await deletePendingVisit(queuedVisit.visitUuid);
            await deleteNativePendingBackup(queuedVisit.visitUuid).catch((error) => {
              setStorageError(`اكتملت المزامنة، لكن تعذر حذف النسخة المحلية من ملفات الهاتف: ${error.message}`);
            });
            await markRouteCardSubmitted(userId, queuedVisit.payload.cardId, result.status);
            setRoute((current) => {
              if (!current?.regions) return current;
              const regions = current.regions.map((region) => ({
                ...region,
                machines: region.machines.map((machine) => Number(machine.cardId) === Number(queuedVisit.payload.cardId)
                  ? {
                    ...machine,
                    isCompleted: result.status === 'approved',
                    isSubmitted: result.status !== 'reshoot_requested',
                    reviewStatus: result.status === 'approved' ? 'approved' : result.status === 'reshoot_requested' ? 'reshoot' : 'pending',
                    canVisit: result.status === 'reshoot_requested',
                  }
                  : machine),
              }));
              const machines = regions.flatMap((region) => region.machines);
              const completed = machines.filter((machine) => machine.isCompleted).length;
              return {
                ...current,
                regions,
                summary: {
                  totalMachines: machines.length,
                    completed,
                    pending: machines.length - completed,
                    pendingReview: machines.filter((machine) => machine.isSubmitted && !machine.isCompleted).length,
                    progress: machines.length ? Math.floor((completed / machines.length) * 100) : 0,
                },
              };
            });
            changedServer = true;
            setToast(result.status === 'approved'
              ? `اعتمد المشرف زيارة الماكينة ${queuedVisit.payload.machineCode}.`
              : `رُفعت زيارة الماكينة ${queuedVisit.payload.machineCode} وبانتظار مراجعة المشرف.`);
            continue;
          }
          await updatePendingVisit(queuedVisit.visitUuid, {
            status: 'queued',
            lastError: 'الخادم ما زال يعالج الزيارة؛ ستتم إعادة المحاولة تلقائياً.',
          });
          break;
        } catch (error) {
          const permanentClientError = error.status >= 400 && error.status < 500
            && ![408, 425, 429].includes(error.status);
          await updatePendingVisit(queuedVisit.visitUuid, {
            status: permanentClientError ? 'blocked' : 'queued',
            attempts: Number(queuedVisit.attempts ?? 0) + 1,
            lastError: permanentClientError
              ? `${error.message || 'رفض الخادم الزيارة.'} راجع المسار أو تواصل مع المشرف ثم أعد المحاولة.`
              : error.message || 'تعذرت المزامنة؛ ستظل الزيارة محفوظة على الهاتف.',
          });
          if (error.status === 401) setServerState('offline');
          if (error.status === 401) window.dispatchEvent(new Event('madar-auth-expired'));
          break;
        }
      }
    } catch (error) {
      setStorageError(error.message || 'تعذر قراءة قائمة المزامنة المحلية.');
    } finally {
      syncingRef.current = false;
      try { await refreshPending(); } catch { /* Keep the previous queue count visible. */ }
      if (changedServer) void refreshData();
    }
  }, [offlineOnly, refreshData, refreshPending, serverState, userId]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    let appStateHandle;
    void addNativeAppStateListener(({ isActive }) => {
      if (!isActive) return;
      void getNativeDutyTrackingState().then((state) => {
        setOnDuty(Boolean(state.active));
        void syncTracking({ duty: Boolean(state.active) });
        if (state.mocked) {
          setGps(null);
          setOnDuty(false);
          setGpsError('تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.');
          setToast('تم إيقاف تتبع الوردية بعد رصد موقع مزيف.');
          void syncTracking({ duty: false, location: null });
        } else if (state.active && state.gpsEnabled === false) {
          setGpsError('فعّل GPS بالأقمار الصناعية لاستئناف تتبع الوردية.');
        }
      }).catch(() => undefined);
      void checkServer().then((reachable) => {
        if (reachable) {
          void refreshData();
          void refreshAttendance();
          void drainQueue();
        }
      });
    }).then((handle) => {
      if (active) appStateHandle = handle;
      else void handle.remove();
    }).catch(() => undefined);
    return () => {
      active = false;
      void appStateHandle?.remove();
    };
  }, [checkServer, drainQueue, nativeApp, refreshAttendance, refreshData, syncTracking]);

  useEffect(() => {
    if ((pendingVisits.length || pendingMachineActions.length) && serverState === 'online' && !offlineOnly) void drainQueue();
  }, [drainQueue, offlineOnly, pendingMachineActions.length, pendingVisits.length, serverState]);

  useEffect(() => {
    if ((!pendingVisits.length && !pendingMachineActions.length) || offlineOnly) return undefined;
    const timer = window.setInterval(() => void drainQueue(), 30000);
    return () => window.clearInterval(timer);
  }, [drainQueue, offlineOnly, pendingMachineActions.length, pendingVisits.length]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summary = route?.summary ?? { totalMachines: 0, completed: 0, pending: 0, pendingReview: 0, progress: 0 };
  const filteredRegions = useMemo(() => {
    const term = normalize(query);
    return (route?.regions ?? []).map((region) => ({
      ...region,
      machines: region.machines.filter((machine) => {
        const matchesTerm = !term
          || normalize(machine.machineCode).includes(term)
          || normalize(machine.arabicName).includes(term)
          || normalize(machine.clientName).includes(term)
          || normalize(machine.address).includes(term);
        const matchesFilter = routeFilter === 'all'
          || (routeFilter === 'remaining' && !visitSubmitted(machine))
          || (routeFilter === 'completed' && visitSubmitted(machine));
        return matchesTerm && matchesFilter;
      }),
    })).filter((region) => region.machines.length > 0);
  }, [query, route, routeFilter]);

  const routeMachines = useMemo(() => (route?.regions ?? []).flatMap((region) => region.machines ?? []), [route]);
  const routeFilterCounts = {
    all: routeMachines.length,
    remaining: routeMachines.filter((machine) => !visitSubmitted(machine)).length,
    completed: routeMachines.filter(visitSubmitted).length,
  };
  const pendingQueueCount = pendingVisits.length + pendingMachineActions.length;

  const finishTutorial = () => {
    try { window.localStorage.setItem(`tutorial_seen:${userId}`, '1'); } catch { /* Tutorial is dismissed for this session. */ }
    setTutorialOpen(false);
  };

  const logout = async () => {
    if (attendance?.clock_in_time && !attendance.clock_out_time) {
      setToast('سجّل الانصراف من بطاقة الحضور أولاً؛ يمكنك الخروج بعد إغلاق الوردية.');
      return;
    }
    if (nativeApp) {
      try {
        await syncTracking({ duty: false, stop: true });
        await stopNativeDutyTracking();
        setOnDuty(false);
      } catch (error) {
        setToast(error.message || 'تعذر إيقاف تتبع الوردية؛ لم يتم تسجيل الخروج.');
        return;
      }
    }
    await onLogout();
  };

  const saveVisit = async ({ machineCondition, reasonIds, notes, beforePhotos, afterPhotos, beforeCapturedAt, afterCapturedAt, capturedAt, location }) => {
    const visitUuid = createVisitUuid();
    const payload = {
      visitUuid,
      cardId: Number(selectedMachine.cardId),
      machineCode: selectedMachine.machineCode,
      regionName: selectedMachine.regionName,
      machineCondition,
      reasonIds,
      notes,
      capturedAt,
      beforeCapturedAt,
      afterCapturedAt,
      location,
    };
    const queuedVisit = {
      visitUuid,
      repId: userId,
      repUsername: user.username,
      createdAt: new Date().toISOString(),
      payload,
      beforePhotos,
      afterPhotos,
      status: 'queued',
      attempts: 0,
      lastError: '',
    };
    try {
      const nativeStoragePath = await saveNativePendingBackup(queuedVisit);
      const storedVisit = { ...queuedVisit, nativeStoragePath };
      try {
        await addPendingVisit(storedVisit);
      } catch (error) {
        if (nativeStoragePath) await deleteNativePendingBackup(visitUuid).catch(() => undefined);
        throw error;
      }
      setPendingVisits((current) => [...current, storedVisit].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
      try { await refreshPending(); } catch { /* The IndexedDB add transaction already confirmed durable storage. */ }
      setSelectedMachine(null);
      setShowQueue(true);
      setToast(`حُفظت الزيارة و${beforePhotos.length + afterPhotos.length} صورة على هذا الهاتف. ستتم المزامنة عند اتصال الخادم.`);
    } catch (error) {
      setStorageError(error.message || 'لم يتم حفظ الزيارة. تحقق من مساحة الهاتف وحاول مجدداً.');
      throw error;
    }
  };

  const confirmSelectedMachineLocation = async (location) => {
    if (!selectedMachine?.machineId) throw new Error('تعذر تحديد بطاقة الماكينة؛ حدّث المسار وحاول مجدداً.');
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
      throw new Error('تعذر قراءة إحداثيات GPS الحالية.');
    }
    const actionUuid = createVisitUuid();
    const payload = {
      actionUuid,
      cardId: Number(selectedMachine.cardId),
      location: {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        accuracy: Number(location.accuracy),
        updatedAt: location.updatedAt || new Date().toISOString(),
      },
    };
    const queuedAction = {
      actionUuid,
      repId: userId,
      type: 'confirm_location',
      machineId: Number(selectedMachine.machineId),
      createdAt: new Date().toISOString(),
      payload,
      status: 'queued',
      attempts: 0,
      lastError: '',
    };
    try {
      await addPendingMachineAction(queuedAction);
      pendingMachineActionsRef.current = [...pendingMachineActionsRef.current, queuedAction];
      setPendingMachineActions(pendingMachineActionsRef.current);
      setRoute((current) => {
        const updated = updateRouteMachineLocation(current, selectedMachine.machineId, payload.location, true);
        void saveSnapshot('route_snapshots', userId, { route: updated, cachedAt: new Date().toISOString() }).catch(() => undefined);
        return updated;
      });
      setToast('تم حفظ تأكيد الموقع محلياً؛ سيُقفل على الخادم قبل مزامنة أي زيارة.');
      void drainQueue();
      return {
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        isLocationLocked: true,
        geofenceRadiusMeters: 50,
        locationConfirmationPending: true,
      };
    } catch (error) {
      setStorageError(error.message || 'تعذر حفظ تأكيد الموقع على الهاتف.');
      throw error;
    }
  };

  const submitSelectedMachineCorrection = async ({ reportedCode, reportedName, note, evidence, location, capturedAt }) => {
    if (!selectedMachine?.machineId) throw new Error('تعذر تحديد بطاقة الماكينة؛ حدّث المسار وحاول مجدداً.');
    if (evidence && (!(evidence instanceof Blob) || evidence.size > 4 * 1024 * 1024
        || !['image/jpeg', 'image/png', 'image/webp'].includes(evidence.type))) {
      throw new Error('صورة الإثبات يجب أن تكون JPEG أو PNG أو WebP وألا تتجاوز 4 ميغابايت.');
    }
    const actionUuid = createVisitUuid();
    const payload = {
      actionUuid,
      cardId: Number(selectedMachine.cardId),
      reportedCode,
      reportedName,
      note,
      location,
      capturedAt: capturedAt || new Date().toISOString(),
    };
    const queuedAction = {
      actionUuid,
      repId: userId,
      type: 'report_correction',
      machineId: Number(selectedMachine.machineId),
      createdAt: new Date().toISOString(),
      payload,
      evidence: evidence ?? null,
      status: 'queued',
      attempts: 0,
      lastError: '',
    };
    try {
      await addPendingMachineAction(queuedAction);
      pendingMachineActionsRef.current = [...pendingMachineActionsRef.current, queuedAction];
      setPendingMachineActions(pendingMachineActionsRef.current);
      setRoute((current) => updateRouteMachineCorrection(current, selectedMachine.machineId));
      setToast('حُفظ بلاغ اختلاف الماكينة على الهاتف؛ ستتم مزامنته مع صورة الإثبات عند عودة الاتصال.');
      void drainQueue();
    } catch (error) {
      setStorageError(error.message || 'تعذر حفظ بلاغ التصحيح على الهاتف.');
      throw error;
    }
  };

  const serverLabel = serverState === 'checking'
    ? 'جارٍ فحص الخادم'
    : serverState === 'online' && networkOnline
      ? 'متصل بالسيرفر'
      : networkOnline
        ? 'السيرفر غير متاح'
        : 'أوفلاين · حفظ محلي';
  const attendanceIsOpen = Boolean(attendance?.clock_in_time && !attendance.clock_out_time);
  const attendanceIsClosed = Boolean(attendance?.clock_in_time && attendance.clock_out_time);
  const punchAction = attendanceIsOpen ? 'out' : 'in';

  return (
    <main className="rep-app" dir="rtl">
      <header className="rep-live-header">
        <div className="rep-live-brand">
          <span className="rep-brand-mark">م</span>
          <div><strong>مَــدَارْ</strong><small>مسار المندوب</small></div>
        </div>
        <div className="rep-user-info"><strong>{user.fullName}</strong><span>كود المندوب: <b dir="ltr">{user.username}</b></span></div>
        <div className="rep-header-actions">
          <span className={`rep-connect-status ${serverState === 'online' && networkOnline ? 'connected' : ''} ${serverState === 'checking' ? 'checking' : ''}`}>
            <i aria-hidden="true" />{serverLabel}
          </span>
          <button className="rep-queue-count" type="button" onClick={() => setShowQueue((value) => !value)} aria-expanded={showQueue}>
            <span>⏳</span><b>{pendingQueueCount}</b><small>معلق</small>
          </button>
          <button className="rep-icon-button rep-refresh-button" type="button" onClick={() => { void checkServer(); void refreshData(); void refreshAttendance(); }} disabled={routeLoading} aria-label="تحديث مسار اليوم" title="تحديث المسار">
            <span className={routeLoading ? 'rep-spinning' : ''}>↻</span>
          </button>
          <button className="rep-logout-button" type="button" onClick={() => void logout()}>خروج</button>
        </div>
      </header>

      {assignmentNotice && (
        <div className="rep-assignment-notice" role="status">
          <span><b>{!assignmentNotice.assigned ? 'إلغاء التكليف' : assignmentNotice.previouslyAssigned ? 'تحديث التكليف' : 'تكليف جديد'}</b> · {assignmentNotice.orderCode}{assignmentNotice.areas.length ? ` · ${assignmentNotice.areas.join('، ')}` : ''}</span>
          <button type="button" onClick={() => setAssignmentNotice(null)} aria-label="إغلاق تنبيه التكليف">×</button>
        </div>
      )}

      {offlineOnly && <div className="rep-offline-banner" role="status">أنت في وضع العمل المحلي. لا تُرسل أي بيانات حتى تتم إعادة التحقق من الجلسة مع الخادم.</div>}

      <section className="rep-attendance-card" aria-label="الحضور والانصراف">
        <div className="rep-attendance-summary">
          <span className="rep-eyebrow">الحضور والانصراف · {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeZone: 'Africa/Cairo' }).format(new Date())}</span>
          <strong>{attendance?.clock_in_time ? `${attendanceHours(attendance, clockNow).toFixed(2)} ساعة` : 'لم يسجل الحضور بعد'}</strong>
          <small>{attendance?.clock_in_time
            ? `حضور ${formatTime(attendance.clock_in_time)}${attendance.clock_out_time ? ` · انصراف ${formatTime(attendance.clock_out_time)}` : ' · الدوام مستمر'}`
            : 'يسجل النظام الوقت من الخادم وموقع GPS عند الحضور.'}</small>
        </div>
        <div className="rep-attendance-actions">
          <button
            className={`rep-attendance-punch ${attendanceIsOpen ? 'clock-out' : 'clock-in'}`}
            type="button"
            disabled={attendanceSaving || offlineOnly || serverState !== 'online' || attendanceIsClosed}
            onClick={() => void clockAttendance(punchAction)}
            aria-label={attendanceIsOpen ? 'تسجيل الانصراف وإيقاف تتبع الوردية' : attendanceIsClosed ? 'تم تسجيل الانصراف لهذا اليوم' : 'تسجيل الحضور وبدء تتبع الوردية'}
          >
            {attendanceSaving
              ? 'جارٍ تسجيل البصمة…'
              : attendanceIsOpen
                ? 'تسجيل الانصراف ↧'
                : attendanceIsClosed
                  ? 'تم تسجيل الانصراف اليوم'
                  : 'تسجيل الحضور ↥'}
          </button>
          <div className={`rep-attendance-gps ${gps ? 'has-fix' : ''}`} role="status">
            <i aria-hidden="true" />
            <span><b>GPS</b> · {gps ? formatGps(gps) : gpsError || 'سيُطلب الموقع عند تسجيل البصمة'}</span>
          </div>
        </div>
      </section>

      <section className="rep-welcome-row">
        <div>
          <span className="rep-eyebrow">{new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeZone: 'Africa/Cairo' }).format(new Date())}</span>
          <h1>مسار اليوم <span>جاهز لخطوتك التالية.</span></h1>
          <p>ابحث عن ماكينة، وثّق الزيارة، ثم يتولى المشرف اعتمادها قبل دخولها التقارير.</p>
        </div>
        <div className="rep-welcome-mark" aria-hidden="true"><span>م</span><i /><i /></div>
      </section>

      <section className="rep-progress-card" aria-label="إنجاز اليوم">
        <div className="rep-progress-copy">
          <div><span className="rep-eyebrow">إنجاز الوردية</span><strong>{summary.completed} <small>من</small> {summary.totalMachines} <small>ماكينة</small></strong></div>
          <span className="rep-progress-percent">{summary.progress}%</span>
        </div>
        <div className="rep-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={summary.progress}>
          <span style={{ width: `${summary.progress}%` }} />
        </div>
        <div className="rep-progress-foot"><span><i className="done-dot" />معتمدة <b>{summary.completed}</b></span><span><i className="pending-dot" />بانتظار الاعتماد <b>{summary.pendingReview ?? 0}</b></span><span>متبقية <b>{summary.pending}</b></span><small>{routeLoading ? 'جارٍ تحديث المسار…' : route ? `آخر تحديث ${formatTime(route.cachedAt ?? route.fetchedAt ?? new Date())}` : 'لا توجد نسخة مسار محفوظة بعد'}</small></div>
      </section>

      <section className="rep-route-section">
        <div className="rep-route-heading">
          <div><span className="rep-eyebrow">أوامر الصيانة المعيّنة لك</span><h2>ماكيناتك <small>{summary.totalMachines} بطاقة</small></h2></div>
          <div className="rep-route-heading-actions">
            <button type="button" className={`rep-map-toggle ${showOfflineMap ? 'active' : ''}`} onClick={() => setShowOfflineMap((value) => !value)} aria-expanded={showOfflineMap}>
              ⌖ {showOfflineMap ? 'إخفاء الخريطة' : 'خريطة أوفلاين'}
            </button>
            <label className="rep-search">
              <span aria-hidden="true">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بكود الماكينة أو اسمها" aria-label="ابحث بكود الماكينة أو اسمها" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث">×</button>}
            </label>
          </div>
        </div>

        <div className="rep-route-filters" role="group" aria-label="تصفية مسار اليوم">
          {[['all', 'الكل'], ['remaining', 'المتبقية'], ['completed', 'المكتملة']].map(([value, label]) => (
            <button key={value} type="button" className={routeFilter === value ? 'active' : ''}
              aria-pressed={routeFilter === value} onClick={() => setRouteFilter(value)}>
              {label}<b>{routeFilterCounts[value]}</b>
            </button>
          ))}
        </div>

        {storagePersistent === false && <p className="rep-storage-hint">قد يقوم المتصفح بإخلاء بعض البيانات المحلية عند امتلاء الهاتف. اترك مساحة كافية ولا تمسح بيانات التطبيق قبل المزامنة.</p>}
        {storageError && <p className="rep-storage-error" role="alert">{storageError}</p>}
        {showOfflineMap && <OfflineMapPanel
          route={route}
          gps={gps}
          online={serverState === 'online' && networkOnline}
          offlineOnly={offlineOnly}
          onMachineSelect={(machine) => setSelectedMachine(machine)}
        />}

        {filteredRegions.length ? (
          <div className="rep-region-list">
            {filteredRegions.map((region) => {
              const done = region.machines.filter((machine) => machine.isCompleted).length;
              return (
                <details className="rep-region-folder" key={region.regionName} open>
                  <summary>
                    <span className="rep-folder-icon" aria-hidden="true">▰</span>
                    <span className="rep-folder-name"><strong>{region.regionName}</strong><small>{region.machines.length} ماكينة · {done} مكتملة</small></span>
                    <span className="rep-folder-count">{done}/{region.machines.length}</span>
                    <span className="rep-folder-chevron" aria-hidden="true">⌄</span>
                  </summary>
                  <div className="rep-machine-grid">
                    {region.machines.map((machine) => (
                      <article className="rep-machine-card-wrap" key={`${machine.cardId}-${machine.machineCode}`}>
                        <button
                          type="button"
                          className={`rep-machine-card ${machine.isCompleted ? 'is-complete' : ''} ${machine.canVisit === false ? 'is-locked' : ''}`}
                          onClick={() => setSelectedMachine({ ...machine, regionName: region.regionName })}
                          disabled={machine.canVisit === false}
                        >
                           <div className="rep-machine-card-top"><span className="rep-machine-code" dir="ltr">{machine.machineCode}</span><span className="rep-machine-status">{machine.isCompleted ? '✅ معتمدة' : machine.correctionPending ? '⚠️ بلاغ تصحيح قيد المراجعة' : machine.reviewStatus === 'pending' ? '🟡 بانتظار الاعتماد' : machine.reviewStatus === 'reshoot' ? '🔁 إعادة تصوير' : machine.canVisit === false ? 'مغلقة' : '⏳ متبقية'}</span></div>
                          <small className="rep-work-order-code">أمر الصيانة · {machine.workOrderCode}</small>
                          {machine.clientName && <strong className="rep-machine-branch">{machine.clientName}</strong>}
                          <span className="rep-machine-name">{machine.arabicName || `ماكينة ${machine.machineCode}`}</span>
                          <span className="rep-machine-address"><i aria-hidden="true">⌖</i>{machine.address || 'عنوان العميل غير مسجل'}</span>
                           <span className="rep-machine-distance">
                             <i aria-hidden="true">↔</i>
                             {machine.locationConfirmationPending
                               ? 'موقع مؤكد محلياً · بانتظار المزامنة'
                               : !machine.isLocationLocked || machineDistance(machine, gps) === null
                               ? !machine.isLocationLocked || !Number.isFinite(machine.latitude) || !Number.isFinite(machine.longitude)
                                 ? 'الموقع الجغرافي غير مثبت'
                                 : 'سجّل الحضور لتحديث المسافة'
                               : `المسافة الحالية ${Math.round(machineDistance(machine, gps))}م · GPS ±${Math.round(gps.accuracy)}م`}
                          </span>
                          {machine.reviewNote && <small className="rep-review-note">ملاحظة المشرف: {machine.reviewNote}</small>}
                          <span className="rep-machine-open">{machine.isCompleted ? 'تم اعتماد الزيارة' : machine.reviewStatus === 'pending' ? 'بانتظار قرار المشرف' : machine.reviewStatus === 'reshoot' ? 'افتح لإعادة التصوير' : machine.canVisit === false ? 'للعرض فقط' : 'ابدأ الزيارة'} <b aria-hidden="true">←</b></span>
                        </button>
                        {googleMapsNavigationUrl(machine) && <a className="rep-map-link" href={googleMapsNavigationUrl(machine)} target="_blank" rel="noopener noreferrer">⌖ ملاحة إلى الماكينة في Google Maps</a>}
                      </article>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        ) : routeLoading ? (
          <div className="rep-empty-state"><span className="rep-empty-icon rep-spinning">↻</span><h3>جارٍ تنزيل مسار اليوم</h3><p>سيتم حفظ نسخة محلية لتتمكن من فتحها دون اتصال لاحقاً.</p></div>
        ) : route?.regions?.length ? (
          <div className="rep-empty-state"><span className="rep-empty-icon">⌕</span><h3>لا توجد نتائج لهذا البحث</h3><p>جرّب كتابة كود الماكينة أو جزء من اسمها.</p></div>
        ) : (
          <div className="rep-empty-state"><span className="rep-empty-icon">▤</span><h3>{networkOnline ? 'لا توجد ماكينات مسندة اليوم' : 'لا توجد نسخة محلية للمسار بعد'}</h3><p>{networkOnline ? 'اسحب للأسفل أو استخدم زر التحديث إذا أضاف المشرف تكليفاً جديداً.' : 'اتصل بالخادم مرة واحدة لتنزيل مسارك، وبعدها يمكنك متابعة العمل أوفلاين.'}</p><button type="button" className="rep-button rep-button-light" onClick={() => { void checkServer(); void refreshData(); void refreshAttendance(); }}>إعادة المحاولة</button></div>
        )}
      </section>

       {showQueue && <section className="rep-queue-panel" aria-label="قائمة الإجراءات المعلقة">
         <div className="rep-queue-panel-head"><div><span className="rep-eyebrow">التخزين المحلي</span><h2>إجراءات بانتظار المزامنة <small>{pendingQueueCount}</small></h2></div><button className="rep-icon-button" type="button" onClick={() => setShowQueue(false)} aria-label="إخفاء قائمة المزامنة">×</button></div>
         {!pendingQueueCount ? <p className="rep-queue-empty">لا توجد إجراءات معلقة لهذا الحساب.</p> : <ul className="rep-queue-list">
         {pendingMachineActions.map((action) => <li key={action.actionUuid}>
           <span className={`rep-queue-state ${action.status === 'syncing' ? 'syncing' : ''} ${action.status === 'blocked' ? 'blocked' : ''}`} aria-hidden="true">{action.status === 'syncing' ? '↻' : action.status === 'blocked' ? '!' : '⏳'}</span>
           <div><strong>{action.type === 'confirm_location' ? `تأكيد موقع الماكينة ${action.payload?.cardId ? `· بطاقة ${action.payload.cardId}` : ''}` : `بلاغ ماكينة مختلفة · ${action.payload?.reportedCode || ''}`}</strong><small>حُفظ {formatTime(action.createdAt)}{action.attempts ? ` · محاولات ${action.attempts}` : ''} · {action.status === 'blocked' ? 'تحتاج مراجعة' : action.status === 'syncing' ? 'جارٍ الإرسال' : 'بانتظار المزامنة'}</small>{action.evidence && <small>صورة الإثبات محفوظة محلياً · {Math.ceil(action.evidence.size / 1024)} KB</small>}{action.lastError && <small className="rep-queue-error">{action.lastError}</small>}</div>
           {action.status === 'blocked'
             ? <button type="button" className="rep-queue-retry" disabled={serverState !== 'online' || offlineOnly} onClick={async () => { await updatePendingMachineAction(action.actionUuid, { status: 'queued', lastError: '' }); await refreshPending(); void drainQueue(); }}>إعادة المحاولة</button>
             : <span className="rep-queue-local">محفوظ محلياً</span>}
         </li>)}
         {pendingVisits.map((visit) => <li key={visit.visitUuid}>
           <span className={`rep-queue-state ${visit.status === 'syncing' ? 'syncing' : ''} ${visit.status === 'blocked' ? 'blocked' : ''}`} aria-hidden="true">{visit.status === 'syncing' ? '↻' : visit.status === 'blocked' ? '!' : '⏳'}</span>
           <div><strong>ماكينة {visit.payload.machineCode} · {visit.payload.regionName}</strong><small>حُفظت {formatTime(visit.createdAt)}{visit.attempts ? ` · محاولات ${visit.attempts}` : ''} · {visit.status === 'blocked' ? 'تحتاج مراجعة' : visit.status === 'syncing' ? 'جارٍ الإرسال' : 'بانتظار المزامنة'}</small>{visit.lastError && <small className="rep-queue-error">{visit.lastError}</small>}</div>
           {visit.status === 'blocked'
             ? <button type="button" className="rep-queue-retry" disabled={serverState !== 'online' || offlineOnly} onClick={async () => { await updatePendingVisit(visit.visitUuid, { status: 'queued', lastError: '' }); await refreshPending(); void drainQueue(); }}>إعادة المحاولة</button>
             : <span className="rep-queue-local">محفوظة محلياً</span>}
         </li>)}</ul>}
         <button type="button" className="rep-button rep-button-primary rep-sync-now" disabled={!pendingQueueCount || serverState !== 'online' || offlineOnly} onClick={() => void drainQueue()}>{serverState === 'online' ? 'مزامنة الآن ↻' : 'ستتم المزامنة عند الاتصال'}</button>
       </section>}

        <footer className="rep-app-footer"><span>مَــدَارْ · تطبيق المندوب الميداني</span><span>{gps ? `آخر GPS: ${formatGps(gps)}` : onDuty ? gpsError : nativeApp ? 'فعّل الحضور لتسجيل GPS أثناء الوردية' : 'يُسجّل GPS مع الحضور والانصراف والزيارة'}</span></footer>

      {selectedMachine && <MachineVisitSheet machine={selectedMachine} reasons={reasons} gps={gps} gpsError={gpsError} captureLocation={captureVisitLocation} onClose={() => setSelectedMachine(null)} onSave={saveVisit} onConfirmLocation={confirmSelectedMachineLocation} onReportCorrection={submitSelectedMachineCorrection} />}
      {tutorialOpen && <Tutorial nativeApp={nativeApp} onFinish={finishTutorial} />}
      {toast && <div className="rep-toast" role="status">✓ {toast}</div>}
    </main>
  );
}
