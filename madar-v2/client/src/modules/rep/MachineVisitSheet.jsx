import { useEffect, useRef, useState } from 'react';
import { compressAndWatermark, locationPayload } from './image-processing.js';
import { captureNativeCameraPhoto, isNativeRepApp } from './native-bridges.js';

function showLocation(location) {
  if (!location) return 'بانتظار إشارة GPS';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · دقة ±${Math.round(location.accuracy)}م`;
}

function distanceMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export default function MachineVisitSheet({ machine, reasons, gps, gpsError, captureLocation, onClose, onSave }) {
  const [machineCondition, setMachineCondition] = useState('');
  const [reasonIds, setReasonIds] = useState([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState({ before: [], after: [] });
  const [processingPhase, setProcessingPhase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const beforeInput = useRef(null);
  const afterInput = useRef(null);
  const previewUrls = useRef(new Set());
  const nativeApp = isNativeRepApp();

  useEffect(() => () => {
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    void captureLocation?.();
    const timer = window.setInterval(() => { void captureLocation?.(); }, 20000);
    return () => window.clearInterval(timer);
  }, [captureLocation]);

  const locationLocked = machine.isLocationLocked === true;
  const hasMachinePin = Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude);
  const measuredDistance = gps && hasMachinePin
    ? distanceMeters(gps, { latitude: machine.latitude, longitude: machine.longitude })
    : null;
  const effectiveDistance = measuredDistance === null ? null : Math.max(0, measuredDistance - Number(gps.accuracy ?? 0));
  const radius = Math.max(1, Number(machine.geofenceRadiusMeters) || 50);
  const withinGeofence = !locationLocked || (hasMachinePin && effectiveDistance !== null && effectiveDistance <= radius);
  const canCapture = Boolean(gps) && withinGeofence;

  const toggleReason = (id) => {
    setReasonIds((current) => current.includes(Number(id))
      ? current.filter((item) => item !== Number(id))
      : [...current, Number(id)]);
  };

  const processCaptures = async (phase, files) => {
    const selectedFiles = Array.from(files ?? []).filter(Boolean);
    if (!selectedFiles.length) return;
    setError('');
    const capturedLocation = await captureLocation?.();
    const currentLocation = capturedLocation ?? gps;
    if (!currentLocation) {
      setError('يلزم تحديد موقع GPS قبل التقاط صور الزيارة.');
      return;
    }
    if (locationLocked && (!hasMachinePin || Math.max(0,
      distanceMeters(currentLocation, { latitude: machine.latitude, longitude: machine.longitude })
        - Number(currentLocation.accuracy ?? 0)) > radius)) {
      setError('أنت خارج نطاق الماكينة؛ اقترب منها لتفعيل التصوير.');
      return;
    }
    const preparedPhotos = [];
    for (const [index, file] of selectedFiles.entries()) {
      setProcessingPhase(phase);
      try {
        const capturedAt = new Date();
        const blob = await compressAndWatermark(file, {
          machineCode: machine.machineCode,
          regionName: machine.regionName,
          phase,
          capturedAt,
          location: locationPayload(currentLocation),
        });
        const previewUrl = URL.createObjectURL(blob);
        previewUrls.current.add(previewUrl);
        preparedPhotos.push({ blob, previewUrl, capturedAt: capturedAt.toISOString() });
      } catch (captureError) {
        setError(captureError.message || `تعذر تجهيز الصورة ${index + 1}. حاول التقاطها مرة أخرى.`);
        break;
      } finally {
        setProcessingPhase('');
      }
    }
    if (preparedPhotos.length) {
      setPhotos((current) => ({ ...current, [phase]: [...current[phase], ...preparedPhotos] }));
    }
  };

  const captureFromPicker = (phase) => async (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await processCaptures(phase, files);
  };

  const openCamera = (phase, inputRef) => async () => {
    if (!nativeApp) {
      inputRef.current?.click();
      return;
    }
    try {
      const photo = await captureNativeCameraPhoto();
      await processCaptures(phase, [photo]);
    } catch (captureError) {
      setError(captureError.message || 'تعذر فتح الكاميرا. تحقق من إذن الكاميرا وحاول مجدداً.');
    }
  };

  const removePhoto = (phase, index) => {
    setPhotos((current) => {
      const removed = current[phase][index];
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return { ...current, [phase]: current[phase].filter((_, photoIndex) => photoIndex !== index) };
    });
  };

  const save = async () => {
    if (nativeApp && /تزييف الموقع/.test(gpsError ?? '')) {
      setError('رُفضت الزيارة: أوقف تطبيق تزييف الموقع وأعد تشغيل الوردية قبل المتابعة.');
      return;
    }
    if (!photos.before.length || !photos.after.length) {
      setError('يلزم التقاط صورة واحدة على الأقل قبل الصيانة وبعدها.');
      return;
    }
    if (!machineCondition) {
      setError('اختر حالة الماكينة قبل حفظ الزيارة.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const capturedLocation = await captureLocation?.();
      const currentLocation = capturedLocation ?? gps;
      if (!currentLocation) throw new Error('يلزم تحديد موقع GPS قبل حفظ الزيارة.');
      if (locationLocked && (!hasMachinePin || Math.max(0,
        distanceMeters(currentLocation, { latitude: machine.latitude, longitude: machine.longitude })
          - Number(currentLocation.accuracy ?? 0)) > radius)) {
        const distance = hasMachinePin
          ? Math.max(0, distanceMeters(currentLocation, { latitude: machine.latitude, longitude: machine.longitude })
            - Number(currentLocation.accuracy ?? 0))
          : null;
        throw new Error(distance === null
          ? 'إحداثيات الماكينة المقفلة غير مكتملة؛ تواصل مع الإدارة.'
          : `أنت خارج نطاق الماكينة (المسافة الفعالة: ${Math.round(distance)} متر، المسموح: ${radius} متر).`);
      }
      await onSave({
        machineCondition,
        reasonIds,
        notes: notes.trim(),
        beforePhotos: photos.before.map(({ blob }) => blob),
        afterPhotos: photos.after.map(({ blob }) => blob),
        beforeCapturedAt: photos.before.map(({ capturedAt }) => capturedAt),
        afterCapturedAt: photos.after.map(({ capturedAt }) => capturedAt),
        capturedAt: new Date().toISOString(),
        location: locationPayload(currentLocation),
      });
    } catch (saveError) {
      setError(saveError.message || 'تعذر حفظ الزيارة محلياً. لم تُحذف الصور؛ حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const photoField = (phase, phasePhotos, inputRef) => {
    const label = phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة';
    return (
      <section className="rep-photo-card" aria-label={`صور ${label}`}>
        <div className="rep-photo-card-head">
          <div>
            <span className="rep-eyebrow">{phase === 'before' ? '01 · BEFORE' : '02 · AFTER'}</span>
            <h3>{label}</h3>
          </div>
          <span className={`rep-photo-state ${phasePhotos.length ? 'is-ready' : ''}`}>{phasePhotos.length ? `${phasePhotos.length} صور` : 'مطلوبة'}</span>
        </div>
        {phasePhotos.length > 0 && <div className="rep-photo-preview-grid">
          {phasePhotos.map((photo, index) => <div className="rep-photo-preview" key={`${photo.capturedAt}-${index}`}>
            <img src={photo.previewUrl} alt={`صورة ${label} رقم ${index + 1} للماكينة ${machine.machineCode}`} />
            <small>{index + 1} · {Math.max(1, Math.round(photo.blob.size / 1024))} KB · {new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' }).format(new Date(photo.capturedAt))}</small>
            <button type="button" className="rep-button rep-button-danger-light" onClick={() => removePhoto(phase, index)} disabled={saving}>حذف الصورة</button>
          </div>)}
        </div>}
        <div className="rep-photo-capture-actions">
          <button
            type="button"
            className="rep-camera-button"
            onClick={openCamera(phase, inputRef)}
            disabled={Boolean(processingPhase) || saving || !canCapture}
          >
            <span className="rep-camera-icon" aria-hidden="true">⌖</span>
            <span>{processingPhase === phase ? 'جارٍ تجهيز الصورة...' : `${nativeApp ? 'التقط صورة أخرى بالكاميرا' : 'أضف صورة بالكاميرا'} · ${label}`}</span>
          </button>
          {!nativeApp && <button type="button" className="rep-button rep-button-light" onClick={() => inputRef.current?.click()} disabled={Boolean(processingPhase) || saving || !canCapture}>اختيار صور متعددة</button>}
        </div>
        {!nativeApp && <input
          ref={inputRef}
          className="rep-visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={captureFromPicker(phase)}
          aria-label={`التقاط صورة ${label}`}
        />}
      </section>
    );
  };

  return (
    <div className="rep-sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="rep-visit-sheet" role="dialog" aria-modal="true" aria-labelledby="rep-visit-title" dir="rtl">
        <header className="rep-sheet-header">
          <button type="button" className="rep-icon-button" onClick={onClose} aria-label="إغلاق الزيارة">×</button>
          <div>
            <span className="rep-eyebrow">زيارة ميدانية جديدة</span>
            <h2 id="rep-visit-title">ماكينة {machine.machineCode}</h2>
            <p>{machine.arabicName} · {machine.regionName}</p>
          </div>
          <span className="rep-machine-mark" aria-hidden="true">م</span>
        </header>

        <div className="rep-sheet-content">
          <div className={`rep-gps-strip ${gps ? 'has-fix' : ''}`}>
            <span className="rep-gps-pulse" aria-hidden="true" />
            <div>
              <strong>{gps ? 'موقع الجهاز الحالي' : gpsError || 'جارٍ تحديد الموقع...'}</strong>
              <small>{showLocation(gps)}</small>
            </div>
            <span className="rep-gps-label">GPS</span>
          </div>

          <div className={`rep-geofence-status ${!gps || (locationLocked && !withinGeofence) ? 'outside' : 'inside'}`} role="status">
            {!gps
              ? 'جارٍ انتظار إشارة GPS؛ يلزم الموقع لتفعيل التصوير.'
              : !locationLocked
                ? 'أول زيارة: سيُثبّت النظام موقع الماكينة عند مزامنة الصور.'
                : !hasMachinePin
                  ? 'إحداثيات قفل الماكينة غير مكتملة؛ التصوير متوقف.'
                  : withinGeofence
                    ? `أنت داخل النطاق · المسافة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`
                    : `أنت خارج النطاق · المسافة الفعالة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`}
          </div>

          <section className="rep-form-section">
            <div className="rep-section-title">
              <div><span className="rep-eyebrow">MACHINE CHECK</span><h3>حالة الماكينة</h3></div>
              <small>اختر الحالة الحالية</small>
            </div>
            <div className="rep-condition-options" role="radiogroup" aria-label="حالة الماكينة">
              {[
                ['working', 'تعمل', '✓'],
                ['faulty', 'عطلانة', '!'],
                ['preventive_maintenance', 'صيانة وقائية', '⌁'],
              ].map(([value, label, icon]) => (
                <button key={value} type="button" role="radio" aria-checked={machineCondition === value}
                  className={`rep-condition-option ${machineCondition === value ? 'selected' : ''}`}
                  onClick={() => setMachineCondition(value)}>
                  <span aria-hidden="true">{icon}</span>{label}
                </button>
              ))}
            </div>
          </section>

          <section className="rep-form-section">
            <div className="rep-section-title">
              <div><span className="rep-eyebrow">MAINTENANCE</span><h3>ما الذي تم إصلاحه؟</h3></div>
              <small>اختياري · يمكنك اختيار أكثر من سبب</small>
            </div>
            {reasons.length ? (
              <div className="rep-reason-grid">
                {reasons.map((reason) => {
                  const active = reasonIds.includes(Number(reason.id));
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      className={`rep-reason-chip ${active ? 'selected' : ''}`}
                      aria-pressed={active}
                      onClick={() => toggleReason(reason.id)}
                    >
                      <span aria-hidden="true">{active ? '✓' : '+'}</span>{reason.name}
                    </button>
                  );
                })}
              </div>
            ) : <p className="rep-muted-box">لا توجد أسباب صيانة محفوظة. يمكنك متابعة الزيارة بدون تحديد سبب.</p>}
          </section>

          <section className="rep-form-section">
            <div className="rep-section-title">
              <div><span className="rep-eyebrow">PHOTO PROOF</span><h3>توثيق الزيارة</h3></div>
              <small>صورة واضحة للماكينة كاملة</small>
            </div>
            <div className="rep-photo-grid">
              {photoField('before', photos.before, beforeInput)}
              {photoField('after', photos.after, afterInput)}
            </div>
            <p className="rep-watermark-note">يُضاف على الصورة ختم تعريفي من الهاتف يتضمن الوقت والموقع الملتقطين. هذا الختم مفيد للتوثيق لكنه ليس دليلاً غير قابل للتعديل.</p>
          </section>

          <label className="rep-notes-field">
            <span>ملاحظة للمشرف <small>اختياري</small></span>
            <textarea maxLength={10000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="اكتب ملاحظة مختصرة عن الزيارة..." />
          </label>
          {error && <p className="rep-inline-error" role="alert">{error}</p>}
        </div>

        <footer className="rep-sheet-footer">
          <button type="button" className="rep-button rep-button-light" onClick={onClose}>إلغاء</button>
          <button type="button" className="rep-button rep-button-primary rep-save-visit" onClick={save} disabled={saving || !canCapture || !machineCondition || !photos.before.length || !photos.after.length || Boolean(processingPhase) || (nativeApp && /تزييف الموقع/.test(gpsError ?? ''))}>
            {saving ? 'جارٍ تحديد الموقع وحفظ الزيارة…' : '💾 حفظ الزيارة على الهاتف'}
          </button>
        </footer>
      </section>
    </div>
  );
}
