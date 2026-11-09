import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { regionAccessLabel } from '../../lib/regions.js';
import { errorMessage, formatDate } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmployeeCheckboxList from '../../components/ui/EmployeeCheckboxList.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import AreaMaintenanceDirectory from './AreaMaintenanceDirectory.jsx';
import MachinesDirectory from './MachinesDirectory.jsx';
import MaintenanceReasonsDirectory from './MaintenanceReasonsDirectory.jsx';

const statusItems = [
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'review', label: 'بانتظار المراجعة' },
  { value: 'archived', label: 'الأرشيف' },
];

export default function MaintenancePage({ isAdmin = false }) {
  const location = useLocation();
  const requestedView = new URLSearchParams(location.search).get('view');
  const initialCorrections = new URLSearchParams(location.search).get('review') === 'corrections';
  const [view, setView] = useState(() => isAdmin && ['machines', 'corrections'].includes(requestedView) ? 'machines' : 'orders');
  const [status, setStatus] = useState('in_progress');
  const { data: orders, loading, error, reload } = useApi(`/api/maintenance/orders?status=${status}`);
  const { data: clients } = useApi('/api/clients');
  const { data: areas } = useApi('/api/maintenance/areas');
  const { data: representatives, loading: representativesLoading } = useApi('/api/maintenance/representatives');
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeIds, setEmployeeIds] = useState([]);
  const [repUserIds, setRepUserIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [autoPopulate, setAutoPopulate] = useState(true);
  const selectedAreasQuery = selectedAreas.join('، ');
  const { data: areaMachines } = useApi(selectedAreas.length
    ? `/api/maintenance/machines?area=${encodeURIComponent(selectedAreasQuery)}&limit=1`
    : '', { enabled: selectedAreas.length > 0 });
  const { notice, showToast, clearToast } = useToast();
  const filteredOrders = useMemo(() => (orders ?? []).filter((order) =>
    `${order.order_code} ${order.client_name} ${order.client_code} ${order.area_summary || ''} ${order.area || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())), [orders, search]);

  useEffect(() => {
    if (isAdmin && ['machines', 'corrections'].includes(requestedView)) setView('machines');
  }, [isAdmin, requestedView]);

  async function createOrder(event) {
    event.preventDefault();
    if (!selectedAreas.length) {
      setFormError('اختر منطقة واحدة على الأقل لإنشاء أمر الصيانة.');
      return;
    }
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const orderPayload = {
        clientId: Number(form.get('clientId')),
        areas: selectedAreas,
        autoPopulateAreaMachines: Boolean(selectedAreas.length && autoPopulate),
        employeeIds,
        notes: form.get('notes') || undefined,
      };
      if (Array.isArray(representatives)) orderPayload.repUserIds = repUserIds;
      await api.post('/api/maintenance/orders', orderPayload);
      setCreateOpen(false);
      setEmployeeIds([]);
      setRepUserIds([]);
      setSelectedAreas([]);
      if (status !== 'in_progress') setStatus('in_progress');
      else await reload();
      showToast('تم إنشاء أمر الصيانة بنجاح.');
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        kicker="الخدمة الميدانية · الصيانة"
        title={view === 'reasons' ? 'أسباب الأعطال' : view === 'machines' ? 'قاعدة الماكينات' : view === 'area_notes' ? 'صيانات المناطق' : 'أوامر الصيانة'}
        description={view === 'reasons' ? 'إدارة أسباب الأعطال التي تظهر في بطاقات فحص الصيانة.' : view === 'machines' ? 'دليل الماكينات النشطة ومناطق الخدمة والاستيراد.' : view === 'area_notes' ? 'عرض أحدث الملاحظات الفنية المسجلة لكل ماكينة حسب المنطقة.' : 'من إنشاء أمر الخدمة حتى فحص الآلات، التوثيق بالصور، والمراجعة والأرشفة.'}
        actions={view === 'orders' && <Button icon="plus" onClick={() => { setFormError(''); setEmployeeIds([]); setRepUserIds([]); setSelectedAreas([]); setAutoPopulate(true); setCreateOpen(true); }}>إنشاء أمر صيانة</Button>}
      />
      <div className="madar-section"><Tabs items={[
        { value: 'orders', label: 'أوامر الصيانة (Orders)' },
        { value: 'machines', label: 'قاعدة الماكينات (Machines Directory)' },
        { value: 'reasons', label: 'أسباب الأعطال (Maintenance Reasons)' },
        { value: 'area_notes', label: 'صيانات المناطق (Area Maintenance)' },
      ]} value={view} onChange={setView} ariaLabel="مساحات الصيانة" /></div>
      {view === 'area_notes' ? <AreaMaintenanceDirectory /> : view === 'machines' ? <MachinesDirectory isAdmin={isAdmin} initialCorrections={initialCorrections} /> : view === 'reasons' ? <MaintenanceReasonsDirectory /> : <>
      <div className="madar-list-toolbar madar-section">
        <Tabs items={statusItems.map((item) => ({ ...item, count: status === item.value ? orders?.length : undefined }))} value={status} onChange={setStatus} ariaLabel="حالة أوامر الصيانة" />
        <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث برقم الأمر، العميل، أو المنطقة..." aria-label="بحث أوامر الصيانة" /></label>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      <section className="madar-panel madar-section">
        {loading ? <LoadingState label="جارٍ تحميل أوامر الصيانة" /> : filteredOrders.length ? (
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>أمر الخدمة</th><th>العميل</th><th>المناطق</th><th>عدد الآلات</th><th>الفنيون</th><th>المناديب</th><th>تاريخ الإنشاء</th><th>الحالة</th><th /></tr></thead>
            <tbody>{filteredOrders.map((order) => (
              <tr key={order.id}>
                <td><Link className="madar-table-link madar-code" to={`/maintenance/${order.id}`}>{order.order_code}</Link></td>
                <td><div className="madar-table-primary">{order.client_name}</div><small className="madar-code">{order.client_code}</small></td>
                <td>
                  {Array.isArray(order.areas) && order.areas.length ? (
                    <div className="madar-inline-wrap" style={{ gap: '4px', maxWidth: '240px', flexWrap: 'wrap' }}>
                      {order.areas.map((areaName, idx) => <span key={`${areaName}-${idx}`} className="madar-badge madar-badge-info" style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.12)',
                        color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', fontWeight: 600, whiteSpace: 'nowrap',
                      }}>{areaName}</span>)}
                    </div>
                  ) : order.area ? (
                    <span className="madar-badge madar-badge-info" style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.12)',
                      color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{order.area}</span>
                  ) : <span style={{ color: 'var(--madar-muted)' }}>—</span>}
                </td>
                <td>{order.card_count}</td><td>{order.technician_count}</td><td>{order.representative_names || '—'}</td><td>{formatDate(order.created_at)}</td>
                <td><Badge status={order.status} /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Link className="madar-button madar-button-ghost madar-button-small" to={`/maintenance/${order.id}`} aria-label="فتح أمر الصيانة"><Icon name="chevron" size={13} /></Link>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState icon="wrench" title={search ? 'لا توجد نتائج' : 'لا توجد أوامر في هذه المرحلة'} description={search ? 'جرّب كلمة بحث أخرى.' : 'يمكنك إنشاء أمر صيانة جديد لبدء الزيارة الميدانية.'} action={status === 'in_progress' && !search && <Button icon="plus" onClick={() => setCreateOpen(true)}>إنشاء أمر صيانة</Button>} />}
      </section>

        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="إنشاء أمر صيانة" description="أمر ميداني مستقل عن أوامر الإنتاج. عيّن المندوبين لتظهر لهم بطاقات هذا الأمر في التطبيق.">
        <form onSubmit={createOrder}>
          <div className="madar-form-stack">
            <Select label="العميل *" name="clientId" required defaultValue="">
              <option value="" disabled>اختر العميل</option>
              {(clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}
            </Select>
            <div className="madar-field">
              <span>المنطقة / خط السير * (اختر منطقة أو أكثر)</span>
              {(areas ?? []).length ? <div className="madar-employee-picker madar-area-picker" role="group" aria-label="مناطق أمر الصيانة" aria-required="true">
                {(areas ?? []).map((areaName) => {
                  const checked = selectedAreas.includes(areaName);
                  return <label key={areaName} className={`employee-checkbox-card ${checked ? 'selected' : ''}`}>
                    <input
                      className="madar-checkbox"
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedAreas((current) => checked
                        ? current.filter((area) => area !== areaName)
                        : [...current, areaName])}
                    />
                    <span className="madar-checkbox-title">{areaName}</span>
                  </label>;
                })}
              </div> : <small className="madar-field-hint">لا توجد مناطق نشطة في دليل الماكينات.</small>}
              <small className="madar-field-hint">
                {selectedAreas.length ? `المناطق المحددة: ${selectedAreas.join('، ')}` : 'يجب اختيار منطقة واحدة على الأقل.'}
              </small>
            </div>
            {selectedAreas.length > 0 && <label className="madar-check-row"><input type="checkbox" checked={autoPopulate} onChange={(event) => setAutoPopulate(event.target.checked)} /><span>إدراج جميع ماكينات المناطق المحددة تلقائياً في أمر الصيانة (عدد: {areaMachines?.total ?? 0})</span></label>}
            {Array.isArray(representatives) && <div className="madar-field">
              <span>المناديب المكلّفون بالتطبيق</span>
              {representativesLoading ? <small className="madar-field-hint">جارٍ تحميل حسابات المناديب…</small> : representatives.length ? (
                <div className="madar-employee-picker" role="group" aria-label="المناديب المكلّفون">
                  {representatives.map((rep) => {
                    const selected = repUserIds.includes(Number(rep.id));
                    return <label key={rep.id} className={`employee-checkbox-card ${selected ? 'selected' : ''}`}>
                      <input className="madar-checkbox" type="checkbox" checked={selected}
                        onChange={() => setRepUserIds((current) => selected
                          ? current.filter((userId) => userId !== Number(rep.id))
                          : [...current, Number(rep.id)])} />
                      <span className="madar-checkbox-title">{rep.full_name}</span>
                      <small className="madar-field-hint">{rep.username} · {regionAccessLabel(rep.assignedRegions)}</small>
                    </label>;
                  })}
                </div>
              ) : <small className="madar-field-hint">لا توجد حسابات مندوب نشطة. أنشئ حساباً من الإعدادات أولاً.</small>}
            </div>}
            <EmployeeCheckboxList department="Maintenance" selectedIds={employeeIds} onChange={setEmployeeIds} title="الفنيون المكلّفون (اختياري)" />
            <Textarea label="ملاحظات الخدمة" name="notes" maxLength={10000} placeholder="وصف موجز للزيارة أو نطاق العمل…" />
          </div>
          {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
          {!clients?.length && <div className="madar-form-note"><Alert tone="info">أضف ملف عميل أولاً قبل إنشاء أمر صيانة.</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving || !clients?.length}>{saving ? 'جارٍ الإنشاء…' : 'إنشاء الأمر'}</Button></div>
        </form>
      </Modal>
      </>}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
