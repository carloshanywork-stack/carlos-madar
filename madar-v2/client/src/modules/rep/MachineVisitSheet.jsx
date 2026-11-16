import { useEffect, useRef, useState } from 'react';
import { MAX_VISIT_PHOTOS_PER_PHASE } from '../../../../shared/visit-photo-policy.js';
import { compressAndWatermark, locationPayload } from './image-processing.js';
import {
  captureNativeCameraPhotos,
  deleteNativeVisitPhoto,
  isNativeRepApp,
  nativeFilePreviewUrl,
  processNativeVisitPhoto,
  listNativeStagedVisitPhotos,
} from './native-bridges.js';
import {
  firstUnusedPhotoIndex,
  isEligibleVisitGps,
  mergeCapturedPhotoResults,
  validateVisitPhotoCaptureLocation,
} from './visit-photo-capture.js';

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

function getDraftVisitUuid(repId, cardId) {
  const key = `madar-rep-visit-draft:${Number(repId)}:${Number(cardId)}`;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
    const created = createDraftVisitUuid();
    window.localStorage.setItem(key, created);
    return created;
  } catch { return createDraftVisitUuid(); }
}

function clearDraftVisitUuid(repId, cardId, visitUuid) {
  try {
    const key = `madar-rep-visit-draft:${Number(repId)}:${Number(cardId)}`;
    if (window.localStorage.getItem(key) === visitUuid) window.localStorage.removeItem(key);
  } catch { /* Local draft UUID remains harmless if storage is unavailable. */ }
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

export default function MachineVisitSheet({ machine, repId, repName = '', reasons, gps, gpsError, captureLocation, onStartWork, onStopWork, onClose, onSave, onConfirmLocation, onReportCorrection, onRequestLocationChange }) {
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState({ before: [], after: [] });
  const [pendingCaptures, setPendingCaptures] = useState({ before: [], after: [] });
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [selectedReasonIds, setSelectedReasonIds] = useState(() => {
    if (Array.isArray(machine?.reasonIds) && machine.reasonIds.length) return machine.reasonIds.map(Number);
    if (Array.isArray(machine?.reason_ids) && machine.reason_ids.length) return machine.reason_ids.map(Number);
    return [];
  });
  const [quantities, setQuantities] = useState(() => {
    const initial = {};
    if (Array.isArray(machine?.maintenance_lines)) {
      for (const line of machine.maintenance_lines) {
        if (line.reasonId && line.quantity) initial[Number(line.reasonId)] = line.quantity;
      }
    }
    return initial;
  });
  const [quantityModal, setQuantityModal] = useState(null);
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
  const [locationChangeOpen, setLocationChangeOpen] = useState(false);
  const [locationChangeSaving, setLocationChangeSaving] = useState(false);
  const [locationChangeNote, setLocationChangeNote] = useState('');
  const [locationChangeEvidence, setLocationChangeEvidence] = useState(null);
  const beforeInput = useRef(null);
  const afterInput = useRef(null);
  const previewUrls = useRef(new Set());
  const draftVisitUuid = useRef(getDraftVisitUuid(repId, machine.cardId)).current;
  const draftCapturedAt = useRef(new Date().toISOString()).current;
  const draftSaved = useRef(false);
  const autoCameraOpened = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const pendingCapturesRef = useRef(pendingCaptures);
  pendingCapturesRef.current = pendingCaptures;
  const deletingPhotoRef = useRef(false);
  const captureSessionRef = useRef(false);
  const processingCapturesRef = useRef(false);
  const nativeApp = isNativeRepApp();
  const stopWorkRef = useRef(onStopWork);
  stopWorkRef.current = onStopWork;

  useEffect(() => () => {
    if (!draftSaved.current) void stopWorkRef.current?.(machine.cardId, draftVisitUuid);
  }, [draftVisitUuid, machine.cardId]);

  useEffect(() => {
    if (photos.before.length + photos.after.length === 0 || !onStartWork) return undefined;
    const timer = window.setInterval(() => {
      if (draftSaved.current) return;
      void (async () => {
        const location = await captureLocation?.();
        if (!location) return;
        try { await onStartWork(machine.cardId, draftVisitUuid, locationPayload(location)); }
        catch (error) { setError(error.message || 'تعذر تجديد حالة الماكينة قيد التنفيذ.'); }
      })();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [captureLocation, draftVisitUuid, machine.cardId, onStartWork, photos.after.length, photos.before.length]);

  useEffect(() => () => {
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!nativeApp) return undefined;
    let active = true;
    void listNativeStagedVisitPhotos(draftVisitUuid).then((staged) => {
      if (!active) return;
      const recoveredPhotos = { before: [], after: [] };
      const recoveredCaptures = { before: [], after: [] };
      for (const entry of staged) {
        if (!['before', 'after'].includes(entry.phase) || !Number.isInteger(entry.photoIndex)
            || !entry.captureId || !entry.capturedAt) continue;
        if (entry.status === 'processed' && entry.path) {
          recoveredPhotos[entry.phase].push({
            path: entry.path, sizeBytes: Number(entry.sizeBytes), capturedAt: entry.capturedAt,
            photoIndex: entry.photoIndex, captureId: entry.captureId, previewUrl: nativeFilePreviewUrl(entry.path),
          });
        } else if (entry.status === 'captured' && entry.sourceUri) {
          recoveredCaptures[entry.phase].push(entry);
        }
      }
      setPhotos((current) => ({
        before: [...current.before, ...recoveredPhotos.before.filter((photo) => !current.before.some((saved) => saved.captureId === photo.captureId))],
        after: [...current.after, ...recoveredPhotos.after.filter((photo) => !current.after.some((saved) => saved.captureId === photo.captureId))],
      }));
      setPendingCaptures((current) => {
        const next = {
          before: mergeCapturedPhotoResults(current.before, recoveredCaptures.before, MAX_VISIT_PHOTOS_PER_PHASE),
          after: mergeCapturedPhotoResults(current.after, recoveredCaptures.after, MAX_VISIT_PHOTOS_PER_PHASE),
        };
        pendingCapturesRef.current = next;
        return next;
      });
    }).catch((restoreError) => {
      if (active) setError(restoreError.message || 'تعذر استعادة الصور المحفوظة لهذه الزيارة.');
    });
    return () => { active = false; };
  }, [draftVisitUuid, nativeApp]);

  useEffect(() => {
    void captureLocation?.();
    const timer = window.setInterval(() => { void captureLocation?.(); }, 20000);
    return () => window.clearInterval(timer);
  }, [captureLocation]);

  const provisionalActionMatches = confirmedPin?.offlineProvisional
    && confirmedPin.locationConfirmation?.actionUuid
    && confirmedPin.locationConfirmation.actionUuid === machine.locationConfirmation?.actionUuid;
  const activeMachine = confirmedPin && (!machine.locationConfirmation || provisionalActionMatches)
    ? { ...machine, ...confirmedPin } : machine;
  const locationPending = activeMachine.locationConfirmationPending === true;
  const offlineProvisionalLocation = activeMachine.offlineProvisional === true;
  const locationLocked = activeMachine.isLocationLocked === true;
  const hasMachinePin = Number.isFinite(activeMachine.latitude) && Number.isFinite(activeMachine.longitude);
  const gpsFresh = isEligibleVisitGps(gps);
  const measuredDistance = gpsFresh && hasMachinePin
    ? distanceMeters(gps, { latitude: activeMachine.latitude, longitude: activeMachine.longitude })
    : null;
  const effectiveDistance = measuredDistance === null ? null : Math.max(0, measuredDistance - Number(gps.accuracy ?? 0));
  const radius = Math.max(1, Number(activeMachine.geofenceRadiusMeters) || 50);
  const withinGeofence = locationLocked && hasMachinePin && effectiveDistance !== null && effectiveDistance <= radius;
  const canAttemptCapture = locationLocked && hasMachinePin && !correctionOpen
    && (!locationPending || offlineProvisionalLocation) && activeMachine.canVisit !== false;

  const confirmCurrentLocation = async () => {
    setError('');
    setConfirmingLocation(true);
    try {
      const location = await captureLocation?.();
      const currentLocation = location;
      if (!currentLocation) throw new Error('يلزم انتظار إشارة GPS قبل تثبيت موقع الماكينة.');
      if (!isEligibleVisitGps(currentLocation)) throw new Error('إشارة GPS قديمة أو غير دقيقة؛ انتظر تحديث الموقع ثم حاول تثبيته من جديد.');
      const pin = await onConfirmLocation(currentLocation);
      setConfirmedPin(pin);
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
      const currentLocation = capturedLocation;
      if (!currentLocation) throw new Error('يلزم إرسال موقع GPS الحالي مع بلاغ التصحيح.');
      if (!isEligibleVisitGps(currentLocation)) throw new Error('يلزم GPS حديث ودقيق لإرسال بلاغ التصحيح.');
      if (correctionEvidence && correctionEvidence.size > 4 * 1024 * 1024) {
        throw new Error('يجب ألا تتجاوز صورة الإثبات 4 ميغابايت.');
      }
      await onReportCorrection({
        reportedCode: correctionCode.trim(),
        reportedName: correctionName.trim(),
        note: correctionNote.trim(),
        evidence: correctionEvidence,
        location: locationPayload(currentLocation),
        capturedAt: draftCapturedAt,
      });
      onClose();
    } catch (correctionError) {
      setError(correctionError.message || 'تعذر حفظ بلاغ التصحيح؛ أعد المحاولة.');
    } finally {
      setCorrectionSaving(false);
    }
  };

  const submitLocationChange = async () => {
    setLocationChangeSaving(true);
    setError('');
    try {
      const currentLocation = await captureLocation?.();
      if (!currentLocation) throw new Error('يلزم الحصول على GPS حديث قبل طلب تغيير الموقع.');
      if (!isEligibleVisitGps(currentLocation)) throw new Error('إشارة GPS قديمة أو غير دقيقة؛ حدّث الموقع ثم حاول مجدداً.');
      if (currentLocation.isMock === true) throw new Error('لا يمكن إرسال موقع تم الإبلاغ عنه كموقع تجريبي.');
      if (locationChangeEvidence && locationChangeEvidence.size > 4 * 1024 * 1024) throw new Error('يجب ألا تتجاوز صورة الإثبات 4 ميغابايت.');
      await onRequestLocationChange({
        note: locationChangeNote.trim(), evidence: locationChangeEvidence,
        location: { latitude: currentLocation.latitude, longitude: currentLocation.longitude,
          accuracy: currentLocation.accuracy, updatedAt: currentLocation.updatedAt, isMock: currentLocation.isMock === true },
      });
      setLocationChangeOpen(false);
      setLocationChangeNote('');
      setLocationChangeEvidence(null);
      setError('تم إرسال طلب تغيير الموقع للمراجعة الإدارية. سيظل الموقع الحالي فعالاً حتى اعتماده.');
    } catch (caught) { setError(caught.message || 'تعذر إرسال طلب تغيير الموقع.'); }
    finally { setLocationChangeSaving(false); }
  };

  const setPendingPhase = (phase, updater) => {
    const next = { ...pendingCapturesRef.current, [phase]: updater(pendingCapturesRef.current[phase]) };
    pendingCapturesRef.current = next;
    setPendingCaptures(next);
  };

  const processCaptures = async (phase, incomingFiles = []) => {
    if (deletingPhotoRef.current || processingCapturesRef.current) return;
    processingCapturesRef.current = true;
    setProcessingPhase(phase);
    try {
      const currentPhotos = photosRef.current[phase];
      const existingPending = pendingCapturesRef.current[phase];
      const merged = mergeCapturedPhotoResults(existingPending, Array.from(incomingFiles ?? []).filter(Boolean), MAX_VISIT_PHOTOS_PER_PHASE - currentPhotos.length);
      setPendingPhase(phase, () => merged);
      if (!merged.length) return;

      const currentLocation = await captureLocation?.();
      validateVisitPhotoCaptureLocation(currentLocation, activeMachine);
      setError('');
      try { await onStartWork?.(machine.cardId, draftVisitUuid, locationPayload(currentLocation)); }
      catch (claimError) { throw new Error(claimError.message || 'بدأ مندوب آخر العمل على هذه الماكينة؛ حدّث المسار.'); }

      for (let index = 0; index < merged.length; index += 1) {
        const file = merged[index];
        let capturedAt;
        let photo = null;
        try {
          capturedAt = new Date(file.capturedAt ?? Date.now());
          if (Number.isNaN(capturedAt.valueOf())) throw new Error('وقت التقاط الصورة غير صالح.');
          const photoLocation = nativeApp ? file.location : await captureLocation?.();
          validateVisitPhotoCaptureLocation(photoLocation, activeMachine);
          if (nativeApp) {
            const photoIndex = Number.isInteger(file.photoIndex) ? file.photoIndex : firstUnusedPhotoIndex(photosRef.current[phase], MAX_VISIT_PHOTOS_PER_PHASE);
            if (photoIndex < 0) throw new Error('بلغت الحد التقني للصور لهذه المرحلة.');
            const saved = await processNativeVisitPhoto({
              visitUuid: draftVisitUuid,
              phase,
              index: photoIndex,
              photoIndex,
              captureId: file.captureId,
              sourceUri: file.sourceUri,
              watermark: {
                machineCode: activeMachine.machineCode,
                machineName: activeMachine.arabicName,
                repName,
                regionName: activeMachine.regionName,
                areaName: activeMachine.areaName,
                phase,
                capturedAt: capturedAt.toISOString(),
                visitCapturedAt: draftCapturedAt,
                location: locationPayload(photoLocation),
              },
            });
            photo = {
              path: saved.path,
              photoIndex,
              captureId: file.captureId,
              sizeBytes: Number(saved.sizeBytes),
              previewUrl: nativeFilePreviewUrl(saved.path),
              capturedAt: capturedAt.toISOString(),
            };
            if (saved.archiveWarning) setError(saved.archiveWarning);
            else if (saved.archive?.pending > 0) setError('الصورة محفوظة داخل التطبيق؛ توجد صور بانتظار نسخها إلى المجلد المختار.');
          } else {
            const blob = await compressAndWatermark(file, {
              machineCode: activeMachine.machineCode,
              machineName: activeMachine.arabicName,
              regionName: activeMachine.regionName,
              areaName: activeMachine.areaName,
              phase,
              capturedAt,
              location: locationPayload(photoLocation),
            });
            const previewUrl = URL.createObjectURL(blob);
            previewUrls.current.add(previewUrl);
            photo = { blob, previewUrl, capturedAt: capturedAt.toISOString() };
          }
          if (!photosRef.current[phase].some((saved) => file.captureId && saved.captureId === file.captureId)) {
            const next = { ...photosRef.current, [phase]: [...photosRef.current[phase], photo] };
            photosRef.current = next;
            setPhotos(next);
          }
          setPendingPhase(phase, (current) => current.filter((candidate) => candidate.captureId !== file.captureId && candidate !== file));
        } catch (captureError) {
          throw new Error(`الصورة ${index + 1} محفوظة محلياً ولم تُفقد. ${captureError.message || 'تعذرت معالجتها؛ أعد المحاولة.'}`);
        }
      }
      setError('');
    } catch (captureError) {
      setError(captureError.message || 'تعذرت معالجة الصور؛ تبقى المجموعة محفوظة ويمكن إعادة المحاولة.');
      if (nativeApp) {
        try {
          const staged = await listNativeStagedVisitPhotos(draftVisitUuid);
          const processed = staged.filter((photo) => photo.phase === phase && photo.status === 'processed' && photo.path);
          const nextPhotos = [...photosRef.current[phase]];
          for (const entry of processed) {
            if (nextPhotos.some((photo) => photo.captureId === entry.captureId)) continue;
            nextPhotos.push({
              path: entry.path, sizeBytes: Number(entry.sizeBytes), capturedAt: entry.capturedAt,
              photoIndex: entry.photoIndex, captureId: entry.captureId, previewUrl: nativeFilePreviewUrl(entry.path),
            });
          }
          const next = { ...photosRef.current, [phase]: nextPhotos };
          photosRef.current = next;
          setPhotos(next);
          setPendingPhase(phase, () => staged.filter((photo) => photo.phase === phase && photo.status === 'captured'));
        } catch { /* SQLite remains authoritative; the representative can reopen the visit to rehydrate it. */ }
      }
    } finally {
      processingCapturesRef.current = false;
      setProcessingPhase('');
    }
  };

  const captureFromPicker = (phase) => async (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await processCaptures(phase, files);
  };

  const openCamera = (phase, inputRef) => async () => {
    if (captureSessionRef.current || processingCapturesRef.current || saving || !canAttemptCapture) return;
    captureSessionRef.current = true;
    setProcessingPhase(phase);
    try {
      const freshLocation = await captureLocation?.();
      validateVisitPhotoCaptureLocation(freshLocation, activeMachine);
      const currentPhotos = photosRef.current[phase];
      const staged = pendingCapturesRef.current[phase];
      const remaining = MAX_VISIT_PHOTOS_PER_PHASE - currentPhotos.length - staged.length;
      if (remaining <= 0) throw new Error('وصلت إلى الحد الأقصى للصور في هذه المرحلة. أعد معالجة الصور المحفوظة أولاً.');
      if (!nativeApp) {
        inputRef.current?.click();
        return;
      }
      const allPhotos = [...currentPhotos, ...staged];
      const startIndex = allPhotos.reduce((highest, photo) => Math.max(highest, Number(photo.photoIndex) + 1), 0);
      if (startIndex < 0 || startIndex + remaining > MAX_VISIT_PHOTOS_PER_PHASE) {
        throw new Error('تعذر تحديد ترتيب آمن لمجموعة الصور؛ أعد معالجة الصور المحفوظة أولاً.');
      }
      setProcessingPhase('camera');
      const captured = await captureNativeCameraPhotos({
        visitUuid: draftVisitUuid,
        repId,
        cardId: machine.cardId,
        phase,
        startIndex,
        fallbackLocation: locationPayload(freshLocation),
        maxPhotos: remaining,
        phaseLabel: phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة',
      });
      await processCaptures(phase, captured);
    } catch (captureError) {
      setError(captureError.message || 'تعذر فتح الكاميرا. الصور التي حُفظت جزئياً ستظهر عند استعادة الزيارة.');
      if (nativeApp) {
        try {
          const staged = await listNativeStagedVisitPhotos(draftVisitUuid);
          const captured = staged.filter((photo) => photo.phase === phase && photo.status === 'captured');
          setPendingPhase(phase, (current) => mergeCapturedPhotoResults(current, captured, MAX_VISIT_PHOTOS_PER_PHASE - photosRef.current[phase].length));
        } catch { /* Existing staged photos remain in the native SQLite draft queue. */ }
      }
    } finally {
      captureSessionRef.current = false;
      setProcessingPhase('');
    }
  };

  useEffect(() => {
    if (!nativeApp || activePhase !== 'before' || photos.before.length > 0 || pendingCaptures.before.length > 0
        || autoCameraOpened.current || correctionOpen || !canAttemptCapture) return;
    autoCameraOpened.current = true;
    void openCamera('before', beforeInput);
  }, [activePhase, canAttemptCapture, correctionOpen, nativeApp, openCamera, pendingCaptures.before.length, photos.before.length]);

  const removePhoto = async (phase, index) => {
    if (deletingPhotoRef.current) return;
    const removed = photosRef.current[phase][index];
    if (!removed) return;
    deletingPhotoRef.current = true;
    setProcessingPhase(phase);
    setError('');
    try {
      if (nativeApp) {
        const result = await deleteNativeVisitPhoto(draftVisitUuid, phase, removed.photoIndex ?? index, removed.path, removed);
        if (result?.deleted === false) throw new Error('تعذر حذف الصورة المحلية؛ بقيت ضمن الزيارة.');
      }
      if (removed.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      setPhotos((current) => {
        const next = {
        ...current,
        [phase]: current[phase].filter((photo) => photo !== removed),
        };
        photosRef.current = next;
        return next;
      });
    } catch (deleteError) {
      setError(deleteError.message || 'تعذر حذف الصورة من التخزين المحلي؛ لم تُزل من الزيارة.');
    } finally {
      deletingPhotoRef.current = false;
      setProcessingPhase('');
    }
  };

  const addReason = (id) => {
    const numId = Number(id);
    if (!numId || selectedReasonIds.includes(numId)) return;
    const reasonObj = (reasons || []).find((r) => Number(r.id) === numId);
    if (reasonObj && (reasonObj.countable || reasonObj.is_countable)) {
      setQuantityModal({ reason: reasonObj, initialValue: '', isNew: true });
      return;
    }
    setSelectedReasonIds((current) => [...current, numId]);
  };

  const confirmReasonQuantity = ({ reasonId, quantity }) => {
    const reason = quantityModal?.reason;
    if (!reason) return;
    if (quantityModal.isNew) setSelectedReasonIds((current) => [...current, Number(reasonId)]);
    setQuantities((current) => ({ ...current, [reasonId]: quantity }));
    setQuantityModal(null);
  };

  const removeReason = (id) => {
    const numId = Number(id);
    setSelectedReasonIds((current) => current.filter((rId) => rId !== numId));
    setQuantities((current) => {
      const next = { ...current };
      delete next[numId];
      return next;
    });
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
    if (pendingCaptures.before.length || pendingCaptures.after.length) {
      setError('توجد صور محفوظة لم تكتمل معالجتها. أعد معالجتها قبل حفظ الزيارة؛ لن تحتاج إلى إعادة تصويرها.');
      return;
    }
    if (photos.before.length < 1 || photos.after.length < 1) {
      setError('يلزم تصوير صورة قبل الصيانة وصورة بعدها على الأقل.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      let capturedLocation = await captureLocation?.();
      let currentLocation = capturedLocation || gps;
      if (!currentLocation && hasMachinePin) {
        currentLocation = {
          latitude: Number(activeMachine.latitude),
          longitude: Number(activeMachine.longitude),
          accuracy: 25,
          speed: 0,
          updatedAt: new Date().toISOString(),
          approximate: true,
        };
      }
      if (!currentLocation) throw new Error('يلزم تحديد موقع GPS قبل حفظ الزيارة.');
      validateVisitPhotoCaptureLocation(currentLocation, activeMachine);
      if (correctionOpen) throw new Error('أغلق بلاغ اختلاف الماكينة أو أرسله قبل متابعة الزيارة.');
      if (!locationLocked || !hasMachinePin) {
        throw new Error('لم يتم تأكيد موقع الماكينة بعد؛ أكّد موقعها الحالي قبل حفظ الزيارة.');
      }
      const measuredDist = distanceMeters(currentLocation, { latitude: activeMachine.latitude, longitude: activeMachine.longitude });
      const effDist = Math.max(0, measuredDist - Number(currentLocation.accuracy ?? 0));
      if (effDist > radius) {
        throw new Error(`أنت خارج نطاق الماكينة (المسافة الفعالة: ${Math.round(effDist)} متر، المسموح: ${radius} متر).`);
      }

      const selectedReasonsList = selectedReasonIds
        .map((rid) => (reasons || []).find((r) => Number(r.id) === Number(rid)))
        .filter(Boolean);
      const countableSelected = selectedReasonsList.filter((r) => Boolean(r.countable || r.is_countable));
      const maintenanceLines = [];
      for (const countable of countableSelected) {
        const rawQ = quantities[countable.id];
        const qNum = Number(rawQ);
        if (!Number.isSafeInteger(qNum) || qNum <= 0) {
          throw new Error(`يرجى إدخال كمية صحيحة موجبة للبند: "${countable.name}".`);
        }
        maintenanceLines.push({ reasonId: Number(countable.id), quantity: qNum, unit: countable.default_unit ?? countable.unit });
      }

      draftSaved.current = true;
      await onSave({
        visitUuid: draftVisitUuid,
        machineCondition: 'working',
        reasonIds: selectedReasonIds,
        maintenanceLines,
        notes: notes.trim(),
        beforePhotos: photos.before.map(({ blob, path, sizeBytes, capturedAt: photoCapturedAt }) => blob ?? ({ path, sizeBytes, capturedAt: photoCapturedAt })),
        afterPhotos: photos.after.map(({ blob, path, sizeBytes, capturedAt: photoCapturedAt }) => blob ?? ({ path, sizeBytes, capturedAt: photoCapturedAt })),
        beforeCapturedAt: photos.before.map(({ capturedAt }) => capturedAt),
        afterCapturedAt: photos.after.map(({ capturedAt }) => capturedAt),
        capturedAt: draftCapturedAt,
        location: locationPayload(currentLocation),
      });
      clearDraftVisitUuid(repId, machine.cardId, draftVisitUuid);
    } catch (saveError) {
      draftSaved.current = false;
      setError(saveError.message || 'تعذر حفظ الزيارة محلياً. لم تُحذف الصور؛ حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const photoField = (phase, phasePhotos, inputRef) => {
    const label = phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة';
    const queuedCaptures = pendingCaptures[phase];
    const captureAction = queuedCaptures.length
      ? () => void processCaptures(phase, [])
      : openCamera(phase, inputRef);
    return (
      <section className="rep-photo-card" aria-label={`صور ${label}`}>
        <div className="rep-photo-card-head">
          <div>
            <span className="rep-eyebrow">{phase === 'before' ? '01 · BEFORE' : '02 · AFTER'}</span>
            <h3>{label}</h3>
          </div>
          <span className={`rep-photo-state ${phasePhotos.length >= 1 ? 'is-ready' : ''}`}>{phasePhotos.length} معالجة{queuedCaptures.length ? ` · ${queuedCaptures.length} محفوظة لإعادة المعالجة` : ''} · صورة واحدة على الأقل</span>
        </div>
        {phasePhotos.length > 0 && <div className="rep-photo-preview-grid">
          {phasePhotos.map((photo, index) => <div className="rep-photo-preview" key={`${photo.capturedAt}-${index}`}>
            <button type="button" className="rep-button rep-button-light" onClick={() => setPreviewPhoto(photo.previewUrl)} aria-label="معاينة الصورة"><img src={photo.previewUrl} alt={`صورة ${label} رقم ${index + 1} للماكينة ${machine.machineCode}`} /></button>
            <small>{index + 1} · {Math.max(1, Math.round((photo.blob?.size ?? photo.sizeBytes ?? 1) / 1024))} KB · {new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' }).format(new Date(photo.capturedAt))}</small>
            <button type="button" className="rep-button rep-button-danger-light" onClick={() => void removePhoto(phase, index)} disabled={saving || Boolean(processingPhase)}>حذف الصورة</button>
          </div>)}
        </div>}
        {queuedCaptures.length > 0 && <ul className="rep-captured-pending-list" aria-label={`صور ${label} بانتظار المعالجة`}>
          {queuedCaptures.map((capture, index) => <li key={capture.captureId || capture.sourceUri || `${capture.name}-${capture.lastModified}`}>
            <span>صورة محفوظة {index + 1} · {new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' }).format(new Date(capture.capturedAt || Date.now()))} · بانتظار GPS/المعالجة</span>
            <button type="button" className="rep-button rep-button-danger-light" disabled={Boolean(processingPhase) || saving} onClick={async () => {
              try {
                if (nativeApp) {
                  const result = await deleteNativeVisitPhoto(draftVisitUuid, phase, capture.photoIndex, capture.sourceUri, capture);
                  if (result?.deleted === false) throw new Error('تعذر حذف الصورة المؤقتة؛ بقيت محفوظة للمحاولة التالية.');
                }
                setPendingPhase(phase, (current) => current.filter((item) => item !== capture && item.captureId !== capture.captureId));
              } catch (deleteError) { setError(deleteError.message || 'تعذر حذف الصورة المؤقتة؛ بقيت محفوظة للمحاولة التالية.'); }
            }}>حذف الصورة المحفوظة</button>
          </li>)}
        </ul>}
        <div className="rep-photo-capture-actions">
          <button
            type="button"
            className="rep-camera-button"
            onClick={captureAction}
            disabled={Boolean(processingPhase) || saving || (!queuedCaptures.length && !canAttemptCapture) || phasePhotos.length >= MAX_VISIT_PHOTOS_PER_PHASE}
          >
            <span className="rep-camera-icon" aria-hidden="true">⌖</span>
            <span>{processingPhase === phase ? 'جارٍ تجهيز الصور...' : processingPhase === 'camera' ? 'الكاميرا مفتوحة…' : queuedCaptures.length ? `أعد معالجة ${queuedCaptures.length} صورة محفوظة · ${label}` : `${nativeApp ? `التقط حتى ${MAX_VISIT_PHOTOS_PER_PHASE - phasePhotos.length - queuedCaptures.length} صور متتالية دون إغلاق الكاميرا` : 'أضف صوراً بالكاميرا'} · ${label}`}</span>
          </button>
          {!nativeApp && !queuedCaptures.length && <button type="button" className="rep-button rep-button-light" onClick={captureAction} disabled={Boolean(processingPhase) || saving || !canAttemptCapture || phasePhotos.length >= MAX_VISIT_PHOTOS_PER_PHASE}>اختيار الصور المتبقية</button>}
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
    <>
    {previewPhoto && <div role="dialog" aria-modal="true" aria-label="معاينة الصورة" style={{position:"fixed",inset:0,zIndex:10000,background:"#000e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><button type="button" className="rep-button" onClick={() => setPreviewPhoto(null)}>إغلاق المعاينة</button><img src={previewPhoto} alt="الصورة المحفوظة بالواترمارك" style={{maxWidth:"100%",maxHeight:"85vh",objectFit:"contain"}} /></div>}
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
          {locationLocked && hasMachinePin && <>
            <div className={`rep-gps-strip ${gpsFresh ? 'has-fix' : ''}`}>
              <span className="rep-gps-pulse" aria-hidden="true" />
              <div>
                <strong>{gpsFresh ? 'GPS حديث صالح للتصوير' : gps ? 'آخر موقع معروف — غير صالح للتصوير' : gpsError || 'جارٍ تحديد GPS حديث...'}</strong>
                <small>{gps ? showLocation(gps) : 'لن تُستخدم الإحداثيات القديمة؛ حدّث GPS قبل التصوير أو الحفظ.'}</small>
              </div>
              <span className="rep-gps-label">GPS</span>
            </div>

            <div className={`rep-geofence-status ${!gpsFresh || !withinGeofence ? 'outside' : 'inside'}`} role="status">
              {!gpsFresh
                ? 'يلزم الحصول على GPS حديث ودقيق؛ الإحداثيات السابقة لا تفعّل التصوير.'
                : withinGeofence
                  ? `أنت داخل النطاق · المسافة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`
                  : `أنت خارج النطاق · المسافة الفعالة ${Math.round(effectiveDistance)} متر (المسموح ${radius} متر).`}
            </div>
          </>}

          {!locationLocked || !hasMachinePin ? <section className="rep-machine-verification">
            <button type="button" className="rep-button rep-button-primary" onClick={() => void confirmCurrentLocation()}
              disabled={locationPending || confirmingLocation || saving || correctionSaving}>
              {confirmingLocation ? 'جارٍ اعتماد الماكينة…' : locationPending ? 'الموقع محفوظ وبانتظار الاتصال' : 'اعتماد الماكينة'}
            </button>
          </section> : <section className="rep-machine-verification verified">
            <div>
              <strong>{offlineProvisionalLocation ? 'الموقع مثبت مؤقتاً على هذا الهاتف' : 'الموقع مؤكد ومقفل'}</strong>
              <small>{offlineProvisionalLocation
                ? 'يمكنك استكمال الزيارة أوفلاين؛ سيُرسل اقتراح الموقع أولاً، ولن تُرفع الزيارة قبل إقرار الخادم له.'
                : `نطاق التصوير والزيارة: ${radius} متر${activeMachine.locationConfirmationPending ? ' · بانتظار مزامنة الخادم' : ''}.`}</small>
            </div>
          </section>}

          {locationLocked && <section className="rep-wrong-machine-report">
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
                disabled={correctionSaving || !gpsFresh || !correctionCode.trim() || !correctionName.trim()}>
                {correctionSaving ? 'جارٍ حفظ البلاغ…' : 'إرسال بلاغ التصحيح للإدارة'}
              </button>
            </div>}
          </section>}

          {locationLocked && onRequestLocationChange && <section className="rep-wrong-machine-report">
            <button type="button" className="rep-button rep-button-light"
              onClick={() => { setLocationChangeOpen((value) => !value); setError(''); }}
              aria-expanded={locationChangeOpen} disabled={locationChangeSaving || saving}>
              {locationChangeOpen ? 'إخفاء طلب تغيير الموقع' : 'تغيير موقع الماكينة · يتطلب اعتماد الإدارة'}
            </button>
            {locationChangeOpen && <div className="rep-correction-form">
              <p>سيُرفق طلبك بإحداثيات GPS الحالية. لن يتغير الموقع المثبت أو نطاق الزيارة قبل اعتماد المدير.</p>
              <label><span>سبب التغيير (اختياري)</span><textarea value={locationChangeNote} onChange={(event) => setLocationChangeNote(event.target.value)} maxLength={2000} rows={2} /></label>
              <label><span>صورة إثبات اختيارية (JPEG / PNG / WebP · حتى 4 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setLocationChangeEvidence(event.target.files?.[0] ?? null)} /></label>
              {locationChangeEvidence && <small className="rep-correction-file">{locationChangeEvidence.name} · {Math.ceil(locationChangeEvidence.size / 1024)} KB</small>}
              <button type="button" className="rep-button rep-button-primary" onClick={() => void submitLocationChange()}
                disabled={locationChangeSaving || !gpsFresh}>{locationChangeSaving ? 'جارٍ إرسال الطلب…' : 'إرسال طلب التغيير للموافقة'}</button>
            </div>}
          </section>}

          <section className="rep-form-section">
            <div className="rep-section-title">
              <div><span className="rep-eyebrow">PHOTO PROOF</span><h3>توثيق وصور الزيارة</h3></div>
              <small>{activePhase === 'before' ? 'المرحلة 1 من 2 · صور قبل الصيانة' : 'المرحلة 2 من 2 · صور بعد الصيانة'}</small>
            </div>
            <div className="rep-phase-selector-tabs" role="tablist" aria-label="اختيار مرحلة التصوير">
              <button
                type="button"
                role="tab"
                aria-selected={activePhase === 'before'}
                className={`rep-phase-tab ${activePhase === 'before' ? 'active' : ''}`}
                onClick={() => setActivePhase('before')}
              >
                <span>📸 01 · قبل الصيانة</span>
                <b>{photos.before.length > 0 ? `✓ ${photos.before.length}` : 'مطلوب'}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePhase === 'after'}
                className={`rep-phase-tab ${activePhase === 'after' ? 'active' : ''}`}
                onClick={() => setActivePhase('after')}
              >
                <span>✨ 02 · بعد الصيانة</span>
                <b>{photos.after.length > 0 ? `✓ ${photos.after.length}` : 'مطلوب'}</b>
              </button>
            </div>
            <div className="rep-photo-grid">
              {activePhase === 'before'
                ? photoField('before', photos.before, beforeInput)
                : photoField('after', photos.after, afterInput)}
            </div>
            {activePhase === 'before' ? (
              <button type="button" className="rep-button rep-button-primary"
                onClick={() => setActivePhase('after')} disabled={photos.before.length < 1 || saving || Boolean(processingPhase)}>
                {photos.before.length >= 1 ? 'الانتقال إلى صور بعد الصيانة ←' : 'التقط صورة قبل الصيانة على الأقل للمتابعة'}
              </button>
            ) : (
              <div className="rep-photo-capture-actions">
                <button type="button" className="rep-button rep-button-light" onClick={() => setActivePhase('before')} disabled={saving || Boolean(processingPhase)}>
                  العودة إلى صور قبل الصيانة
                </button>
                {photos.after.length >= 1 && <small>✓ اكتملت صور قبل وبعد؛ يمكنك الآن حفظ الزيارة.</small>}
              </div>
            )}
            <p className="rep-watermark-note">يُدمج ووترمارك رسمي ببكسلات كل صورة: شعار مدار، اليوم والتاريخ بتوقيت القاهرة الرسمي، إحداثيات GPS، والماكينة.</p>
          </section>

          <label className="rep-notes-field">
            <span>ملاحظة للمشرف <small>اختياري</small></span>
            <textarea maxLength={10000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="اكتب ملاحظة مختصرة عن الزيارة..." />
          </label>
          {error && <p className="rep-inline-error" role="alert">{error}</p>}
        </div>

        <footer className="rep-sheet-footer">
          <button type="button" className="rep-button rep-button-light" onClick={onClose} disabled={visitBusy}>إلغاء</button>
          <button type="button" className="rep-button rep-button-primary rep-save-visit" onClick={save} disabled={saving || !canAttemptCapture || photos.before.length < 1 || photos.after.length < 1 || pendingCaptures.before.length > 0 || pendingCaptures.after.length > 0 || Boolean(processingPhase) || (nativeApp && /تزييف الموقع/.test(gpsError ?? ''))}>
            {saving ? 'جارٍ تحديد الموقع وحفظ الزيارة…' : '💾 إنهاء الزيارة وحفظ صور قبل وبعد'}
          </button>
        </footer>
      </section>
    </div>
    </>
  );
}
