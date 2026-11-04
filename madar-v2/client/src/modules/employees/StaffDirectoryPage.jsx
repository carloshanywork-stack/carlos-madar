import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Toast from '../../components/ui/Toast.jsx';
import './staff-directory.css';

const filters = [
  { value: 'all', label: 'الكل' },
  { value: 'representatives', label: 'مناديب الميدان' },
  { value: 'workers', label: 'عمال وفنيون' },
  { value: 'administration', label: 'إدارة وعمليات' },
];
const departments = ['Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration', 'Management', 'Sales'];
const systemRoles = [
  { value: 'admin', label: 'مدير النظام' },
  { value: 'operations', label: 'العمليات' },
  { value: 'sales', label: 'المبيعات' },
  { value: 'purchasing', label: 'المشتريات' },
];

function roleLabel(role) {
  return role === 'rep' ? 'مندوب ميداني' : systemRoles.find((item) => item.value === role)?.label ?? role ?? 'بدون حساب';
}

function initialClassification(member) {
  return member?.classification ?? 'worker';
}

export default function StaffDirectoryPage() {
  const [category, setCategory] = useState('all');
  const { data: staff, loading, error, reload } = useApi(`/api/staff?category=${category}`);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [classification, setClassification] = useState('worker');
  const [enableLogin, setEnableLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { notice, showToast, clearToast } = useToast();

  useEffect(() => {
    const refreshOnStaffChange = (message) => {
      if (message.detail?.type === 'staff.changed') void reload();
    };
    window.addEventListener('madar:operations-event', refreshOnStaffChange);
    return () => window.removeEventListener('madar:operations-event', refreshOnStaffChange);
  }, [reload]);

  const visibleStaff = useMemo(() => (staff ?? []).filter((member) => {
    const value = `${member.name} ${member.username ?? ''} ${member.phone ?? ''} ${member.department ?? ''} ${member.job_title ?? ''}`;
    return value.toLocaleLowerCase('ar').includes(search.trim().toLocaleLowerCase('ar'));
  }), [search, staff]);

  const openCreate = () => {
    setEditing(null);
    setClassification('worker');
    setEnableLogin(false);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (member) => {
    setEditing(member);
    setClassification(initialClassification(member));
    setEnableLogin(Boolean(member.can_login));
    setFormError('');
    setModalOpen(true);
  };

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const loginEnabled = classification !== 'worker' && enableLogin;
    try {
      const payload = {
        classification: loginEnabled ? classification : 'worker',
        name: form.get('name'),
        department: form.get('department'),
        job_title: form.get('job_title') || null,
        phone: form.get('phone') || null,
        national_id: form.get('national_id') || null,
        hire_date: form.get('hire_date') || null,
        monthly_salary_cents: egpToCents(form.get('monthly_salary'), { allowZero: true }),
        daily_rate_cents: form.get('daily_rate') ? egpToCents(form.get('daily_rate'), { allowZero: true }) : 0,
        active: form.get('active') === 'on',
      };
      if (loginEnabled) {
        payload.enableLogin = true;
        payload.username = form.get('username') || undefined;
        if (form.get('password')) payload.password = form.get('password');
        payload.role = classification === 'representative' ? 'rep' : form.get('role');
        payload.assignedRegions = classification === 'representative'
          ? String(form.get('assigned_regions') ?? '').split(/[،,]/).map((item) => item.trim()).filter(Boolean)
          : [];
      } else if (editing?.can_login) {
        payload.enableLogin = false;
      }
      if (editing) await api.patch(`/api/staff/${editing.id}`, payload);
      else await api.post('/api/staff', payload);
      setModalOpen(false);
      await reload();
      showToast(editing ? 'تم تحديث بيانات الكادر والصلاحيات.' : 'تمت إضافة فرد الكادر وربطه بالنظام.');
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(member) {
    const active = !member.active;
    const action = active ? 'تفعيل' : 'إيقاف';
    if (!window.confirm(`سيتم ${action} ${member.name}${member.can_login ? ' وإلغاء جلسات الدخول أو استعادتها' : ''}. متابعة؟`)) return;
    try {
      await api.patch(`/api/staff/${member.id}`, { active });
      await reload();
      showToast(active ? 'تم تفعيل فرد الكادر.' : 'تم إيقافه وإبطال جلسات الدخول المرتبطة.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  const canLogin = classification !== 'worker' && enableLogin;

  return (
    <>
      <PageHeader kicker="الموارد البشرية · الهوية" title="الفريق والكادر" description="دليل موحّد للمناديب والفنيين والعمال والإدارة، مع ربط آمن لحسابات الدخول والموظفين." />
      <section className="madar-section madar-panel">
        <div className="madar-panel-pad">
          <div className="madar-inline-wrap" role="group" aria-label="تصفية الكادر">
            {filters.map((item) => <Button key={item.value} size="small" variant={category === item.value ? 'primary' : 'secondary'} onClick={() => setCategory(item.value)}>{item.label}</Button>)}
            <span className="madar-inline-spacer" />
            <Input label="بحث" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم أو الهاتف أو الحساب" />
            <Button icon="plus" onClick={openCreate}>إضافة كادر</Button>
          </div>
          <p className="madar-small madar-muted">{visibleStaff.length} فرد · سجلات الحضور والرواتب وعهد الأدوات مرتبطة بملف الموظف.</p>
        </div>
      </section>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      <section className="madar-section madar-panel">
        {loading ? <LoadingState /> : visibleStaff.length ? (
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>الاسم والصفة</th><th>القسم / المسمى</th><th>بيانات التواصل</th><th>الهوية / التعيين</th><th>الأجر الشهري</th><th>حساب النظام</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
            <tbody>{visibleStaff.map((member) => <tr key={member.id}>
              <td><strong>{member.name}</strong><br /><Badge tone={member.classification === 'representative' ? 'warning' : member.classification === 'worker' ? 'neutral' : 'info'}>{member.classification === 'representative' ? 'مندوب ميداني' : member.classification === 'worker' ? 'عامل / فني' : 'إدارة / عمليات'}</Badge></td>
              <td>{member.department}<br /><small className="madar-small madar-muted">{member.job_title || '—'}</small></td>
              <td>{member.phone || '—'}</td>
              <td>{member.national_id || '—'}<br /><small className="madar-small madar-muted">{member.hire_date || 'تاريخ التعيين غير مسجل'}</small></td>
              <td>{formatMoney(member.monthly_salary_cents)}</td>
              <td>{member.can_login ? <><strong>{member.username}</strong><br /><small className="madar-small madar-muted">{roleLabel(member.role)}{member.role === 'rep' && member.assignedRegions.length ? ` · ${member.assignedRegions.join('، ')}` : ''}</small></> : <span className="madar-muted">بدون بيانات دخول</span>}</td>
              <td><Badge tone={member.active ? 'success' : 'neutral'}>{member.active ? 'نشط' : 'موقوف'}</Badge>{member.can_login && !member.login_active && <><br /><Badge tone="danger">الدخول معطّل</Badge></>}</td>
              <td><div className="madar-inline-wrap"><Button size="small" variant="ghost" onClick={() => openEdit(member)}>تعديل</Button><Button size="small" variant="ghost" onClick={() => void toggleActive(member)}>{member.active ? 'إيقاف' : 'تفعيل'}</Button></div></td>
            </tr>)}</tbody>
          </table></div>
        ) : <EmptyState icon="users" title="لا توجد سجلات مطابقة" description="غيّر المرشح أو أضف فرداً جديداً إلى الكادر." action={<Button icon="plus" onClick={openCreate}>إضافة كادر</Button>} />}
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `تعديل ملف ${editing.name}` : 'إضافة فرد جديد إلى الكادر'}>
        <form onSubmit={submit}>
          <div className="madar-form-stack">
            {!editing && <Select label="نوع الكادر *" value={classification} onChange={(event) => { setClassification(event.target.value); setEnableLogin(event.target.value !== 'worker'); }}>
              <option value="representative">مندوب ميداني — تطبيق وحساب دخول</option>
              <option value="worker">عامل / فني — بدون حساب دخول</option>
              <option value="system">مستخدم لوحة تحكم</option>
            </Select>}
            {editing && <Select label="تصنيف الكادر" value={classification} onChange={(event) => { setClassification(event.target.value); setEnableLogin(event.target.value !== 'worker'); }}>
              <option value="representative">مندوب ميداني</option><option value="worker">عامل / فني</option><option value="system">إدارة / مستخدم لوحة تحكم</option>
            </Select>}
            <Input label="الاسم الكامل *" name="name" required defaultValue={editing?.name ?? ''} maxLength={160} />
            <Select label="القسم *" name="department" required defaultValue={editing?.department ?? (classification === 'representative' ? 'Maintenance' : 'Workshop')}>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</Select>
            <Input label="المسمى الوظيفي" name="job_title" defaultValue={editing?.job_title ?? ''} maxLength={120} />
            <Input label="رقم الهاتف" name="phone" defaultValue={editing?.phone ?? ''} maxLength={80} />
            <Input label="رقم الهوية" name="national_id" defaultValue={editing?.national_id ?? ''} maxLength={80} />
            <Input label="تاريخ التعيين" name="hire_date" type="date" defaultValue={editing?.hire_date ?? ''} />
            <Input label="الراتب الشهري (جنيه)" name="monthly_salary" type="text" inputMode="decimal" required defaultValue={editing ? (editing.monthly_salary_cents / 100).toFixed(2) : '0.00'} />
            <Input label="الأجر اليومي (اختياري، جنيه)" name="daily_rate" type="text" inputMode="decimal" defaultValue={editing?.daily_rate_cents ? (editing.daily_rate_cents / 100).toFixed(2) : ''} hint="المسير القياسي يحسب اليومية من الراتب الشهري ÷ 26." />
            <label className="madar-checkbox"><input type="checkbox" name="active" defaultChecked={editing ? Boolean(editing.active) : true} /><span>ملف نشط</span></label>
            <section className="madar-staff-login-box">
              <label className="madar-checkbox"><input type="checkbox" checked={canLogin} disabled={classification === 'worker'} onChange={(event) => setEnableLogin(event.target.checked)} /><span>تمكين حساب دخول النظام</span></label>
              {canLogin && <>
                <Input label="اسم المستخدم *" name="username" required={!editing?.can_login} defaultValue={editing?.username ?? ''} minLength={3} maxLength={64} />
                <Input label={editing?.can_login ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور * (4 خانات على الأقل)'} name="password" type="password" required={!editing?.can_login} minLength={4} maxLength={72} autoComplete="new-password" />
                {classification === 'representative' ? <Textarea label="مناطق المسار * (افصل بينها بفاصلة)" name="assigned_regions" required defaultValue={editing?.assignedRegions?.join('، ') ?? ''} maxLength={2000} rows={2} /> : <Select label="الدور *" name="role" required defaultValue={editing?.role && editing.role !== 'rep' ? editing.role : 'operations'}>{systemRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}
              </>}
            </section>
          </div>
          {formError && <div className="madar-section"><Alert tone="error">{formError}</Alert></div>}
          <div className="madar-form-actions"><Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ بيانات الكادر'}</Button></div>
        </form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
