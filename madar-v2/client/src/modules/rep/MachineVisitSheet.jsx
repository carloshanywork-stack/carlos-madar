import { useEffect, useRef, useState } from 'react';
import { compressAndWatermark, locationPayload } from './image-processing.js';
import { captureNativeCameraPhoto, isNativeRepApp } from './native-bridges.js';

function showLocation(location) {
  if (!location) return 'بانتظار إشارة GPS';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · دقة ±${Math.round(location.accuracy)}م`;
}

export default function MachineVisitSheet({ machine, reasons, gps, gpsError, captureLocation, onClose, onSave }) {
  const [machineCondition, setMachineCondition] = useState('');
  const [reasonIds, setReasonIds] = useState([]);
  const [notes, setNotes] = useState('');
  const [beforePhoto, setBeforePhoto] = useState(null);
  const [afterPhoto, setAfterPhoto] = useState(null);
  const [processingPhase, setProcessingPhase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const beforeInput = useRef(null);
  const afterInput = useRef(null);
  const nativeApp = isNativeRepApp();

  useEffect(() => () => {
    if (beforePhoto?.previewUrl) URL.revokeObjectURL(beforePhoto.previewUrl);
    if (afterPhoto?.previewUrl) URL.revokeObjectURL(afterPhoto.previewUrl);
  }, [beforePhoto?.previewUrl, afterPhoto?.previewUrl]);

  const toggleReason = (id) => {
    setReasonIds((current) => current.includes(Number(id))
      ? current.filter((item) => item !== Number(id))
      : [...current, Number(id)]);
  };

  const processCapture = async (phase, file) => {
    if (!file) return;
    setProcessingPhase(phase);
    setError('');
    try {
      const capturedAt = new Date();
      const blob = await compressAndWatermark(file, {
        machineCode: machine.machineCode,
        regionName: machine.regionName,
        phase,
        capturedAt,
        location: locationPayload(gps),
      });
      const photo = { blob, previewUrl: URL.createObjectURL(blob), capturedAt: capturedAt.toISOString() };
      const setter = phase === 'before' ? setBeforePhoto : setAfterPhoto;
      setter((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return photo;
      });
    } catch (captureError) {
      setError(captureError.message || 'تعذر تجهيز الصورة. حاول التقاطها مرة أخرى.');
    } finally {
      setProcessingPhase('');
    }
  };

  const captureFromPicker = (phase) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await processCapture(phase, file);
  };

  const openCamera = (phase, inputRef) => async () => {
    if (!nativeApp) {
      inputRef.current?.click();
      return;
    }
    setProcessingPhase(phase);
    setError('');
    try {
      const photo = await captureNativeCameraPhoto();
      await processCapture(phase, photo);
    } catch (captureError) {
      setError(captureError.message || 'تعذر فتح الكاميرا. تحقق من إذن الكاميرا وحاول مجدداً.');
    } finally {
      setProcessingPhase('');
    }
  };

  const removePhoto = (phase) => {
    const setter = phase === 'before' ? setBeforePhoto : setAfterPhoto;
    setter((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  };

  const save = async () => {
    if (nativeApp && /تزييف الموقع/.test(gpsError ?? '')) {
      setError('رُفضت الزيارة: أوقف تطبيق تزييف الموقع وأعد تشغيل الوردية قبل المتابعة.');
      return;
    }
    if (!beforePhoto || !afterPhoto) {
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
      await onSave({
        machineCondition,
        reasonIds,
        notes: notes.trim(),
        beforePhoto: beforePhoto.blob,
        afterPhoto: afterPhoto.blob,
        beforeCapturedAt: beforePhoto.capturedAt,
        afterCapturedAt: afterPhoto.capturedAt,
        capturedAt: new Date().toISOString(),
        location: locationPayload(capturedLocation) ?? locationPayload(gps),
      });
    } catch (saveError) {
      setError(saveError.message || 'تعذر حفظ الزيارة محلياً. لم تُحذف الصور؛ حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const photoField = (phase, photo, inputRef) => {
    const label = phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة';
    return (
      <section className="rep-photo-card" aria-label={`صور ${label}`}>
        <div className="rep-photo-card-head">
          <div>
            <span className="rep-eyebrow">{phase === 'before' ? '01 · BEFORE' : '02 · AFTER'}</span>
            <h3>{label}</h3>
          </div>
          <span className={`rep-photo-state ${photo ? 'is-ready' : ''}`}>{photo ? 'جاهزة' : 'مطلوبة'}</span>
        </div>
        {photo ? (
          <div className="rep-photo-preview">
            <img src={photo.previewUrl} alt={`صورة ${label} للماكينة ${machine.machineCode}`} />
            <div className="rep-photo-actions">
              <button type="button" className="rep-button rep-button-light" onClick={openCamera(phase, inputRef)} disabled={Boolean(processingPhase)}>
                إعادة التصوير
              </button>
              <button type="button" className="rep-button rep-button-danger-light" onClick={() => removePhoto(phase)}>
                حذف
              </button>
            </div>
            <small>{Math.max(1, Math.round(photo.blob.size / 1024))} KB · جرى ضغطها وختمها على الهاتف</small>
          </div>
        ) : (
          <button
            type="button"
            className="rep-camera-button"
            onClick={openCamera(phase, inputRef)}
            disabled={Boolean(processingPhase)}
          >
            <span className="rep-camera-icon" aria-hidden="true">⌖</span>
            <span>{processingPhase === phase ? 'جارٍ تجهيز الصورة...' : `${nativeApp ? 'التقط صورة بالكاميرا' : 'افتح الكاميرا'} · ${label}`}</span>
          </button>
        )}
        {!nativeApp && <input
          ref={inputRef}
          className="rep-visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
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
              {photoField('before', beforePhoto, beforeInput)}
              {photoField('after', afterPhoto, afterInput)}
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
          <button type="button" className="rep-button rep-button-primary rep-save-visit" onClick={save} disabled={saving || !machineCondition || !beforePhoto || !afterPhoto || Boolean(processingPhase) || (nativeApp && /تزييف الموقع/.test(gpsError ?? ''))}>
            {saving ? 'جارٍ تحديد الموقع وحفظ الزيارة…' : '💾 حفظ الزيارة على الهاتف'}
          </button>
        </footer>
      </section>
    </div>
  );
}
