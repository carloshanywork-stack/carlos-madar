import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Select } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Toast from '../../components/ui/Toast.jsx';

const headers = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات', 'الإجراء'];

export default function AreaMaintenanceDirectory() {
  const { data: groups, loading, error, reload } = useApi('/api/maintenance/area-notes');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [onlyWithNotesFilter, setOnlyWithNotesFilter] = useState(false);
  const [clearingId, setClearingId] = useState(null);
  const [editingMachine, setEditingMachine] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [optimisticNotes, setOptimisticNotes] = useState({});
  const [historyMachine, setHistoryMachine] = useState(null);
  const [notesHistoryList, setNotesHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequestId = useRef(0);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportConfig, setExportConfig] = useState({ area: '', machineId: null, onlyNotes: true, includeHistory: false });
  const { notice, showToast, clearToast } = useToast();

  const areaOptions = useMemo(() => (groups ?? []).map((group) => group.area), [groups]);
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (groups ?? [])
      .filter((group) => !area || group.area === area)
      .map((group) => ({
         ...group,
         machines: group.machines.filter((machine) => (
           (!onlyWithNotesFilter || Boolean(machine.notes?.trim()))
           && (!term || `${machine.code} ${machine.name_ar} ${machine.name_en ?? ''}`.toLocaleLowerCase().includes(term))
         )),
       }))
       .filter((group) => group.machines.length > 0);
  }, [area, groups, onlyWithNotesFilter, search]);

  function openExport({ area: targetArea = area, machineId = null, onlyNotes = true } = {}) {
    setExportConfig({ area: targetArea, machineId, onlyNotes, includeHistory: false });
    setExportModalOpen(true);
  }

  function beginExport() {
    const query = new URLSearchParams();
    if (exportConfig.area) query.set('area', exportConfig.area);
    if (exportConfig.machineId) query.set('machineId', String(exportConfig.machineId));
    query.set('onlyNotes', String(exportConfig.onlyNotes));
    query.set('historyMode', exportConfig.includeHistory ? 'all' : 'latest');
    setExportModalOpen(false);
    window.location.assign(`/api/maintenance/area-notes/export.xlsx?${query.toString()}`);
  }

  async function openHistory(machine) {
    const requestId = historyRequestId.current + 1;
    historyRequestId.current = requestId;
    setHistoryMachine(machine);
    setNotesHistoryList([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const result = await api.get(`/api/maintenance/machines/${machine.id}/notes-history`);
      if (historyRequestId.current === requestId) setNotesHistoryList(result);
    } catch (caught) {
      if (historyRequestId.current === requestId) setHistoryError(errorMessage(caught));
    } finally {
      if (historyRequestId.current === requestId) setHistoryLoading(false);
    }
  }

  function closeHistory() {
    historyRequestId.current += 1;
    setHistoryMachine(null);
    setHistoryLoading(false);
  }

  function exportMachineHistory(machine) {
    const query = new URLSearchParams({
      machineId: String(machine.id),
      onlyNotes: 'true',
      historyMode: 'all',
    });
    if (machine.area) query.set('area', machine.area);
    window.location.assign(`/api/maintenance/area-notes/export.xlsx?${query.toString()}`);
  }

  async function clearNote(machine) {
    if (!machine.notes?.trim()) return;
    if (!window.confirm(`سيتم مسح الملاحظة الحالية للماكينة ${machine.code} مع الاحتفاظ بسجلها السابق. هل تريد المتابعة؟`)) return;
    setClearingId(machine.id);
    setOptimisticNotes((current) => ({ ...current, [machine.id]: '' }));
    try {
      const result = await api.delete(`/api/maintenance/machines/${machine.id}/maintenance-note`);
      await reload();
      setOptimisticNotes((current) => {
        const next = { ...current };
        delete next[machine.id];
        return next;
      });
      showToast(result.clearedCount
        ? `تم مسح ${result.clearedCount} ملاحظة للماكينة ${machine.code}.`
        : `لا توجد ملاحظات محفوظة للماكينة ${machine.code}.`);
    } catch (caught) {
      setOptimisticNotes((current) => {
        const next = { ...current };
        delete next[machine.id];
        return next;
      });
      showToast(errorMessage(caught), 'error');
    } finally {
      setClearingId(null);
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!editingMachine) return;
    const machine = editingMachine;
    const previousNote = Object.hasOwn(optimisticNotes, machine.id)
      ? optimisticNotes[machine.id]
      : machine.notes ?? '';
    const nextNote = noteText.trim();
    if (!nextNote) return;
    setOptimisticNotes((current) => ({ ...current, [machine.id]: nextNote }));
    setSaving(true);
    setEditingMachine(null);
    try {
      await api.put('/api/maintenance/areas/notes', { machineId: machine.id, notes: nextNote });
      await reload();
      setOptimisticNotes((current) => {
        const next = { ...current };
        delete next[machine.id];
        return next;
      });
      showToast(`تم حفظ ملاحظة الماكينة ${machine.code} بنجاح.`);
    } catch (caught) {
      setOptimisticNotes((current) => ({ ...current, [machine.id]: previousNote }));
      setEditingMachine(machine);
      showToast(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="madar-list-toolbar madar-section">
        <label className="madar-field madar-search">
          <Icon name="search" size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالكود أو الاسم" aria-label="بحث في صيانات المناطق" />
        </label>
        <Select label="المنطقة" value={area} onChange={(event) => setArea(event.target.value)}>
          <option value="">كل المناطق</option>
          {areaOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </Select>
        <label className="madar-check-row" style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyWithNotesFilter} onChange={(event) => setOnlyWithNotesFilter(event.target.checked)} />
          <span>عرض الماكينات ذات الملاحظات فقط</span>
        </label>
        <div className="madar-inline-wrap">
          <Button variant="primary" icon="download" onClick={() => openExport({ onlyNotes: true })}>تصدير Excel (كل المناطق)</Button>
        </div>
      </div>

      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {loading ? <section className="madar-panel madar-section"><LoadingState label="جارٍ تحميل صيانات المناطق" /></section> : filteredGroups.length ? filteredGroups.map((group) => (
        <section className="madar-panel madar-section" key={group.area}>
          <div className="madar-panel-header">
              <div><h2>المنطقة: {group.area}</h2><p>{group.machines.length} ماكينة</p></div>
              <Button variant="secondary" size="small" icon="download" onClick={() => openExport({ area: group.area })}>تصدير المنطقة المحددة إلى Excel</Button>
          </div>
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>{group.machines.map((machine) => (
                <tr key={machine.id}>
                  <td><span className="madar-code">{machine.code}</span></td>
                  <td><button className="madar-link" type="button" onClick={() => openHistory(machine)} title="فتح سجل ملاحظات الماكينة"><strong>{machine.name_ar}</strong></button></td>
                  <td>{machine.name_en || '—'}</td>
                  <td>
                    <div style={{ minWidth: 220, maxWidth: 600, whiteSpace: 'pre-wrap' }}>
                      {(Object.hasOwn(optimisticNotes, machine.id) ? optimisticNotes[machine.id] : machine.notes) || '—'}
                    </div>
                    {editingMachine?.id === machine.id && (
                      <form onSubmit={saveNote} className="madar-form-stack" style={{ marginTop: 8, minWidth: 260 }}>
                        <textarea
                          aria-label={`ملاحظة الماكينة ${machine.code}`}
                          rows={3}
                          maxLength={2000}
                          autoFocus
                          value={noteText}
                          onChange={(event) => setNoteText(event.target.value)}
                          placeholder="اكتب ملاحظة الصيانة..."
                        />
                        <div className="madar-inline-wrap">
                          <Button type="submit" size="small" disabled={saving || !noteText.trim()}>{saving ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</Button>
                          <Button type="button" variant="secondary" size="small" disabled={saving} onClick={() => setEditingMachine(null)}>إلغاء</Button>
                        </div>
                      </form>
                    )}
                    {machine.has_history && <button className="madar-link" type="button" onClick={() => openHistory(machine)}>📜 سجل الملاحظات ({machine.history_count})</button>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Button
                        variant="ghost"
                        size="small"
                        icon="edit"
                        aria-label={`إضافة أو تعديل ملاحظة ${machine.code}`}
                        title="إضافة / تعديل ملاحظة"
                        disabled={saving}
                        onClick={() => { setEditingMachine(machine); setNoteText(machine.notes || ''); }}
                      >إضافة / تعديل ملاحظة</Button>
                      <Button
                        variant="ghost"
                        size="small"
                        icon="history"
                        iconOnly
                        aria-label={`سجل ملاحظات ${machine.code}`}
                        title="سجل الملاحظات"
                        onClick={() => openHistory(machine)}
                      />
                      <Button
                        variant="ghost"
                        size="small"
                        icon="download"
                        iconOnly
                        aria-label={`تصدير تقرير ${machine.code}`}
                        title="تصدير لهذه الماكينة"
                        onClick={() => openExport({ area: group.area, machineId: machine.id })}
                      />
                      <Button
                        variant="ghost"
                        size="small"
                        icon="trash"
                        iconOnly
                        aria-label={`مسح ملاحظات ${machine.code}`}
                        title="مسح ملاحظة الماكينة"
                        disabled={!machine.notes?.trim() || clearingId === machine.id || saving}
                        onClick={() => clearNote(machine)}
                      />
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )) : (
        <section className="madar-panel madar-section">
          <EmptyState
            icon="wrench"
            title={search || area || onlyWithNotesFilter ? 'لا توجد نتائج مطابقة' : 'لا توجد ماكينات نشطة'}
            description={onlyWithNotesFilter ? 'لا توجد ملاحظات مسجلة ضمن النتائج الحالية.' : search || area ? 'جرّب تغيير البحث أو المنطقة المحددة.' : 'ستظهر هنا الماكينات النشطة وملاحظات بطاقات الصيانة المرتبطة بها.'}
          />
        </section>
      )}
      <Modal
        open={Boolean(historyMachine)}
        onClose={closeHistory}
        title={`سجل ملاحظات الماكينة: ${historyMachine?.code ?? ''} - ${historyMachine?.name_ar ?? ''}`}
        description="السجل محفوظ بترتيب زمني؛ الملاحظة الحالية تظهر في أعلى جدول صيانات المناطق."
        wide
      >
        <div className="madar-note-history">
          {historyError && <Alert tone="error">{historyError}</Alert>}
          {historyLoading ? <LoadingState label="جارٍ تحميل سجل الملاحظات" /> : notesHistoryList.length ? (
            <ol className="madar-note-timeline">
              {[...notesHistoryList].reverse().map((entry) => (
                <li key={entry.id} className="madar-note-timeline-entry">
                  <div className="madar-note-timeline-meta">
                    <time dateTime={entry.created_at}>{entry.formatted_date || entry.created_at}</time>
                    <span className={`madar-note-author madar-note-author-${entry.author_role}`}>
                      {entry.author_role === 'rep' ? 'مندوب ميداني' : entry.author_role === 'supervisor' ? 'مشرف' : 'إدارة'}
                    </span>
                    <strong>{entry.author_name}</strong>
                    {entry.order_code && <span className="madar-code">أمر {entry.order_code}</span>}
                  </div>
                  <p>{entry.note}</p>
                </li>
              ))}
            </ol>
          ) : <EmptyState icon="history" title="لا توجد ملاحظات سابقة" description="ستظهر هنا الملاحظات التي يضيفها المندوب أو الإدارة." />}
        </div>
        <div className="madar-form-actions">
          <Button variant="secondary" onClick={closeHistory}>إغلاق</Button>
          <Button icon="download" disabled={historyLoading} onClick={() => historyMachine && exportMachineHistory(historyMachine)}>
            تصدير سجل هذه الماكينة Excel
          </Button>
        </div>
      </Modal>
      <Modal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="خيارات تصدير صيانات المناطق"
        description="حدد نطاق التقرير ومستوى تفاصيل الملاحظات قبل تنزيل ملف Excel."
      >
        <div className="madar-form-stack madar-pptx-export-form">
          <fieldset className="madar-export-fieldset">
            <legend>نطاق الماكينات</legend>
            <div className="madar-export-scope-options" style={{ gridTemplateColumns: '1fr' }}>
              <label className="madar-export-radio-option">
              <input type="radio" name="area-notes-scope" checked={exportConfig.onlyNotes} onChange={() => setExportConfig((current) => ({ ...current, onlyNotes: true }))} />
                <span><strong>تصدير الماكينات التي تحتوي على ملاحظات فقط</strong><small>الخيار الافتراضي: يضم الملاحظة الحالية لكل ماكينة.</small></span>
              </label>
              <label className="madar-export-radio-option">
                <input type="radio" name="area-notes-scope" checked={!exportConfig.onlyNotes} onChange={() => setExportConfig((current) => ({ ...current, onlyNotes: false }))} />
                <span><strong>تصدير كل الماكينات</strong><small>يشمل الماكينات النشطة حتى إن لم يكن لها تعليق.</small></span>
              </label>
            </div>
          </fieldset>
          <label className="madar-export-radio-option">
            <input
              type="checkbox"
              checked={exportConfig.includeHistory}
              onChange={(event) => setExportConfig((current) => ({ ...current, includeHistory: event.target.checked }))}
            />
            <span><strong>تضمين تاريخ الملاحظات السابقة في ملف الإكسيل</strong><small>يشمل التاريخ واسم الكاتب والدور ورقم أمر الصيانة عند توفرها.</small></span>
          </label>
          <p className="madar-muted madar-small">
            النطاق المحدد: {exportConfig.machineId
              ? `الماكينة ${(groups ?? []).flatMap((group) => group.machines).find((machine) => machine.id === exportConfig.machineId)?.code ?? ''}`
              : exportConfig.area ? `المنطقة ${exportConfig.area}` : 'جميع المناطق'}.
          </p>
        </div>
        <div className="madar-form-actions">
          <Button variant="secondary" onClick={() => setExportModalOpen(false)}>إلغاء</Button>
          <Button icon="download" onClick={beginExport}>بدء تصدير ملف Excel</Button>
        </div>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
