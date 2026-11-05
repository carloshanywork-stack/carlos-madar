import { useEffect, useRef, useState } from 'react';
import { compressAndWatermark, locationPayload } from './image-processing.js';
import {
  captureNativeCameraPhoto,
  deleteNativeVisitPhoto,
  isNativeRepApp,
  nativeFilePreviewUrl,
  processNativeVisitPhoto,
} from './native-bridges.js';

function createDraftVisitUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!globalThis.crypto?.getRandomValues) bytes.forEach((_value, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

export default function MachineVisitSheet({ machine, reasons, gps, gpsError, captureLocation, onClose, onSave, onConfirmLocation, onReportCorrection }) {
  const [machineCondition, setMachineCondition] = useState('');
  const [reasonIds, setReasonIds] = useState([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState({ before: [], after: [] });
  const [activePhase, setActivePhase] = useState('before');
  const [processingPhase, setProcessingPhase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedPin, setConfirmedPin] = useState(null);
  const [confirmingLocation, setConfirmingLocation] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionCode, setCorrectionCode] = useState('');
  const [correctionName, setCorrectionName] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [correctionEvidence, setCorrectionEvidence] = useState(null);
  const beforeInput = useRef(null);
  const afterInput = useRef(null);
  const previewUrls = useRef(new Set());
  const draftVisitUuid = useRef(createDraftVisitUuid()).current;
  const draftSaved = useRef(false);
  const autoCameraOpened = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const deletingPhotoRef = useRef(false);
  const nativeApp = isNativeRepApp();

  useEffect(() => () => {
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
  }, []);

  useEffect(() => () => {
    if (!nativeApp || draftSaved.current) return;
    for (const phase of ['before', 'after']) {
      photosRef.current[phase].forEach((photo, index) => {
        void deleteNativeVisitPhoto(draftVisitUuid, phase, photo.photoIndex ?? index, photo.path).catch(() => undefined);
      });
    }
  }, [draftVisitUuid, nativeApp]);

  useEffect(() => {
    void captureLocation?.();
    const timer = window.setInterval(() => { void captureLocation?.(); }, 20000);
    return () => window.clearInterval(timer);
  }, [captureLocation]);

  const activeMachine = confirmedPin ? { ...machine, ...confirmedPin } : machine;
  const locationLocked = activeMachine.isLocationLocked === true;
  const hasMachinePin = Number.isFinite(activeMachine.latitude) && Number.isFinite(activeMachine.longitude);
  const measuredDistance = gps && hasMachinePin
    ? distanceMeters(gps, { latitude: activeMachine.latitude, longitude: activeMachine.longitude })
    : null;
  const effectiveDistance = measuredDistance === null ? null : Math.max(0, measuredDistance - Number(gps.accuracy ?? 0));
  const radius = Math.max(1, Number(activeMachine.geofenceRadiusMeters) || 50);
  const withinGeofence = locationLocked && hasMachinePin && effectiveDistance !== null && effectiveDistance <= radius;
  const canCapture = Boolean(gps) && withinGeofence && !correctionOpen;

  const confirmCurrentLocation = async () => {
    setError('');
    setConfirmingLocation(true);
    try {
      const location = await captureLocation?.();
      const currentLocation = location ?? gps;
      if (!currentLocation) throw new Error('يلزم انتظار إشارة GPS قبل تثبيت موقع الماكينة.');
      if (Number(currentLocation.accuracy) > 100) throw new Error('إشارة GPS غير دقيقة بما يكفي؛ انتظر تحسن الدقة إلى 100 متر أو أفضل.');
      const ageMs = Date.now() - Date.parse(currentLocation.updatedAt ?? '');
      if (!Number.isFinite(ageMs) || ageMs < -30000 || ageMs > 5 * 60 * 1000) {
        throw new Error('إشارة GPS قديمة؛ انتظر تحديث الموقع ثم حاول تثبيته من جديد.');
      }
      const pin = await onConfirmLocation(currentLocation);
      setConfirmedPin({
        latitude: Number(pin?.latitude ?? currentLocation.latitude),
        longitude: Number(pin?.longitude ?? currentLocation.longitude),
        isLocationLocked: true,
        geofenceRadiusMeters: 50,
      });
    } catch (confirmationError) {
      setError(confirmationError.message || 'تعذر تثبيت الموقع؛ ستبقى الماكينة غير مثبتة.');
    } finally {
      setConfirmingLocation(false);
    }
  };

  const submitCorrection = async () => {
    if (!correctionCode.trim() || !correctionName.trim()) {
      setError('أدخل الكود والاسم الصحيحين للماكينة التي تقف أمامها.');
      return;
    }
    setCorrectionSaving(true);
    setError('');
    try {
      const capturedLocation = await captureLocation?.();
      const currentLocation = capturedLocation ?? gps;
      if (!currentLocation) throw new Error('يلزم إرسال موقع GPS الحالي مع بلاغ التصحيح.');
      if (correctionEvidence && correctionEvidence.size > 4 * 1024 * 1024) {
        throw new Error('يجب ألا تتجاوز صورة الإثبات 4 ميغابايت.');
      }
      await onReportCorrection({
        reportedCode: correctionCode.trim(),
        reportedName: correctionName.trim(),
        note: correctionNote.trim(),
        evidence: correctionEvidence,
        location: locationPayload(currentLocation),
        capturedAt: new Date().toISOString(),
      });
      onClose();
    } catch (correctionError) {
      setError(correctionError.message || 'تعذر حفظ بلاغ التصحيح؛ أعد المحاولة.');
    } finally {
      setCorrectionSaving(false);
    }
  };

  const toggleReason = (id) => {
    setReasonIds((current) => current.includes(Number(id))
      ? current.filter((item) => item !== Number(id))
      : [...current, Number(id)]);
  };

  const processCaptures = async (phase, files) => {
    if (deletingPhotoRef.current) return;
    const selectedFiles = Array.from(files ?? []).filter(Boolean);
    if (!selectedFiles.length) return;
    const remaining = 3 - photos[phase].length;
    if (selectedFiles.length > remaining) {
      setError(`يمكن حفظ 3 صور فقط لكل مرحلة؛ المتاح الآن ${remaining} صورة.`);
      return;
    }
    setError('');
    const capturedLocation = await captureLocation?.();
    const currentLocation = capturedLocation ?? gps;
    if (!currentLocation) {
      setError('يلزم تحديد موقع GPS قبل التقاط صور الزيارة.');
      return;
    }
    if (!locationLocked || !hasMachinePin) {
      setError('لم يتم تأكيد موقع هذه الماكينة بعد؛ أكّد وجودك عندها أو أرسل بلاغ ماكينة خاطئة قبل التصوير.');
      return;
    }
    if (Math.max(0,
      distanceMeters(currentLocation, { latitude: activeMachine.latitude, longitude: activeMachine.longitude })
        - Number(currentLocation.accuracy ?? 0)) > radius) {
      setError('أنت خارج نطاق الماكينة؛ اقترب منها لتفعيل التصوير.');
      return;
    }
    const preparedPhotos = [];
    for (const [index, file] of selectedFiles.entries()) {
      setProcessingPhase(phase);
      try {
        const capturedAt = new Date();
        if (nativeApp) {
          const usedIndexes = new Set([...photos[phase], ...preparedPhotos].map((photo) => Number(photo.photoIndex)));
          const photoIndex = [0, 1, 2].find((candidate) => !usedIndexes.has(candidate));
          if (photoIndex === undefined) throw new Error('اكتملت الصور الثلاث لهذه المرحلة.');
          const saved = await processNativeVisitPhoto({
            visitUuid: draftVisitUuid,
            phase,
            index: photoIndex,
            sourceUri: file.sourceUri,
            watermark: {
              machineCode: activeMachine.machineCode,
              machineName: activeMachine.arabicName,
              regionName: activeMachine.regionName,
              areaName: activeMachine.areaName,
              phase,
              capturedAt: capturedAt.toISOString(),
              location: locationPayload(currentLocation),
            },
          });
          preparedPhotos.push({
            path: saved.path,
            photoIndex,
            sizeBytes: Number(saved.sizeBytes),
            previewUrl: nativeFilePreviewUrl(saved.path),
            capturedAt: capturedAt.toISOString(),
          });
        } else {
          const blob = await compressAndWatermark(file, {
            machineCode: activeMachine.machineCode,
            machineName: activeMachine.arabicName,
            regionName: activeMachine.regionName,
            areaName: activeMachine.areaName,
            phase,
            capturedAt,
            location: locationPayload(currentLocation),
          });
          const previewUrl = URL.createObjectURL(blob);
          previewUrls.current.add(previewUrl);
          preparedPhotos.push({ blob, previewUrl, capturedAt: capturedAt.toISOString() });
        }
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

  useEffect(() => {
    if (!nativeApp || activePhase !== 'before' || !canCapture || photos.before.length > 0
        || autoCameraOpened.current || correctionOpen) return;
    autoCameraOpened.current = true;
    void (async () => {
      try {
        const photo = await captureNativeCameraPhoto();
        await processCaptures('before', [photo]);
      } catch (captureError) {
        setError(captureError.message || 'تعذر فتح الكاميرا تلقائياً؛ استخدم زر التقاط صورة قبل الصيانة.');
      }
    })();
  }, [activePhase, canCapture, correctionOpen, nativeApp, photos.before.length]);

  const removePhoto = async (phase, index) => {
    if (deletingPhotoRef.current) return;
    const removed = photosRef.current[phase][index];
    if (!removed) return;
    deletingPhotoRef.current = true;
    setProcessingPhase(phase);
    setError('');
    try {
      if (nativeApp) {
        const result = await deleteNativeVisitPhoto(draftVisitUuid, phase, removed.photoIndex ?? index, removed.path);
        if (result?.deleted === false) throw new Error('تعذر حذف الصورة المحلية؛ بقيت ضمن الزيارة.');
      }
      if (removed.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      setPhotos((current) => ({
        ...current,
        [phase]: current[phase].filter((photo) => photo !== removed),
      }));
    } catch (deleteError) {
      setError(deleteError.message || 'تعذر حذف الصورة من التخزين المحلي؛ لم تُزل من الزيارة.');
    } finally {
      deletingPhotoRef.current = false;
      setProcessingPhase('');
    }
  };

  const save = async () => {
    if (deletingPhotoRef.current) {
      setError('انتظر اكتمال حذف الصورة قبل حفظ الزيارة.');
      return;
    }
    if (nativeApp && /تزييف الموقع/.test(gpsError ?? '')) {
      setError('رُفضت الزيارة: أوقف تطبيق تزييف الموقع وأعد تشغيل الوردية قبل المتابعة.');
      return;
    }
    if (photos.before.length !== 3 || photos.after.length > 3) {
      setError('يلزم التقاط 3 صور قبل الصيانة؛ صور ما بعد الصيانة اختيارية وبحد أقصى 3 صور.');
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
      if (correctionOpen) throw new Error('أغلق بلاغ اختلاف الماكينة أو أرسله قبل متابعة الزيارة.');
      if (!locationLocked || !hasMachinePin) {
        throw new Error('لم يتم تأكيد موقع الماكينة بعد؛ أكّد موقعها الحالي قبل حفظ الزيارة.');
      }
      if (Math.max(0,
        distanceMeters(currentLocation, { latitude: activeMachine.latitude, longitude: activeMachine.longitude })
          - Number(currentLocation.accuracy ?? 0)) > radius) {
        const distance = Math.max(0, distanceMeters(currentLocation, { latitude: activeMachine.latitude, longitude: activeMachine.longitude })
          - Number(currentLocation.accuracy ?? 0));
        throw new Error(`أنت خارج نطاق الماكينة (المسافة الفعالة: ${Math.round(distance)} متر، المسموح: ${radius} متر).`);
      }
      await onSave({
        visitUuid: draftVisitUuid,
        machineCondition,
        reasonIds,
        notes: notes.trim(),
        beforePhotos: photos.before.map(({ blob, path, sizeBytes, capturedAt: photoCapturedAt }) => blob ?? ({ path, sizeBytes, capturedAt: photoCapturedAt })),
        afterPhotos: photos.after.map(({ blob, path, sizeBytes, capturedAt: photoCapturedAt }) => blob ?? ({ path, sizeBytes, capturedAt: photoCapturedAt })),
        beforeCapturedAt: photos.before.map(({ capturedAt }) => capturedAt),
        afterCapturedAt: photos.after.map(({ capturedAt }) => capturedAt),
        capturedAt: new Date().toISOString(),
        location: locationPayload(currentLocation),
      });
      draftSaved.current = true;
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
          <span className={`rep-photo-state ${phasePhotos.length === 3 ? 'is-ready' : ''}`}>{phasePhotos.length} / 3 صور</span>
        </div>
        {phasePhotos.length > 0 && <div className="rep-photo-preview-grid">
          {phasePhotos.map((photo, index) => <div className="rep-photo-preview" key={`${photo.capturedAt}-${index}`}>
            <img src={photo.previewUrl} alt={`صورة ${label} رقم ${index + 1} للماكينة ${machine.machineCode}`} />
            <small>{index + 1} · {Math.max(1, Math.round((photo.blob?.size ?? photo.sizeBytes ?? 1) / 1024))} KB · {new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' }).format(new Date(photo.capturedAt))}</small>
            <button type="button" className="rep-button rep-button-danger-light" onClick={() => void removePhoto(phase, index)} disabled={saving || Boolean(processingPhase)}>حذف الصورة</button>
          </div>)}
        </div>}
        <div className="rep-photo-capture-actions">
          <button
            type="button"
            className="rep-camera-button"
            onClick={openCamera(phase, inputRef)}
            disabled={Boolean(processingPhase) || saving || !canCapture || phasePhotos.length >= 3}
          >
            <span className="rep-camera-icon" aria-hidden="true">⌖</span>
            <span>{processingPhase === phase ? 'جارٍ تجهيز الصورة...' : `${nativeApp ? 'التقط صورة أخرى بالكاميرا' : 'أضف صورة بالكاميرا'} · ${label}`}</span>
          </button>
          {!nativeApp && <button type="button" className="rep-button rep-button-light" onClick={() => inputRef.current?.click()} disabled={Boolean(processingPhase) || saving || !canCapture || phasePhotos.length >= 3}>اختيار الصور المتبقية</button>}
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

  const visitBusy = saving || Boolean(processingPhase) || deletingPhotoRef.current;

  return (
    <div className="rep-sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !visitBusy) onClose();
    }}>
      <section className="rep-visit-sheet" role="dialog" aria-modal="true" aria-labelledby="rep-visit-title" dir="rtl">
        <header className="rep-sheet-header">
          <button type="button" className="rep-icon-button" onClick={onClose} disabled={visitBusy} aria-label="إغلاق الزيارة">×</button>
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

          <div className={`rep-geofence-status ${!gps || !withinGeofence ? 'outside' : 'inside'}`} role="status">
            {!gps
              ? 'جارٍ انتظار إشارة GPS؛ يلزم الموقع لتفعيل التصوير.'
              : !locationLocked || !hasMachinePin
                ? 'هذه أول زيارة موثقة للموقع. تأكد من كود الماكينة ثم ثبّت موقعك الحالي أو أرسل بلاغ ماكينة خاطئة.'
                : withinGeofence
                  ? `أنت داخل النطاق · المسافة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`
                  : `أنت خارج النطاق · المسافة الفعالة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`}
          </div>

          {!locationLocked || !hasMachinePin ? <section className="rep-machine-verification">
            <div>
              <strong>تحقق من هوية وموقع الماكينة</strong>
              <small>سيُحفظ موقع GPS الحالي كمرجع ثابت، بنطاق زيارة 50 متراً.</small>
            </div>
            <button type="button" className="rep-button rep-button-primary" onClick={() => void confirmCurrentLocation()}
              disabled={confirmingLocation || !gps || Number(gps.accuracy) > 100 || saving || correctionSaving || correctionOpen}>
              {confirmingLocation ? 'جارٍ تثبيت موقع GPS…' : 'هذه هي الماكينة الصحيحة · ثبّت موقعي الحالي'}
            </button>
          </section> : <section className="rep-machine-verification verified">
            <div>
              <strong>الموقع مؤكد ومقفل</strong>
              <small>نطاق التصوير والزيارة: {radius} متر{activeMachine.locationConfirmationPending ? ' · بانتظار مزامنة الخادم' : ''}.</small>
            </div>
          </section>}

          <section className="rep-wrong-machine-report">
            <button type="button" className="rep-button rep-button-light"
              onClick={() => { setCorrectionOpen((value) => !value); setError(''); }}
              aria-expanded={correctionOpen} disabled={correctionSaving || saving}>
              {correctionOpen ? 'إخفاء بلاغ الماكينة الخاطئة' : 'هذه ماكينة مختلفة · إبلاغ الإدارة'}
            </button>
            {correctionOpen && <div className="rep-correction-form">
              <p>لن تتغير بطاقة الصيانة أو أي سجل سابق. سيُحفظ البلاغ وموقع GPS وصورة الإثبات الاختيارية للمراجعة.</p>
              <label><span>الكود الصحيح على لوحة الماكينة *</span><input value={correctionCode} onChange={(event) => setCorrectionCode(event.target.value)} maxLength={64} autoComplete="off" /></label>
              <label><span>الاسم الصحيح للماكينة *</span><input value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} maxLength={200} /></label>
              <label><span>ملاحظة اختيارية</span><textarea value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} maxLength={2000} rows={2} /></label>
              <label><span>صورة إثبات اختيارية (JPEG / PNG / WebP · حتى 4 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setCorrectionEvidence(event.target.files?.[0] ?? null)} /></label>
              {correctionEvidence && <small className="rep-correction-file">{correctionEvidence.name} · {Math.ceil(correctionEvidence.size / 1024)} KB</small>}
              <button type="button" className="rep-button rep-button-danger-light" onClick={() => void submitCorrection()}
                disabled={correctionSaving || !gps || !correctionCode.trim() || !correctionName.trim()}>
                {correctionSaving ? 'جارٍ حفظ البلاغ…' : 'إرسال بلاغ التصحيح للإدارة'}
              </button>
            </div>}
          </section>

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
              <small>{activePhase === 'before' ? 'الخطوة 1 من 2 · صور قبل الصيانة' : 'الخطوة 2 من 2 · صور بعد الصيانة اختيارية'}</small>
            </div>
            <div className="rep-photo-grid">
              {activePhase === 'before'
                ? photoField('before', photos.before, beforeInput)
                : photoField('after', photos.after, afterInput)}
            </div>
            {activePhase === 'before' ? (
              <button type="button" className="rep-button rep-button-primary"
                onClick={() => setActivePhase('after')} disabled={photos.before.length !== 3 || saving || Boolean(processingPhase)}>
                {photos.before.length === 3 ? 'اعتماد صور قبل الصيانة · الانتقال إلى بعد الصيانة' : 'التقط 3 صور قبل الصيانة للمتابعة'}
              </button>
            ) : (
              <div className="rep-photo-capture-actions">
                <button type="button" className="rep-button rep-button-light" onClick={() => setActivePhase('before')} disabled={saving || Boolean(processingPhase)}>
                  العودة إلى صور قبل الصيانة
                </button>
                {!photos.after.length && <small>يمكنك إنهاء الزيارة الآن دون صور بعد الصيانة.</small>}
              </div>
            )}
            <p className="rep-watermark-note">يُدمج ختم واضح ببكسلات كل صورة قبل حفظها: التاريخ واليوم، الوقت بالثواني، إحداثيات GPS والمنطقة المسجلة، وكود الماكينة واسمها.</p>
          </section>

          <label className="rep-notes-field">
            <span>ملاحظة للمشرف <small>اختياري</small></span>
            <textarea maxLength={10000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="اكتب ملاحظة مختصرة عن الزيارة..." />
          </label>
          {error && <p className="rep-inline-error" role="alert">{error}</p>}
        </div>

        <footer className="rep-sheet-footer">
          <button type="button" className="rep-button rep-button-light" onClick={onClose} disabled={visitBusy}>إلغاء</button>
          <button type="button" className="rep-button rep-button-primary rep-save-visit" onClick={save} disabled={saving || !canCapture || !machineCondition || photos.before.length !== 3 || photos.after.length > 3 || Boolean(processingPhase) || (nativeApp && /تزييف الموقع/.test(gpsError ?? ''))}>
            {saving ? 'جارٍ تحديد الموقع وحفظ الزيارة…' : photos.after.length ? '💾 إنهاء الزيارة وحفظ الصور' : '💾 إنهاء الزيارة بصور قبل فقط'}
          </button>
        </footer>
      </section>
    </div>
  );
}
