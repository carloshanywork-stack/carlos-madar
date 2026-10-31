import { useMemo, useState } from 'react';
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
import Toast from '../../components/ui/Toast.jsx';

const headers = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات', 'الإجراء'];

export default function AreaMaintenanceDirectory() {
  const { data: groups, loading, error, reload } = useApi('/api/maintenance/area-notes');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [clearingId, setClearingId] = useState(null);
  const { notice, showToast, clearToast } = useToast();

  const areaOptions = useMemo(() => (groups ?? []).map((group) => group.area), [groups]);
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (groups ?? [])
      .filter((group) => !area || group.area === area)
      .map((group) => ({
        ...group,
        machines: group.machines.filter((machine) => !term ||
          `${machine.code} ${machine.name_ar} ${machine.name_en ?? ''}`.toLocaleLowerCase().includes(term)),
      }))
      .filter((group) => group.machines.length > 0);
  }, [area, groups, search]);

  function exportWorkbook(selectedArea = '') {
    const query = selectedArea ? `?area=${encodeURIComponent(selectedArea)}` : '';
    window.location.assign(`/api/maintenance/area-notes/export.xlsx${query}`);
  }

  async function clearNote(machine) {
    if (!machine.notes?.trim()) return;
    if (!window.confirm(`سيتم مسح ملاحظات بطاقات الصيانة للماكينة ${machine.code}. هل تريد المتابعة؟`)) return;
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
        <div className="madar-inline-wrap">
          <Button variant="secondary" icon="download" onClick={() => exportWorkbook()}>تصدير Excel (كل المناطق)</Button>
          <Button variant="secondary" icon="download" disabled={!area} onClick={() => exportWorkbook(area)}>تصدير المنطقة المحددة إلى Excel</Button>
        </div>
      </div>

      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {loading ? <section className="madar-panel madar-section"><LoadingState label="جارٍ تحميل صيانات المناطق" /></section> : filteredGroups.length ? filteredGroups.map((group) => (
        <section className="madar-panel madar-section" key={group.area}>
          <div className="madar-panel-header">
            <div><h2>المنطقة: {group.area}</h2><p>{group.machines.length} ماكينة</p></div>
          </div>
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>{group.machines.map((machine) => (
                <tr key={machine.id}>
                  <td><span className="madar-code">{machine.code}</span></td>
                  <td><strong>{machine.name_ar}</strong></td>
                  <td>{machine.name_en || '—'}</td>
                  <td><div style={{ minWidth: 220, maxWidth: 600, whiteSpace: 'pre-wrap' }}>{machine.notes || '—'}</div></td>
                  <td>
                    <Button
                      variant="ghost"
                      size="small"
                      icon="trash"
                      iconOnly
                      aria-label={`مسح ملاحظات ${machine.code}`}
                      title="مسح ملاحظات بطاقة الصيانة"
                      disabled={!machine.notes?.trim() || clearingId === machine.id}
                      onClick={() => clearNote(machine)}
                    />
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
            title={search || area ? 'لا توجد نتائج مطابقة' : 'لا توجد ماكينات نشطة'}
            description={search || area ? 'جرّب تغيير البحث أو المنطقة المحددة.' : 'ستظهر هنا الماكينات النشطة وملاحظات بطاقات الصيانة المرتبطة بها.'}
          />
        </section>
      )}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
