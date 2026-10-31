import { useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage, formatDate } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Toast from '../../components/ui/Toast.jsx';

export default function MaintenanceReasonsDirectory() {
  const { data: reasons, loading, error, reload } = useApi('/api/maintenance/reasons?includeInactive=true');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { notice, showToast, clearToast } = useToast();

  function openCreate() {
    setEditing(null);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(reason) {
    setEditing(reason);
    setFormError('');
    setModalOpen(true);
  }

  async function saveReason(event) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    setSaving(true);
    setFormError('');
    try {
      if (editing) await api.patch(`/api/maintenance/reasons/${editing.id}`, { name });
      else await api.post('/api/maintenance/reasons', { name });
      setModalOpen(false);
      setEditing(null);
      await reload();
      showToast(editing ? 'تم تحديث سبب العطل.' : 'تمت إضافة سبب العطل.');
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(reason) {
    if (!window.confirm(`سيتم تعطيل سبب «${reason.name}» مع الاحتفاظ به في السجلات السابقة. متابعة؟`)) return;
    try {
      await api.delete(`/api/maintenance/reasons/${reason.id}`);
      await reload();
      showToast('تم تعطيل سبب العطل مع الاحتفاظ بسجلاته السابقة.');
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    }
  }

  async function reactivate(reason) {
    try {
      await api.patch(`/api/maintenance/reasons/${reason.id}`, { active: true });
      await reload();
      showToast('تمت إعادة تفعيل سبب العطل.');
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    }
  }

  return (
    <>
      <div className="madar-list-toolbar madar-section madar-reasons-toolbar">
        <div><strong>قاعدة أسباب الأعطال</strong><div className="madar-section-note">إدارة الأسباب المتاحة لبطاقات فحص الصيانة مع حفظ روابط السجلات القديمة.</div></div>
        <Button icon="plus" onClick={openCreate}>إضافة سبب عطل جديد</Button>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      <section className="madar-panel madar-section">
        {loading ? <LoadingState label="جارٍ تحميل أسباب الأعطال" /> : reasons?.length ? (
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>سبب العطل</th><th>الحالة</th><th>تاريخ الإضافة</th><th>الإجراءات</th></tr></thead>
            <tbody>{reasons.map((reason) => (
              <tr key={reason.id}>
                <td><strong>{reason.name}</strong></td>
                <td><Badge tone={reason.active ? 'success' : 'warning'}>{reason.active ? 'نشط' : 'معطّل'}</Badge></td>
                <td>{formatDate(reason.created_at)}</td>
                <td><div className="madar-inline-wrap">
                  <Button variant="ghost" size="small" icon="settings" onClick={() => openEdit(reason)}>تعديل</Button>
                  {reason.active
                    ? <Button variant="ghost" size="small" icon="close" onClick={() => deactivate(reason)}>تعطيل</Button>
                    : <Button variant="ghost" size="small" icon="check" onClick={() => reactivate(reason)}>إعادة التفعيل</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState icon="wrench" title="لا توجد أسباب أعطال" description="أضف الأسباب التي تظهر في بطاقات فحص الصيانة." action={<Button icon="plus" onClick={openCreate}>إضافة سبب عطل جديد</Button>} />}
      </section>

      <Modal open={modalOpen} onClose={() => { if (!saving) { setModalOpen(false); setEditing(null); } }} title={editing ? 'تعديل سبب العطل' : 'إضافة سبب عطل جديد'}>
        <form onSubmit={saveReason}>
          <div className="madar-form-stack">
            <Input label="اسم سبب العطل *" name="name" required maxLength={200} defaultValue={editing?.name ?? ''} autoFocus />
            {formError && <Alert tone="error">{formError}</Alert>}
          </div>
          <div className="madar-form-actions">
            <Button variant="secondary" disabled={saving} onClick={() => { setModalOpen(false); setEditing(null); }}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
          </div>
        </form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
