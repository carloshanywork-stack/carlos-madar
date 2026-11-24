import { usableNativeGpsSnapshot } from './native-gps-state.js';
import RepSupportPanel from './RepSupportPanel.jsx';
import { getNativePhotoArchiveStatus, chooseNativePhotoArchiveFolder } from './native-bridges.js';
import { subscribeNativeOperations } from './native-bridges.js';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl } from '../../lib/api.js';
import { distanceBetweenGpsPointsMeters, getAdaptiveGpsInterval, GPS_POLLING } from './gps-adaptive.js';
import {
  applyPendingMachineLocations,
  locationReviewState,
  locationReviewLabel,
} from './location-review.js';
import { groupRouteMachinesByRegion } from './route-folders.js';
import {
  addPendingVisit,
  addPendingMachineAction,
  clearSnapshot,
  deleteGpsSamples,
  deletePendingMachineAction,
  deletePendingVisit,
  getSnapshot,
  listGpsSamples,
  listPendingVisits,
  listPendingMachineActions,
  listPendingSupportReports,
  deletePendingSupportReport,
  markRouteCardSubmitted,
  requestPersistentStorage,
  saveSnapshot,
  saveGpsSample,
  updatePendingVisit,
  updatePendingMachineAction,
} from './offline-store.js';
import {
  addNativeAppStateListener,
  getNativeAppInfo,
  addNativeBackListener,
  addNativeNetworkListener,
  acknowledgeNativeDutyTracking,
  acknowledgeNativeAttendanceAction,
  authenticateNativeAttendance,
  deleteNativePendingBackup,
  exportPendingQueue,
  importNativeRecoveryPackage,
  getNativeDutyTrackingState,
  getNativeRepCache,
  getNativeRecoveryGps,
  getNativeGpsLocation,
  getNativeGpsAvailability,
  getNativeNetworkStatus,
  isNativeRepApp,
  listNativeVisits,
  listNativeAttendanceActions,
  enqueueNativeAttendanceAction,
  enqueueNativeMachineAction,
  listNativeMachineActions,
  cacheNativeReasons,
  cacheNativeRoute,
  restoreNativePendingBackups,
  retryNativeVisit,
  retryNativeMachineAction,
  reconcileNativeMachineActionReview,
  requestNativeSync,
  saveNativePendingBackup,
  startNativeDutyTracking,
  stopNativeDutyTracking,
} from './native-bridges.js';
import { mergeMachineActions } from './queue-recovery.js';
import NotificationBell from '../../components/notifications/NotificationBell.jsx';
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
    body: 'بعد الانتهاء، التقط صورة واضحة من زاوية قريبة من صورة «قبل» إن أمكن. أضف سبب الصيانة والملاحظة التي يحتاجها المشرف.',
    tip: 'صور ما بعد الصيانة اختيارية؛ الصور الثلاث قبل الصيانة مطلوبة.',
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

function sessionHours(startValue, endValue, now = Date.now()) {
  if (!startValue) return 0;
  const start = Date.parse(startValue);
  const end = endValue ? Date.parse(endValue) : now;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? (end - start) / 3_600_000
    : 0;
}

function attendanceHours(record, now = Date.now()) {
  const total = sessionHours(record?.clock_in_time, record?.clock_out_time, now)
    + sessionHours(record?.overtime_clock_in_time, record?.overtime_clock_out_time, now);
  return Math.round(total * 100) / 100;
}

function hasOpenAttendanceSession(record) {
  return Boolean((record?.clock_in_time && !record.clock_out_time)
    || (record?.overtime_clock_in_time && !record.overtime_clock_out_time));
}

const MAX_CLOCK_ACCURACY_METERS = 250;
const MAX_INDOOR_ACCURACY_METERS = 350;

function currentBusinessDate() {
  const date = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function businessDateFor(value) {
  const date = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map(({ type, value: partValue }) => [type, partValue]));
  return `${date.year}-${date.month}-${date.day}`;
}

function applyPendingAttendance(attendance, actions = []) {
  let current = attendance ? { ...attendance } : null;
  for (const item of [...actions].sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)))) {
    const action = item.action ?? item.payload?.action;
    const occurredAt = item.occurredAt ?? item.payload?.occurredAt;
    const location = item.location ?? item.payload?.location;
    if (!['in', 'out'].includes(action) || !occurredAt) continue;
    const regularClosed = Boolean(current?.clock_in_time && current?.clock_out_time);
    if (action === 'in') {
      if (regularClosed) {
        current = {
          ...current,
          overtime_session_status: 'open',
          overtime_clock_in_time: occurredAt,
          overtime_clock_in_source: 'app',
          overtime_clock_in_lat: location?.latitude ?? null,
          overtime_clock_in_lng: location?.longitude ?? null,
          overtime_clock_in_accuracy: location?.accuracy ?? null,
          overtime_clock_in_location_at: location?.updatedAt ?? null,
          overtime_clock_in_biometric_verified: 1,
          overtime_clock_out_time: null,
          overtime_clock_out_source: null,
          overtime_session_hours: 0,
        };
      } else {
        current = {
          ...(current ?? {}),
          work_date: businessDateFor(occurredAt),
          status: 'present',
          clock_in_time: occurredAt,
          clock_in_source: 'app',
          clock_in_lat: location?.latitude ?? null,
          clock_in_lng: location?.longitude ?? null,
          clock_in_accuracy: location?.accuracy ?? null,
          clock_in_location_at: location?.updatedAt ?? null,
          clock_in_biometric_verified: 1,
          clock_out_time: null,
          clock_out_source: null,
        };
      }
    } else if (current?.overtime_clock_in_time && !current.overtime_clock_out_time) {
      current = {
        ...current,
        overtime_session_status: 'closed',
        overtime_clock_out_time: occurredAt,
        overtime_clock_out_source: 'app',
        overtime_clock_out_lat: location?.latitude ?? null,
        overtime_clock_out_lng: location?.longitude ?? null,
        overtime_clock_out_accuracy: location?.accuracy ?? null,
        overtime_clock_out_location_at: location?.updatedAt ?? null,
        overtime_clock_out_biometric_verified: 1,
      };
    } else if (current?.clock_in_time && !current.clock_out_time) {
      current = {
        ...current,
        clock_out_time: occurredAt,
        clock_out_source: 'app',
        clock_out_lat: location?.latitude ?? null,
        clock_out_lng: location?.longitude ?? null,
        clock_out_accuracy: location?.accuracy ?? null,
        clock_out_location_at: location?.updatedAt ?? null,
        clock_out_biometric_verified: 1,
      };
    }
  }
  return current;
}

