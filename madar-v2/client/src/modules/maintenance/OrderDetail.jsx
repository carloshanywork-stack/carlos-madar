import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
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
const EMPTY_TRIP_PROGRESS = { percent: 0, processed: 0, total: 0, stage: 'جارٍ فحص المجلد وربط الصور...' };

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
  const { data: order, setData: setOrderData, loading, error, reload } = useApi(`/api/maintenance/orders/${id}`);
  const machinePath = order?.area ? `/api/maintenance/machines?area=${encodeURIComponent(order.area)}&limit=500` : '';
  const { data: machineData, loading: machinesLoading } = useApi(machinePath, { enabled: Boolean(machinePath) });
  const { data: apiAreas } = useApi('/api/maintenance/areas');
  const { data: reasons } = useApi('/api/maintenance/reasons');
  const [cardOpen, setCardOpen] = useState(false);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [populateOpen, setPopulateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [pptxExportOpen, setPptxExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tripProcessing, setTripProcessing] = useState(false);
  const [tripProgress, setTripProgress] = useState(EMPTY_TRIP_PROGRESS);
  const [selectedAreaFilter, setSelectedAreaFilter] = useState('all');
  const [cardSort, setCardSort] = useState('name_asc');
  const [cardDrafts, setCardDrafts] = useState({});
  const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set());
  const [expandedCardIds, setExpandedCardIds] = useState(() => new Set());
  const [actionError, setActionError] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [custodyError, setCustodyError] = useState('');
  const [populateArea, setPopulateArea] = useState('');
  const [folderSourceMode, setFolderSourceMode] = useState('storage');
  const [tripZip, setTripZip] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bindingMachineCodes, setBindingMachineCodes] = useState({});
  const { notice, showToast, clearToast } = useToast();
  const orderAreaNames = useMemo(() => [...new Set((order?.area ?? '').split(/[،,]/).map((area) => area.trim()).filter(Boolean))], [order?.area]);
  const populateAreaOptions = useMemo(() => orderAreaNames.length
    ? (apiAreas ?? []).filter((area) => orderAreaNames.some((selected) => selected.normalize('NFKC').toLocaleLowerCase('ar') === area.normalize('NFKC').toLocaleLowerCase('ar')))
    : (apiAreas ?? []), [apiAreas, orderAreaNames]);
  const areas = useMemo(() => [...new Set((order?.cards ?? []).map((card) => card.machine_area).filter(Boolean))], [order]);
  const activeMachines = machineData?.machines ?? EMPTY_MACHINES;
  const cardsByMachineId = useMemo(() => new Map((order?.cards ?? []).map((card) => [card.machine_id, card])), [order?.cards]);
  const matchedCards = useMemo(() => (order?.cards ?? []).filter((card) =>
    card.status === 'completed' && (card.before_photo_urls?.length ?? 0) > 0 && (card.after_photo_urls?.length ?? 0) > 0,
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
    let filtered = matchedCards;
    if (selectedAreaFilter !== 'all') {
      filtered = matchedCards.filter((card) => String(card.machine_area || '').trim() === selectedAreaFilter);
    }
    return sortCards(filtered, cardSort);
  }, [matchedCards, selectedAreaFilter, cardSort]);
  const tripMatchedMachineIds = useMemo(() => new Set(matchedCards.map((card) => card.machine_id)), [matchedCards]);
  const missingMachines = useMemo(() => {
    const list = activeMachines.filter((machine) => !tripMatchedMachineIds.has(machine.id));
    return sortMachines(list, cardSort);
  }, [activeMachines, tripMatchedMachineIds, cardSort]);
  const unmatchedMachineCandidates = order?.unmatched_machine_candidates ?? EMPTY_MACHINES;
  const knownFolderIds = useRef(new Set());

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
    await reload();
    showToast(`تمت مطابقة ${result.matchedMachineCount} ماكينة، وربط ${result.attachedBefore + result.attachedAfter} صورة. مجلدات للمراجعة: ${result.unmatchedFolderCount}.`);
  }

  async function processStorageFolder(folder) {
    if (!folder?.fullStoragePath) return;
    setSaving(true);
    setTripProgress(EMPTY_TRIP_PROGRESS);
    setTripProcessing(true);
    setActionError('');
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

  function getCardDraft(card) {
    return cardDrafts[card.id] ?? { reasonId: card.reason_id ?? '', notes: card.notes ?? '' };
  }

  async function saveCardFields(card, reasonId, notes) {
    const normalizedReasonId = reasonId === '' || reasonId === null ? null : Number(reasonId);
    const normalizedNotes = notes ?? '';
    if (normalizedReasonId === (card.reason_id ?? null) && normalizedNotes === (card.notes ?? '')) return;

    setCardDrafts((current) => ({
      ...current,
      [card.id]: { reasonId: normalizedReasonId ?? '', notes: normalizedNotes },
    }));
    try {
      const updatedCard = await api.patch(`/api/maintenance/orders/${id}/cards/${card.id}`, {
        reasonId: normalizedReasonId,
        notes: normalizedNotes,
      });
      setOrderData((current) => current ? {
        ...current,
        cards: current.cards.map((item) => item.id === card.id ? { ...item, ...updatedCard } : item),
      } : current);
      setCardDrafts((current) => ({
        ...current,
        [card.id]: { reasonId: updatedCard.reason_id ?? '', notes: updatedCard.notes ?? '' },
      }));
      showToast('تم حفظ سبب العطل والملاحظات الفنية.');
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    }
  }

  function setCardReason(card, value) {
    const draft = getCardDraft(card);
    void saveCardFields(card, value, draft.notes);
  }

  function updateCardNotesDraft(card, value) {
    const draft = getCardDraft(card);
    setCardDrafts((current) => ({
      ...current,
      [card.id]: { ...draft, notes: value },
    }));
  }

  function setCardNotes(card, value) {
    const draft = getCardDraft(card);
    void saveCardFields(card, draft.reasonId, value);
  }

  function renderInspectionCard(card, { embedded = false } = {}) {
    const expanded = expandedCardIds.has(card.id);
    const photoCount = (card.before_photo_urls?.length ?? 0) + (card.after_photo_urls?.length ?? 0);
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
              <strong>{card.machine_name_ar}{card.machine_name_en ? ` · ${card.machine_name_en}` : ''}</strong>
              <small><span className="madar-code">{card.machine_code}</span> · {card.machine_area}</small>
            </span>
            <Badge tone={photoCount ? 'info' : 'warning'}>{photoCount} صور</Badge>
            <Badge status={card.status} />
          </button>
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
            <div className="madar-inspection-card-fields">
              <Select label="سبب العطل *" value={getCardDraft(card).reasonId} disabled={order.status === 'archived'} onChange={(event) => setCardReason(card, event.target.value)}>
                <option value="">غير محدد</option>{(reasons ?? []).map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
                {reasons && card.reason_id && card.reason_name && !reasons.some((reason) => reason.id === card.reason_id)
                  && <option value={card.reason_id} disabled>{card.reason_name} (معطّل)</option>}
              </Select>
              <Input
                label="ملاحظات الفحص الفنية"
                value={getCardDraft(card).notes}
                placeholder="اكتب الملاحظات الفنية الخاصة بهذه الماكينة..."
                maxLength={10000}
                disabled={order.status === 'archived'}
                onChange={(event) => updateCardNotesDraft(card, event.target.value)}
                onBlur={(event) => { void setCardNotes(card, event.target.value); }}
              />
            </div>
            <div className="madar-grid madar-grid-2">
              <PhotoPhase title="قبل الصيانة" phase="before" urls={card.before_photo_urls} disabled={order.status === 'archived' || saving} onUpload={(event) => uploadPhotos(card, 'before', event)} />
              <PhotoPhase title="بعد الصيانة" phase="after" urls={card.after_photo_urls} disabled={order.status === 'archived' || saving} onUpload={(event) => uploadPhotos(card, 'after', event)} />
            </div>
            {order.status === 'in_progress' && (
              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--madar-border)', display: 'flex', justifyContent: 'flex-end' }}>
                <button
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
                </button>
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
            <span>تاريخ الإنشاء <strong>{order.created_at?.slice(0, 10)}</strong></span>
          </div>
          {order.notes && <p className="madar-order-notes">{order.notes}</p>}
        </div>
        <div className="madar-inline-wrap">
          {order.status === 'in_progress' && <Button variant="secondary" icon="plus" onClick={() => { setActionError(''); setCardOpen(true); }}>إضافة آلة للفحص</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="factory" onClick={() => { setActionError(''); setPopulateArea(orderAreaNames[0] ?? ''); setPopulateOpen(true); }}>إدراج ماكينات منطقة...</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="upload" onClick={() => { setActionError(''); setFolderSourceMode('storage'); setTripZip(null); setFolderOpen(true); }}>فحص مجلد رحلة الصيانة</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="wallet" onClick={() => { setCustodyError(''); setCustodyOpen(true); }}>صرف عهدة</Button>}
          {order.status === 'in_progress' && <Button icon="check" disabled={saving} onClick={transitionToReview}>إرسال للمراجعة</Button>}
          {order.status === 'review' && <Button icon="archive" onClick={() => { setExpenseError(''); setArchiveOpen(true); }}>أرشفة وتسوية العهدة</Button>}
          <Button variant="secondary" icon="file" onClick={() => { window.location.href = `/api/maintenance/orders/${id}/export.docx`; }}>تقرير Word</Button>
        </div>
      </section>
      {actionError && <div className="madar-section"><Alert tone="error">{actionError}</Alert></div>}
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
                  <button className="madar-accordion-header madar-unmatched-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => toggleFolder(folder.id)}>
                    <span className="madar-accordion-chevron" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                    <span className="madar-accordion-identity">
                      <strong>{folder.folder_name}</strong>
                      <small>المنطقة: {order.area} · المصدر: {folder.source_name}</small>
                    </span>
                    <Badge tone="info">{folder.photo_count} صور</Badge>
                    <Badge tone="warning">تحتاج مطابقة</Badge>
                  </button>
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
                        <Button icon="check" disabled={saving || !bindingMachine} onClick={() => bindUnmatchedFolder(folder)}>ربط واعتماد الاسم</Button>
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
        <div className="madar-panel-header"><div><h2>ماكينات مكتملة الفحص (Matched Machines)</h2><p>بطاقات مكتملة وبها صور قبل وبعد الصيانة من ملفات الرحلة.</p></div><Badge tone="success">{matchedCards.length}</Badge></div>
        <div className="madar-panel-body">
          {areaBreakdown.length > 0 && (
            <div className="madar-area-breakdown-box" style={{ padding: '1rem', marginBottom: '1.2rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--madar-border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                <strong style={{ fontSize: '13px' }}>إجمالي الفحص المكتمل:</strong>
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
              title={selectedAreaFilter === 'all' ? 'لا توجد ماكينات مطابقة بصور' : 'لا توجد ماكينات مكتملة في هذه المنطقة'}
              description={selectedAreaFilter === 'all' ? 'بعد معالجة المجلد ستظهر هنا بطاقات الماكينات التي تم ربط صورها.' : 'اختر منطقة أخرى أو اعرض كل المناطق لمراجعة البطاقات المكتملة.'}
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
      <MaintenancePptxExportModal
        open={pptxExportOpen}
        onClose={() => setPptxExportOpen(false)}
        currentOrder={order}
        defaultScope="current"
      />
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}

function PhotoPhase({ title, phase, urls, disabled, onUpload }) {
  return (
    <section className="madar-photo-section">
      <div className="madar-photo-heading"><span>{title}</span><span className="madar-muted">{urls?.length ?? 0} / 4</span></div>
      {urls?.length ? <div className="madar-photo-grid">{urls.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer"><img className="madar-photo" src={url} alt={`${title} ${index + 1}`} loading="lazy" /></a>)}</div> : <div className="madar-photo-empty">لا توجد صور بعد</div>}
      {!disabled && (urls?.length ?? 0) < 4 && <label className="madar-photo-upload"><Icon name="upload" size={13} /> رفع 2–4 صور<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={onUpload} aria-label={`رفع صور ${title}`} /></label>}
      {phase && <span className="madar-visually-hidden">{phase}</span>}
    </section>
  );
}
