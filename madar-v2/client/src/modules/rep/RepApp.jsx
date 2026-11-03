import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import MachineVisitSheet from './MachineVisitSheet.jsx';
import {
  addPendingVisit,
  deletePendingVisit,
  getSnapshot,
  listPendingVisits,
  markRouteCardSubmitted,
  requestPersistentStorage,
  saveSnapshot,
  updatePendingVisit,
} from './offline-store.js';
import {
  addNativeAppStateListener,
  addNativeBackListener,
  addNativeNetworkListener,
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
    body: 'يساعد GPS في توثيق الموقع وقت التصوير أثناء فتح التطبيق. تُضغط الصور وتُحفظ الزيارة على هذا الهاتف أولاً، ثم تُرفع عند توفر اتصال بالخادم.',
    tip: 'الختم الظاهر على الصورة معلومات مساعدة من الجهاز، وليس دليلاً غير قابل للتعديل. أبقِ التطبيق مفتوحاً لتحديث الموقع.',
  },
];

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar');
}

function formatTime(value) {
  if (!value) return 'غير معروف';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatGps(location) {
  if (!location) return 'الموقع غير متاح';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · دقة ±${Math.round(location.accuracy)}م`;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function visitSubmitted(machine) {
  return Boolean(machine.isCompleted || machine.isSubmitted);
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
    ? 'يُحفظ المسار والزيارات على هذا الهاتف. في تطبيق أندرويد، شغّل «أون ديوتي» واسمح بالموقع طوال الوقت لتسجيل GPS محلياً في الخلفية؛ وستتم مزامنة الزيارات عند عودة اتصال الخادم.'
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
  const [reasons, setReasons] = useState([]);
  const [pendingVisits, setPendingVisits] = useState([]);
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
  const [toast, setToast] = useState('');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [storagePersistent, setStoragePersistent] = useState(null);
  const [storageError, setStorageError] = useState('');
  const syncingRef = useRef(false);
  const trackingCursorRef = useRef(0);
  const gpsRef = useRef(null);
  const seenReviewNoticesRef = useRef(new Set());
  const nativeBackStateRef = useRef({});
  const userId = Number(user.id);
  const nativeApp = isNativeRepApp();

  const refreshPending = useCallback(async () => {
    const visits = await listPendingVisits(userId);
    setPendingVisits(visits);
    return visits;
  }, [userId]);

  const syncTracking = useCallback(async (options = {}) => {
    const duty = options.duty ?? onDuty;
    const hasLocationOverride = Object.hasOwn(options, 'location');
    if (offlineOnly || !navigator.onLine) return false;
    try {
      const state = nativeApp ? await getNativeDutyTrackingState() : null;
      const mocked = Boolean(state?.mocked);
      const nativeLocation = state?.lastLocation && !mocked ? {
        latitude: state.lastLocation.latitude,
        longitude: state.lastLocation.longitude,
        accuracy: state.lastLocation.accuracy,
        updatedAt: new Date(state.lastLocation.timestamp).toISOString(),
      } : null;
      const location = mocked
        ? null
        : hasLocationOverride ? options.location : duty ? nativeLocation ?? gpsRef.current : null;
      const trail = (state?.trail ?? []).filter((point) => !point.mocked
        && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
        && Number(point.timestamp ?? 0) > trackingCursorRef.current)
        .map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
          updatedAt: point.updatedAt ?? new Date(point.timestamp).toISOString(),
        }));
      const chunks = [];
      for (let index = 0; index < trail.length; index += 450) chunks.push(trail.slice(index, index + 450));
      const closeAfterFlush = !duty || options.stop === true;
      for (const [index, chunk] of chunks.entries()) {
        const response = await api.post('/api/rep/tracking', {
          onDuty: true,
          location: !closeAfterFlush && index === chunks.length - 1 ? location : null,
          trail: chunk,
        });
        if (!response?.success) return false;
        if (chunk.length) {
          trackingCursorRef.current = Math.max(
            trackingCursorRef.current,
            ...chunk.map((point) => new Date(point.updatedAt).valueOf()),
          );
        }
      }
      if (closeAfterFlush || !chunks.length) {
        const response = await api.post('/api/rep/tracking', {
          onDuty: closeAfterFlush ? false : Boolean(duty) && !mocked,
          location: closeAfterFlush ? null : location,
          trail: [],
        });
        return Boolean(response?.success);
      }
      return true;
    } catch {
      // GPS samples remain on the device and are retried on the next heartbeat.
      return false;
    }
  }, [nativeApp, offlineOnly, onDuty]);

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
          updatedAt: new Date(position.timestamp).toISOString(),
        };
      } else {
        return gpsRef.current;
      }
      setGps(location);
      setGpsError('');
      return location;
    } catch (error) {
      setGpsError(error.message || 'تعذر تحديث GPS عند حفظ الزيارة.');
      return gpsRef.current;
    }
  }, [nativeApp]);

  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);

  const loadLocalSnapshots = useCallback(async () => {
    try {
      const recoveredCount = await restoreNativePendingBackups(userId);
      const [savedRoute, savedReasons, visits] = await Promise.all([
        getSnapshot('route_snapshots', userId),
        getSnapshot('reason_snapshots', userId),
        listPendingVisits(userId),
      ]);
      if (savedRoute?.route) setRoute({ ...savedRoute.route, cachedAt: savedRoute.cachedAt });
      if (savedReasons?.reasons) setReasons(savedReasons.reasons);
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
      api.get(`/api/rep/today-route?${params.toString()}`),
      api.get('/api/rep/fault-reasons'),
    ]);
    if (routeResult.status === 'fulfilled' && routeResult.value?.success) {
      const cachedRoute = { ...routeResult.value, cachedAt: new Date().toISOString() };
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

  const checkServer = useCallback(async () => {
    const online = navigator.onLine;
    setNetworkOnline(online);
    if (!online) {
      setServerState('offline');
      return false;
    }
    setServerState('checking');
    try {
      await api.get('/api/health');
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
    void requestPersistentStorage().then(setStoragePersistent);
  }, [loadLocalSnapshots, refreshData]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const reachable = await checkServer();
      if (!active || !reachable) return;
      await refreshData();
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
  }, [checkServer, refreshData, syncTracking]);

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
            if (reachable) { void refreshData(); void syncTracking(); }
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
  }, [checkServer, nativeApp, refreshData, syncTracking]);

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
      setOnDuty(Boolean(state.active));
      void syncTracking({ duty: Boolean(state.active) });
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
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [nativeApp, syncTracking]);

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
      const readNativePosition = async () => {
        try {
          const location = await getNativeGpsLocation();
          if (!active) return;
          setGps(location);
          setGpsError('');
          if (onDuty) void syncTracking({ duty: true, location });
        } catch (error) {
          if (!active) return;
          setGpsError(error.message || 'إشارة GPS غير متاحة حالياً.');
          if (/تزييف الموقع/.test(error.message ?? '')) {
            setGps(null);
            setOnDuty(false);
            void syncTracking({ duty: false, location: null });
          }
        }
      };
      void readNativePosition();
      const timer = window.setInterval(() => void readNativePosition(), 12000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }
    if (!navigator.geolocation) {
      setGpsError('هذا المتصفح لا يدعم تحديد الموقع.');
      return undefined;
    }
    setGpsError('جارٍ طلب إشارة GPS...');
    const watchId = navigator.geolocation.watchPosition((position) => {
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        updatedAt: new Date(position.timestamp).toISOString(),
      };
      setGps(location);
      setGpsError('');
      if (onDuty) void syncTracking({ duty: true, location });
    }, (error) => {
      const messages = {
        1: 'اسمح للتطبيق باستخدام الموقع من إعدادات الهاتف.',
        2: 'تعذر تحديد الموقع حالياً؛ يمكنك حفظ الزيارة بدونه.',
        3: 'انتهت مهلة تحديد الموقع؛ سنحاول مجدداً.',
      };
      setGpsError(messages[error.code] || 'إشارة GPS غير متاحة حالياً.');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [nativeApp, onDuty, selectedMachine, syncTracking]);

  const drainQueue = useCallback(async () => {
    if (syncingRef.current || offlineOnly || !navigator.onLine || serverState !== 'online') return;
    syncingRef.current = true;
    let changedServer = false;
    try {
      const visits = await listPendingVisits(userId);
      setPendingVisits(visits);
      for (const queuedVisit of visits) {
        // Never send a visit queued by another representative, even after an account switch.
        if (Number(queuedVisit.repId) !== userId || queuedVisit.status === 'blocked') continue;
        await updatePendingVisit(queuedVisit.visitUuid, { status: 'syncing', lastAttemptAt: new Date().toISOString() });
        const formData = new FormData();
        formData.append('visit', JSON.stringify(queuedVisit.payload));
        formData.append('beforePhoto', queuedVisit.beforePhoto, `${queuedVisit.visitUuid}-before.jpg`);
        formData.append('afterPhoto', queuedVisit.afterPhoto, `${queuedVisit.visitUuid}-after.jpg`);
        try {
          const result = await api.upload('/api/rep/sync-visit', formData);
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
  }, [checkServer, drainQueue, nativeApp, refreshData, syncTracking]);

  useEffect(() => {
    if (pendingVisits.length && serverState === 'online' && !offlineOnly) void drainQueue();
  }, [drainQueue, offlineOnly, pendingVisits.length, serverState]);

  useEffect(() => {
    if (!pendingVisits.length || offlineOnly) return undefined;
    const timer = window.setInterval(() => void drainQueue(), 30000);
    return () => window.clearInterval(timer);
  }, [drainQueue, offlineOnly, pendingVisits.length]);

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

  const routeMachines = (route?.regions ?? []).flatMap((region) => region.machines ?? []);
  const routeFilterCounts = {
    all: routeMachines.length,
    remaining: routeMachines.filter((machine) => !visitSubmitted(machine)).length,
    completed: routeMachines.filter(visitSubmitted).length,
  };

  const finishTutorial = () => {
    try { window.localStorage.setItem(`tutorial_seen:${userId}`, '1'); } catch { /* Tutorial is dismissed for this session. */ }
    setTutorialOpen(false);
  };

  const toggleDuty = async () => {
    if (!nativeApp) {
      const nextDuty = !onDuty;
      setOnDuty(nextDuty);
      void syncTracking({ duty: nextDuty, location: gps });
      return;
    }
    if (onDuty) {
      try {
        await syncTracking({ duty: false, stop: true });
        await stopNativeDutyTracking();
        setOnDuty(false);
        setToast('تم إيقاف تتبع GPS للوردية.');
      } catch (error) {
        setToast(error.message || 'تعذر إيقاف تتبع الوردية.');
      }
      return;
    }
    try {
      await startNativeDutyTracking();
      setOnDuty(true);
      void syncTracking({ duty: true });
      setToast('بدأ تتبع GPS أثناء الوردية. يمكنك إيقافه من زر أوف ديوتي.');
    } catch (error) {
      setToast(error.message || 'تعذر بدء تتبع الوردية.');
    }
  };

  const logout = async () => {
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

  const saveVisit = async ({ machineCondition, reasonIds, notes, beforePhoto, afterPhoto, beforeCapturedAt, afterCapturedAt, capturedAt, location }) => {
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
      beforePhoto,
      afterPhoto,
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
      setToast('حُفظت الزيارة والصورتان على هذا الهاتف. ستتم المزامنة عند اتصال الخادم.');
    } catch (error) {
      setStorageError(error.message || 'لم يتم حفظ الزيارة. تحقق من مساحة الهاتف وحاول مجدداً.');
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
          <button className={`rep-duty-toggle ${onDuty ? 'on-duty' : ''}`} type="button" onClick={() => void toggleDuty()} aria-pressed={onDuty}>
            {onDuty ? 'أون ديوتي 🟢' : 'أوف ديوتي 🔴'}
          </button>
          <button className="rep-queue-count" type="button" onClick={() => setShowQueue((value) => !value)} aria-expanded={showQueue}>
            <span>⏳</span><b>{pendingVisits.length}</b><small>معلق</small>
          </button>
          <button className="rep-icon-button rep-refresh-button" type="button" onClick={() => { void checkServer(); void refreshData(); }} disabled={routeLoading} aria-label="تحديث مسار اليوم" title="تحديث المسار">
            <span className={routeLoading ? 'rep-spinning' : ''}>↻</span>
          </button>
          <button className="rep-logout-button" type="button" onClick={() => void logout()}>خروج</button>
        </div>
      </header>

      {offlineOnly && <div className="rep-offline-banner" role="status">أنت في وضع العمل المحلي. لا تُرسل أي بيانات حتى تتم إعادة التحقق من الجلسة مع الخادم.</div>}

      <section className="rep-welcome-row">
        <div>
          <span className="rep-eyebrow">{new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full' }).format(new Date())}</span>
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
          <div><span className="rep-eyebrow">الفولدرات الميدانية</span><h2>ماكيناتك اليوم <small>{summary.totalMachines} إجمالي</small></h2></div>
          <label className="rep-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بكود الماكينة أو اسمها" aria-label="ابحث بكود الماكينة أو اسمها" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث">×</button>}
          </label>
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
                          <div className="rep-machine-card-top"><span className="rep-machine-code" dir="ltr">{machine.machineCode}</span><span className="rep-machine-status">{machine.isCompleted ? '✅ معتمدة' : machine.reviewStatus === 'pending' ? '🟡 بانتظار الاعتماد' : machine.reviewStatus === 'reshoot' ? '🔁 إعادة تصوير' : machine.canVisit === false ? 'مغلقة' : '⏳ متبقية'}</span></div>
                          {machine.clientName && <strong className="rep-machine-branch">{machine.clientName}</strong>}
                          <span className="rep-machine-name">{machine.arabicName || `ماكينة ${machine.machineCode}`}</span>
                          <span className="rep-machine-address"><i aria-hidden="true">⌖</i>{machine.address || 'عنوان العميل غير مسجل'}</span>
                          {machine.reviewNote && <small className="rep-review-note">ملاحظة المشرف: {machine.reviewNote}</small>}
                          <span className="rep-machine-open">{machine.isCompleted ? 'تم اعتماد الزيارة' : machine.reviewStatus === 'pending' ? 'بانتظار قرار المشرف' : machine.reviewStatus === 'reshoot' ? 'افتح لإعادة التصوير' : machine.canVisit === false ? 'للعرض فقط' : 'ابدأ الزيارة'} <b aria-hidden="true">←</b></span>
                        </button>
                        {machine.address && <a className="rep-map-link" href={mapsUrl(machine.address)} target="_blank" rel="noopener noreferrer">⌖ فتح الموقع في Google Maps</a>}
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
          <div className="rep-empty-state"><span className="rep-empty-icon">▤</span><h3>{networkOnline ? 'لا توجد ماكينات مسندة اليوم' : 'لا توجد نسخة محلية للمسار بعد'}</h3><p>{networkOnline ? 'اسحب للأسفل أو استخدم زر التحديث إذا أضاف المشرف تكليفاً جديداً.' : 'اتصل بالخادم مرة واحدة لتنزيل مسارك، وبعدها يمكنك متابعة العمل أوفلاين.'}</p><button type="button" className="rep-button rep-button-light" onClick={() => { void checkServer(); void refreshData(); }}>إعادة المحاولة</button></div>
        )}
      </section>

      {showQueue && <section className="rep-queue-panel" aria-label="قائمة الزيارات المعلقة">
        <div className="rep-queue-panel-head"><div><span className="rep-eyebrow">التخزين المحلي</span><h2>زيارات بانتظار المزامنة <small>{pendingVisits.length}</small></h2></div><button className="rep-icon-button" type="button" onClick={() => setShowQueue(false)} aria-label="إخفاء قائمة المزامنة">×</button></div>
        {!pendingVisits.length ? <p className="rep-queue-empty">لا توجد زيارات معلقة لهذا الحساب.</p> : <ul className="rep-queue-list">{pendingVisits.map((visit) => <li key={visit.visitUuid}>
          <span className={`rep-queue-state ${visit.status === 'syncing' ? 'syncing' : ''} ${visit.status === 'blocked' ? 'blocked' : ''}`} aria-hidden="true">{visit.status === 'syncing' ? '↻' : visit.status === 'blocked' ? '!' : '⏳'}</span>
          <div><strong>ماكينة {visit.payload.machineCode} · {visit.payload.regionName}</strong><small>حُفظت {formatTime(visit.createdAt)}{visit.attempts ? ` · محاولات ${visit.attempts}` : ''} · {visit.status === 'blocked' ? 'تحتاج مراجعة' : visit.status === 'syncing' ? 'جارٍ الإرسال' : 'بانتظار المزامنة'}</small>{visit.lastError && <small className="rep-queue-error">{visit.lastError}</small>}</div>
          {visit.status === 'blocked'
            ? <button type="button" className="rep-queue-retry" disabled={serverState !== 'online' || offlineOnly} onClick={async () => { await updatePendingVisit(visit.visitUuid, { status: 'queued', lastError: '' }); await refreshPending(); void drainQueue(); }}>إعادة المحاولة</button>
            : <span className="rep-queue-local">محفوظة محلياً</span>}
        </li>)}</ul>}
        <button type="button" className="rep-button rep-button-primary rep-sync-now" disabled={!pendingVisits.length || serverState !== 'online' || offlineOnly} onClick={() => void drainQueue()}>{serverState === 'online' ? 'مزامنة الآن ↻' : 'ستتم المزامنة عند الاتصال'}</button>
      </section>}

      <footer className="rep-app-footer"><span>مَــدَارْ · تطبيق المندوب الميداني</span><span>{gps ? `آخر GPS: ${formatGps(gps)}` : onDuty ? gpsError : nativeApp ? 'فعّل أون ديوتي لتسجيل GPS بالخلفية' : 'GPS يعمل أثناء فتح التطبيق فقط'}</span></footer>

      {selectedMachine && <MachineVisitSheet machine={selectedMachine} reasons={reasons} gps={gps} gpsError={gpsError} captureLocation={captureVisitLocation} onClose={() => setSelectedMachine(null)} onSave={saveVisit} />}
      {tutorialOpen && <Tutorial nativeApp={nativeApp} onFinish={finishTutorial} />}
      {toast && <div className="rep-toast" role="status">✓ {toast}</div>}
    </main>
  );
}
