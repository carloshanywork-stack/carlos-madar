import { useCallback, useEffect, useState } from 'react';
import {
  getNativePermissionStatus,
  isNativeRepApp,
  openNativeAppSettings,
  requestNativeBatteryExemption,
  requestNativeInitialPermissions,
} from '../../lib/device-permissions.js';
import './native-permissions.css';

const DISMISSED_KEY = 'madar-native-permissions-gate-v1';

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // The gate still works for this session when storage is unavailable.
  }
}

function wasDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function PermissionRow({ granted, title, description, action }) {
  return (
    <li className={`native-permission-row ${granted ? 'is-granted' : 'is-missing'}`}>
      <span className="native-permission-mark" aria-hidden="true">{granted ? '✓' : '!'}</span>
      <span className="native-permission-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {!granted && action ? (
        <button type="button" className="native-permission-mini" onClick={action.onClick}>{action.label}</button>
      ) : null}
    </li>
  );
}

export default function NativePermissionsGate({ children }) {
  const native = isNativeRepApp();
  const [available, setAvailable] = useState(null);
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(() => (native ? wasDismissed() : true));
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!native) return null;
    const next = await getNativePermissionStatus();
    setAvailable(Boolean(next));
    if (next) setStatus(next);
    return next;
  }, [native]);

  useEffect(() => {
    if (!native) return undefined;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [native, refresh]);

  const requestPermissions = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const next = await requestNativeInitialPermissions();
      if (next) setStatus(next);
      setAsked(true);
      if (!next?.camera || !next?.location) {
        setError('لم تُمنح الصلاحيات الأساسية. افتح إعدادات التطبيق وفعّل الكاميرا والموقع الدقيق ثم عد إلى مدار.');
      }
    } catch (requestError) {
      setError(requestError?.message || 'تعذر طلب الصلاحيات. افتح إعدادات التطبيق وفعّلها يدوياً.');
    } finally {
      setBusy(false);
    }
  }, []);

  const enableBackgroundLocation = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await openNativeAppSettings();
      setAsked(true);
    } catch {
      setError('تعذر فتح إعدادات التطبيق. افتحها يدوياً من إعدادات الهاتف.');
    } finally {
      setBusy(false);
    }
  }, []);

  const exemptBattery = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await requestNativeBatteryExemption();
      setAsked(true);
    } catch {
      setError('تعذر فتح إعدادات البطارية. افتحها يدوياً من إعدادات الهاتف.');
    } finally {
      setBusy(false);
    }
  }, []);

  const continueAnyway = useCallback(() => {
    rememberDismissed();
    setDismissed(true);
  }, []);

  if (!native) return children;
  if (available === false) return children;
  if (available === null || !status) {
    return (
      <main className="native-permissions-gate" dir="rtl">
        <p className="native-permissions-loading">جارٍ التحقق من صلاحيات الهاتف…</p>
      </main>
    );
  }
  if (status.camera && status.location && (status.backgroundLocation || dismissed)) return children;

  const allGranted = Boolean(
    status?.camera && status?.location && status?.backgroundLocation
      && status?.notifications && status?.ignoringBatteryOptimizations,
  );
  const needsBackgroundOnly = Boolean(status?.camera && status?.location && !status?.backgroundLocation);

  return (
    <main className="native-permissions-gate" dir="rtl">
      <section className="native-permissions-card" aria-labelledby="native-permissions-title">
        <header className="native-permissions-head">
          <span className="native-permissions-badge" aria-hidden="true">مدار</span>
          <p className="native-permissions-eyebrow">تطبيق المندوب · أندرويد</p>
          <h1 id="native-permissions-title">قبل البدء، نحتاج صلاحيات الهاتف</h1>
          <p className="native-permissions-lead">
            يعمل تطبيق مدار الميداني دون إنترنت. تسمح هذه الصلاحيات بتصوير الماكينات وتسجيل
            الحضور بموقعك، ومتابعة خط السير أثناء إغلاق الشاشة.
          </p>
        </header>

        <ul className="native-permissions-list">
          <PermissionRow
            granted={Boolean(status?.camera)}
            title="الكاميرا"
            description="لتصوير الماكينة قبل وبعد الصيانة. لا نصل إلى معرض الصور."
          />
          <PermissionRow
            granted={Boolean(status?.location)}
            title="الموقع الدقيق"
            description="لتسجيل حضورك وانصرافك عند موقع العميل."
          />
          <PermissionRow
            granted={Boolean(status?.backgroundLocation)}
            title="الموقع أثناء إغلاق الشاشة"
            description="لمتابعة خط السير في الخلفية أثناء الوردية فقط."
            action={{ label: 'الإعدادات', onClick: enableBackgroundLocation }}
          />
          <PermissionRow
            granted={Boolean(status?.notifications)}
            title="الإشعارات"
            description="لإظهار تنبيه التتبع النشط وإشعارات المزامنة."
          />
          <PermissionRow
            granted={Boolean(status?.ignoringBatteryOptimizations)}
            title="استثناء من تحسين البطارية"
            description="حتى لا يوقف أندرويد رفع الزيارات عند إغلاق التطبيق."
            action={{ label: 'تفعيل', onClick: exemptBattery }}
          />
        </ul>

        {error ? <p className="native-permissions-error" role="alert">{error}</p> : null}
        {asked && !allGranted ? (
          <p className="native-permissions-hint">
            بعد الرجوع من الإعدادات، اختر «السماح طوال الوقت» للموقع ثم عد إلى مدار؛
            ستُحدَّث الحالة تلقائياً.
          </p>
        ) : null}

        <div className="native-permissions-actions">
          <button
            type="button"
            className="native-permissions-primary"
            onClick={needsBackgroundOnly ? enableBackgroundLocation : requestPermissions}
            disabled={busy}
          >
            {busy
              ? 'جارٍ التفعيل…'
              : needsBackgroundOnly
                ? 'السماح بالموقع أثناء إغلاق الشاشة'
                : status?.camera && status?.location
                  ? 'استكمال الصلاحيات'
                  : 'السماح بالصلاحيات'}
          </button>
          <button type="button" className="native-permissions-secondary" onClick={enableBackgroundLocation} disabled={busy}>
            فتح إعدادات الهاتف للتفعيل
          </button>
          <button type="button" className="native-permissions-skip" onClick={continueAnyway}>
            المتابعة الآن بدون صلاحيات كاملة
          </button>
        </div>

        <p className="native-permissions-note">
          بدون الكاميرا والموقع لن يعمل تسجيل الحضور ولا توثيق الزيارات. يمكنك تفعيلها
          لاحقاً من إعدادات التطبيق.
        </p>
      </section>
    </main>
  );
}
