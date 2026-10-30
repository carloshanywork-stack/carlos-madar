import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
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

const statusItems = [
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'review', label: 'بانتظار المراجعة' },
  { value: 'archived', label: 'الأرشيف' },
];

export default function MaintenancePage() {
  const [status, setStatus] = useState('in_progress');
  const { data: orders, loading, error, reload } = useApi(`/api/maintenance/orders?status=${status}`);
  const { data: clients } = useApi('/api/clients');
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeIds, setEmployeeIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const { notice, showToast, clearToast } = useToast();
  const filteredOrders = useMemo(() => (orders ?? []).filter((order) =>
    `${order.order_code} ${order.client_name} ${order.client_code}`.toLowerCase().includes(search.toLowerCase())), [orders, search]);

  async function createOrder(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/maintenance/orders', {
        clientId: Number(form.get('clientId')),
        employeeIds,
        notes: form.get('notes') || undefined,
      });
      setCreateOpen(false);
      setEmployeeIds([]);
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
        title="أوامر الصيانة"
        description="من إنشاء أمر الخدمة حتى فحص الآلات، التوثيق بالصور، والمراجعة والأرشفة."
        actions={<Button icon="plus" onClick={() => { setFormError(''); setEmployeeIds([]); setCreateOpen(true); }}>إنشاء أمر صيانة</Button>}
      />
      <div className="madar-list-toolbar madar-section">
        <Tabs items={statusItems.map((item) => ({ ...item, count: status === item.value ? orders?.length : undefined }))} value={status} onChange={setStatus} ariaLabel="حالة أوامر الصيانة" />
        <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث برقم الأمر أو العميل" aria-label="بحث أوامر الصيانة" /></label>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      <section className="madar-panel madar-section">
        {loading ? <LoadingState label="جارٍ تحميل أوامر الصيانة" /> : filteredOrders.length ? (
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>أمر الخدمة</th><th>العميل</th><th>عدد الآلات</th><th>الفنيون</th><th>تاريخ الإنشاء</th><th>الحالة</th><th /></tr></thead>
            <tbody>{filteredOrders.map((order) => (
              <tr key={order.id}>
                <td><Link className="madar-table-link madar-code" to={`/maintenance/${order.id}`}>{order.order_code}</Link></td>
                <td><div className="madar-table-primary">{order.client_name}</div><small className="madar-code">{order.client_code}</small></td>
                <td>{order.card_count}</td><td>{order.technician_count}</td><td>{formatDate(order.created_at)}</td>
                <td><Badge status={order.status} /></td>
                <td><Link className="madar-button madar-button-ghost madar-button-small" to={`/maintenance/${order.id}`} aria-label="فتح أمر الصيانة"><Icon name="chevron" size={13} /></Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState icon="wrench" title={search ? 'لا توجد نتائج' : 'لا توجد أوامر في هذه المرحلة'} description={search ? 'جرّب كلمة بحث أخرى.' : 'يمكنك إنشاء أمر صيانة جديد لبدء الزيارة الميدانية.'} action={status === 'in_progress' && !search && <Button icon="plus" onClick={() => setCreateOpen(true)}>إنشاء أمر صيانة</Button>} />}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="إنشاء أمر صيانة" description="أمر ميداني مستقل عن أوامر الإنتاج. تُضاف الآلات وبطاقات الفحص لاحقاً من صفحة التفاصيل.">
        <form onSubmit={createOrder}>
          <div className="madar-form-stack">
            <Select label="العميل *" name="clientId" required defaultValue="">
              <option value="" disabled>اختر العميل</option>
              {(clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}
            </Select>
            <EmployeeCheckboxList department="Maintenance" selectedIds={employeeIds} onChange={setEmployeeIds} title="الفنيون المكلّفون (اختياري)" />
            <Textarea label="ملاحظات الخدمة" name="notes" maxLength={10000} placeholder="وصف موجز للزيارة أو نطاق العمل…" />
          </div>
          {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
          {!clients?.length && <div className="madar-form-note"><Alert tone="info">أضف ملف عميل أولاً قبل إنشاء أمر صيانة.</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving || !clients?.length}>{saving ? 'جارٍ الإنشاء…' : 'إنشاء الأمر'}</Button></div>
        </form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
