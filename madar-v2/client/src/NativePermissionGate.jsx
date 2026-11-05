import { useCallback, useEffect, useState } from 'react';
import { isNativeRepApp, RepEngine } from './modules/rep/native-session.js';

function requiredGranted(state) {
  return Boolean(state?.camera && state?.fineLocation && state?.coarseLocation
    && state?.notifications && state?.backgroundLocation);
}

export default function NativePermissionGate({ children }) {
  const nativeAndroid = isNativeRepApp();
  const [state, setState] = useState(nativeAndroid ? null : { ready: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batterySkipped, setBatterySkipped] = useState(false);

  const refresh = useCallback(async () => {
    if (!nativeAndroid) return { ready: true };
    const permissions = await RepEngine.getPermissionState();
    setState(permissions);
    return permissions;
  }, [nativeAndroid]);

  useEffect(() => {
    if (!nativeAndroid) return undefined;
    let active = true;
    const initialize = async () => {
      try {
        let permissions = await RepEngine.getPermissionState();
        if (active) setState(permissions);
        const foregroundReady = permissions.camera && permissions.fineLocation
          && permissions.coarseLocation && permissions.notifications;
        if (!foregroundReady && !permissions.initialRequestMade) {
          permissions = await RepEngine.requestInitialPermissions();
        } else if (foregroundReady && !permissions.backgroundLocation
          && Number(permissions.sdkInt) === 29 && !permissions.backgroundRequestMade) {
          permissions = await RepEngine.requestBackgroundPermission();
        }
        if (active) setState(permissions);
      } catch (requestError) {
        if (active) setError(requestError.message || 'تعذر فحص صلاحيات الهاتف.');
      }
    };
    void initialize();
    const onResume = () => { void refresh().catch(() => undefined); };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      active = false;
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [nativeAndroid, refresh]);

  const run = async (operation) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (requestError) {
      setError(requestError.message || 'تعذر تنفيذ طلب الصلاحية.');
    } finally {
      setBusy(false);
    }
  };

  if (!nativeAndroid) return children;
  if (state && requiredGranted(state) && (state.batteryOptimizationIgnored || batterySkipped)) return children;

  const missing = [];
  if (!state?.camera) missing.push('الكاميرا لالتقاط صور قبل الصيانة وبعدها');
  if (!state?.fineLocation || !state?.coarseLocation) missing.push('الموقع الدقيق لتأكيد الماكينة وتسجيل GPS');
  if (!state?.notifications) missing.push('الإشعارات لعرض حالة التتبع أثناء الوردية');
  if (!state?.backgroundLocation) missing.push('الموقع طوال الوقت لتسجيل المسار والشاشة مغلقة');

  return (
    <main dir="rtl" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#f2f6f4', color: '#18352e', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: 'min(100%, 560px)', background: '#fff', border: '1px solid #d8e4df', borderRadius: 22, padding: '28px 24px', boxShadow: '0 18px 55px #12392c18' }}>
        <span style={{ color: '#198265', fontWeight: 800, letterSpacing: 1 }}>مدار · إعداد الهاتف</span>
        <h1 style={{ margin: '12px 0', fontSize: 25 }}>نحتاج تفعيل صلاحيات العمل الميداني</h1>
        <p style={{ lineHeight: 1.8, color: '#50645d' }}>قبل تسجيل الدخول، اسمح للصلاحيات التالية حتى يعمل التطبيق دون إنترنت ويسجل الزيارات والمسار بأمان على هذا الهاتف:</p>
        <ul style={{ paddingRight: 22, lineHeight: 2 }}>{missing.map((permission) => <li key={permission}>{permission}</li>)}</ul>
        {error && <p role="alert" style={{ color: '#a33131', lineHeight: 1.7 }}>{error}</p>}
        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          {(!state?.camera || !state?.fineLocation || !state?.coarseLocation || !state?.notifications) && (
            <button type="button" disabled={busy} onClick={() => void run(() => RepEngine.requestInitialPermissions())} style={primaryButton}>
              {busy ? 'جارٍ فحص الصلاحيات…' : 'طلب صلاحيات الكاميرا والموقع والإشعارات'}
            </button>
          )}
          {!state?.backgroundLocation && (
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const result = await RepEngine.requestBackgroundPermission();
              if (result?.settingsRequired) await RepEngine.openAppSettings();
            })} style={primaryButton}>
              تفعيل «السماح طوال الوقت» للموقع
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run(() => RepEngine.openAppSettings())} style={secondaryButton}>
            فتح إعدادات الهاتف للتفعيل
          </button>
          {state && !state.batteryOptimizationIgnored && (
            <button type="button" disabled={busy} onClick={() => void run(() => RepEngine.requestBatteryExemption())} style={secondaryButton}>
              طلب استثناء MADAR من تحسين البطارية
            </button>
          )}
          {state && requiredGranted(state) && !state.batteryOptimizationIgnored && (
            <button type="button" disabled={busy} onClick={() => setBatterySkipped(true)} style={secondaryButton}>متابعة دون استثناء البطارية</button>
          )}
        </div>
        <small style={{ display: 'block', marginTop: 16, color: '#60736c', lineHeight: 1.7 }}>على Android 11 فأحدث، امنح صلاحية الموقع بالخلفية من صفحة أذونات الموقع في إعدادات التطبيق. لا يطلب MADAR صلاحية مكتبة الصور؛ تُحفظ الصور الملتقطة داخل مساحة التطبيق الخاصة.</small>
      </section>
    </main>
  );
}

const primaryButton = { border: 0, borderRadius: 12, padding: '13px 16px', background: '#14775f', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' };
const secondaryButton = { border: '1px solid #c9d9d2', borderRadius: 12, padding: '12px 16px', background: '#f7faf8', color: '#245143', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