function formatGps(location) {
  if (!location) return 'الموقع غير متاح';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · دقة ±${Math.round(location.accuracy)}م`;
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
        <header className="rep-tutorial-brand"><span className="rep-brand-mark" style={{ overflow: 'hidden', padding: 2 }}><img src="/icon.svg" alt="شعار مدار" style={{ width: '100%', height: '100%', display: 'block' }} /></span><span><strong>مَــدَارْ</strong><small>دليل المندوب الميداني</small></span></header>
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
  const [overtimeRequest, setOvertimeRequest] = useState(null);
  const [overtimeFormOpen, setOvertimeFormOpen] = useState(false);
  const [overtimeReason, setOvertimeReason] = useState('');
  const [overtimeBusy, setOvertimeBusy] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [reasons, setReasons] = useState([]);
  const [pendingVisits, setPendingVisits] = useState([]);
  const [pendingMachineActions, setPendingMachineActions] = useState([]);
  const [pendingAttendanceActions, setPendingAttendanceActions] = useState([]);
  const [pendingGpsQueue, setPendingGpsQueue] = useState({ pending: [], rejected: [] });
  const [query, setQuery] = useState('');
  const [routeFilter, setRouteFilter] = useState('remaining');
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [serverState, setServerState] = useState('checking');
  const [routeLoading, setRouteLoading] = useState(false);
  const [lastGps, setGps] = useState(null);
  const [nativeGpsEnabled, setNativeGpsEnabled] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [onDuty, setOnDuty] = useState(false);
  const [activeTab, setActiveTab] = useState('route');
  const [showQueue, setShowQueue] = useState(false);
  const [supportPanelOpen, setSupportPanelOpen] = useState(false);
  const [showOfflineMap, setShowOfflineMap] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState(null);
  const [toast, setToast] = useState('');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [storagePersistent, setStoragePersistent] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [storageError, setStorageError] = useState('');
  const [pendingExportBusy, setPendingExportBusy] = useState(false);
  const [pendingImportBusy, setPendingImportBusy] = useState(false);
  const syncingRef = useRef(false);
  const trackingSyncingRef = useRef(false);
  const gpsRef = useRef(null);
  const routeRef = useRef(null);
  const pendingMachineActionsRef = useRef([]);
  const seenReviewNoticesRef = useRef(new Set());
  const mockAuditAtRef = useRef(0);
  const nativeBackStateRef = useRef({});
  const userId = Number(user.id);
  const nativeApp = isNativeRepApp();
  // Cached native fixes may survive provider shutdown; never expose them as a usable fix.
  const gps = nativeApp && nativeGpsEnabled === false ? null : lastGps;
  const visibleGpsError = nativeApp && nativeGpsEnabled === false
    ? 'GPS مغلق على الهاتف؛ فعّله من الإعدادات قبل تسجيل الحضور أو التصوير.' : gpsError;
  const [photoArchive, setPhotoArchive] = useState(null);
  const [photoArchiveBusy, setPhotoArchiveBusy] = useState(false);
  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    const refresh = () => void getNativePhotoArchiveStatus().then(state => { if (active) setPhotoArchive(state); }).catch(() => { if (active) setPhotoArchive({ configured: false, error: 'تعذر قراءة حالة مجلد الصور.' }); });
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [nativeApp, userId]);
  routeRef.current = route;

  const reportMockLocation = useCallback(async (action) => {
    if (Date.now() - mockAuditAtRef.current < 60_000) return false;
    if (offlineOnly || !navigator.onLine) return false;
    mockAuditAtRef.current = Date.now();
    try {
      const result = await api.post('/api/rep/attendance/mock-location', {
        action,
        detectedAt: new Date().toISOString(),
        is_mock: true,
      }, { timeoutMs: 4000 });
      return Boolean(result?.audited);
    } catch {
      return false;
    }
  }, [offlineOnly]);

  useEffect(() => {
    if (!attendance?.clock_in_time || attendance.clock_out_time) return undefined;
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(timer);
  }, [attendance?.clock_in_time, attendance?.clock_out_time]);

  const refreshPending = useCallback(async () => {
    let storedVisits = [];
    let storedActions = [];
    let indexedStorageError = null;
    try {
      [storedVisits, storedActions] = await Promise.all([
        listPendingVisits(userId),
        listPendingMachineActions(userId),
      ]);
    } catch (error) {
      if (!nativeApp) throw error;
      indexedStorageError = error;
    }
    let visits = storedVisits;
    let actions = storedActions;
    if (nativeApp) {
      const [nativeVisits, nativeActions, nativeGps] = await Promise.all([
        listNativeVisits(userId),
        listNativeMachineActions(userId),
        getNativeRecoveryGps(userId),
      ]);
      const nativeByUuid = new Map(nativeVisits.map((visit) => [visit.visitUuid, visit]));
      const seen = new Set();
      visits = [];
      for (const stored of storedVisits) {
        const native = nativeByUuid.get(stored.visitUuid);
        if (native?.status === 'synced') {
          await deletePendingVisit(stored.visitUuid).catch(() => undefined);
          continue;
        }
        if (native) {
          seen.add(native.visitUuid);
          visits.push({ ...stored, ...native, beforePhotos: [], afterPhotos: [] });
        } else {
          visits.push(stored);
        }
      }
      for (const native of nativeVisits) {
        if (native.status === 'synced' || seen.has(native.visitUuid)) continue;
        visits.push({ ...native, beforePhotos: [], afterPhotos: [] });
      }
      visits.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      actions = mergeMachineActions(storedActions, nativeActions, userId);
      setPendingGpsQueue(nativeGps);
      if (indexedStorageError) setStorageError(`قاعدة المتصفح غير متاحة؛ عُرضت طوابير SQLite الأصلية. ${indexedStorageError.message}`);
    }
    pendingMachineActionsRef.current = actions;
    setPendingMachineActions(actions);
    setPendingVisits(visits);
    return { visits, actions };
  }, [nativeApp, userId]);

  const syncTracking = useCallback(async (options = {}) => {
    if (nativeApp) {
      void requestNativeSync().catch(() => undefined);
    }
    const duty = options.duty ?? onDuty;
    const hasLocationOverride = Object.hasOwn(options, 'location');
    if (offlineOnly || !navigator.onLine) return false;
    if (trackingSyncingRef.current) return false;
    trackingSyncingRef.current = true;
    try {
      const state = nativeApp ? await getNativeDutyTrackingState() : null;
      const mocked = Boolean(state?.mocked);
      if (mocked) void reportMockLocation('tracking');
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
          clientPointId: point.clientPointId || `web-${userId}-${point.sampleId}`,
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
        const acknowledgments = new Map((response.points ?? []).map((point) => [point.clientPointId, point]));
        const accepted = chunk.filter((point) => ['accepted', 'duplicate'].includes(acknowledgments.get(point.clientPointId)?.status));
        if (accepted.length) await deleteGpsSamples(accepted.map((point) => point.sampleId).filter(Boolean));
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
  }, [nativeApp, offlineOnly, onDuty, reportMockLocation, userId]);

  const captureVisitLocation = useCallback(async (purpose = 'visit') => {
    try {
      let location;
      if (nativeApp) {
        const availability = await getNativeGpsAvailability();
        if (typeof availability?.enabled === 'boolean') setNativeGpsEnabled(availability.enabled);
        if (availability && !availability.enabled) throw new Error('خدمة الموقع مغلقة على الهاتف؛ فعّلها من الإعدادات.');
        location = await getNativeGpsLocation();
      } else if (navigator.geolocation) {
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
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
      if (nativeApp) {
        const currentAvailability = await getNativeGpsAvailability();
        if (typeof currentAvailability?.enabled === 'boolean') setNativeGpsEnabled(currentAvailability.enabled);
        if (currentAvailability?.enabled === false) throw new Error('خدمة الموقع مغلقة على الهاتف؛ فعّلها من الإعدادات.');
      }
      const timestamp = Date.parse(location?.updatedAt ?? '');
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
        || !Number.isFinite(location.accuracy) || location.accuracy > MAX_INDOOR_ACCURACY_METERS
        || !Number.isFinite(timestamp) || Date.now() - timestamp > 10 * 60 * 1000 || timestamp - Date.now() > 60 * 1000) {
        if (gpsRef.current && Number.isFinite(gpsRef.current.latitude) && Number.isFinite(gpsRef.current.longitude)) {
          setGps(gpsRef.current);
          setGpsError('');
          return gpsRef.current;
        }
        throw new Error('تعذر الحصول على موقع حديث بدقة مناسبة؛ فعّل GPS وانتقل إلى مكان مفتوح أو قرب نافذة ثم حاول مجدداً.');
      }
      setGps(location);
      setGpsError('');
      return location;
    } catch (error) {
      if (/mock|تزييف|مزيف/i.test(String(error?.message ?? '')) || error?.code === 'MOCK_LOCATION_DETECTED') {
        void reportMockLocation(purpose);
      }
      setGpsError(error.message || 'تعذر تحديث GPS عند حفظ الزيارة.');
      if (gpsRef.current && !/تزييف/.test(error?.message ?? '')) {
        return gpsRef.current;
      }
      setGps(null);
      return null;
    }
  }, [nativeApp, reportMockLocation]);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    const check = async () => {
      try {
        const state = await getNativeGpsAvailability();
        if (!active) return;
        if (typeof state?.enabled === 'boolean') setNativeGpsEnabled(state.enabled);
        if (state && !state.enabled) {
          setGps(null);
          setGpsError('GPS مغلق على الهاتف؛ فعّله من الإعدادات قبل تسجيل الحضور أو التصوير.');
        } else if (state?.enabled) {
          setGpsError((current) => current.startsWith('GPS مغلق على الهاتف') ? '' : current);
        }
      } catch { /* The capture path reports a concrete native error. */ }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [nativeApp]);

  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);

  const loadLocalSnapshots = useCallback(async () => {
    try {
      const recoveredCount = await restoreNativePendingBackups(userId);
      const [savedRoute, savedReasons, visits, storedActions, savedAttendance, nativeCache, attendanceActions, nativeActions, nativeGps] = await Promise.all([
        getSnapshot('route_snapshots', userId),
        getSnapshot('reason_snapshots', userId),
        listPendingVisits(userId),
        listPendingMachineActions(userId),
        getSnapshot('attendance_snapshots', userId),
        nativeApp ? getNativeRepCache(userId) : Promise.resolve(null),
        nativeApp ? listNativeAttendanceActions(userId) : Promise.resolve([]),
        nativeApp ? listNativeMachineActions(userId) : Promise.resolve([]),
        nativeApp ? getNativeRecoveryGps(userId) : Promise.resolve({ pending: [], rejected: [] }),
      ]);
      const actions = nativeApp ? mergeMachineActions(storedActions, nativeActions, userId) : storedActions;
      setPendingAttendanceActions(attendanceActions);
      setPendingGpsQueue(nativeGps);
      pendingMachineActionsRef.current = actions;
      setPendingMachineActions(actions);
      const cachedRoute = savedRoute?.route ?? nativeCache?.route;
      const cachedReasons = savedReasons?.reasons ?? nativeCache?.reasons;
      if (cachedRoute) setRoute(applyPendingMachineLocations({ ...cachedRoute, cachedAt: savedRoute?.cachedAt ?? cachedRoute.cachedAt }, actions));
      if (cachedReasons) setReasons(cachedReasons);
      if (savedAttendance?.date === currentBusinessDate() || attendanceActions.length) {
        const cachedAttendance = applyPendingAttendance(savedAttendance.attendance ?? null, attendanceActions);
        setAttendance(cachedAttendance);
        if (savedAttendance?.overtimeRequest && savedAttendance?.date === currentBusinessDate()) setOvertimeRequest(savedAttendance.overtimeRequest);
        setOnDuty(hasOpenAttendanceSession(cachedAttendance));
        setAttendanceLoaded(true);
      }
      setPendingVisits(visits);
      if (recoveredCount) setToast(`استُعيدت ${recoveredCount} زيارة من نسخة الهاتف الاحتياطية.`);
      setStorageError('');
    } catch (error) {
      if (nativeApp) {
        try {
          const [nativeCache, nativeVisits, nativeAttendanceActions, nativeMachineActions, nativeGps] = await Promise.all([
            getNativeRepCache(userId),
            listNativeVisits(userId),
            listNativeAttendanceActions(userId),
            listNativeMachineActions(userId),
            getNativeRecoveryGps(userId),
          ]);
          const machineActions = mergeMachineActions([], nativeMachineActions, userId);
          setPendingAttendanceActions(nativeAttendanceActions);
          setPendingGpsQueue(nativeGps);
          pendingMachineActionsRef.current = machineActions;
          setPendingMachineActions(machineActions);
          const offlineAttendance = applyPendingAttendance(null, nativeAttendanceActions);
          if (offlineAttendance) {
            setAttendance(offlineAttendance);
            setOnDuty(hasOpenAttendanceSession(offlineAttendance));
            setAttendanceLoaded(true);
          }
          if (nativeCache?.route) setRoute(applyPendingMachineLocations(nativeCache.route));
          if (Array.isArray(nativeCache?.reasons)) setReasons(nativeCache.reasons);
          setPendingVisits(nativeVisits.filter((visit) => visit.status !== 'synced'));
          setStorageError('قاعدة المتصفح غير متاحة؛ عُرضت المسارات والزيارات وإجراءات الماكينة من قواعد SQLite الأصلية على الهاتف.');
        } catch (nativeError) {
          setStorageError(`تعذر قراءة إحدى طوابير SQLite الأصلية؛ لم تُعتبر فارغة. ${nativeError.message || error.message || 'خطأ قراءة محلي.'}`);
        }
      } else {
        setStorageError(error.message || 'لا يمكن استخدام قاعدة البيانات المحلية لهذا المتصفح.');
      }
    }
  }, [nativeApp, userId]);

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
      if (nativeApp) void cacheNativeRoute(userId, cachedRoute).catch(() => undefined);
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
      if (nativeApp) void cacheNativeReasons(userId, reasonsResult.value.reasons).catch(() => undefined);
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
  }, [loadLocalSnapshots, nativeApp, offlineOnly, user.username, userId]);

  const startMachineWork = useCallback(async (cardId, visitUuid, location) => {
    if (offlineOnly || serverState !== 'online') return { offline: true };
    try {
      const result = await api.post(`/api/rep/machines/${cardId}/start-work`, { visitUuid, location });
      void refreshData();
      return result;
    } catch (error) {
      if (error?.status) throw error;
      setStorageError('تعذر إبلاغ باقي المناديب بأن الماكينة قيد التنفيذ؛ ستبقى الصور محلية حتى عودة الاتصال.');
      return { offline: true };
    }
  }, [offlineOnly, refreshData, serverState]);

  const stopMachineWork = useCallback(async (cardId, visitUuid) => {
    if (offlineOnly || serverState !== 'online') return;
    try {
      await api.post(`/api/rep/machines/${cardId}/stop-work`, { visitUuid });
      void refreshData();
    } catch { /* The server-side lease expires if the close request is interrupted. */ }
  }, [offlineOnly, refreshData, serverState]);

  const refreshAttendance = useCallback(async () => {
    if (offlineOnly || !navigator.onLine) return null;
    try {
      const result = await api.get('/api/rep/attendance/today', { timeoutMs: 4000 });
      if (result?.success) {
        const pendingActions = nativeApp ? await listNativeAttendanceActions(userId) : [];
        setPendingAttendanceActions(pendingActions);
        const currentAttendance = applyPendingAttendance(result.openAttendance ?? result.attendance ?? null, pendingActions);
        setAttendance(currentAttendance);
        setOvertimeRequest(result.overtimeRequest ?? null);
        setOnDuty(hasOpenAttendanceSession(currentAttendance));
        setAttendanceLoaded(true);
        try {
          await saveSnapshot('attendance_snapshots', userId, {
            date: result.date,
            attendance: result.attendance ?? null,
            overtimeRequest: result.overtimeRequest ?? null,
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
  }, [nativeApp, offlineOnly, userId]);

  const submitOvertimeRequest = useCallback(async (event) => {
    event?.preventDefault();
    if (overtimeBusy) return;
    if (offlineOnly || !navigator.onLine || serverState !== 'online') {
      setToast('تحتاج اتصالاً بالخادم لإرسال طلب الأوفرتايم واعتماده من المشرف.');
      return;
    }
    setOvertimeBusy(true);
    try {
      const result = await api.post('/api/rep/attendance/overtime-request', {
        ...(overtimeReason.trim() ? { reason: overtimeReason.trim() } : {}),
      }, { timeoutMs: 8000 });
      setOvertimeRequest(result.request ?? null);
      setOvertimeFormOpen(false);
      setOvertimeReason('');
      setToast('تم إرسال طلب الأوفرتايم إلى المشرف.');
      void refreshAttendance();
    } catch (error) {
      setToast(error.message || 'تعذر إرسال طلب الأوفرتايم. حاول مرة أخرى.');
    } finally {
      setOvertimeBusy(false);
    }
  }, [offlineOnly, overtimeBusy, overtimeReason, refreshAttendance, serverState]);

  const cancelOvertimeRequest = useCallback(async () => {
    if (overtimeBusy) return;
    setOvertimeBusy(true);
    try {
      const result = await api.post('/api/rep/attendance/overtime-request/cancel', {}, { timeoutMs: 8000 });
      setOvertimeRequest(result.request ?? null);
      setOvertimeFormOpen(false);
      setToast('تم إلغاء طلب الأوفرتايم.');
      void refreshAttendance();
    } catch (error) {
      setToast(error.message || 'تعذر إلغاء طلب الأوفرتايم.');
    } finally {
      setOvertimeBusy(false);
    }
  }, [overtimeBusy, refreshAttendance]);

  const clockAttendance = useCallback(async (action) => {
    if (offlineOnly) {
      setToast('أعد التحقق من الجلسة مع الخادم قبل بدء تسجيل حضور جديد.');
      return;
    }
    setAttendanceSaving(true);
    let nativeTrackingStarted = false;
    let actionQueued = false;
    try {
      if (!nativeApp) throw new Error('تسجيل الحضور والانصراف بالبصمة متاح من تطبيق MADAR على أندرويد فقط.');
      const biometric = await authenticateNativeAttendance(action);
      if (biometric?.verified !== true) throw new Error('لم تكتمل المصادقة الحيوية.');
      let location = await captureVisitLocation('attendance');
      if (!location) {
        location = gpsRef.current;
      }
      if (!location) throw new Error('يلزم تفعيل خدمة الموقع لتسجيل الحضور أو الانصراف.');
      const attendanceLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        updatedAt: location.updatedAt,
      };
      try {
        await saveGpsSample(userId, location);
        setStorageError('');
      } catch (error) {
        // Keep the server punch available even if local browser storage is full;
        // schema-related failures are repaired by offline-store before surfacing here.
        setStorageError(error.message || 'تعذر حفظ نقطة GPS محلياً.');
      }
      if (action === 'in' && nativeApp) {
        try {
          await startNativeDutyTracking();
          nativeTrackingStarted = true;
        } catch (dutyError) {
          console.warn('[Attendance] startNativeDutyTracking notice:', dutyError);
        }
      }
      const occurredAt = new Date().toISOString();
      const actionUuid = globalThis.crypto?.randomUUID?.() ?? createVisitUuid();
      const localAction = {
        actionUuid,
        repId: userId,
        action,
        occurredAt,
        location: attendanceLocation,
        biometricVerified: true,
      };
      await enqueueNativeAttendanceAction(localAction);
      actionQueued = true;
      const pendingActions = await listNativeAttendanceActions(userId);
      setPendingAttendanceActions(pendingActions);
      const optimisticAttendance = applyPendingAttendance(attendance, pendingActions);
      setAttendance(optimisticAttendance);
      setOnDuty(hasOpenAttendanceSession(optimisticAttendance));
      setAttendanceLoaded(true);

      let trackingReady = false;
      if (action === 'out') {
        // Flush and acknowledge every durable breadcrumb before stopping the
        // native location service. WorkManager completes this later if offline.
        trackingReady = await syncTracking({ duty: false, stop: true, location });
        if (trackingReady) {
          try {
            await stopNativeDutyTracking();
          } catch {
            // A point may arrive between the flush and stop request. Keep the
            // clock-out queued until WorkManager drains it and stops tracking.
            trackingReady = false;
          }
        }
      } else {
        trackingReady = await syncTracking({ duty: true, location });
      }
      void requestNativeSync().catch(() => undefined);

      let serverAttendance = null;
      if (trackingReady && navigator.onLine && serverState === 'online') {
        try {
          const result = await api.post('/api/rep/attendance/sync', {
            actionUuid,
            action,
            occurredAt,
            location: attendanceLocation,
            biometricVerified: true,
          }, { timeoutMs: 15000 });
          if (result?.success === true && result.actionUuid === actionUuid && result.attendance) {
            serverAttendance = result.attendance;
            await acknowledgeNativeAttendanceAction(actionUuid, userId);
            const remainingActions = await listNativeAttendanceActions(userId);
            setPendingAttendanceActions(remainingActions);
            serverAttendance = applyPendingAttendance(serverAttendance, remainingActions);
            setAttendance(serverAttendance);
            setOvertimeRequest((current) => (serverAttendance.overtime_session_id
              ? { ...(current ?? {}), status: 'used' }
              : current));
            setOnDuty(hasOpenAttendanceSession(serverAttendance));
          }
        } catch (error) {
          if (error.status === 401) window.dispatchEvent(new Event('madar-auth-expired'));
          // The native action remains queued; this covers both network loss and a
          // response lost after the server committed the idempotent action.
        }
      }
      if (!serverAttendance) {
        void requestNativeSync().catch(() => undefined);
        setToast(action === 'in'
          ? 'تم حفظ الحضور محلياً وبدأ تتبع الوردية؛ ستتم المزامنة تلقائياً عند الاتصال.'
          : 'تم حفظ الانصراف محلياً؛ سيُستكمل بعد تأكيد مزامنة نقاط GPS وإيقاف التتبع تلقائياً.');
      } else {
        setToast(action === 'in'
          ? 'تم تسجيل الحضور وبدأ تتبع الوردية.'
          : 'تم تسجيل الانصراف وإيقاف تتبع الوردية.');
      }
      try {
        await saveSnapshot('attendance_snapshots', userId, {
          date: serverAttendance?.work_date ?? optimisticAttendance?.work_date,
          attendance: serverAttendance ?? optimisticAttendance,
          lastLocation: location,
          cachedAt: new Date().toISOString(),
        });
      } catch {
        // The server has already committed the attendance event.
      }
      void refreshAttendance();
    } catch (error) {
      if (action === 'in' && nativeTrackingStarted && !actionQueued) await stopNativeDutyTracking().catch(() => undefined);
      setToast(error.message || 'تعذر تسجيل الحضور. حاول مرة أخرى.');
    } finally {
      setAttendanceSaving(false);
    }
  }, [attendance, authenticateNativeAttendance, captureVisitLocation, nativeApp, offlineOnly, refreshAttendance, requestNativeSync, serverState, syncTracking, userId]);

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
    if (nativeApp) {
      void getNativeAppInfo().then((info) => {
        if (info?.version) setAppVersion(`${info.version} (${info.build ?? ''})`.replace(' ()', ''));
      }).catch(() => undefined);
    }
  }, [loadLocalSnapshots, nativeApp, refreshAttendance, refreshData]);

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
    if (offlineOnly || serverState !== 'online') return undefined;
    const events = nativeApp ? null : new EventSource(apiUrl('/api/rep/events'), { withCredentials: true });
    let nativeHandle;
    let stopped = false;
    const onOperationsEvent = (message) => {
      try {
        const event = JSON.parse(message.data);
        window.dispatchEvent(new CustomEvent('madar:notifications-changed'));
        if (event.type === 'system.reconcile-required') { void refreshData(); void refreshAttendance(); void refreshPending(); }
        else if (event.type === 'maintenance.changed' || event.type === 'rep.machine.location-reset'
          || event.type === 'rep.machine.work-started' || event.type === 'rep.machine.work-ended') { void refreshData(); void refreshPending(); }
        else if (event.type === 'rep.visit.submitted') { void refreshData(); void refreshPending(); }
        else if (event.type === 'maintenance.order.assigned') {
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
        } else if (event.type === 'rep.machine.location-reviewed') {
          setToast(event.status === 'approved' ? 'أكد الخادم موقع الماكينة.' : 'رُفض الموقع المقترح؛ راجع الملاحظة وأعد الإرسال.');
          void refreshData();
        } else if (event.type === 'attendance.changed') {
          const cancellationIsForUser = Number(event.userId) === userId
            || (Array.isArray(event.recipientUserIds) && event.recipientUserIds.map(Number).includes(userId))
            || Number(event.employeeId) === Number(user.employee_id ?? attendance?.employee_id);
          if (['cancelled', 'revoked'].includes(event.action) && cancellationIsForUser) {
            setAttendance({ status: event.action === 'revoked' ? 'revoked' : 'cancelled' });
            setOnDuty(false);
            void syncTracking({ duty: false, stop: true, location: null });
            if (nativeApp) void stopNativeDutyTracking().catch(() => undefined);
            void clearSnapshot('attendance_snapshots', userId).catch(() => undefined);
            setToast(event.action === 'revoked' ? 'تم إلغاء الحضور بواسطة الإدارة.' : '⚠️ تم إلغاء تسجيل الحضور لهذا اليوم من قبل الإدارة.');
          } else void refreshAttendance();
        } else if (event.type === 'overtime.reviewed') {
          setToast(event.decision === 'approved'
            ? 'اعتمد المشرف طلب الأوفرتايم؛ يمكنك الآن بدء جلسة الحضور الإضافية.'
            : event.decision === 'rejected'
              ? 'تم رفض طلب الأوفرتايم؛ يمكنك إرسال طلب جديد بعد إغلاق الدوام الأساسي.'
              : 'تم تحديث طلب الأوفرتايم.');
          void refreshAttendance();
        }
      } catch {
        // Ignore malformed frames; the regular route refresh remains a fallback.
      }
    };
    const reconcile = () => {
      window.dispatchEvent(new CustomEvent('madar:notifications-changed'));
      void refreshData(); void refreshAttendance(); void refreshPending();
    };
    if (nativeApp) {
      void subscribeNativeOperations((event) => onOperationsEvent({ data: JSON.stringify(event) }), (status) => {
        if (status.reconcile) reconcile();
        if (status.state === 'authentication_required') window.dispatchEvent(new Event('madar-auth-expired'));
      }).then((handle) => { if (stopped) void handle.remove(); else nativeHandle = handle; }).catch(reconcile);
    } else { events.addEventListener('operations', onOperationsEvent); events.addEventListener('open', reconcile); }
    return () => { stopped = true; void nativeHandle?.remove(); events?.removeEventListener('operations', onOperationsEvent); events?.removeEventListener('open', reconcile); events?.close(); };
  }, [attendance?.employee_id, nativeApp, offlineOnly, refreshAttendance, refreshData, refreshPending, serverState, user.employee_id]);

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
            if (reachable) { void requestNativeSync().catch(() => undefined); void refreshData(); void refreshAttendance(); void syncTracking(); }
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
      const restoredLocation = usableNativeGpsSnapshot(state);
      if (restoredLocation) setGps(restoredLocation);
      if (state.active && state.gpsEnabled === false) { setGps(null); setNativeGpsEnabled(false); }
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
      const attendanceIsOpen = hasOpenAttendanceSession(attendance);
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
  }, [attendance?.clock_in_time, attendance?.clock_out_time,
  attendance?.overtime_clock_in_time, attendance?.overtime_clock_out_time,
    attendanceLoaded, nativeApp, syncTracking]);

  useEffect(() => {
    nativeBackStateRef.current = { selectedMachine, showQueue, tutorialOpen, activeTab };
  }, [selectedMachine, showQueue, tutorialOpen, activeTab]);

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
      } else if (current.activeTab && current.activeTab !== 'route') {
        setActiveTab('route');
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
    if (nativeApp) {
      let active = true;
      let timer;
      let stationarySince = null;
      let previousLocation = null;
      let nextIntervalMs = onDuty ? GPS_POLLING.movingIntervalMs : 30000;
      const readNativePosition = async () => {
        try {
          const availability = await getNativeGpsAvailability();
          if (typeof availability?.enabled === 'boolean') setNativeGpsEnabled(availability.enabled);
          if (availability && !availability.enabled) throw new Error('GPS مغلق على الهاتف؛ فعّله من الإعدادات.');
          let location;
          if (onDuty) {
            const state = await getNativeDutyTrackingState();
            if (state.mocked) throw new Error('تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.');
            if (state.active && state.gpsEnabled === false) { setNativeGpsEnabled(false); throw new Error('GPS مغلق على الهاتف؛ فعّله من الإعدادات.'); }
            location = usableNativeGpsSnapshot(state);
          }
          location ??= await getNativeGpsLocation();
          const currentAvailability = await getNativeGpsAvailability();
          if (!active) return;
          if (typeof currentAvailability?.enabled === 'boolean') setNativeGpsEnabled(currentAvailability.enabled);
          if (currentAvailability?.enabled === false) throw new Error('GPS مغلق على الهاتف؛ فعّله من الإعدادات.');
          const displacementMeters = distanceBetweenGpsPointsMeters(previousLocation, location);
          const speedMetersPerSecond = Number(location.speed) || 0;
          const moving = speedMetersPerSecond > GPS_POLLING.movementSpeedMetersPerSecond
            || displacementMeters > GPS_POLLING.movementDistanceMeters;
          if (moving) stationarySince = null;
          else if (stationarySince === null) stationarySince = Date.now();
          const stationaryDurationMs = stationarySince === null ? 0 : Date.now() - stationarySince;
          nextIntervalMs = onDuty
            ? getAdaptiveGpsInterval({ speedMetersPerSecond, displacementMeters, stationaryDurationMs })
            : 30000;
          previousLocation = location;
          setGps(location);
          setGpsError('');
          if (onDuty) void syncTracking({ duty: true, location });
        } catch (error) {
          if (!active) return;
          stationarySince = null;
          setGpsError(error.message || 'إشارة GPS غير متاحة حالياً.');
          if (/GPS مغلق/.test(error.message ?? '')) setGps(null);
          if (/تزييف الموقع/.test(error.message ?? '')) {
            setGps(null);
            setOnDuty(false);
            void syncTracking({ duty: false, location: null });
          }
          nextIntervalMs = onDuty ? GPS_POLLING.movingIntervalMs : 30000;
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
    if (!onDuty && !selectedMachine) {
      setGpsError('فعّل الوردية أو افتح زيارة لتحديث GPS.');
      return undefined;
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
        const moving = speedMetersPerSecond > GPS_POLLING.movementSpeedMetersPerSecond
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
      const [indexedActions, nativeActions] = await Promise.all([
        listPendingMachineActions(userId),
        nativeApp ? listNativeMachineActions(userId) : Promise.resolve([]),
      ]);
      const actions = nativeApp ? mergeMachineActions(indexedActions, nativeActions, userId) : indexedActions;
      const reviews = await api.get('/api/rep/location-confirmations', { timeoutMs: 12000 });
      for (const action of actions.filter((item) => item.type === 'confirm_location')) {
        const review = reviews.requests?.find((item) => item.actionUuid === action.actionUuid);
        if (!review) continue;
        if (action.status !== locationReviewState(review.status)) changedServer = true;
        Object.assign(action, { status: locationReviewState(review.status), correctionId: review.id, reviewNote: review.reviewNote });
        if (action.source === 'native-sqlite') {
          await reconcileNativeMachineActionReview(action.actionUuid, userId, {
            status: action.status,
            correctionId: review.id,
            reviewNote: review.reviewNote,
          });
        } else {
          await updatePendingMachineAction(action.actionUuid, { status: action.status, correctionId: review.id, reviewNote: review.reviewNote });
        }
      }
      const pausedCardIds = new Set();
      const pausedMachineIds = new Set();
      let canDrainVisits = true;
      for (const action of actions) {
        if (Number(action.repId) !== userId) continue;
        const cardId = Number(action.payload?.cardId);
        if (nativeApp && action.source === 'native-sqlite') {
          if (action.type === 'confirm_location' && ['approved', 'rejected'].includes(action.status)) {
            const review = reviews.requests?.find((item) => item.actionUuid === action.actionUuid);
            if (!review?.approvedLocation) {
              pausedMachineIds.add(Number(action.machineId));
              pausedCardIds.add(cardId);
            }
          } else if (['queued', 'syncing', 'blocked', 'pending_approval'].includes(action.status)) {
            if (Number.isSafeInteger(cardId) && cardId > 0) pausedCardIds.add(cardId);
            if (action.type === 'report_correction') pausedMachineIds.add(Number(action.machineId));
          }
          continue;
        }
        if (action.type === 'confirm_location' && ['approved', 'rejected'].includes(action.status)) {
          const review = reviews.requests?.find((item) => item.actionUuid === action.actionUuid);
          if (!review?.approvedLocation) {
            pausedMachineIds.add(Number(action.machineId));
            pausedCardIds.add(cardId);
          }
          continue;
        }
        if (action.type === 'confirm_location' && action.status === 'pending_approval') {
          pausedMachineIds.add(Number(action.machineId));
          pausedCardIds.add(cardId);
          continue;
        }
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
            await updatePendingMachineAction(action.actionUuid, {
              status: locationReviewState(result.status), correctionId: result.correctionId,
            });
            if (result.status !== 'approved') {
              pausedMachineIds.add(Number(action.machineId));
              pausedCardIds.add(cardId);
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
          if (action.type !== 'confirm_location') await deletePendingMachineAction(action.actionUuid);
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
        // Native Android visits are uploaded from filesDir by WorkManager, never through WebView Blobs.
        if (nativeApp && queuedVisit.nativeStoragePath?.startsWith('internal://visits/')) continue;
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
                    workStatus: result.status === 'reshoot_requested' ? 'available' : result.status === 'approved' ? 'done' : 'pending_review',
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

      // Drain queued offline support reports
      try {
        const queuedReports = await listPendingSupportReports(userId);
        for (const item of queuedReports) {
          try {
            const formData = new FormData();
            formData.append('report', JSON.stringify(item.report));
            if (item.attachment) formData.append('attachment', item.attachment);
            await api.upload('/api/rep/support/reports', formData, { timeoutMs: 30000 });
            await deletePendingSupportReport(item.reportUuid);
          } catch (reportErr) {
            if (reportErr?.status && reportErr.status >= 400 && reportErr.status < 500) {
              await deletePendingSupportReport(item.reportUuid);
            }
          }
        }
      } catch {}
    } catch (error) {
      setStorageError(error.message || 'تعذر قراءة قائمة المزامنة المحلية.');
    } finally {
      syncingRef.current = false;
      try { await refreshPending(); }
      catch (error) { setStorageError(`تعذر إعادة قراءة طوابير المزامنة؛ لم تُعتبر فارغة. ${error.message || ''}`); }
      if (changedServer) void refreshData();
    }
  }, [nativeApp, networkOnline, offlineOnly, refreshData, refreshPending, serverState, userId]);

  const handleFullRefresh = useCallback(async () => {
    if (routeLoading) return;
    setRouteLoading(true);
    try {
      await checkServer();
      if (nativeApp) {
        await requestNativeSync().catch(() => undefined);
      }
      await syncTracking({ duty: onDuty, location: gpsRef.current });
      await drainQueue();
      await Promise.all([
        refreshData(),
        refreshAttendance(),
        refreshPending(),
      ]);
      setToast('تم تحديث البيانات والمزامنة الكاملة بنجاح');
    } catch (err) {
      console.warn('[RepApp] handleFullRefresh notice:', err?.message || err);
    } finally {
      setRouteLoading(false);
    }
  }, [checkServer, drainQueue, nativeApp, onDuty, refreshAttendance, refreshData, refreshPending, requestNativeSync, routeLoading, syncTracking]);

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
          setGps(null);
          setNativeGpsEnabled(false);
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
    if (nativeApp && pendingAttendanceActions.length && serverState === 'online' && !offlineOnly) {
      void requestNativeSync().catch(() => undefined);
    }
  }, [nativeApp, offlineOnly, pendingAttendanceActions.length, requestNativeSync, serverState]);

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
    return groupRouteMachinesByRegion(route?.regions, (machine) => {
      if (machine.workOrderStatus && machine.workOrderStatus !== 'in_progress') return false;
      const matchesTerm = !term
        || normalize(machine.machineCode).includes(term)
        || normalize(machine.arabicName).includes(term)
        || normalize(machine.clientName).includes(term)
        || normalize(machine.address).includes(term)
        || normalize(machine.workOrderCode).includes(term)
        || normalize(machine.areaName).includes(term)
        || normalize(machine.regionName).includes(term);
      const matchesFilter = routeFilter === 'all'
        || (routeFilter === 'remaining' && !visitSubmitted(machine))
        || (routeFilter === 'sent' && machine.isSubmitted && !machine.isCompleted)
        || (routeFilter === 'completed' && machine.isCompleted);
      return matchesTerm && matchesFilter;
    });
  }, [query, route, routeFilter]);

  const routeMachines = useMemo(() => (route?.regions ?? []).flatMap((region) => (region.machines ?? []).map((machine) => ({ ...machine, regionName: region.regionName }))), [route]);
  const routeFilterCounts = {
    all: routeMachines.length,
    remaining: routeMachines.filter((machine) => !visitSubmitted(machine)).length,
    sent: routeMachines.filter((machine) => machine.isSubmitted && !machine.isCompleted).length,
    completed: routeMachines.filter((machine) => machine.isCompleted).length,
  };
  const pendingGpsCount = pendingGpsQueue.pending.length + pendingGpsQueue.rejected.length;
  const pendingQueueCount = pendingVisits.length + pendingMachineActions.length + pendingAttendanceActions.length + pendingGpsCount;

  useEffect(() => {
    if (!pendingQueueCount) return undefined;
    const protectQueue = (event) => {
      event.preventDefault();
      event.returnValue = 'توجد عناصر بانتظار المزامنة؛ يمكن أن تضيع قبل خروجها.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', protectQueue);
    return () => window.removeEventListener('beforeunload', protectQueue);
  }, [pendingQueueCount]);

  const exportPending = async () => {
    if (pendingExportBusy) return;
    if (!pendingQueueCount) {
      setToast('لا توجد عناصر بانتظار المزامنة لتصديرها.');
      return;
    }
    setPendingExportBusy(true);
    try {
      const result = await exportPendingQueue(userId, user.username);
      setToast(result.complete
        ? `أُنشئت نسخة استرداد كاملة تضم ${result.totalItems} عنصراً: ${result.path}`
        : `أُنشئت نسخة غير مكتملة؛ العناصر غير المقروءة: ${result.omittedItems}. راجع ملف الاسترداد قبل الاعتماد عليه: ${result.path}`);
    } catch (error) {
      setToast(error.message || 'تعذر إنشاء نسخة JSON من العمل المعلق.');
    } finally {
      setPendingExportBusy(false);
    }
  };

  const importRecovery = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setPendingImportBusy(true);
    try {
      if (!nativeApp) throw new Error('استيراد نسخة الاسترداد متاح من تطبيق أندرويد؛ لا تفتح الملف في متصفح آخر.');
      if (file.size < 1 || file.size > 128 * 1024 * 1024) throw new Error('حجم ملف الاسترداد يجب أن يكون بين 1 بايت و128 ميغابايت.');
      const result = await importNativeRecoveryPackage(await file.text(), userId);
      await loadLocalSnapshots();
      await refreshPending();
      setToast(`اكتمل الاسترداد المحلي: ${result.imported} عنصر جديد، ${result.duplicates} عنصر مطابق موجود مسبقاً. لم يُرفع أي ملف إلى الخادم.`);
    } catch (error) {
      setStorageError(error.message || 'تعذر التحقق من نسخة الاسترداد أو استيرادها.');
    } finally {
      setPendingImportBusy(false);
    }
  };

  const retryMachineAction = async (action) => {
    if (['rejected', 'pending_approval', 'approved'].includes(action.status)) {
      setToast('قرار المراجعة لا يُعاد إرساله. أرسل تصحيحاً جديداً من بطاقة الماكينة بمعرّف إجراء جديد.');
      return;
    }
    try {
      if (nativeApp && action.source === 'native-sqlite') {
        const nativeAction = await retryNativeMachineAction(action.actionUuid, userId);
        await updatePendingMachineAction(action.actionUuid, {
          status: nativeAction.status,
          lastError: nativeAction.lastError ?? '',
          attempts: nativeAction.attempts,
        }).catch((error) => setStorageError(`أُعيد الإجراء في SQLite الأصلية، لكن تعذّر تحديث العرض المساعد: ${error.message}`));
        await refreshPending();
        setToast('أُعيد الإجراء الأصلي بنفس المعرّف والمحتوى؛ ستتم مزامنته من طابور أندرويد.');
        return;
      }
      await updatePendingMachineAction(action.actionUuid, { status: 'queued', lastError: '' });
      await refreshPending();
      void drainQueue();
    } catch (error) {
      setStorageError(error.message || 'تعذرت إعادة إجراء الماكينة؛ بقي محفوظاً دون تغيير.');
    }
  };

  const finishTutorial = () => {
    try { window.localStorage.setItem(`tutorial_seen:${userId}`, '1'); } catch { /* Tutorial is dismissed for this session. */ }
    setTutorialOpen(false);
  };

  const logout = async () => {
    if (hasOpenAttendanceSession(attendance)) {
      setToast('سجّل الانصراف من بطاقة الحضور أولاً؛ يمكنك الخروج بعد إغلاق الوردية.');
      return;
    }
    if (pendingQueueCount) {
      const exit = window.confirm(`لديك ${pendingQueueCount} عنصر(اً) بانتظار المزامنة. اضغط موافق للخروج على مسؤوليتك. اضغط إلغاء ثم "تصدير نسخة JSON" للحفاظ عليها قبل الخروج.`);
      if (!exit) return;
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

  const saveVisit = async ({ visitUuid: draftVisitUuid, machineCondition, reasonIds, maintenanceLines, notes, beforePhotos, afterPhotos, beforeCapturedAt, afterCapturedAt, capturedAt, location }) => {
    const visitUuid = draftVisitUuid || createVisitUuid();
    const payload = {
      visitUuid,
      photoPolicyVersion: 2,
      cardId: Number(selectedMachine.cardId),
      machineCode: selectedMachine.machineCode,
      regionName: selectedMachine.visitRegionName || selectedMachine.regionName,
      machineCondition,
      reasonIds,
      maintenanceLines: maintenanceLines || [],
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
      const storedVisit = nativeApp
        ? { ...queuedVisit, beforePhotos: [], afterPhotos: [], nativeStoragePath }
        : { ...queuedVisit, nativeStoragePath };
      // SQLite is the Android source of truth. IndexedDB only mirrors queue metadata for the existing UI.
      await addPendingVisit(storedVisit).catch((error) => {
        if (!nativeApp) throw error;
        setStorageError(error.message || 'حُفظت الزيارة في قاعدة أندرويد المحلية، وتعذر تحديث عرض قائمة الزيارات.');
      });
      setPendingVisits((current) => [...current, storedVisit].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
      setRoute((current) => current?.regions ? {
        ...current,
        regions: current.regions.map((region) => ({
          ...region,
          machines: region.machines.map((machine) => Number(machine.cardId) === Number(payload.cardId)
            ? { ...machine, workStatus: 'in_progress', workOwnerId: userId, canVisit: false }
            : machine),
        })),
      } : current);
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
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
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
      if (nativeApp) {
        try { await enqueueNativeMachineAction(queuedAction); }
        catch (error) {
          queuedAction.source = 'indexeddb';
          setStorageError(`تعذر حفظ الإجراء في SQLite الأصلية؛ حُفظ في IndexedDB كمسار احتياطي وسيزامن من واجهة التطبيق فقط. ${error.message}`);
        }
      }
      try { await addPendingMachineAction(queuedAction); }
      catch (error) {
        if (!nativeApp) throw error;
        setStorageError(`حُفظ الإجراء في SQLite الأصلية، لكن تعذر حفظ نسخة العرض في IndexedDB: ${error.message}`);
      }
      await refreshPending();
      const online = !offlineOnly && navigator.onLine && networkOnline && serverState === 'online';
      let result = null;
      if (online) {
        try {
          result = await api.post(
            `/api/rep/machines/${encodeURIComponent(queuedAction.machineId)}/confirm-location`,
            payload,
            { timeoutMs: 12000 },
          );
          if (!result?.success || !['approved', 'pending'].includes(result.status)) {
            throw new Error('لم يؤكد الخادم حفظ الموقع؛ بقي الإجراء محفوظاً على الهاتف.');
          }
          const status = locationReviewState(result.status);
          const reviewNote = result.locationConfirmation?.reviewNote ?? result.reviewNote ?? '';
          await updatePendingMachineAction(actionUuid, {
            status, correctionId: result.correctionId, reviewNote, lastError: '',
          });
          if (nativeApp) await reconcileNativeMachineActionReview(actionUuid, userId, {
            status, correctionId: result.correctionId, reviewNote,
          });
          const acknowledgedAction = { ...queuedAction, status, correctionId: result.correctionId, reviewNote };
          setRoute((current) => {
            const updated = applyPendingMachineLocations(current, [acknowledgedAction]);
            void saveSnapshot('route_snapshots', userId, { route: updated, cachedAt: new Date().toISOString() }).catch(() => undefined);
            return updated;
          });
          setToast(status === 'approved'
            ? 'تم اعتماد الموقع الأول فوراً من الخادم؛ يمكنك متابعة الزيارة.'
            : 'أُرسل تصحيح الموقع للمراجعة الإدارية؛ تبقى الزيارة متوقفة حتى القرار.');
          void refreshData();
          await refreshPending();
          return {
            latitude: result.machine?.latitude ?? payload.location.latitude,
            longitude: result.machine?.longitude ?? payload.location.longitude,
            isLocationLocked: status === 'approved',
            approvedLocation: status === 'approved' ? payload.location : null,
            locationConfirmation: result.locationConfirmation ?? { actionUuid, proposedLocation: payload.location, status: result.status },
            locationReviewState: status,
            locationConfirmationPending: status === 'pending_approval',
            canVisit: status === 'approved',
          };
        } catch (error) {
          const permanentClientError = error.status >= 400 && error.status < 500
            && ![408, 425, 429].includes(error.status);
          if (permanentClientError) {
            await updatePendingMachineAction(actionUuid, { status: 'blocked', lastError: error.message });
            await refreshPending();
            throw error;
          }
          await updatePendingMachineAction(actionUuid, { status: 'queued', lastError: error.message || 'بانتظار اتصال الخادم.' });
        }
      }
      const queuedForOverlay = { ...queuedAction, status: 'queued' };
      setRoute((current) => {
        const updated = applyPendingMachineLocations(current, [queuedForOverlay]);
        void saveSnapshot('route_snapshots', userId, { route: updated, cachedAt: new Date().toISOString() }).catch(() => undefined);
        return updated;
      });
      setToast('الموقع محفوظ على الهاتف وبانتظار المزامنة؛ لا يلزم اعتماد مدير للموقع الأول بعد إقرار الخادم.');
      if (online) void drainQueue();
      await refreshPending();
      return {
        locationConfirmation: { actionUuid, proposedLocation: payload.location, status: 'queued' },
        locationReviewState: 'queued',
        locationConfirmationPending: true,
        canVisit: false,
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
      if (nativeApp) {
        try { await enqueueNativeMachineAction(queuedAction, evidence ?? null); }
        catch (error) {
          queuedAction.source = 'indexeddb';
          setStorageError(`تعذر حفظ البلاغ وإثباته في SQLite الأصلية؛ حُفظ في IndexedDB كمسار احتياطي وسيزامن من واجهة التطبيق فقط. ${error.message}`);
        }
      }
      try { await addPendingMachineAction(queuedAction); }
      catch (error) {
        if (!nativeApp) throw error;
        setStorageError(`حُفظ البلاغ وإثباته في SQLite الأصلية، لكن تعذر حفظ نسخة العرض في IndexedDB: ${error.message}`);
      }
      await refreshPending();
      setRoute((current) => updateRouteMachineCorrection(current, selectedMachine.machineId));
      setToast('حُفظ بلاغ اختلاف الماكينة على الهاتف؛ ستتم مزامنته مع صورة الإثبات عند عودة الاتصال.');
      void drainQueue();
    } catch (error) {
      setStorageError(error.message || 'تعذر حفظ بلاغ التصحيح على الهاتف.');
      throw error;
    }
  };

  const submitSelectedMachineLocationChange = async ({ note, evidence, location }) => {
    const form = new FormData();
    form.append('request', JSON.stringify({
      actionUuid: crypto.randomUUID(),
      cardId: selectedMachine.cardId,
      location: {
        latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy,
        updatedAt: location.updatedAt, isMock: location.isMock === true,
      },
      note,
    }));
    if (evidence) form.append('evidence', evidence);
    const result = await api.upload(`/api/rep/machines/${selectedMachine.machineId}/location-change-requests`, form);
    return result;
  };

  const serverLabel = serverState === 'checking'
    ? 'جارٍ فحص الخادم'
    : serverState === 'online' && networkOnline
      ? 'متصل بالسيرفر'
      : networkOnline
        ? 'السيرفر غير متاح'
        : 'أوفلاين · حفظ محلي';
  const regularOpen = Boolean(attendance?.clock_in_time && !attendance.clock_out_time);
  const regularClosed = Boolean(attendance?.clock_in_time && attendance.clock_out_time);
  const overtimeOpen = Boolean(attendance?.overtime_clock_in_time && !attendance.overtime_clock_out_time);
  const overtimeClosed = Boolean(attendance?.overtime_clock_in_time && attendance.overtime_clock_out_time);
  const attendanceIsOpen = regularOpen || overtimeOpen;
  const overtimeApproved = overtimeRequest?.status === 'approved';
  const attendanceIsRevoked = attendance?.status === 'revoked';
  const attendanceIsClosed = attendanceIsRevoked || (regularClosed && !overtimeOpen && !overtimeClosed && !overtimeApproved);
  const overtimeReady = regularClosed && overtimeApproved && !overtimeClosed;
  const canRequestOvertime = regularClosed && !overtimeOpen && !overtimeClosed
    && !overtimeApproved && overtimeRequest?.status !== 'pending';
  const punchAction = attendanceIsOpen ? 'out' : 'in';
  const overtimeHoursForToday = sessionHours(attendance?.overtime_clock_in_time,
    attendance?.overtime_clock_out_time, clockNow);
  const punchLabel = attendanceSaving
    ? 'جارٍ تسجيل البصمة…'
    : regularOpen
      ? 'تسجيل الانصراف ↧'
      : overtimeOpen
        ? 'إنهاء جلسة الأوفرتايم ↧'
        : overtimeReady
          ? 'بدء جلسة الأوفرتايم ↥'
          : attendanceIsRevoked
            ? 'تم إلغاء الحضور'
            : attendanceIsClosed
              ? 'تم تسجيل الانصراف اليوم'
              : 'تسجيل الحضور ↥';

  return (
    <main className="rep-app" dir="rtl">
      <header className="rep-live-header">
        <div className="rep-live-brand">
          <span className="rep-brand-mark" style={{ overflow: 'hidden', padding: 2 }}>
            <img src="/icon.svg" alt="شعار مدار" style={{ width: '100%', height: '100%', display: 'block' }} />
          </span>
          <div><strong>مَــدَارْ</strong><small>مسار المندوب</small></div>
        </div>
        <div className="rep-user-info"><strong>{user.fullName}</strong><span>كود المندوب: <b dir="ltr">{user.username}</b></span></div>
        <div className="rep-header-actions">
          <span className={`rep-connect-status ${serverState === 'online' && networkOnline ? 'connected' : ''} ${serverState === 'checking' ? 'checking' : ''}`}>
            <i aria-hidden="true" />{serverLabel}
          </span>
          {pendingQueueCount > 0 && (
            <button className="rep-queue-count" type="button" onClick={() => void handleFullRefresh()} disabled={routeLoading} aria-label="مزامنة العناصر المعلقة" title="مزامنة فورية">
              <span>⏳</span><b>{pendingQueueCount}</b><small>معلق · مزامنة ↻</small>
            </button>
          )}
          <NotificationBell user={user} online={serverState === 'online' && networkOnline && !offlineOnly} variant="rep" />
          <button className={`rep-icon-button ${activeTab === 'tickets' ? 'active' : ''}`} type="button" onClick={() => setActiveTab((value) => value === 'tickets' ? 'route' : 'tickets')} aria-label="إرسال بلاغ للدعم" title="إرسال بلاغ">؟</button>
          <button className="rep-icon-button rep-refresh-button" type="button" onClick={() => void handleFullRefresh()} disabled={routeLoading} aria-label="تحديث ومزامنة البيانات" title="تحديث ومزامنة كاملة">
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
      {supportPanelOpen && <RepSupportPanel repId={userId} onClose={() => setSupportPanelOpen(false)} />}

      {/* Tab 1: الوردية (Shift / Attendance) */}
      {activeTab === 'shift' && (
        <div className="rep-tab-view rep-tab-shift">
          <section className="rep-attendance-card" aria-label="الحضور والانصراف">
            <div className="rep-attendance-summary">
              <span className="rep-eyebrow">الوردية · {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeZone: 'Africa/Cairo' }).format(new Date())}</span>
              <strong>{attendanceIsRevoked ? 'تم إلغاء الحضور' : attendance?.clock_in_time ? `${attendanceHours(attendance, clockNow).toFixed(2)} ساعة عمل` : 'لم يسجل الحضور بعد'}</strong>
              <small>{attendanceIsRevoked ? 'تم إيقاف تتبع الوردية وإلغاء تسجيل اليوم.' : attendance?.clock_in_time
                ? `حضور ${formatTime(attendance.clock_in_time)}${attendance.clock_out_time ? ` · انصراف ${formatTime(attendance.clock_out_time)}` : ' · الدوام مستمر'}${attendance.overtime_clock_in_time ? ` · أوفرتايم ${formatTime(attendance.overtime_clock_in_time)}${attendance.overtime_clock_out_time ? ` إلى ${formatTime(attendance.overtime_clock_out_time)}` : ' · الجلسة الإضافية مستمرة'}` : ''}`
                : 'تسجيل الحضور بالبصمة الحيوية وإحداثيات الـ GPS الميدانية.'}</small>
            </div>
            <div className="rep-attendance-actions">
              <button
                className={`rep-attendance-punch ${attendanceIsOpen ? 'clock-out' : 'clock-in'} ${overtimeReady ? 'overtime' : ''}`}
                type="button"
                disabled={attendanceSaving || offlineOnly || !nativeApp || attendanceIsClosed}
                onClick={() => void clockAttendance(punchAction)}
                aria-label={regularOpen
                  ? 'تسجيل الانصراف وإيقاف تتبع الوردية'
                  : overtimeOpen
                    ? 'إنهاء جلسة الأوفرتايم'
                    : overtimeReady
                      ? 'بدء جلسة الأوفرتايم المعتمدة'
                      : attendanceIsClosed
                        ? 'تم تسجيل الانصراف لهذا اليوم'
                        : 'تسجيل الحضور وبدء تتبع الوردية'}
              >
                {punchLabel}
              </button>
              <div className={`rep-attendance-gps ${gps ? 'has-fix' : ''}`} role="status">
                <i aria-hidden="true" />
                <span><b>GPS</b> · {gps ? formatGps(gps) : visibleGpsError || 'سيُطلب الموقع عند تسجيل البصمة'}{pendingAttendanceActions.length ? ` · ${pendingAttendanceActions.length} تسجيل حضور بانتظار المزامنة` : ''}</span>
              </div>
            </div>
            {(overtimeRequest || regularClosed) && (
              <div className="rep-attendance-overtime" aria-live="polite">
                {overtimeRequest?.status === 'pending' && (
                  <div className="rep-overtime-state pending">
                    <span><b>طلب أوفرتايم قيد الاعتماد</b><small>أُرسل {formatTime(overtimeRequest.created_at)} وينتظر موافقة المشرف؛ لن يبدأ التسجيل الإضافي قبل الاعتماد.</small></span>
                    <button type="button" disabled={overtimeBusy} onClick={() => void cancelOvertimeRequest()}>{overtimeBusy ? 'جارٍ الإلغاء…' : 'إلغاء الطلب'}</button>
                  </div>
                )}
                {overtimeApproved && !overtimeClosed && (
                  <div className="rep-overtime-state approved">
                    <span><b>تم اعتماد الأوفرتايم</b><small>اضغط «بدء جلسة الأوفرتايم» لتسجيل حضور وانصراف إضافي مرة واحدة لهذا اليوم.</small></span>
                  </div>
                )}
                {overtimeClosed && (
                  <div className="rep-overtime-state done">
                    <span><b>جلسة أوفرتايم مكتملة · {overtimeHoursForToday.toFixed(2)} ساعة</b><small>من {formatTime(attendance.overtime_clock_in_time)} إلى {formatTime(attendance.overtime_clock_out_time)} · تُراجع الساعات إدارياً مع مسير الرواتب.</small></span>
                  </div>
                )}
                {overtimeRequest?.status === 'rejected' && (
                  <div className="rep-overtime-state rejected">
                    <span><b>تم رفض طلب الأوفرتايم</b><small>{overtimeRequest.supervisor_note || 'لم يُسجّل المشرف سبباً للرفض.'} يمكنك إرسال طلب جديد.</small></span>
                  </div>
                )}
                {canRequestOvertime && (overtimeFormOpen ? (
                  <form className="rep-overtime-form" onSubmit={(event) => void submitOvertimeRequest(event)}>
                    <label>سبب الأوفرتايم (اختياري)
                      <textarea value={overtimeReason} onChange={(event) => setOvertimeReason(event.target.value)} maxLength={500} rows={2} placeholder="مثال: استكمال زيارة ماكينة متأخرة" />
                    </label>
                    <div className="rep-overtime-form-actions">
                      <button type="submit" disabled={overtimeBusy}>{overtimeBusy ? 'جارٍ الإرسال…' : 'إرسال الطلب للمشرف'}</button>
                      <button type="button" disabled={overtimeBusy} onClick={() => { setOvertimeFormOpen(false); setOvertimeReason(''); }}>إلغاء</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="rep-overtime-open" onClick={() => setOvertimeFormOpen(true)}>
                    طلب أوفرتايم إضافي · بعد إغلاق الدوام الأساسي
                  </button>
                ))}
              </div>
            )}
          </section>

          {nativeApp && (
            <section className="rep-photo-archive-card" aria-label="حفظ الصور على الهاتف">
              <strong>نسخة الصور على معرض الهاتف</strong>
              <p>{photoArchive?.configured ? 'الحفظ التلقائي مفعّل في المجلد المختار بنفس ترتيب السيرفر.' : 'اختر مجلداً مرة واحدة لنسخ الصور تلقائياً حسب المنطقة والماكينة وقبل/بعد.'}</p>
              {photoArchive?.pending > 0 && <p>صور محفوظة داخل التطبيق بانتظار النسخ: {photoArchive.pending}</p>}
              {photoArchive?.error && <p role="alert">{photoArchive.error}</p>}
              <button type="button" className="rep-button rep-button-light" disabled={photoArchiveBusy} onClick={async () => { setPhotoArchiveBusy(true); try { setPhotoArchive(await chooseNativePhotoArchiveFolder()); } catch (error) { setToast(error.message); } finally { setPhotoArchiveBusy(false); } }}>
                {photoArchiveBusy ? 'جارٍ اختيار المجلد…' : photoArchive?.configured ? 'تغيير مجلد الصور' : 'اختيار مجلد الصور'}
              </button>
            </section>
          )}

          <section className="rep-shift-summary-card">
            <h3>بيانات الوردية</h3>
            <div className="rep-shift-stats-grid">
              <div className="rep-stat-box">
                <span className="rep-stat-label">ساعات العمل</span>
                <span className="rep-stat-value">{attendance?.clock_in_time ? `${attendanceHours(attendance, clockNow).toFixed(2)} س` : '0 س'}</span>
              </div>
              <div className="rep-stat-box">
                <span className="rep-stat-label">حالة الدوام</span>
                <span className="rep-stat-value">{attendanceIsOpen ? '🟢 نشط' : attendanceIsClosed ? '⚪ مغلق' : '⏳ لم يبدأ'}</span>
              </div>
              <div className="rep-stat-box">
                <span className="rep-stat-label">ماكينات اليوم</span>
                <span className="rep-stat-value">{summary.completed} / {summary.totalMachines}</span>
              </div>
              <div className="rep-stat-box">
                <span className="rep-stat-label">دقة الـ GPS</span>
                <span className="rep-stat-value">{gps ? `±${Math.round(gps.accuracy)}م` : 'غير متاح'}</span>
              </div>
            </div>
            {attendance?.clock_in_time && (
              <button type="button" className="rep-button rep-button-primary rep-goto-route-btn" onClick={() => setActiveTab('route')}>
                الذهاب إلى خط سير اليوم ←
              </button>
            )}
          </section>
        </div>
      )}

      {/* Tab 2: خط السير والماكينات (Route & Machines) */}
      {activeTab === 'route' && (
        <div className="rep-tab-view rep-tab-route">
          {!attendance?.clock_in_time && !attendanceIsClosed && (
            <div className="rep-shift-banner-alert" onClick={() => setActiveTab('shift')}>
              <span>⏱️ <strong>تنبيه:</strong> لم يتم تسجيل حضور الوردية بعد.</span>
              <b>سجّل البصمة الآن ←</b>
            </div>
          )}

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
            <div className="rep-progress-foot"><span><i className="done-dot" />معتمدة <b>{summary.completed}</b></span><span><i className="pending-dot" />بانتظار الاعتماد <b>{summary.pendingReview ?? 0}</b></span><span>متبقية <b>{routeFilterCounts.remaining}</b></span><small>{routeLoading ? 'جارٍ تحديث المسار…' : route ? `آخر تحديث ${formatTime(route.cachedAt ?? route.fetchedAt ?? new Date())}` : 'لا توجد نسخة مسار محفوظة بعد'}</small></div>
          </section>

          <section className="rep-route-section">
            <div className="rep-route-heading">
              <div><span className="rep-eyebrow">أوامر الصيانة المعيّنة لك</span><h2>ماكيناتك <small>{summary.totalMachines} بطاقة</small></h2></div>
              <div className="rep-route-heading-actions">
                <button type="button" className={`rep-map-toggle ${showOfflineMap ? 'active' : ''}`} onClick={() => setShowOfflineMap((value) => !value)} aria-expanded={showOfflineMap}>
                  ⌖ {showOfflineMap ? 'إخفاء خريطة الماكينات' : 'خريطة الماكينات · متاحة دون إنترنت'}
                </button>
                <label className="rep-search">
                  <span aria-hidden="true">⌕</span>
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالكود أو العميل أو المنطقة" aria-label="ابحث بالكود أو العميل أو المنطقة" />
                  {query && <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث">×</button>}
                </label>
              </div>
            </div>

            <div className="rep-route-filters" role="group" aria-label="تصفية مسار اليوم">
              {[['remaining', 'المتبقية'], ['sent', 'قيد الاعتماد'], ['completed', 'المعتمدة'], ['all', 'الكل']].map(([value, label]) => (
                <button key={value} type="button" className={routeFilter === value ? 'active' : ''}
                  aria-pressed={routeFilter === value} onClick={() => setRouteFilter(value)}>
                  {label}<b>{routeFilterCounts[value]}</b>
                </button>
              ))}
            </div>

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
                    <details className="rep-region-folder" key={`${region.regionName}-${query.trim() ? 'search' : 'browse'}`} defaultOpen={Boolean(query.trim())}>
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
                              className={`rep-machine-card ${machine.workStatus === 'done' ? 'is-complete' : ''} ${machine.canVisit === false ? 'is-locked' : ''}`}
                              onClick={() => setSelectedMachine({ ...machine, regionName: region.regionName })}
                              disabled={machine.canVisit === false}
                            >
                              <div className="rep-machine-card-top"><span className="rep-machine-code" dir="ltr">{machine.machineCode}</span><span className="rep-machine-status">{machine.reviewStatus === 'pending' ? '🟣 بانتظار مراجعة الصور' : machine.workStatus === 'done' ? '✅ تم' : machine.workStatus === 'in_progress' ? '🟠 قيد التنفيذ' : machine.correctionPending ? '⚠️ بلاغ تصحيح قيد المراجعة' : machine.reviewStatus === 'reshoot' ? '🔁 إعادة تصوير' : machine.canVisit === false ? 'مغلقة' : '⏳ متبقية'}</span></div>
                              <small className="rep-work-order-code">أمر الصيانة · {machine.workOrderCode}</small>
                              {machine.clientName && <strong className="rep-machine-branch">{machine.clientName}</strong>}
                              <span className="rep-machine-name">{machine.arabicName || `ماكينة ${machine.machineCode}`}</span>
                              <span className="rep-machine-address"><i aria-hidden="true">⌖</i>{machine.address || 'عنوان العميل غير مسجل'}</span>
                              {machine.reviewNote && <small className="rep-review-note">ملاحظة المشرف: {machine.reviewNote}</small>}
                              <span className="rep-machine-open">{machine.isCompleted ? 'تم اعتماد الزيارة' : machine.reviewStatus === 'pending' ? 'بانتظار مراجعة الصور · تابع إلى ماكينة أخرى' : machine.reviewStatus === 'reshoot' ? 'افتح لإعادة التصوير' : machine.canVisit === false ? 'للعرض فقط' : 'ابدأ الزيارة'} <b aria-hidden="true">←</b></span>
                            </button>
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
        </div>
      )}

      {/* Tab 3: البلاغات والدعم (Tickets / Support) */}
      {activeTab === 'tickets' && (
        <div className="rep-tab-view rep-tab-tickets">
          <RepSupportPanel repId={userId} inline onClose={() => setActiveTab('route')} />
        </div>
      )}

      {/* Fixed Mobile Bottom Navigation Bar */}
      <nav className="rep-bottom-nav" aria-label="شريط التنقل الرئيسي">
        <button
          type="button"
          className={`rep-nav-item ${activeTab === 'shift' ? 'active' : ''}`}
          onClick={() => { setShowQueue(false); setActiveTab('shift'); }}
          aria-label="تبويب الوردية"
        >
          <span className="rep-nav-icon">{attendanceIsOpen ? '🟢' : '⏱️'}</span>
          <span className="rep-nav-label">الوردية</span>
        </button>
        <button
          type="button"
          className={`rep-nav-item ${activeTab === 'route' ? 'active' : ''}`}
          onClick={() => { setShowQueue(false); setActiveTab('route'); }}
          aria-label="تبويب خط السير"
        >
          <span className="rep-nav-icon">📋</span>
          <span className="rep-nav-label">خط السير</span>
          {routeFilterCounts.remaining > 0 && (
            <span className="rep-nav-badge">{routeFilterCounts.remaining}</span>
          )}
        </button>
        <button
          type="button"
          className={`rep-nav-item ${activeTab === 'tickets' ? 'active' : ''}`}
          onClick={() => { setShowQueue(false); setActiveTab('tickets'); }}
          aria-label="تبويب البلاغات"
        >
          <span className="rep-nav-icon">💬</span>
          <span className="rep-nav-label">البلاغات</span>
        </button>
      </nav>

      <footer className="rep-app-footer">
        <span>مَــدَارْ · تطبيق المندوب الميداني{appVersion ? ` · إصدار ${appVersion}` : ''}</span>
        <span>{gps ? `آخر GPS: ${formatGps(gps)}` : visibleGpsError || (nativeApp ? 'جاري تحديد موقع GPS...' : 'يُسجّل GPS مع الحضور والانصراف والزيارة')}</span>
      </footer>

      {selectedMachine && <MachineVisitSheet machine={{ ...selectedMachine, ...(route?.regions ?? []).flatMap((region) => region.machines).find((machine) => machine.cardId === selectedMachine.cardId) }} repId={userId} repName={user.fullName} reasons={reasons} gps={gps} gpsError={visibleGpsError} captureLocation={captureVisitLocation} onStartWork={startMachineWork} onStopWork={stopMachineWork} onClose={() => setSelectedMachine(null)} onSave={saveVisit} onConfirmLocation={confirmSelectedMachineLocation} onReportCorrection={submitSelectedMachineCorrection} onRequestLocationChange={submitSelectedMachineLocationChange} />}
      {tutorialOpen && <Tutorial nativeApp={nativeApp} onFinish={finishTutorial} />}
      {toast && <div className="rep-toast" role="status">✓ {toast}</div>}
    </main>
  );
}
