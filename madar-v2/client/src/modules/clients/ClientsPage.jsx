import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage, formatMoney, initials } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { Input, Textarea } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Toast from '../../components/ui/Toast.jsx';

export default function ClientsPage({ canViewFinancialDetails = false }) {
  const { data: clients, loading, error, reload } = useApi('/api/clients');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [formError, setFormError] = useState('');
  const [editError, setEditError] = useState('');
  const [deactivateError, setDeactivateError] = useState('');
  const { notice, showToast, clearToast } = useToast();
  const filtered = useMemo(() => (clients ?? []).filter((client) =>
    `${client.name} ${client.code} ${client.phone ?? ''} ${client.contact_name ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  [clients, search]);
  const { data: profile, loading: profileLoading, error: profileError, reload: reloadProfile } = useApi(
    selectedId ? `/api/clients/${selectedId}` : '', { enabled: selectedId !== null },
  );
  const { data: statement, loading: statementLoading, error: statementError } = useApi(
    selectedId ? `/api/clients/${selectedId}/statement` : '', { enabled: statementOpen && selectedId !== null },
  );

  async function createClient(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/clients', {
        name: form.get('name'),
        contactName: form.get('contactName') || undefined,
        phone: form.get('phone') || undefined,
        email: form.get('email') || undefined,
        address: form.get('address') || undefined,
      });
      setCreateOpen(false);
      await reload();
      showToast('تم إنشاء ملف العميل بنجاح.');
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function updateClient(event) {
    event.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setEditError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.put(`/api/clients/${selectedId}`, {
        code: form.get('code'),
        nameAr: form.get('nameAr'),
        nameEn: form.get('nameEn'),
        contactName: form.get('contactName'),
        phone: form.get('phone'),
        email: form.get('email'),
        address: form.get('address'),
        notes: form.get('notes'),
      });
      setEditOpen(false);
      await Promise.all([reload(), reloadProfile()]);
      showToast('تم تحديث بيانات العميل بنجاح.');
    } catch (caught) {
      setEditError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateClient() {
    if (!selectedId) return;
    setDeactivating(true);
    setDeactivateError('');
    try {
      await api.delete(`/api/clients/${selectedId}`);
      setDeactivateOpen(false);
      setSelectedId(null);
      await reload();
      showToast('تم إيقاف ملف العميل مع الاحتفاظ بسجلاته.');
    } catch (caught) {
      setDeactivateError(errorMessage(caught));
    } finally {
      setDeactivating(false);
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedId) return;
    const form = new FormData();
    form.append('logo', file);
    try {
      await api.upload(`/api/clients/${selectedId}/logo`, form);
      await reloadProfile();
      await reload();
      showToast('تم تحديث شعار العميل.');
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      event.target.value = '';
    }
  }

  const selectedClient = profile ?? clients?.find((client) => client.id === selectedId);

  return (
    <>
      <PageHeader
        kicker="العلاقات · العملاء"
        title="عملاؤنا"
        description="بطاقات تعريفية بملف كل عميل، أصوله التشغيلية، وموقفه المالي."
        actions={<Button icon="plus" onClick={() => { setFormError(''); setCreateOpen(true); }}>إضافة عميل</Button>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="madar-toolbar madar-section">
        <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف" aria-label="بحث العملاء" /></label>
        <span className="madar-muted madar-small">{filtered.length} عميل</span>
      </div>
      {loading ? <LoadingState label="جارٍ تحميل العملاء" /> : filtered.length ? (
        <div className="madar-grid madar-grid-3 madar-section">
          {filtered.map((client) => (
            <button className="madar-client-card madar-card madar-card-interactive" type="button" key={client.id} onClick={() => setSelectedId(client.id)}>
              <span className="madar-client-card-top">
                {client.logo_path ? <img className="madar-client-avatar-image" src={`/api/clients/${client.id}/logo`} alt="" /> : <span className="madar-client-avatar">{initials(client.name)}</span>}
                <span className="madar-client-card-copy">
                  <strong className="madar-client-name">{client.name}</strong>
                  <small className="madar-code">{client.code}</small>
                </span>
                <Icon name="chevron" size={15} className="madar-client-chevron" />
              </span>
              <span className="madar-client-contact">{client.contact_name || 'جهة اتصال غير محددة'}{client.phone ? ` · ${client.phone}` : ''}</span>
              <span className="madar-client-card-footer">فتح الملف <Icon name="arrow" size={13} /></span>
            </button>
          ))}
        </div>
      ) : <div className="madar-panel madar-section"><EmptyState icon="users" title={search ? 'لا توجد نتائج مطابقة' : 'ابدأ بإضافة أول عميل'} description={search ? 'جرّب البحث باسم أو كود مختلف.' : 'ملفات العملاء تربط أوامر الصيانة والورشة والفواتير.'} action={!search && <Button icon="plus" onClick={() => setCreateOpen(true)}>إضافة عميل</Button>} /></div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="إنشاء ملف عميل" description="أدخل بيانات التواصل الأساسية. سيُنشأ كود العميل تلقائياً.">
        <form onSubmit={createClient}>
          <div className="madar-form-grid">
            <Input label="اسم العميل *" name="name" required maxLength={200} autoFocus />
            <Input label="اسم مسؤول التواصل" name="contactName" maxLength={200} />
            <Input label="رقم الهاتف" name="phone" type="tel" maxLength={80} />
            <Input label="البريد الإلكتروني" name="email" type="email" maxLength={254} />
            <Input className="madar-form-full" label="العنوان" name="address" maxLength={1000} />
          </div>
          {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ العميل'}</Button></div>
        </form>
      </Modal>

      <Modal open={selectedId !== null && !statementOpen} onClose={() => { setSelectedId(null); setStatementOpen(false); }} title={selectedClient?.name ?? 'ملف العميل'} description={selectedClient?.code} wide>
        {profileLoading ? <LoadingState label="جارٍ تحميل ملف العميل" /> : profileError ? <Alert tone="error">{profileError}</Alert> : profile && (
          <div className="madar-stack">
            <div className="madar-profile-banner">
              <div className="madar-client-avatar-wrap">{profile.logo_url ? <img className="madar-client-avatar-image large" src={profile.logo_url} alt={`شعار ${profile.name}`} /> : <span className="madar-client-avatar large">{initials(profile.name)}</span>}</div>
              <div className="madar-profile-heading"><h3>{profile.name}</h3><span className="madar-code">{profile.code}</span><p>{profile.contact_name || 'جهة اتصال غير محددة'}{profile.phone ? ` · ${profile.phone}` : ''}</p></div>
              <div className="madar-profile-actions">
                 {canViewFinancialDetails && <Button variant="secondary" icon="file" onClick={() => setStatementOpen(true)}>كشف الحساب</Button>}
                <Button variant="secondary" onClick={() => { setEditError(''); setEditOpen(true); }}>تعديل البيانات</Button>
                <label className="madar-button madar-button-ghost madar-button-small madar-logo-upload"><Icon name="upload" size={14} /> تحديث الشعار<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadLogo} /></label>
                <Button variant="danger" icon="trash" onClick={() => { setDeactivateError(''); setDeactivateOpen(true); }}>إيقاف العميل</Button>
              </div>
            </div>
            {profile.name_en && <p className="madar-muted madar-small" dir="ltr">{profile.name_en}</p>}
            {profile.notes && <p className="madar-muted madar-small">{profile.notes}</p>}
            <div className="madar-grid madar-grid-3">
              <div className="madar-stat-tile"><span>صيانة نشطة</span><strong>{profile.statistics.activeMaintenanceOrders}</strong></div>
              <div className="madar-stat-tile"><span>زيارات مكتملة</span><strong>{profile.statistics.completedMaintenanceVisits}</strong></div>
              <div className="madar-stat-tile"><span>أوامر ورشة نشطة</span><strong>{profile.statistics.activeWorkshopOrders}</strong></div>
            </div>
            <section className="madar-panel">
              <div className="madar-panel-header"><div><h3>الآلات ومواقع الخدمة</h3><p>{profile.machines.length} أصل مرتبط بالعميل</p></div></div>
              {profile.machines.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الآلة</th><th>الاسم</th><th>المنطقة</th><th>آخر متابعة</th></tr></thead><tbody>{profile.machines.map((machine) => <tr key={machine.id}><td className="madar-code">{machine.code}</td><td>{machine.name_ar}{machine.name_en ? ` · ${machine.name_en}` : ''}</td><td>{machine.site_area}</td><td>{machine.last_seen_at?.slice(0, 10) ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon="factory" title="لا توجد آلات مرتبطة بعد" description="تُسجل علاقة الآلة بالعميل عند إضافتها إلى بطاقة صيانة." />}
            </section>
          </div>
        )}
      </Modal>

      <Modal open={editOpen && selectedId !== null} onClose={() => setEditOpen(false)} title="تعديل بيانات العميل" description="يُحفظ كود العميل وأسماء العرض دون تغيير روابط الملفات والسجلات الحالية." wide>
        {selectedClient && <form onSubmit={updateClient}>
          <div className="madar-form-grid">
            <Input label="كود العميل *" name="code" required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" defaultValue={selectedClient.code} />
            <Input label="اسم العميل بالعربية *" name="nameAr" required maxLength={200} defaultValue={selectedClient.name_ar || selectedClient.name} />
            <Input label="اسم العميل بالإنجليزية" name="nameEn" maxLength={200} defaultValue={selectedClient.name_en ?? ''} />
            <Input label="اسم مسؤول التواصل" name="contactName" maxLength={200} defaultValue={selectedClient.contact_name ?? ''} />
            <Input label="رقم الهاتف" name="phone" type="tel" maxLength={80} defaultValue={selectedClient.phone ?? ''} />
            <Input label="البريد الإلكتروني" name="email" type="email" maxLength={254} defaultValue={selectedClient.email ?? ''} />
            <Input className="madar-form-full" label="العنوان" name="address" maxLength={1000} defaultValue={selectedClient.address ?? ''} />
            <Textarea className="madar-form-full" label="ملاحظات" name="notes" maxLength={10000} defaultValue={selectedClient.notes ?? ''} rows={3} />
          </div>
          {editError && <div className="madar-form-error"><Alert tone="error">{editError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setEditOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</Button></div>
        </form>}
      </Modal>

      <Modal open={deactivateOpen && selectedId !== null} onClose={() => setDeactivateOpen(false)} title="إيقاف ملف العميل" description="سيُخفى العميل من القوائم، مع الاحتفاظ بالفواتير والأوامر والملفات المرتبطة به.">
        <div className="madar-stack">
          <p>هل تريد إيقاف <strong>{selectedClient?.name}</strong>؟ لا يمكن تنفيذ ذلك ما دامت هناك أوامر صيانة أو ورشة نشطة.</p>
          {deactivateError && <Alert tone="error">{deactivateError}</Alert>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setDeactivateOpen(false)}>إلغاء</Button><Button variant="danger" icon="trash" disabled={deactivating} onClick={deactivateClient}>{deactivating ? 'جارٍ الإيقاف…' : 'تأكيد إيقاف العميل'}</Button></div>
        </div>
      </Modal>

      {canViewFinancialDetails && <Modal open={statementOpen} onClose={() => setStatementOpen(false)} title="كشف حساب العميل" description={selectedClient ? `${selectedClient.name} · ${selectedClient.code}` : ''}>
        {statementLoading ? <LoadingState label="جارٍ إعداد كشف الحساب" /> : statementError ? <Alert tone="error">{statementError}</Alert> : statement && (
          <div className="madar-stack">
            <div className="madar-statement-summary">
              <div><span>إجمالي الفواتير</span><strong>{formatMoney(statement.totalBilledCents)}</strong></div>
              <div><span>إجمالي المقبوضات</span><strong>{formatMoney(statement.totalPaidCents)}</strong></div>
              <div className="outstanding"><span>الرصيد المستحق</span><strong>{formatMoney(statement.outstandingBalanceCents)}</strong></div>
            </div>
            <div className="madar-section-head"><h3 className="madar-section-title">الفواتير المتأخرة أكثر من 60 يوماً</h3>{statement.hasOverdueDebt && <span className="madar-badge madar-badge-danger">توجد مديونية متأخرة</span>}</div>
            {statement.overdueInvoices.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الفاتورة</th><th>تاريخها</th><th>أيام التأخير</th><th>المتبقي</th></tr></thead><tbody>{statement.overdueInvoices.map((invoice) => <tr key={invoice.id}><td className="madar-code">{invoice.code}</td><td>{invoice.created_at?.slice(0, 10)}</td><td>{invoice.days_overdue}</td><td className="madar-money">{formatMoney(invoice.remaining_cents)}</td></tr>)}</tbody></table></div> : <div className="madar-alert madar-alert-success"><Icon name="check" size={14} /> لا توجد فواتير متأخرة.</div>}
          </div>
        )}
      </Modal>}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
