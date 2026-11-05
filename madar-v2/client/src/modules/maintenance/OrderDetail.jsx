import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { regionAccessLabel } from '../../lib/regions.js';
import { egpToCents, errorMessage, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import MaintenancePptxExportModal from './MaintenancePptxExportModal.jsx';
import StorageFileExplorer, { TripScanProgress } from './StorageFileExplorer.jsx';

const EMPTY_MACHINES = [];
const CARD_NOTE_SAVE_DELAY_MS = 800;
const EMPTY_TRIP_PROGRESS = { percent: 0, processed: 0, total: 0, stage: 'جارٍ فحص المجلد وربط الصور...' };

function formatCaptureTime(value) {
  if (!value) return 'وقت الالتقاط غير معروف';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'وقت الالتقاط غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function sortCards(cards, sortMode) {
  if (!cards || !cards.length) return [];
  const list = [...cards];
  switch (sortMode) {
    case 'name_asc':
      return list.sort((a, b) => {
        const nameA = String(a.machine_name_ar || a.machine_name_en || '').trim();
        const nameB = String(b.machine_name_ar || b.machine_name_en || '').trim();
        return nameA.localeCompare(nameB, 'ar', { sensitivity: 'base', numeric: true });
      });
    case 'name_desc':
      return list.sort((a, b) => {
        const nameA = String(a.machine_name_ar || a.machine_name_en || '').trim();
        const nameB = String(b.machine_name_ar || b.machine_name_en || '').trim();
        return nameB.localeCompare(nameA, 'ar', { sensitivity: 'base', numeric: true });
      });
    case 'code_asc':
      return list.sort((a, b) => {
        const codeA = String(a.machine_code || '').trim();
        const codeB = String(b.machine_code || '').trim();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      });
    case 'code_desc':
      return list.sort((a, b) => {
        const codeA = String(a.machine_code || '').trim();
        const codeB = String(b.machine_code || '').trim();
        return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
      });
    default:
      return list;
  }
}

function sortMachines(machines, sortMode) {
  if (!machines || !machines.length) return [];
  const list = [...machines];
  switch (sortMode) {
    case 'name_asc':
      return list.sort((a, b) => {
        const nameA = String(a.name_ar || a.name_en || '').trim();
        const nameB = String(b.name_ar || b.name_en || '').trim();
        return nameA.localeCompare(nameB, 'ar', { sensitivity: 'base', numeric: true });
      });
    case 'name_desc':
      return list.sort((a, b) => {
        const nameA = String(a.name_ar || a.name_en || '').trim();
        const nameB = String(b.name_ar || b.name_en || '').trim();
        return nameB.localeCompare(nameA, 'ar', { sensitivity: 'base', numeric: true });
      });
    case 'code_asc':
      return list.sort((a, b) => {
        const codeA = String(a.code || '').trim();
        const codeB = String(b.code || '').trim();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      });
    case 'code_desc':
      return list.sort((a, b) => {
        const codeA = String(a.code || '').trim();
        const codeB = String(b.code || '').trim();
        return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
      });
    default:
      return list;
  }
}

export default function MaintenanceOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, setData: setOrderData, loading, error, reload: reloadOrder } = useApi(`/api/maintenance/orders/${id}`);
  const { data: representativeOptions } = useApi(`/api/maintenance/representatives?orderId=${encodeURIComponent(id)}`, { enabled: order?.canAssignRepresentatives === true });
  const machinePath = order?.area ? `/api/maintenance/machines?area=${encodeURIComponent(order.area)}&limit=500` : '';
  const { data: machineData, loading: machinesLoading } = useApi(machinePath, { enabled: Boolean(machinePath) });
  const { data: apiAreas } = useApi('/api/maintenance/areas');
  const { data: reasons } = useApi('/api/maintenance/reasons');
  const [cardOpen, setCardOpen] = useState(false);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [representativesOpen, setRepresentativesOpen] = useState(false);
  const [representativeIds, setRepresentativeIds] = useState([]);
  const [representativeSaving, setRepresentativeSaving] = useState(false);
  const [representativeError, setRepresentativeError] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [populateOpen, setPopulateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [pptxExportOpen, setPptxExportOpen] = useState(false);
  const [machineCodeCard, setMachineCodeCard] = useState(null);
  const [machineCodeDraft, setMachineCodeDraft] = useState('');
  const [machineCodeError, setMachineCodeError] = useState('');
  const [lightboxState, setLightboxState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tripProcessing, setTripProcessing] = useState(false);
  const [tripProgress, setTripProgress] = useState(EMPTY_TRIP_PROGRESS);
  const [selectedAreaFilter, setSelectedAreaFilter] = useState('all');
  const [matchedSearch, setMatchedSearch] = useState('');
  const [cardSort, setCardSort] = useState('name_asc');
  const [, setCardDrafts] = useState({});
  const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set());
  const [expandedCardIds, setExpandedCardIds] = useState(() => new Set());
  const [actionError, setActionError] = useState('');
  const [tripDuplicateWarnings, setTripDuplicateWarnings] = useState([]);
  const [expenseError, setExpenseError] = useState('');
  const [custodyError, setCustodyError] = useState('');
  const [populateArea, setPopulateArea] = useState('');
  const [folderSourceMode, setFolderSourceMode] = useState('storage');
  const [tripZip, setTripZip] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bindingMachineCodes, setBindingMachineCodes] = useState({});
  const cardDraftsRef = useRef({});
  const cardNoteSaveTimersRef = useRef(new Map());
  const cardSavePromisesRef = useRef(new Map());
  const cardSavePayloadsRef = useRef(new Map());
  const orderRef = useRef(order);
  orderRef.current = order;
  const { notice, showToast, clearToast } = useToast();
  const orderAreaNames = useMemo(() => [...new Set((order?.area ?? '').split(/[،,]/).map((area) => area.trim()).filter(Boolean))], [order?.area]);
  const populateAreaOptions = useMemo(() => orderAreaNames.length
    ? (apiAreas ?? []).filter((area) => orderAreaNames.some((selected) => selected.normalize('NFKC').toLocaleLowerCase('ar') === area.normalize('NFKC').toLocaleLowerCase('ar')))
    : (apiAreas ?? []), [apiAreas, orderAreaNames]);
  const areas = useMemo(() => [...new Set((order?.cards ?? []).map((card) => card.machine_area).filter(Boolean))], [order]);
  const activeMachines = machineData?.machines ?? EMPTY_MACHINES;
  const cardsByMachineId = useMemo(() => new Map((order?.cards ?? []).map((card) => [card.machine_id, card])), [order?.cards]);
  const matchedCards = useMemo(() => (order?.cards ?? []).filter((card) =>
    card.status !== 'excluded'
      && ((card.before_photo_urls?.length ?? 0) > 0 || (card.after_photo_urls?.length ?? 0) > 0),
  ), [order?.cards]);
  const areaBreakdown = useMemo(() => {
    const map = new Map();

    for (const machine of activeMachines) {
      const areaName = String(machine.area || 'غير محددة').trim();
      if (!map.has(areaName)) {
        map.set(areaName, { area: areaName, total: 0, matched: 0, missing: 0, percent: 0 });
      }
      map.get(areaName).total += 1;
    }

    for (const card of matchedCards) {
      const areaName = String(card.machine_area || order?.area || 'غير محددة').trim();
      if (!map.has(areaName)) {
        map.set(areaName, { area: areaName, total: 1, matched: 0, missing: 0, percent: 0 });
      }
      map.get(areaName).matched += 1;
    }

    for (const stats of map.values()) {
      stats.missing = Math.max(0, stats.total - stats.matched);
      stats.percent = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
    }

    return [...map.values()].sort((a, b) => a.area.localeCompare(b.area, 'ar'));
  }, [activeMachines, matchedCards, order?.area]);
  const displayedMatchedCards = useMemo(() => {
    const query = matchedSearch.trim().toLowerCase();
    const filtered = matchedCards.filter((card) => {
      const area = String(card.machine_area || order?.area || '').trim();
      const matchesArea = selectedAreaFilter === 'all' || area === selectedAreaFilter;
      if (!matchesArea) return false;
      if (!query) return true;
      const nameAr = String(card.machine_name_ar || '').toLowerCase();
      const nameEn = String(card.machine_name_en || '').toLowerCase();
      const code = String(card.machine_code || '').toLowerCase();
      return nameAr.includes(query) || nameEn.includes(query) || code.includes(query) || area.toLowerCase().includes(query);
    });
    return sortCards(filtered, cardSort);
  }, [matchedCards, selectedAreaFilter, matchedSearch, cardSort, order?.area]);
  const lightboxCards = useMemo(() => {
    if (!lightboxState) return displayedMatchedCards;
    const activeCard = (order?.cards ?? []).find((card) => card.id === lightboxState.cardId);
    if (!activeCard || displayedMatchedCards.some((card) => card.id === activeCard.id)) return displayedMatchedCards;
    return sortCards([...displayedMatchedCards, activeCard], cardSort);
  }, [displayedMatchedCards, lightboxState, order?.cards, cardSort]);
  const tripMatchedMachineIds = useMemo(() => new Set(matchedCards.map((card) => card.machine_id)), [matchedCards]);
  const missingMachines = useMemo(() => {
    const list = activeMachines.filter((machine) => !tripMatchedMachineIds.has(machine.id));
    return sortMachines(list, cardSort);
  }, [activeMachines, tripMatchedMachineIds, cardSort]);
  const unmatchedMachineCandidates = order?.unmatched_machine_candidates ?? EMPTY_MACHINES;
  const knownFolderIds = useRef(new Set());

  function clearCardNoteSaveTimers() {
    for (const timer of cardNoteSaveTimersRef.current.values()) window.clearTimeout(timer);
    cardNoteSaveTimersRef.current.clear();
  }

  function setCardDraft(cardId, draft) {
    const next = { ...cardDraftsRef.current, [cardId]: draft };
    cardDraftsRef.current = next;
    setCardDrafts(next);
  }

  function clearAllCardDrafts() {
    clearCardNoteSaveTimers();
    cardDraftsRef.current = {};
    cardSavePayloadsRef.current.clear();
    setCardDrafts({});
  }

  async function flushPendingCardSaves() {
    clearCardNoteSaveTimers();
    const currentOrder = orderRef.current;
    const failedCardIds = new Set();
    if (!currentOrder) return failedCardIds;

    for (const card of currentOrder.cards ?? []) {
      const draft = cardDraftsRef.current[card.id];
      const queuedPayload = cardSavePayloadsRef.current.get(card.id);
      const hasInFlightSave = cardSavePromisesRef.current.has(card.id);
      if (!draft && !queuedPayload && !hasInFlightSave) continue;
      const reasonIds = draft?.reasonIds ?? queuedPayload?.reasonIds ?? card.reason_ids ?? (card.reason_id ? [card.reason_id] : []);
      const notes = draft?.notes ?? queuedPayload?.notes ?? card.notes ?? '';
      const saved = await saveCardFields(card, reasonIds, notes, { showSuccess: false });
      if (!saved) failedCardIds.add(card.id);
    }
    return failedCardIds;
  }

  async function reload() {
    const failedCardIds = await flushPendingCardSaves();
    const freshOrder = await reloadOrder();
    if (freshOrder) {
      orderRef.current = freshOrder;
      if (!failedCardIds.size) {
        clearAllCardDrafts();
      } else {
        const freshCardIds = new Set((freshOrder.cards ?? []).map((card) => card.id));
        const retainedDrafts = Object.fromEntries(
          Object.entries(cardDraftsRef.current).filter(([cardId]) => (
            failedCardIds.has(Number(cardId)) && freshCardIds.has(Number(cardId))
          )),
        );
        cardDraftsRef.current = retainedDrafts;
        setCardDrafts(retainedDrafts);
      }
    }
    return freshOrder;
  }

  useEffect(() => {
    if (!tripProcessing) return undefined;
    let cancelled = false;
    let timeoutId;
    const pollTripProgress = async () => {
      try {
        const progress = await api.get(`/api/maintenance/orders/${id}/trip-progress`);
        if (!cancelled && progress.percent < 100 && !progress.stage?.startsWith('تعذر')) {
          setTripProgress(progress);
        }
      } catch {
        // The scan request owns error reporting; keep showing the latest progress during transient poll failures.
      }
      if (!cancelled) timeoutId = window.setTimeout(pollTripProgress, 400);
    };
    void pollTripProgress();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [id, tripProcessing]);

  useEffect(() => {
    setSelectedAreaFilter('all');
  }, [id]);

  useEffect(() => {
    setRepresentativeIds((order?.representatives ?? []).filter((rep) => Number(rep.active) === 1).map((rep) => Number(rep.id)));
  }, [order?.id, order?.representatives]);

  useEffect(() => {
    clearAllCardDrafts();
  }, [id]);

  useEffect(() => {
    let flushed = false;
    const flushDraftsBeforeLeave = () => {
      if (flushed) return;
      flushed = true;
      for (const timer of cardNoteSaveTimersRef.current.values()) window.clearTimeout(timer);
      cardNoteSaveTimersRef.current.clear();
      const currentOrder = orderRef.current;
      if (!currentOrder) return;
      for (const card of currentOrder.cards ?? []) {
        const draft = cardDraftsRef.current[card.id];
        if (!draft) continue;
        const serverReasonIds = card.reason_ids ?? (card.reason_id ? [card.reason_id] : []);
        const draftReasonIds = Array.isArray(draft.reasonIds) ? draft.reasonIds : serverReasonIds;
        const sameReasons = serverReasonIds.length === draftReasonIds.length
          && serverReasonIds.every((reasonId, index) => reasonId === draftReasonIds[index]);
        if (sameReasons && (draft.notes ?? '') === (card.notes ?? '')) continue;
        void api.patch(`/api/maintenance/orders/${currentOrder.id}/cards/${card.id}`, {
          reasonIds: draftReasonIds,
          notes: draft.notes ?? '',
        }, { keepalive: true }).catch(() => {});
      }
    };
    const resetLeaveFlush = () => { flushed = false; };
    window.addEventListener('pagehide', flushDraftsBeforeLeave);
    window.addEventListener('pageshow', resetLeaveFlush);
    return () => {
      window.removeEventListener('pagehide', flushDraftsBeforeLeave);
      window.removeEventListener('pageshow', resetLeaveFlush);
      flushDraftsBeforeLeave();
    };
  }, [id]);

  useEffect(() => {
    if (!order?.unmatched_folders) return;
    const folderIds = new Set(order.unmatched_folders.map((folder) => folder.id));
    const newIds = [...folderIds].filter((folderId) => !knownFolderIds.current.has(folderId));
    setExpandedFolderIds((current) => {
      const next = new Set([...current].filter((folderId) => folderIds.has(folderId)));
      for (const folderId of newIds) next.add(folderId);
      return next;
    });
    knownFolderIds.current = folderIds;
  }, [order?.unmatched_folders]);

  const transitionToReview = useCallback(async () => {
    setSaving(true);
    setActionError('');
    try {
      await api.patch(`/api/maintenance/orders/${id}/status`, {});
      await reload();
      showToast('تم تحويل الأمر إلى المراجعة.');
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally { setSaving(false); }
  }, [id, reload, showToast]);

  async function addInspectionCard(event) {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/api/maintenance/orders/${id}/cards`, {
        machineId: Number(form.get('machineId')),
        notes: form.get('notes') || undefined,
      });
      setCardOpen(false);
      await reload();
      showToast('أُضيفت بطاقة فحص الآلة.');
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function uploadPhotos(card, phase, event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    const existing = phase === 'before' ? card.before_photos.length : card.after_photos.length;
    if (files.length < 2 || files.length > 4 || files.length + existing > 4) {
      showToast('اختر من صورتين إلى أربع صور، وبحد أقصى أربع صور لكل مرحلة.', 'error');
      return;
    }
    setSaving(true);
    try {
      for (const file of files) {
        const data = new FormData();
        data.append('photo', file);
        await api.upload(`/api/maintenance/orders/${id}/cards/${card.id}/photos/${phase}`, data);
      }
      await reload();
      showToast(`تم رفع صور ${phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}.`);
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function handleDeletePhoto(card, phase, filename) {
    if (!window.confirm('هل تريد حذف هذه الصورة نهائياً من كارت الفحص؟')) return false;
    setSaving(true);
    try {
      await api.delete(`/api/maintenance/orders/${id}/cards/${card.id}/photos/${phase}/${encodeURIComponent(filename)}`);
      await reload();
      showToast('تم حذف الصورة بنجاح.');
      return true;
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleMovePhoto(card, fromPhase, toPhase, filename) {
    setSaving(true);
    try {
      await api.post(`/api/maintenance/orders/${id}/cards/${card.id}/photos/move`, {
        fromPhase,
        toPhase,
        filename,
      });
      await reload();
      showToast(`تم نقل الصورة إلى مرحلة ${toPhase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}.`);
      return true;
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function archiveOrder(event) {
    event.preventDefault();
    setSaving(true);
    setExpenseError('');
    const form = new FormData(event.currentTarget);
    try {
      const actualExpensesCents = egpToCents(form.get('actualExpenses'), { allowZero: true });
      if (actualExpensesCents > order.petty_cash_disbursed_cents) {
        throw new Error('المصروف الفعلي لا يمكن أن يتجاوز العهدة المصروفة لهذا الأمر.');
      }
      await api.post(`/api/maintenance/orders/${id}/archive`, {
        actualExpensesCents,
        warrantyPeriodMonths: Number(form.get('warrantyPeriodMonths')),
      });
      setArchiveOpen(false);
      await reload();
      showToast('تمت أرشفة أمر الصيانة وتسوية العهدة.');
    } catch (caught) { setExpenseError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function handleDeleteArchivedOrder() {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف أمر الصيانة (${order.order_code}) نهائياً؟\n\n- ستُزال صور وفولدرات الأمر من الأرشيف.\n- سيُحذف الأمر من القوائم مع الاحتفاظ بسجل تاريخي آمن.\n- لا يمكن التراجع عن هذه الخطوة من الواجهة.`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.delete(`/api/maintenance/orders/${id}`);
      showToast(`تم حذف أمر الصيانة ${order.order_code} من الأرشيف.`);
      navigate('/maintenance');
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
      setSaving(false);
    }
  }

  async function handleUnarchiveOrder() {
    const confirmed = window.confirm(
      `هل تريد إلغاء أرشفة أمر الصيانة (${order.order_code}) وإعادة فتحه؟\n\n- سيعود الأمر لحالة (قيد التنفيذ).\n- ستتمكن من تعديل البطاقات وإضافة أو حذف ماكينات ورفع أو نقل الصور.`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.post(`/api/maintenance/orders/${id}/unarchive`);
      await reload();
      showToast(`تم إلغاء أرشفة الأمر ${order.order_code} وإعادة فتحه بنجاح.`);
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function advanceCustody(event) {
    event.preventDefault();
    setSaving(true);
    setCustodyError('');
    const form = new FormData(event.currentTarget);
    try {
      const amountCents = egpToCents(form.get('amount'), { allowZero: false });
      await api.post(`/api/maintenance/orders/${id}/custody-advance`, {
        amountCents,
        notes: form.get('notes') || undefined,
      });
      setCustodyOpen(false);
      await reload();
      showToast('تم صرف العهدة وربطها بأمر الصيانة.');
    } catch (caught) {
      setCustodyError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function populateAreaMachines(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.post(`/api/maintenance/orders/${id}/populate-area`, { area: populateArea });
      setPopulateOpen(false);
      await reload();
      showToast(`تم إدراج ${result.addedCount} ماكينة من المنطقة.`);
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function completeTripFolder(result) {
    setFolderOpen(false);
    setTripZip(null);
    setUploadProgress(0);
    const duplicateWarnings = Array.isArray(result.duplicateWarnings) ? result.duplicateWarnings : [];
    setTripDuplicateWarnings(duplicateWarnings);
    await reload();
    showToast(`تمت مطابقة ${result.matchedMachineCount} ماكينة، وربط ${result.attachedBefore + result.attachedAfter} صورة. مجلدات للمراجعة: ${result.unmatchedFolderCount}.`);
  }

  async function processStorageFolder(folder) {
    if (!folder?.fullStoragePath) return;
    setSaving(true);
    setTripProgress(EMPTY_TRIP_PROGRESS);
    setTripProcessing(true);
    setActionError('');
    setTripDuplicateWarnings([]);
    try {
      const result = await api.post(`/api/maintenance/orders/${id}/process-folder`, { folderPath: folder.fullStoragePath });
      await completeTripFolder(result);
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setTripProcessing(false); setSaving(false); }
  }

  async function uploadTripZip(event) {
    event.preventDefault();
    if (!tripZip) return;
    setSaving(true);
    setTripProgress(EMPTY_TRIP_PROGRESS);
    setTripProcessing(true);
    setUploadProgress(0);
    setActionError('');
    setTripDuplicateWarnings([]);
    try {
      const form = new FormData();
      form.append('file', tripZip);
      const result = await api.uploadWithProgress(`/api/maintenance/orders/${id}/process-folder`, form, setUploadProgress);
      await completeTripFolder(result);
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setTripProcessing(false); setSaving(false); }
  }

  async function bindUnmatchedFolder(folder) {
    const machine = unmatchedMachineCandidates.find((candidate) =>
      candidate.code.toLocaleLowerCase('en') === String(bindingMachineCodes[folder.id] ?? '').trim().toLocaleLowerCase('en'),
    );
    if (!machine) return;
    setSaving(true);
    try {
      const result = await api.post(`/api/maintenance/orders/${id}/unmatched/${folder.id}/bind`, { machineId: machine.id });
      await reload();
      showToast(`تم ربط المجلد واعتماد الاسم ${result.machineCode}.`);
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function deleteUnmatchedFolder(folder) {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف المجلد "${folder.folder_name}" نهائياً؟\n\n- سيتم مسح صور المجلد واستبعاده بالكامل من مراجعة الرحلة.\n- سيتم حذف مجلد المصدر من Areas إن وُجد.\n- لن يتم حذف ملف ZIP الأصلي.`
    );
    if (!confirmed) return;

    setSaving(true);
    setActionError('');
    try {
      const result = await api.delete(`/api/maintenance/orders/${id}/unmatched/${folder.id}`);
      await reload();
      showToast(result.cleanupPending
        ? `تم استبعاد المجلد "${folder.folder_name}"، وسيكتمل تنظيف الملفات المادية عند استعادة النظام.`
        : `تم حذف المجلد "${folder.folder_name}" واستبعاده نهائياً من النظام.`);
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  function getBindingMachine(folderId) {
    const code = String(bindingMachineCodes[folderId] ?? '').trim().toLocaleLowerCase('en');
    if (!code) return null;
    return unmatchedMachineCandidates.find((machine) => machine.code.toLocaleLowerCase('en') === code) ?? null;
  }

  function getBindingMachineMatches(folderId) {
    const query = String(bindingMachineCodes[folderId] ?? '').trim().normalize('NFKC').toLocaleLowerCase('ar');
    if (!query || getBindingMachine(folderId)) return [];
    return unmatchedMachineCandidates.filter((machine) =>
      [machine.code, machine.name_ar, machine.name_en].some((value) =>
        String(value ?? '').normalize('NFKC').toLocaleLowerCase('ar').includes(query),
      ),
    ).slice(0, 6);
  }

  async function addManualCardForMachine(machine) {
    setSaving(true);
    try {
      const card = await api.post(`/api/maintenance/orders/${id}/cards`, { machineId: machine.id });
      setExpandedCardIds((current) => new Set([...current, card.id]));
      await reload();
      showToast(`أُضيف كارت فحص يدوي للماكينة ${machine.code}.`);
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function decommissionMachine({ machineId, machineCode, machineName, cardId }) {
    const name = machineName || machineCode;
    const confirmed = window.confirm(
      `هل أنت متأكد من إزالة الماكينة "${name}" (كود: ${machineCode}) من التشغيل؟\n\n- سيتم حذف مجلد وصور الماكينة المرتبطة بأمر الصيانة ومجلد المنطقة.\n- سيتم إخفاء كارت الفحص من الأمر مع الاحتفاظ بسجل التدقيق.\n- سيتم إلغاء تفعيل الماكينة ولن تظهر ضمن الرحلات أو المعالجة القادمة.`
    );
    if (!confirmed) return;

    setSaving(true);
    setActionError('');
    try {
      if (cardId) {
        await api.delete(`/api/maintenance/orders/${id}/cards/${cardId}`);
      } else {
        await api.delete(`/api/maintenance/orders/${id}/machines/${machineId}`);
      }
      await reload();
      showToast(`تم حذف مجلد الماكينة ${machineCode} وإلغاء تفعيلها بنجاح.`);
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  function toggleFolder(folderId) {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function toggleCard(cardId) {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function expandAllReconciliationCards() {
    setExpandedFolderIds(new Set((order?.unmatched_folders ?? []).map((folder) => folder.id)));
    setExpandedCardIds(new Set((order?.cards ?? []).map((card) => card.id)));
  }

  function collapseAllReconciliationCards() {
    setExpandedFolderIds(new Set());
    setExpandedCardIds(new Set());
  }

  function expandAllMatchedCards() {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      for (const card of displayedMatchedCards) next.add(card.id);
      return next;
    });
  }

  function collapseAllMatchedCards() {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      for (const card of displayedMatchedCards) next.delete(card.id);
      return next;
    });
  }

  function getCardDraft(card) {
    const defaultReasonIds = card.reason_ids ?? (card.reason_id ? [card.reason_id] : []);
    return cardDraftsRef.current[card.id] ?? { reasonIds: defaultReasonIds, notes: card.notes ?? '' };
  }

  async function saveCardFields(card, reasonIds, notes, { showSuccess = true } = {}) {
    const normalizedReasonIds = Array.isArray(reasonIds) ? reasonIds.map(Number).filter(Boolean) : [];
    const normalizedNotes = notes ?? '';
    const payload = { reasonIds: normalizedReasonIds, notes: normalizedNotes };
    const saveTimer = cardNoteSaveTimersRef.current.get(card.id);
    if (saveTimer) window.clearTimeout(saveTimer);
    cardNoteSaveTimersRef.current.delete(card.id);
    setCardDraft(card.id, payload);

    const serverCard = orderRef.current?.cards?.find((item) => item.id === card.id) ?? card;
    const serverReasonIds = serverCard.reason_ids ?? (serverCard.reason_id ? [serverCard.reason_id] : []);
    const sameAsServer = serverReasonIds.length === normalizedReasonIds.length
      && serverReasonIds.every((reasonId, index) => reasonId === normalizedReasonIds[index])
      && (serverCard.notes ?? '') === normalizedNotes;
    if (sameAsServer
      && !cardSavePayloadsRef.current.has(card.id)
      && !cardSavePromisesRef.current.has(card.id)) {
      return true;
    }

    cardSavePayloadsRef.current.set(card.id, payload);
    const activeSave = cardSavePromisesRef.current.get(card.id);
    if (activeSave) return activeSave;

    const savePromise = (async () => {
      while (cardSavePayloadsRef.current.has(card.id)) {
        const currentPayload = cardSavePayloadsRef.current.get(card.id);
        try {
          const updatedCard = await api.patch(`/api/maintenance/orders/${id}/cards/${card.id}`, currentPayload);
          const currentOrder = orderRef.current;
          if (currentOrder) {
            orderRef.current = {
              ...currentOrder,
              cards: (currentOrder.cards ?? []).map((item) => item.id === card.id ? { ...item, ...updatedCard } : item),
            };
          }
          setOrderData((current) => current ? {
            ...current,
            cards: (current.cards ?? []).map((item) => item.id === card.id ? { ...item, ...updatedCard } : item),
          } : current);

          if (cardSavePayloadsRef.current.get(card.id) === currentPayload) {
            cardSavePayloadsRef.current.delete(card.id);
            const currentDraft = cardDraftsRef.current[card.id];
            const draftMatchesSaved = currentDraft
              && currentDraft.notes === currentPayload.notes
              && currentDraft.reasonIds?.length === currentPayload.reasonIds.length
              && currentDraft.reasonIds.every((reasonId, index) => reasonId === currentPayload.reasonIds[index]);
            if (draftMatchesSaved) {
              setCardDraft(card.id, {
                reasonIds: updatedCard.reason_ids ?? (updatedCard.reason_id ? [updatedCard.reason_id] : []),
                notes: updatedCard.notes ?? '',
              });
            }
            if (showSuccess) showToast('تم حفظ أوامر الصيانة والملاحظات الفنية.');
          }
        } catch (caught) {
          showToast(errorMessage(caught), 'error');
          return false;
        }
      }
      return true;
    })().finally(() => {
      cardSavePromisesRef.current.delete(card.id);
    });
    cardSavePromisesRef.current.set(card.id, savePromise);
    return savePromise;
  }

  async function updateInspectionMachineCode(event) {
    event.preventDefault();
    if (!machineCodeCard) return;
    const form = new FormData(event.currentTarget);
    const machineCode = String(form.get('machineCode') ?? '').trim();
    setSaving(true);
    setMachineCodeError('');
    try {
      await api.patch(`/api/maintenance/orders/${id}/cards/${machineCodeCard.id}`, { machineCode });
      await reload();
      setMachineCodeCard(null);
      setMachineCodeDraft('');
      showToast('تم تحديث كود الماكينة في بطاقة الفحص والتقرير.');
    } catch (caught) {
      setMachineCodeError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function saveRepresentativeAssignments(event) {
    event.preventDefault();
    setRepresentativeSaving(true);
    setRepresentativeError('');
    try {
      await api.put(`/api/maintenance/orders/${id}/representatives`, { repUserIds: representativeIds });
      await reload();
      setRepresentativesOpen(false);
      showToast('تم تحديث مناديب أمر الصيانة.');
    } catch (caught) {
      setRepresentativeError(errorMessage(caught));
    } finally {
      setRepresentativeSaving(false);
    }
  }

  function openMachineCodeEditor(card) {
    setMachineCodeError('');
    setMachineCodeDraft(card.machine_code ?? '');
    setMachineCodeCard(card);
  }

  function addCardReason(card, value) {
    if (!value) return;
    const draft = getCardDraft(card);
    const num = Number(value);
    if ((draft.reasonIds ?? []).includes(num)) return;
    const nextIds = [...(draft.reasonIds ?? []), num];
    void saveCardFields(card, nextIds, draft.notes);
  }

  function removeCardReason(card, value) {
    const draft = getCardDraft(card);
    const num = Number(value);
    const nextIds = (draft.reasonIds ?? []).filter((id) => id !== num);
    void saveCardFields(card, nextIds, draft.notes);
  }

  function updateCardNotesDraft(card, value) {
    const draft = getCardDraft(card);
    const nextDraft = { ...draft, notes: value };
    setCardDraft(card.id, nextDraft);
    const existingTimer = cardNoteSaveTimersRef.current.get(card.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      cardNoteSaveTimersRef.current.delete(card.id);
      const latestDraft = cardDraftsRef.current[card.id] ?? nextDraft;
      void saveCardFields(card, latestDraft.reasonIds, latestDraft.notes, { showSuccess: false });
    }, CARD_NOTE_SAVE_DELAY_MS);
    cardNoteSaveTimersRef.current.set(card.id, timer);
  }

  function setCardNotes(card, value) {
    const draft = getCardDraft(card);
    void saveCardFields(card, draft.reasonIds, value);
  }

  function renderInspectionCard(card, { embedded = false } = {}) {
    const expanded = expandedCardIds.has(card.id);
    const photoCount = (card.before_photo_urls?.length ?? 0) + (card.after_photo_urls?.length ?? 0);
    const missingAfterPhotos = (card.after_photo_urls?.length ?? 0) === 0;
    const detailsId = `inspection-card-${card.id}-details`;
    return (
      <section
        className={`madar-panel madar-inspection-card ${embedded ? 'madar-inspection-card-embedded' : ''}`}
        id={`inspection-card-${card.id}`}
        key={card.id}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="madar-accordion-header madar-inspection-card-header"
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            style={{ flex: 1, width: 'auto', minWidth: 0 }}
            onClick={() => toggleCard(card.id)}
          >
            <span className="madar-accordion-chevron" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
            <span className="madar-accordion-identity">
              <strong style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                {missingAfterPhotos && <span
                  className="madar-dot-missing-after"
                  title="الماكينة ينقصها صور بعد الصيانة (After)"
                  aria-label="الماكينة ينقصها صور بعد الصيانة"
                  style={{
                    display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                    backgroundColor: '#ef4444', boxShadow: '0 0 8px rgba(239, 68, 68, 0.8)',
                    marginRight: '6px', flexShrink: 0,
                  }}
                />}
                <span>{card.machine_name_ar}{card.machine_name_en ? ` · ${card.machine_name_en}` : ''}</span>
                {missingAfterPhotos && <span className="madar-badge madar-badge-danger" style={{
                  background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontWeight: 700, fontSize: '10px',
                }}>● ناقصة After</span>}
              </strong>
            </span>
            <Badge tone={photoCount ? 'info' : 'warning'}>{photoCount} صور</Badge>
            <Badge status={card.status} />
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flex: '0 0 auto', flexWrap: 'wrap' }}>
            <small><span className="madar-code">{card.machine_code}</span> · {card.machine_area}</small>
            {(order.status !== 'archived' || order.canAssignRepresentatives) && (
              <button
                type="button"
                className="madar-button-ghost"
                style={{
                  padding: '2px 8px', fontSize: '11px', fontWeight: 'bold', color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: '5px', cursor: 'pointer', marginInlineStart: '8px',
                }}
                title="تعديل كود هذه الماكينة"
                disabled={saving}
                onClick={(event) => { event.stopPropagation(); openMachineCodeEditor(card); }}
              >✏️ تعديل الكود</button>
            )}
          </span>
          {order.status === 'in_progress' && (
            <button
              type="button"
              className="madar-button-icon"
              style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '14px', cursor: 'pointer', padding: '4px', marginRight: '6px', flex: '0 0 auto' }}
              title="إزالة الماكينة وحذف مجلدها نهائياً"
              aria-label={`إزالة الماكينة ${card.machine_code}`}
              disabled={saving}
              onClick={() => decommissionMachine({
                machineId: card.machine_id,
                machineCode: card.machine_code,
                machineName: card.machine_name_ar,
                cardId: card.id,
              })}
            >
              🗑️
            </button>
          )}
        </div>
        <div className={`madar-panel-body madar-accordion-content ${expanded ? 'is-expanded' : ''}`} id={detailsId} aria-hidden={!expanded} inert={!expanded}>
          <div className="madar-accordion-content-inner">
            {missingAfterPhotos && (card.before_photo_urls?.length ?? 0) > 0 && <div
              role="status"
              style={{
                marginBottom: '0.9rem', padding: '0.65rem 0.8rem', borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.25)', fontSize: '12px',
              }}
            >تنبيه: جميع الصور مسجلة في (قبل الصيانة). يمكنك الضغط على أيقونة النقل ⇄ على أي صورة لنقلها إلى (بعد الصيانة) لإكمال البطاقة.</div>}
            <div className="madar-inspection-card-fields">
              <div className="madar-card-reasons-select-wrap">
                <Select
                  label="أوامر / أسباب الصيانة *"
                  value=""
                  disabled={saving || (order.status === 'archived' && !order.canAssignRepresentatives)}
                  onChange={(event) => {
                    addCardReason(card, event.target.value);
                    event.target.value = '';
                  }}
                >
                  <option value="">
                    {(getCardDraft(card).reasonIds ?? []).length === 0
                      ? 'اختر أمر صيانة...'
                      : '+ إضافة أمر صيانة آخر...'}
                  </option>
                  {(reasons ?? [])
                    .filter((reason) => !(getCardDraft(card).reasonIds ?? []).includes(reason.id))
                    .map((reason) => (
                      <option key={reason.id} value={reason.id}>
                        {reason.name}
                      </option>
                    ))}
                </Select>

                <div
                  className="madar-card-reasons-chips"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '8px',
                    minHeight: '26px',
                  }}
                >
                  {(getCardDraft(card).reasonIds ?? []).map((rid) => {
                    const found = (reasons ?? []).find((r) => r.id === rid);
                    const name = found?.name
                      ?? (card.reason_names?.[card.reason_ids?.indexOf(rid)] || `أمر صيانة #${rid}`);
                    return (
                      <span
                        key={rid}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '3px 10px',
                          borderRadius: '999px',
                          background: 'rgba(36, 166, 160, 0.15)',
                          border: '1px solid rgba(36, 166, 160, 0.4)',
                          color: '#2dd4bf',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        <span>{name}</span>
                        <button
                          type="button"
                          onClick={() => removeCardReason(card, rid)}
                          disabled={saving || (order.status === 'archived' && !order.canAssignRepresentatives)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '0 2px',
                            fontSize: '14px',
                            lineHeight: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                          title="إزالة هذا الأمر"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {(getCardDraft(card).reasonIds ?? []).length === 0 && (
                    <span style={{ fontSize: '12px', color: 'var(--madar-muted)', fontStyle: 'italic' }}>
                      غير محدد (اختر من القائمة لإضافة أمر أو سبب صيانة)
                    </span>
                  )}
                </div>
              </div>
              <Input
                label="ملاحظات الفحص الفنية"
                value={getCardDraft(card).notes}
                placeholder="اكتب الملاحظات الفنية الخاصة بهذه الماكينة..."
                maxLength={10000}
                disabled={saving || (order.status === 'archived' && !order.canAssignRepresentatives)}
                onChange={(event) => updateCardNotesDraft(card, event.target.value)}
                onBlur={(event) => { void setCardNotes(card, event.target.value); }}
              />
            </div>
            <div className="madar-grid madar-grid-2">
              <PhotoPhase
                title="قبل الصيانة"
                phase="before"
                urls={card.before_photo_urls}
                thumbnailUrls={card.before_thumbnail_urls}
                photoMetadata={card.rep_photo_metadata}
                card={card}
                disabled={saving || order.status === 'archived'}
                canUpload={order.status !== 'archived'}
                onUpload={(event) => uploadPhotos(card, 'before', event)}
                onDeletePhoto={handleDeletePhoto}
                onMovePhoto={handleMovePhoto}
                onOpenLightbox={(currentCard, currentPhase, photoIndex) => setLightboxState({ cardId: currentCard.id, phase: currentPhase, photoIndex })}
              />
              <PhotoPhase
                title="بعد الصيانة"
                phase="after"
                urls={card.after_photo_urls}
                thumbnailUrls={card.after_thumbnail_urls}
                photoMetadata={card.rep_photo_metadata}
                card={card}
                disabled={saving || order.status === 'archived'}
                canUpload={order.status !== 'archived'}
                onUpload={(event) => uploadPhotos(card, 'after', event)}
                onDeletePhoto={handleDeletePhoto}
                onMovePhoto={handleMovePhoto}
                onOpenLightbox={(currentCard, currentPhase, photoIndex) => setLightboxState({ cardId: currentCard.id, phase: currentPhase, photoIndex })}
              />
            </div>
            {order.status !== 'archived' && (
              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--madar-border)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  disabled={saving}
                  style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}
                  onClick={() => openMachineCodeEditor(card)}
                >✏️ تعديل كود الماكينة ({card.machine_code})</Button>
                {order.status === 'in_progress' && <button
                  type="button"
                  className="madar-button madar-button-small"
                  style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '11px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer' }}
                  disabled={saving}
                  onClick={() => decommissionMachine({
                    machineId: card.machine_id,
                    machineCode: card.machine_code,
                    machineName: card.machine_name_ar,
                    cardId: card.id,
                  })}
                  title="حذف كارت الفحص وصوره وإلغاء تفعيل الماكينة"
                >
                  🗑️ إزالة الماكينة وحذف مجلدها نهائياً
                </button>}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (loading && !order) return <LoadingState label="جارٍ تحميل أمر الصيانة" />;
  if (error) return <><PageHeader title="أمر الصيانة" actions={<Button variant="secondary" onClick={() => navigate('/maintenance')}>العودة للقائمة</Button>} /><Alert tone="error">{error}</Alert></>;

  return (
    <>
      <PageHeader kicker="تفاصيل الزيارة الميدانية" title={order.order_code} description="بطاقات فحص الآلات وتوثيق حالة ما قبل الخدمة وما بعدها." actions={<><Button icon="presentation" variant="primary" onClick={() => setPptxExportOpen(true)}>تصدير تقرير PowerPoint</Button><Button variant="secondary" icon="arrow" onClick={() => navigate('/maintenance')}>كل أوامر الصيانة</Button></>} />
      <section className="madar-panel madar-order-hero">
        <div>
          <div className="madar-inline"><h2 className="madar-order-client">{order.client_name}</h2><Badge status={order.status} /></div>
          <div className="madar-order-meta">
         <span>المنطقة / المناطق <strong>{order.area || areas.join('، ') || 'لم تُحدد بعد'}</strong></span>
            <span>الآلات <strong>{order.cards.length}</strong></span>
            <span>الفنيون <strong>{order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}</strong></span>
            <span>المناديب <strong>{order.representatives?.map((rep) => `${rep.full_name}${Number(rep.active) ? '' : ' (حساب موقوف)'}`).join('، ') || 'غير معيّنين'}</strong></span>
            <span>تاريخ الإنشاء <strong>{order.created_at?.slice(0, 10)}</strong></span>
          </div>
          {order.notes && <p className="madar-order-notes">{order.notes}</p>}
        </div>
        <div className="madar-inline-wrap">
          {order.status === 'in_progress' && <Button variant="secondary" icon="plus" onClick={() => { setActionError(''); setCardOpen(true); }}>إضافة آلة للفحص</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="factory" onClick={() => { setActionError(''); setPopulateArea(orderAreaNames[0] ?? ''); setPopulateOpen(true); }}>إدراج ماكينات منطقة...</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="upload" onClick={() => { setActionError(''); setFolderSourceMode('storage'); setTripZip(null); setFolderOpen(true); }}>فحص مجلد رحلة الصيانة</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="wallet" onClick={() => { setCustodyError(''); setCustodyOpen(true); }}>صرف عهدة</Button>}
          {order.canAssignRepresentatives && order.status !== 'archived' && <Button variant="secondary" icon="users" onClick={() => { setRepresentativeError(''); setRepresentativesOpen(true); }}>تعيين المندوبين</Button>}
          {order.status === 'in_progress' && <Button icon="check" disabled={saving} onClick={transitionToReview}>إرسال للمراجعة</Button>}
          {order.status === 'review' && <Button icon="archive" onClick={() => { setExpenseError(''); setArchiveOpen(true); }}>أرشفة وتسوية العهدة</Button>}
          <Button variant="secondary" icon="file" onClick={() => { window.location.href = `/api/maintenance/orders/${id}/export.docx`; }}>تقرير Word</Button>
          {order.status === 'archived' && order.canAssignRepresentatives && <>
            <Button
              variant="secondary"
              icon="refresh"
              disabled={saving}
              onClick={handleUnarchiveOrder}
              title="إعادة فتح الأمر للتعديل الشامل ورفع أو تعديل الصور"
            >🔄 إعادة فتح للتعديل</Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={saving}
              onClick={handleDeleteArchivedOrder}
              style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid #b91c1c' }}
              title="حذف هذا الأمر المؤرشف وجميع ملفاته من الأرشيف"
            >🗑️ حذف أمر الصيانة</Button>
          </>}
        </div>
      </section>
      {actionError && <div className="madar-section"><Alert tone="error">{actionError}</Alert></div>}
      {tripDuplicateWarnings.length > 0 && <div className="madar-section">
        <Alert tone="warning">
          <strong>تنبيه: تم العثور على {tripDuplicateWarnings.length} مجلدات متشابهة أو مكررة وتم عزلها للمراجعة لمنع تداخل الصور:</strong>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: '1.25rem' }}>
            {tripDuplicateWarnings.map((warning, index) => <li key={`${warning.machineId}-${warning.duplicateFolder}-${index}`}>
              {warning.duplicateFolder} ↔ {warning.originalFolder} · {warning.machineName}
            </li>)}
          </ul>
        </Alert>
      </div>}
      <div className="madar-reconciliation-toolbar madar-section">
        <div><strong>لوحة فرز ومطابقة الرحلة</strong><span>راجع المجلدات غير المطابقة، ثم استكمل تغطية ماكينات المناطق المحددة.</span></div>
        <div className="madar-inline-wrap">
          <Button variant="secondary" size="small" onClick={expandAllReconciliationCards}>فرد الكل (Expand All)</Button>
          <Button variant="secondary" size="small" onClick={collapseAllReconciliationCards}>طي الكل (Collapse All)</Button>
        </div>
      </div>

      <section className="madar-panel madar-section madar-unmatched-review">
        <div className="madar-panel-header"><div><h2>مجلدات تحتاج مراجعة (Unmatched Folders)</h2><p>اربط كل مجلد بماكينة من منطقة الأمر بعد مراجعة صوره.</p></div><Badge tone="warning">{order.unmatched_folders?.length ?? 0}</Badge></div>
        <div className="madar-panel-body">
          {order.unmatched_folders?.length ? <>
            <Alert tone="warning">توجد {order.unmatched_folders.length} مجلدات لم يتم التعرف عليها تلقائياً</Alert>
            <div className="madar-unmatched-list">{order.unmatched_folders.map((folder) => {
              const expanded = expandedFolderIds.has(folder.id);
              const detailsId = `unmatched-folder-${folder.id}-details`;
              const bindingMachine = getBindingMachine(folder.id);
              const bindingMatches = getBindingMachineMatches(folder.id);
              return (
                <article className="madar-unmatched-item" key={folder.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      className="madar-accordion-header madar-unmatched-toggle"
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      style={{ flex: 1, width: 'auto', minWidth: 0 }}
                      onClick={() => toggleFolder(folder.id)}
                    >
                      <span className="madar-accordion-chevron" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                      <span className="madar-accordion-identity">
                        <strong>{folder.folder_name}</strong>
                        {folder.is_duplicate && <Badge tone="warning" title={`يطابق ماكينة موجودة بالفعل؛ المجلد الأول: ${folder.duplicate_of_folder || 'غير معروف'}`}>
                          مجلد مكرر
                        </Badge>}
                        <small>المنطقة: {order.area} · المصدر: {folder.source_name}</small>
                        {folder.is_duplicate && <small style={{ color: '#fbbf24' }}>
                          (مجلد مكرر: يطابق ماكينة موجودة بالفعل){folder.duplicate_of_folder ? ` · المجلد الأول: ${folder.duplicate_of_folder}` : ''}
                        </small>}
                      </span>
                      <Badge tone="info">{folder.photo_count} صور</Badge>
                      <Badge tone="warning">تحتاج مطابقة</Badge>
                    </button>
                    {order.status === 'in_progress' && (
                      <button
                        type="button"
                        className="madar-button-icon"
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '14px', cursor: 'pointer', padding: '4px', marginRight: '6px', flex: '0 0 auto' }}
                        title="حذف المجلد نهائياً من النظام"
                        aria-label={`حذف المجلد ${folder.folder_name}`}
                        disabled={saving}
                        onClick={() => deleteUnmatchedFolder(folder)}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                  <div className={`madar-unmatched-details ${expanded ? 'is-expanded' : ''}`} id={detailsId} aria-hidden={!expanded} inert={!expanded}>
                    <div className="madar-unmatched-details-inner">
                      <div className="madar-unmatched-source"><strong>مسار المصدر</strong><code>{folder.source_name}</code></div>
                      {(folder.before_photo_urls.length > 0 || folder.after_photo_urls.length > 0) && <div className="madar-photo-grid madar-unmatched-photos">
                        {[...folder.before_photo_urls, ...folder.after_photo_urls].slice(0, 8).map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer"><img className="madar-photo" src={url} alt={`صورة من ${folder.folder_name} ${index + 1}`} loading="lazy" /></a>)}
                      </div>}
                      <div className="madar-unmatched-binding">
                        <div className="madar-unmatched-machine-picker">
                          <Input
                            label="كود الماكينة"
                            id={`unmatched-machine-code-${folder.id}`}
                            value={bindingMachineCodes[folder.id] ?? ''}
                            onChange={(event) => setBindingMachineCodes((current) => ({ ...current, [folder.id]: event.target.value }))}
                            placeholder="اكتب كود الماكينة..."
                            autoComplete="off"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={bindingMatches.length > 0}
                            aria-controls={`unmatched-machine-options-${folder.id}`}
                          />
                          {bindingMatches.length > 0 && <div className="madar-unmatched-machine-options" id={`unmatched-machine-options-${folder.id}`} role="listbox" aria-label="ماكينات مطابقة للكود المدخل">
                            {bindingMatches.map((machine) => <button
                              key={machine.id}
                              type="button"
                              role="option"
                              aria-selected={false}
                              onClick={() => setBindingMachineCodes((current) => ({ ...current, [folder.id]: machine.code }))}
                            >
                              <strong>{machine.code}</strong><span>{machine.name_ar}{machine.name_en ? ` · ${machine.name_en}` : ''}</span>
                            </button>)}
                          </div>}
                        </div>
                        <div className={`madar-unmatched-machine-preview ${bindingMachine ? 'is-selected' : ''}`} aria-live="polite">
                          {bindingMachine ? <>
                            <strong>{bindingMachine.code}</strong>
                            <span>· {bindingMachine.name_ar}</span>
                            <span>· {bindingMachine.name_en || 'بدون اسم إنجليزي'}</span>
                          </> : <span>ستظهر بيانات الماكينة هنا بعد اختيار كود صحيح</span>}
                        </div>
                        <div className="madar-inline-wrap" style={{ gap: '0.5rem', alignItems: 'center' }}>
                          <Button icon="check" disabled={saving || !bindingMachine} onClick={() => bindUnmatchedFolder(folder)}>ربط واعتماد الاسم</Button>
                          {order.status === 'in_progress' && (
                            <button
                              type="button"
                              className="madar-button"
                              style={{
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#fca5a5',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                              }}
                              disabled={saving}
                              onClick={() => deleteUnmatchedFolder(folder)}
                              title="حذف هذا المجلد وصوره واستبعاده نهائياً من النظام"
                            >
                              🗑️ حذف المجلد نهائياً
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}</div>
          </> : <EmptyState icon="check" title="لا توجد مجلدات معلّقة" description="ستظهر هنا المجلدات التي لم تتطابق تلقائياً بعد فحص مجلد الرحلة." />}
        </div>
      </section>

      <section className="madar-panel madar-section madar-reconciliation-section">
        <div className="madar-panel-header"><div><h2>ماكينات تمت مطابقتها (Matched Machines)</h2><p>الماكينات المرتبطة ببطاقات تحتوي على صور، مع تنبيه للبطاقات التي ينقصها صور بعد الصيانة.</p></div><Badge tone="success">{matchedCards.length}</Badge></div>
        <div className="madar-panel-body">
          {areaBreakdown.length > 0 && (
            <div className="madar-area-breakdown-box" style={{ padding: '1rem', marginBottom: '1.2rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--madar-border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                <strong style={{ fontSize: '13px' }}>إجمالي الماكينات التي بها صور:</strong>
                <span className="madar-badge madar-badge-success">{matchedCards.length} ماكينة مقروءة</span>
                <span className="madar-badge" style={{ background: '#334155', color: '#f8fafc' }}>المتبقي: {missingMachines.length} ماكينة</span>
                <span className="madar-muted" style={{ fontSize: '12px' }}>من إجمالي {activeMachines.length} ماكينة في خط السير</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {areaBreakdown.map((item) => (
                  <div key={item.area} style={{ padding: '0.85rem', borderRadius: '8px', background: 'var(--madar-surface)', border: '1px solid var(--madar-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--madar-text)' }}>📍 {item.area}</strong>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: item.percent === 100 ? '#10b981' : '#f59e0b' }}>{item.percent}%</span>
                    </div>
                    <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: '0.4rem' }}>
                      <span>مقروء: <b style={{ color: '#10b981' }}>{item.matched}</b></span>
                      <span>متبقي: <b style={{ color: item.missing ? '#f59e0b' : '#94a3b8' }}>{item.missing}</b></span>
                      <span>الإجمالي: {item.total}</span>
                    </div>
                    <div style={{ height: '4px', background: '#334155', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${item.percent}%`, height: '100%', background: item.percent === 100 ? '#10b981' : 'var(--madar-accent)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--madar-border)', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', width: '100%', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>التحكم في العرض:</span>
                    <button
                      type="button"
                      className="madar-button madar-button-small madar-button-secondary"
                      onClick={expandAllMatchedCards}
                      title="فرد وتوسيع جميع بطاقات الماكينات المعروضة"
                    >
                      فرد الكل (Expand All)
                    </button>
                    <button
                      type="button"
                      className="madar-button madar-button-small madar-button-secondary"
                      onClick={collapseAllMatchedCards}
                      title="طي وقفل جميع بطاقات الماكينات المعروضة"
                    >
                      طي الكل (Collapse All)
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="بحث باسم أو كود الماكينة..."
                      value={matchedSearch}
                      onChange={(event) => setMatchedSearch(event.target.value)}
                      className="madar-input"
                      aria-label="بحث في الماكينات المكتملة"
                      style={{ padding: '4px 10px', fontSize: '12px', width: '220px', borderRadius: '6px' }}
                    />
                    {matchedSearch && (
                      <button
                        type="button"
                        onClick={() => setMatchedSearch('')}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 4px', fontSize: '13px' }}
                        title="مسح البحث"
                        aria-label="مسح البحث"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                {areaBreakdown.length > 1 ? (
                  <div role="group" aria-label="تصفية البطاقات حسب المنطقة" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>تصفية المنطقة:</span>
                    <button
                      type="button"
                      className={`madar-button madar-button-small ${selectedAreaFilter === 'all' ? 'madar-button-primary' : 'madar-button-secondary'}`}
                      aria-pressed={selectedAreaFilter === 'all'}
                      onClick={() => setSelectedAreaFilter('all')}
                    >
                      الكل ({matchedCards.length})
                    </button>
                    {areaBreakdown.map((item) => (
                      <button
                        type="button"
                        key={item.area}
                        className={`madar-button madar-button-small ${selectedAreaFilter === item.area ? 'madar-button-primary' : 'madar-button-secondary'}`}
                        aria-pressed={selectedAreaFilter === item.area}
                        onClick={() => setSelectedAreaFilter(item.area)}
                      >
                        {item.area} ({item.matched})
                      </button>
                    ))}
                  </div>
                ) : <div />}

                <div role="group" aria-label="ترتيب الماكينات" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>ترتيب الماكينات:</span>
                  <button
                    type="button"
                    className={`madar-button madar-button-small ${cardSort === 'name_asc' ? 'madar-button-primary' : 'madar-button-secondary'}`}
                    aria-pressed={cardSort === 'name_asc'}
                    onClick={() => setCardSort('name_asc')}
                    title="ترتيب أبجدي تصاعدي أ إلى ي"
                  >
                    أ ← ي (A to Z)
                  </button>
                  <button
                    type="button"
                    className={`madar-button madar-button-small ${cardSort === 'name_desc' ? 'madar-button-primary' : 'madar-button-secondary'}`}
                    aria-pressed={cardSort === 'name_desc'}
                    onClick={() => setCardSort('name_desc')}
                    title="ترتيب أبجدي تنازلي ي إلى أ"
                  >
                    ي ← أ (Z to A)
                  </button>
                  <button
                    type="button"
                    className={`madar-button madar-button-small ${cardSort === 'code_asc' ? 'madar-button-primary' : 'madar-button-secondary'}`}
                    aria-pressed={cardSort === 'code_asc'}
                    onClick={() => setCardSort('code_asc')}
                    title="ترتيب رقمي حسب كود الماكينة"
                  >
                    الكود (123...)
                  </button>
                  <button
                    type="button"
                    className={`madar-button madar-button-small ${cardSort === 'default' ? 'madar-button-primary' : 'madar-button-secondary'}`}
                    aria-pressed={cardSort === 'default'}
                    onClick={() => setCardSort('default')}
                    title="الترتيب الافتراضي لتسلسل الرحلة"
                  >
                    الافتراضي
                  </button>
                </div>
              </div>
            </div>
          )}
          {displayedMatchedCards.length ? <div className="madar-maintenance-cards">{displayedMatchedCards.map((card) => renderInspectionCard(card))}</div>
            : <EmptyState
              icon="image"
              title={matchedSearch.trim() ? 'لا توجد نتائج مطابقة للبحث' : selectedAreaFilter === 'all' ? 'لا توجد ماكينات مطابقة بصور' : 'لا توجد ماكينات مكتملة في هذه المنطقة'}
              description={matchedSearch.trim() ? 'جرّب البحث باسم الماكينة أو كودها أو منطقتها.' : selectedAreaFilter === 'all' ? 'بعد معالجة المجلد ستظهر هنا بطاقات الماكينات التي تم ربط صورها.' : 'اختر منطقة أخرى أو اعرض كل المناطق لمراجعة البطاقات المكتملة.'}
            />}
        </div>
      </section>

      <section className="madar-panel madar-section madar-reconciliation-section">
        <div className="madar-panel-header"><div><h2>ماكينات المناطق غير المشمولة في المجلد (Missing from Trip)</h2><p>ماكينات نشطة ضمن مناطق الأمر لا تملك بطاقة مكتملة بصور قبل وبعد للرحلة الحالية.</p></div><Badge tone={missingMachines.length ? 'warning' : 'success'}>{machinesLoading ? '…' : missingMachines.length}</Badge></div>
        <div className="madar-panel-body">
          {machinesLoading ? <LoadingState label="جارٍ تحميل ماكينات المنطقة" /> : missingMachines.length ? <div className="madar-missing-machine-list">
            {missingMachines.map((machine) => {
               const existingCard = cardsByMachineId.get(machine.id);
               return existingCard ? (
                 <div className="madar-missing-machine-existing" key={machine.id}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                     <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>تحتاج البطاقة إلى استكمال صور قبل وبعد؛ افتحها لإضافة الصور أو بيانات الفحص.</p>
                     {order.status === 'in_progress' && (
                       <button
                         type="button"
                         className="madar-button madar-button-small"
                         style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '11px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}
                         disabled={saving}
                         onClick={() => decommissionMachine({
                           machineId: machine.id,
                           machineCode: machine.code,
                           machineName: machine.name_ar,
                           cardId: existingCard.id,
                         })}
                         title="إزالة الماكينة من قاعدة البيانات لعدم وجودها في الموقع"
                       >
                         🗑️ إزالة الماكينة (غير موجودة)
                       </button>
                     )}
                   </div>
                   {renderInspectionCard(existingCard, { embedded: true })}
                 </div>
               ) : (
                <article className="madar-missing-machine-card" key={machine.id}>
                  <div className="madar-missing-machine-copy">
                    <span className="madar-code">{machine.code}</span>
                    <strong>{machine.name_ar}{machine.name_en ? ` · ${machine.name_en}` : ''}</strong>
                    <small>{machine.area}</small>
                  </div>
                  <Badge tone="warning">0 صور</Badge>
                  <div className="madar-inline-wrap">
                    {order.status === 'in_progress' && <Button icon="plus" size="small" variant="secondary" disabled={saving} onClick={() => addManualCardForMachine(machine)}>إضافة كارت فحص يدوي</Button>}
                    {order.status === 'in_progress' && (
                      <button
                        type="button"
                        className="madar-button madar-button-small"
                        style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '11px', fontWeight: 'bold', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}
                        disabled={saving}
                        onClick={() => decommissionMachine({
                          machineId: machine.id,
                          machineCode: machine.code,
                          machineName: machine.name_ar,
                          cardId: null,
                        })}
                        title="إزالة الماكينة من قاعدة البيانات لعدم وجودها في الموقع"
                      >
                        🗑️ إزالة الماكينة (غير موجودة)
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div> : <EmptyState icon="check" title="كل ماكينات المنطقة مشمولة" description="توجد بطاقة بصور رحلة لكل ماكينة نشطة في المنطقة." />}
        </div>
      </section>

      {order.status === 'archived' && <section className="madar-panel madar-panel-pad madar-section"><h3 className="madar-section-title">ملخص تسوية العهدة</h3><div className="madar-settlement-row"><span>العهدة المصروفة</span><strong>{formatMoney(order.petty_cash_disbursed_cents)}</strong><span>المصروف الفعلي</span><strong>{formatMoney(order.actual_expenses_cents)}</strong><span>المبلغ المعاد للخزينة</span><strong className="madar-money">{formatMoney(order.petty_cash_refund_cents)}</strong></div><div className="madar-small madar-muted">فترة الضمان: {order.warranty_period_months} أشهر</div></section>}

      <Modal open={cardOpen} onClose={() => setCardOpen(false)} title="إضافة آلة للفحص" description="يتم ربط الآلة تلقائياً بملف العميل كموقع خدمة.">
        <form onSubmit={addInspectionCard}>
          <div className="madar-form-stack">
            <Select label="الآلة *" name="machineId" required defaultValue=""><option value="" disabled>اختر الآلة</option>{(machineData?.machines ?? []).map((machine) => <option key={machine.id} value={machine.id}>{machine.code} · {machine.name_ar} · {machine.area}</option>)}</Select>
            <Textarea label="ملاحظات فنية داخلية" name="notes" maxLength={10000} />
          </div>
          {actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCardOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving || !machineData?.machines?.length}>{saving ? 'جارٍ الحفظ…' : 'إضافة البطاقة'}</Button></div>
        </form>
      </Modal>

      <Modal
        open={Boolean(machineCodeCard)}
        onClose={() => { if (!saving) setMachineCodeCard(null); }}
        title="تعديل كود الماكينة"
        description="إذا كان الكود مسجلاً لماكينة نشطة، ستُربط البطاقة بها. وإلا سيتم تحديث كود الماكينة الحالية."
      >
        <form onSubmit={updateInspectionMachineCode}>
          <div className="madar-form-stack">
            <Input
              label="كود الماكينة *"
              name="machineCode"
              value={machineCodeDraft}
              onChange={(event) => setMachineCodeDraft(event.target.value)}
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              required
              autoFocus
            />
            {machineCodeError && <Alert tone="error">{machineCodeError}</Alert>}
          </div>
          <div className="madar-form-actions">
            <Button variant="secondary" disabled={saving} onClick={() => setMachineCodeCard(null)}>إلغاء</Button>
            <Button type="submit" disabled={saving || !machineCodeDraft.trim()}>{saving ? 'جارٍ تحديث الكود…' : 'حفظ الكود'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={populateOpen} onClose={() => setPopulateOpen(false)} title="إدراج ماكينات منطقة" description="تُضاف البطاقات للماكينات النشطة غير الموجودة مسبقاً على الأمر.">
        <form onSubmit={populateAreaMachines}><div className="madar-form-stack"><Select label="المنطقة *" value={populateArea} onChange={(event) => setPopulateArea(event.target.value)} required><option value="">اختر المنطقة</option>{populateAreaOptions.map((item) => <option key={item} value={item}>{item}</option>)}</Select></div>
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setPopulateOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving || !populateArea}>{saving ? 'جارٍ الإدراج…' : 'إدراج الماكينات'}</Button></div></form>
      </Modal>

      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="فحص مجلد رحلة الصيانة" description="اختر مجلداً داخل Areas، أو ارفع ملف ZIP بدلاً منه. تتم مطابقة الماكينات وحفظ المجلدات غير المعروفة للمراجعة." wide>
        <div className="madar-form-stack">
          <Tabs
            items={[{ value: 'storage', label: 'استكشاف Areas' }, { value: 'zip', label: 'رفع ملف ZIP' }]}
            value={folderSourceMode}
            onChange={(mode) => { setActionError(''); setFolderSourceMode(mode); setTripZip(null); setUploadProgress(0); }}
            ariaLabel="مصدر مجلد رحلة الصيانة"
          />
          {actionError && <Alert tone="error">{actionError}</Alert>}
          {folderSourceMode === 'storage' ? (
            <StorageFileExplorer
              initialPath={order.area || ''}
              enabled={folderOpen}
              processing={tripProcessing}
              progress={tripProgress}
              onProcessFolder={processStorageFolder}
            />
          ) : (
            <form onSubmit={uploadTripZip}>
              <div className="madar-form-stack">
                <Input label="ملف الرحلة (.zip) *" type="file" accept=".zip,application/zip" onChange={(event) => setTripZip(event.target.files?.[0] ?? null)} required />
                {uploadProgress > 0 && <progress value={uploadProgress} max="100" aria-label="تقدم رفع ملف الرحلة" />}
                {tripProcessing && <TripScanProgress progress={tripProgress} />}
              </div>
              <div className="madar-form-actions">
                <Button variant="secondary" onClick={() => setFolderOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={saving || !tripZip}>{saving ? 'جارٍ الفحص…' : 'فحص وربط الصور'}</Button>
              </div>
            </form>
          )}
          {folderSourceMode === 'storage' && <div className="madar-form-actions"><Button variant="secondary" onClick={() => setFolderOpen(false)}>إلغاء</Button></div>}
        </div>
      </Modal>

      <Modal open={custodyOpen} onClose={() => setCustodyOpen(false)} title="صرف عهدة لأمر الصيانة" description="يُسجل الصرف كمصروف خزينة مرتبط بهذا الأمر، ويُسوى الرصيد عند الأرشفة.">
        <form onSubmit={advanceCustody}>
          <div className="madar-form-stack">
            <div className="madar-receipt-due"><span>إجمالي العهدة الحالية</span><strong className="madar-money">{formatMoney(order.petty_cash_disbursed_cents)}</strong></div>
            <Input label="مبلغ العهدة الجديدة (جنيه) *" name="amount" type="text" inputMode="decimal" required placeholder="0.00" />
            <Textarea label="ملاحظات الصرف" name="notes" maxLength={2000} />
          </div>
          {custodyError && <div className="madar-form-error"><Alert tone="error">{custodyError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCustodyOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ تسجيل الصرف…' : 'تأكيد صرف العهدة'}</Button></div>
        </form>
      </Modal>

      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="أرشفة أمر الصيانة" description="حدد المصروف الفعلي وفترة الضمان. سيُعاد أي فائض عهدة إلى الخزينة تلقائياً.">
        <form onSubmit={archiveOrder}>
          <div className="madar-form-stack">
            <Alert tone="info">العهدة المسجلة: {formatMoney(order.petty_cash_disbursed_cents)}. لا يمكن أن يتجاوز المصروف الفعلي هذا المبلغ.</Alert>
            <Input label="المصروف الفعلي (جنيه)" name="actualExpenses" type="text" inputMode="decimal" required defaultValue="0.00" hint="أدخل المبلغ حتى منزلتين عشريتين." />
            <Select label="فترة الضمان *" name="warrantyPeriodMonths" required defaultValue="3"><option value="3">3 أشهر</option><option value="6">6 أشهر</option></Select>
          </div>
          {expenseError && <div className="madar-form-error"><Alert tone="error">{expenseError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setArchiveOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الأرشفة…' : 'تأكيد الأرشفة'}</Button></div>
        </form>
      </Modal>

      <Modal open={representativesOpen} onClose={() => { if (!representativeSaving) setRepresentativesOpen(false); }} title="تعيين مندوبي أمر الصيانة" description="سيظهر هذا الأمر وبطاقات ماكيناته للمناديب النشطين المعيّنين إليه؛ ويتمتع المندوبون بصلاحية الوصول لكافة المناطق.">
        <form onSubmit={saveRepresentativeAssignments}>
          <div className="madar-form-stack">
            {(representativeOptions ?? []).length ? <div className="madar-employee-picker" role="group" aria-label="اختيار مندوبي أمر الصيانة">
              {representativeOptions.map((rep) => {
                const selected = representativeIds.includes(Number(rep.id));
                return <label key={rep.id} className={`employee-checkbox-card ${selected ? 'selected' : ''}`}>
                  <input className="madar-checkbox" type="checkbox" checked={selected}
                    onChange={() => setRepresentativeIds((current) => selected
                      ? current.filter((userId) => userId !== Number(rep.id))
                      : [...current, Number(rep.id)])} />
                  <span className="madar-checkbox-title">{rep.full_name}</span>
                  <small className="madar-field-hint">{rep.username} · {regionAccessLabel(rep.assignedRegions)}</small>
                </label>;
              })}
            </div> : <Alert tone="info">لا توجد حسابات مندوب نشطة. يمكنك إنشاء حساب من صفحة الإعدادات.</Alert>}
            {order.representatives?.some((rep) => Number(rep.active) !== 1) && <Alert tone="warning">توجد حسابات مندوب موقوفة على هذا الأمر؛ لن تظهر ضمن الخيارات، وسيؤدي الحفظ إلى إزالة إسنادها.</Alert>}
            {representativeError && <Alert tone="error">{representativeError}</Alert>}
          </div>
          <div className="madar-form-actions"><Button variant="secondary" disabled={representativeSaving} onClick={() => setRepresentativesOpen(false)}>إلغاء</Button><Button type="submit" disabled={representativeSaving}>{representativeSaving ? 'جارٍ الحفظ…' : 'حفظ التعيين'}</Button></div>
        </form>
      </Modal>
      <MaintenancePptxExportModal
        open={pptxExportOpen}
        onClose={() => setPptxExportOpen(false)}
        currentOrder={order}
        defaultScope="current"
      />
      {lightboxState && (
        <PhotoLightboxModal
          lightboxState={lightboxState}
          onClose={(newState) => setLightboxState(newState)}
          cards={lightboxCards}
          onMovePhoto={handleMovePhoto}
          onDeletePhoto={handleDeletePhoto}
          onEditMachineCode={openMachineCodeEditor}
          machineCodeEditorOpen={Boolean(machineCodeCard)}
          disabled={saving || order.status === 'archived'}
          canEditMachineCode={order.status !== 'archived'}
        />
      )}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}

function maintenancePhotoFilename(url) {
  return decodeURIComponent(new URL(url, window.location.origin).pathname.split('/').at(-1) ?? '');
}

function PhotoPhase({ title, phase, urls, thumbnailUrls, photoMetadata = {}, card, disabled, canUpload = true, onUpload, onDeletePhoto, onMovePhoto, onOpenLightbox }) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(event) {
    if (disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragOver(false);
  }

  function handleDrop(event) {
    if (disabled) return;
    event.preventDefault();
    setIsDragOver(false);
    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data && ['before', 'after'].includes(data.phase) && data.phase !== phase && typeof data.filename === 'string' && data.filename) {
        onMovePhoto(card, data.phase, phase, data.filename);
      }
    } catch {
      // Ignore invalid drag payloads.
    }
  }

  return (
    <section
      className={`madar-photo-section ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        transition: 'all 0.2s',
        border: isDragOver ? '2px dashed #10b981' : undefined,
        background: isDragOver ? 'rgba(16, 185, 129, 0.05)' : undefined,
        borderRadius: '8px',
        padding: '0.5rem',
      }}
    >
      <div className="madar-photo-heading"><span>{title}</span><span className="madar-muted">{urls?.length ?? 0} صور</span></div>
      {urls?.length ? (
        <div className="madar-photo-grid">
          {urls.map((url, index) => {
            const filename = maintenancePhotoFilename(url);
            const evidence = photoMetadata?.[filename];
            return (
              <div
                key={`${url}-${index}`}
                className="madar-photo-wrapper"
                draggable={!disabled && !evidence}
                onDragStart={(event) => {
                  if (evidence) { event.preventDefault(); return; }
                  event.dataTransfer.setData('text/plain', JSON.stringify({ phase, filename }));
                  event.dataTransfer.effectAllowed = 'move';
                }}
                style={{ position: 'relative', display: 'inline-block', cursor: disabled || evidence ? 'default' : 'grab' }}
              >
                <button
                  type="button"
                  className="madar-photo-thumb-btn"
                  style={{ all: 'unset', display: 'block', cursor: 'zoom-in', width: '100%', height: '100%' }}
                  title="اضغط لتكبير الصورة والتنقل بين الماكينات"
                  onClick={() => onOpenLightbox?.(card, phase, index)}
                >
                  <img className="madar-photo" src={thumbnailUrls?.[index] ?? url} alt={`${title} ${index + 1}`} loading="lazy" />
                </button>
                {!disabled && !evidence && (
                  <div
                    className="madar-photo-actions"
                    style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      right: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      pointerEvents: 'auto',
                    }}
                  >
                    <button
                      type="button"
                      aria-label={phase === 'before' ? 'نقل الصورة إلى بعد الصيانة' : 'نقل الصورة إلى قبل الصيانة'}
                      style={{
                        background: 'rgba(15, 23, 42, 0.85)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#38bdf8',
                        borderRadius: '4px',
                        padding: '2px 5px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                      title={phase === 'before' ? 'نقل إلى بعد الصيانة' : 'نقل إلى قبل الصيانة'}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        onMovePhoto(card, phase, phase === 'before' ? 'after' : 'before', filename);
                      }}
                    >
                      ⇄
                    </button>
                    <button
                      type="button"
                      aria-label="حذف هذه الصورة"
                      style={{
                        background: 'rgba(15, 23, 42, 0.85)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#f87171',
                        borderRadius: '4px',
                        padding: '2px 5px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                      title="حذف هذه الصورة"
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        onDeletePhoto(card, phase, filename);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                )}
                {evidence && <small className="madar-rep-photo-caption" title={`زيارة ${evidence.visitUuid}`}>
                  <b>{evidence.repName}</b><span>{formatCaptureTime(evidence.capturedAt)}</span>
                  <span>{evidence.reviewStatus === 'approved' ? 'معتمدة' : evidence.reviewStatus === 'reshoot' ? 'إعادة تصوير مطلوبة' : 'بانتظار مراجعة المشرف'}</span>
                </small>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="madar-photo-empty" style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--madar-border)', borderRadius: '6px', color: '#94a3b8', fontSize: '12px' }}>
          {isDragOver ? 'أفلت الصورة هنا لنقلها...' : 'لا توجد صور بعد (يمكن سحب وإفلات صورة هنا)'}
        </div>
      )}
      {canUpload && !disabled && <label className="madar-photo-upload"><Icon name="upload" size={13} /> رفع صور<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={onUpload} aria-label={`رفع صور ${title}`} /></label>}
    </section>
  );
}

function PhotoLightboxModal({ lightboxState, onClose, cards, onMovePhoto, onDeletePhoto, onEditMachineCode, machineCodeEditorOpen, disabled, canEditMachineCode = true }) {
  const currentCardIndex = lightboxState
    ? cards.findIndex((card) => card.id === lightboxState.cardId)
    : -1;
  const currentCard = currentCardIndex >= 0 ? cards[currentCardIndex] : null;
  const prevCard = currentCardIndex > 0 ? cards[currentCardIndex - 1] : null;
  const nextCard = currentCardIndex >= 0 && currentCardIndex < cards.length - 1 ? cards[currentCardIndex + 1] : null;
  const beforeUrls = currentCard?.before_photo_urls ?? [];
  const afterUrls = currentCard?.after_photo_urls ?? [];
  const allPhotos = [
    ...beforeUrls.map((url, index) => ({ phase: 'before', phaseLabel: 'قبل الصيانة', url, index })),
    ...afterUrls.map((url, index) => ({ phase: 'after', phaseLabel: 'بعد الصيانة', url, index })),
  ];
  const currentPhotoIndex = allPhotos.findIndex((photo) => (
    photo.phase === lightboxState?.phase && photo.index === lightboxState?.photoIndex
  ));
  const currentPhoto = currentPhotoIndex >= 0 ? allPhotos[currentPhotoIndex] : allPhotos[0] ?? null;

  function goToMachine(targetCard) {
    if (!targetCard) return;
    const targetPhase = (targetCard.before_photo_urls?.length ?? 0) > 0 ? 'before' : 'after';
    onClose({ cardId: targetCard.id, phase: targetPhase, photoIndex: 0 });
  }

  function goToNextPhoto() {
    if (currentPhotoIndex >= 0 && currentPhotoIndex < allPhotos.length - 1) {
      const nextPhoto = allPhotos[currentPhotoIndex + 1];
      onClose({ cardId: currentCard.id, phase: nextPhoto.phase, photoIndex: nextPhoto.index });
    } else if (nextCard) {
      goToMachine(nextCard);
    }
  }

  function goToPrevPhoto() {
    if (currentPhotoIndex > 0) {
      const previousPhoto = allPhotos[currentPhotoIndex - 1];
      onClose({ cardId: currentCard.id, phase: previousPhoto.phase, photoIndex: previousPhoto.index });
    } else if (prevCard) {
      goToMachine(prevCard);
    }
  }

  useEffect(() => {
    if (!currentCard || !currentPhoto) {
      onClose(null);
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose(null);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPrevPhoto();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToNextPhoto();
      } else if (event.key === 'ArrowUp' && prevCard) {
        event.preventDefault();
        goToMachine(prevCard);
      } else if (event.key === 'ArrowDown' && nextCard) {
        event.preventDefault();
        goToMachine(nextCard);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (!currentCard || !currentPhoto) return null;

  const currentFilename = maintenancePhotoFilename(currentPhoto.url);
  const targetMovePhase = currentPhoto.phase === 'before' ? 'after' : 'before';
  const phasePhotoCount = currentPhoto.phase === 'before' ? beforeUrls.length : afterUrls.length;

  async function moveCurrentPhoto() {
    const moved = await onMovePhoto(currentCard, currentPhoto.phase, targetMovePhase, currentFilename);
    if (!moved) return;
    const targetIndex = targetMovePhase === 'before' ? beforeUrls.length : afterUrls.length;
    onClose({ cardId: currentCard.id, phase: targetMovePhase, photoIndex: targetIndex });
  }

  async function deleteCurrentPhoto() {
    const deleted = await onDeletePhoto(currentCard, currentPhoto.phase, currentFilename);
    if (!deleted) return;
    const remainingPhotos = allPhotos.filter((_, index) => index !== currentPhotoIndex);
    if (!remainingPhotos.length) {
      onClose(null);
      return;
    }
    const nextPhoto = remainingPhotos[Math.min(currentPhotoIndex, remainingPhotos.length - 1)];
    const indexAfterRemoval = nextPhoto.phase === currentPhoto.phase && nextPhoto.index > currentPhoto.index
      ? nextPhoto.index - 1
      : nextPhoto.index;
    onClose({ cardId: currentCard.id, phase: nextPhoto.phase, photoIndex: indexAfterRemoval });
  }

  return (
    <div
      className="madar-lightbox-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: machineCodeEditorOpen ? 70 : 9999,
        background: 'rgba(5, 10, 20, 0.94)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '1rem',
        animation: 'madar-fade-in 0.2s ease-out',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(null);
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`عرض صور ${currentCard.machine_name_ar}`}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '0.6rem 1rem',
          background: 'rgba(255, 255, 255, 0.04)',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '15px', color: '#f8fafc' }}>
            {currentCard.machine_name_ar}{currentCard.machine_name_en ? ` · ${currentCard.machine_name_en}` : ''}
          </strong>
          <span className="madar-code" style={{ fontSize: '12px' }}>{currentCard.machine_code}</span>
          {!disabled && canEditMachineCode && (
            <button
              type="button"
              className="madar-button madar-button-small"
              style={{
                background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid #0284c7',
                fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px',
              }}
              onClick={() => onEditMachineCode?.(currentCard)}
            >✏️ تعديل الكود</button>
          )}
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>({currentCard.machine_area || '—'})</span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              background: currentPhoto.phase === 'before' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              color: currentPhoto.phase === 'before' ? '#38bdf8' : '#34d399',
              border: `1px solid ${currentPhoto.phase === 'before' ? '#0284c7' : '#059669'}`,
            }}
          >
            {currentPhoto.phaseLabel} ({currentPhoto.index + 1} من {phasePhotoCount})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginInlineEnd: '0.5rem' }}>
            <button
              type="button"
              className="madar-button madar-button-small madar-button-secondary"
              disabled={!prevCard}
              onClick={() => goToMachine(prevCard)}
              title={prevCard ? `الانتقال لماكينة ${prevCard.machine_code}` : 'أول ماكينة'}
            >
              ❮ السابقة
            </button>
            <button
              type="button"
              className="madar-button madar-button-small madar-button-secondary"
              disabled={!nextCard}
              onClick={() => goToMachine(nextCard)}
              title={nextCard ? `الانتقال لماكينة ${nextCard.machine_code}` : 'آخر ماكينة'}
            >
              التالية ❯
            </button>
          </div>

          {!disabled && (
            <>
              <button
                type="button"
                className="madar-button madar-button-small"
                style={{ background: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', border: '1px solid #0284c7', fontSize: '11px', fontWeight: 'bold' }}
                onClick={() => { void moveCurrentPhoto(); }}
                title={`نقل الصورة إلى ${targetMovePhase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}`}
              >
                ⇄ نقل إلى {targetMovePhase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}
              </button>
              <button
                type="button"
                className="madar-button madar-button-small"
                style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid #b91c1c', fontSize: '11px', fontWeight: 'bold' }}
                onClick={() => { void deleteCurrentPhoto(); }}
                title="حذف هذه الصورة نهائياً"
              >
                🗑️ حذف الصورة
              </button>
            </>
          )}

          <button
            type="button"
            className="madar-button-icon"
            style={{ background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#ffffff', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => onClose(null)}
            title="إغلاق (Esc)"
            aria-label="إغلاق عارض الصور"
          >
            ✕
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', padding: '1rem 0', minHeight: 0 }}>
        <button
          type="button"
          onClick={goToPrevPhoto}
          style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#ffffff', fontSize: '28px', width: '48px', height: '48px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, flexShrink: 0 }}
          title="الصورة السابقة (السهم الأيمن)"
          aria-label="الصورة السابقة"
        >
          ❯
        </button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minWidth: 0 }}>
          <img
            src={currentPhoto.url}
            alt={`${currentCard.machine_name_ar} - ${currentPhoto.phaseLabel}`}
            style={{ maxWidth: '85vw', maxHeight: '70vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
          />
        </div>
        <button
          type="button"
          onClick={goToNextPhoto}
          style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#ffffff', fontSize: '28px', width: '48px', height: '48px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, flexShrink: 0 }}
          title="الصورة التالية (السهم الأيسر)"
          aria-label="الصورة التالية"
        >
          ❮
        </button>
      </div>

      <footer
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.6rem', padding: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '10px', overflowX: 'auto', maxHeight: '80px' }}
      >
        {allPhotos.map((photo, index) => {
          const isSelected = photo.phase === currentPhoto.phase && photo.index === currentPhoto.index;
          return (
            <button
              key={`${photo.url}-${index}`}
              type="button"
              onClick={() => onClose({ cardId: currentCard.id, phase: photo.phase, photoIndex: photo.index })}
              style={{ all: 'unset', cursor: 'pointer', position: 'relative', borderRadius: '6px', overflow: 'hidden', border: isSelected ? '2px solid #10b981' : '1px solid rgba(255, 255, 255, 0.2)', opacity: isSelected ? 1 : 0.6, transform: isSelected ? 'scale(1.08)' : 'scale(1)', transition: 'all 0.2s', width: '60px', height: '45px', flexShrink: 0 }}
              title={`${photo.phaseLabel} ${photo.index + 1}`}
              aria-label={`عرض ${photo.phaseLabel} ${photo.index + 1}`}
            >
              <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span
                style={{ position: 'absolute', bottom: 0, insetInline: 0, fontSize: '8px', textAlign: 'center', background: photo.phase === 'before' ? 'rgba(2, 132, 199, 0.85)' : 'rgba(5, 150, 105, 0.85)', color: '#ffffff' }}
              >
                {photo.phase === 'before' ? 'قبل' : 'بعد'}
              </span>
            </button>
          );
        })}
      </footer>
    </div>
  );
}
