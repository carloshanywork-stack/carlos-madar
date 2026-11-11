import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Select, Textarea } from '../../components/ui/Field.jsx';
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
  const [historyMachine, setHistoryMachine] = useState(null);
  const [notesHistoryList, setNotesHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequestId = useRef(0);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportConfig, setExportConfig] = useState({ area: '', machineId: null, onlyNotes: true, historyMode: 'latest' });
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
    setExportConfig({ area: targetArea, machineId, onlyNotes, historyMode: 'latest' });
    setExportModalOpen(true);
  }

  function beginExport() {
    const query = new URLSearchParams();
    if (exportConfig.area) query.set('area', exportConfig.area);
    if (exportConfig.machineId) query.set('machineId', String(exportConfig.machineId));
    query.set('onlyNotes', String(exportConfig.onlyNotes));
    query.set('historyMode', exportConfig.historyMode);
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
    try {
      const result = await api.delete(`/api/maintenance/machines/${machine.id}/maintenance-note`);
      await reload();
      showToast(result.clearedCount
        ? `تم مسح ${result.clearedCount} ملاحظة للماكينة ${machine.code}.`
        : `لا توجد ملاحظات محفوظة للماكينة ${machine.code}.`);
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setClearingId(null);
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!editingMachine) return;
    setSaving(true);
    try {
      await api.put(`/api/maintenance/machines/${editingMachine.id}/maintenance-note`, { notes: noteText });
      await reload();
      showToast(`تم حفظ ملاحظة الماكينة ${editingMachine.code} بنجاح.`);
      setEditingMachine(null);
    } catch (caught) {
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
          <Button variant="secondary" icon="download" onClick={() => openExport({ onlyNotes: false })}>تصدير شامل (كل الماكينات)</Button>
        </div>
      </div>

      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {loading ? <section className="madar-panel madar-section"><LoadingState label="جارٍ تحميل صيانات المناطق" /></section> : filteredGroups.length ? filteredGroups.map((group) => (
        <section className="madar-panel madar-section" key={group.area}>
          <div className="madar-panel-header">
              <div><h2>المنطقة: {group.area}</h2><p>{group.machines.length} ماكينة</p></div>
              <Button variant="secondary" size="small" icon="download" onClick={() => openExport({ area: group.area })}>تصدير المنطقة</Button>
          </div>
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>{group.machines.map((machine) => (
                <tr key={machine.id}>
                  <td><span className="madar-code">{machine.code}</span></td>
                  <td><strong>{machine.name_ar}</strong></td>
                  <td>{machine.name_en || '—'}</td>
                  <td>
                    <div style={{ minWidth: 220, maxWidth: 600, whiteSpace: 'pre-wrap' }}>{machine.notes || '—'}</div>
                    {machine.has_history && <button className="madar-link" type="button" onClick={() => openHistory(machine)}>📜 سجل الملاحظات ({machine.history_count})</button>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Button
                        variant="ghost"
                        size="small"
                        icon="edit"
                        iconOnly
                        aria-label={`تعديل ملاحظة ${machine.code}`}
                        title="إضافة أو تعديل ملاحظة"
                        disabled={saving}
                        onClick={() => { setEditingMachine(machine); setNoteText(machine.notes || ''); }}
                      />
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
        open={Boolean(editingMachine)}
        onClose={() => { if (!saving) setEditingMachine(null); }}
        title={`تعديل ملاحظة الماكينة: ${editingMachine?.code ?? ''} - ${editingMachine?.name_ar ?? ''}`}
        description="أضف أو حدّث الملاحظة الفنية الظاهرة في سجل صيانة المناطق."
      >
        <form onSubmit={saveNote}>
          <div className="madar-form-stack">
            <Textarea
              label="الملاحظة"
              rows={4}
              maxLength={2000}
              autoFocus
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="اكتب ملاحظة الصيانة..."
            />
          </div>
          <div className="madar-form-actions">
            <Button variant="secondary" disabled={saving} onClick={() => setEditingMachine(null)}>إلغاء</Button>
          <Button type="submit" disabled={saving || !noteText.trim()}>{saving ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</Button>
          </div>
        </form>
      </Modal>
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
              {notesHistoryList.map((entry) => (
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
                <span><strong>الماكينات ذات الملاحظات فقط</strong><small>النطاق الافتراضي: يشمل الملاحظات الحالية والسجل المحفوظ.</small></span>
              </label>
              <label className="madar-export-radio-option">
                <input type="radio" name="area-notes-scope" checked={!exportConfig.onlyNotes} onChange={() => setExportConfig((current) => ({ ...current, onlyNotes: false }))} />
                <span><strong>حصر شامل لكافة الماكينات</strong><small>يشمل الماكينات النشطة حتى إن لم يكن لها تعليق.</small></span>
              </label>
            </div>
          </fieldset>
          <fieldset className="madar-export-fieldset">
            <legend>تفاصيل التعليقات</legend>
            <div className="madar-export-scope-options" style={{ gridTemplateColumns: '1fr' }}>
              <label className="madar-export-radio-option">
                <input type="radio" name="area-notes-history" checked={exportConfig.historyMode === 'latest'} onChange={() => setExportConfig((current) => ({ ...current, historyMode: 'latest' }))} />
                <span><strong>أحدث ملاحظة فقط</strong><small>يعرض التعليق الحالي المختصر لكل ماكينة.</small></span>
              </label>
              <label className="madar-export-radio-option">
                <input type="radio" name="area-notes-history" checked={exportConfig.historyMode === 'all'} onChange={() => setExportConfig((current) => ({ ...current, historyMode: 'all' }))} />
                <span><strong>السجل الكامل لكافة الملاحظات السابقة</strong><small>يتضمن التاريخ واسم الكاتب والدور ورقم أمر الصيانة.</small></span>
              </label>
            </div>
          </fieldset>
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
