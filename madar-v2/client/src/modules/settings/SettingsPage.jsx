import { useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Toast from '../../components/ui/Toast.jsx';

function fileSize(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function storageSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function uptimeLabel(value) {
  if (!Number.isFinite(value)) return '—';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${days} يوم · ${hours} ساعة · ${minutes} دقيقة`;
}

export default function SettingsPage() {
  const { data: health, loading, error, reload } = useApi('/api/health');
  const { data: authStatus } = useApi('/api/auth/status');
  const isAdmin = authStatus?.user?.role === 'admin';
  const { data: systemHealth, loading: systemHealthLoading, error: systemHealthError, reload: reloadSystemHealth } = useApi('/api/system/health', { enabled: isAdmin });
  const { data: users, loading: usersLoading, error: usersError, reload: reloadUsers } = useApi('/api/auth/users', { enabled: isAdmin });
  const { data: backups, loading: backupsLoading, error: backupsError, reload: reloadBackups } = useApi('/api/system/backups', { enabled: isAdmin });
  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [restoreModal, setRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [actionError, setActionError] = useState('');
  const { notice, showToast, clearToast } = useToast();

  async function saveUser(event) {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    const form = new FormData(event.currentTarget);
    try {
      if (editingUser) {
        const payload = { role: form.get('role'), active: form.get('active') === 'true' };
        if (form.get('password')) payload.password = form.get('password');
        await api.patch(`/api/auth/users/${editingUser.id}`, payload);
      } else {
        await api.post('/api/auth/users', {
          username: form.get('username'), full_name: form.get('full_name'), role: form.get('role'), password: form.get('password'),
        });
      }
      setUserModal(false);
      setEditingUser(null);
      await reloadUsers();
      showToast(editingUser ? 'تم تحديث صلاحيات المستخدم.' : 'تم إنشاء حساب المستخدم.');
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function deactivateUser(user) {
    if (!window.confirm(`سيتم تعطيل حساب ${user.username} وإلغاء جلساته. متابعة؟`)) return;
    try {
      await api.delete(`/api/auth/users/${user.id}`);
      await reloadUsers();
      showToast('تم تعطيل حساب المستخدم.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  async function createBackup() {
    setSaving(true);
    setActionError('');
    try {
      const backup = await api.post('/api/system/backup', {});
      await reloadBackups();
      showToast(`تم إنشاء النسخة ${backup.filename} (${fileSize(backup.sizeBytes)}).`);
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function restoreBackup(event) {
    event.preventDefault();
    if (!restoreFile) return;
    if (!window.confirm('سيستبدل هذا الإجراء قاعدة البيانات والتخزين الحاليين بمحتوى النسخة. تأكد من وجود نسخة حديثة. متابعة؟')) return;
    setSaving(true);
    setProgress(0);
    setActionError('');
    try {
      const form = new FormData();
      form.append('file', restoreFile);
      await api.uploadWithProgress('/api/system/backup/restore', form, setProgress);
      setRestoreModal(false);
      setRestoreFile(null);
      showToast('تمت الاستعادة. أُلغيت جلسات الدخول النشطة؛ سجّل الدخول مجدداً.');
      await reloadUsers();
      await reloadBackups();
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader kicker="النظام · الإصدار والتشغيل" title="إعدادات النظام" description="إدارة حسابات الدخول والنسخ الاحتياطي المحلي واستعادة النظام." />
      <div className="madar-grid madar-grid-2 madar-section">
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">إصدار التطبيق</span><div className="madar-runtime-brand"><span className="madar-brand-mark light">M</span><div><strong>MADAR</strong><small>v2.0.0</small></div></div><p className="madar-page-description">نظام إدارة التشغيل والصيانة · نسخة محلية.</p></section>
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">اتصال API</span>{loading && !health ? <LoadingState label="جارٍ فحص الخادم" /> : error ? <Alert tone="error">{error}</Alert> : <div className="madar-health-row"><span className="madar-health-pulse" /><div><strong>{health?.service ?? 'MADAR V2'}</strong><small>الخادم يستجيب للطلبات.</small></div><Badge tone="success">متصل</Badge></div>}<Button variant="secondary" size="small" onClick={reload}>إعادة الفحص</Button></section>
      </div>

      {!isAdmin ? <div className="madar-section"><Alert tone="info">إدارة المستخدمين والنسخ الاحتياطية متاحة لحسابات المدير فقط.</Alert></div> : <>
        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>صحة النظام والتخزين</h2><p>فحص SQLite ومدة تشغيل العملية والمساحة الحرة على وسيط التخزين.</p></div><Button variant="secondary" size="small" icon="refresh" disabled={systemHealthLoading} onClick={reloadSystemHealth}>إعادة الفحص</Button></div>
          {systemHealthError ? <div className="madar-panel-body"><Alert tone="error">{systemHealthError}</Alert></div> : systemHealthLoading && !systemHealth ? <LoadingState label="جارٍ فحص النظام والتخزين" /> : systemHealth && <div className="madar-panel-body madar-stack">
            {systemHealth.status !== 'ok' && <Alert tone={systemHealth.status === 'error' ? 'error' : 'warning'}>{systemHealth.status === 'error' ? 'تعذر التحقق من صحة قاعدة البيانات أو وسيط التخزين.' : `المساحة الحرة أقل من ${systemHealth.storage.thresholdPercent}% من وسيط التخزين.`}</Alert>}
            <div className="madar-grid madar-grid-4">
              <div className="madar-stat-tile"><span>حالة SQLite</span><strong>{systemHealth.database?.status === 'ok' ? 'سليم' : 'تحقق مطلوب'}</strong></div>
              <div className="madar-stat-tile"><span>مدة التشغيل</span><strong>{uptimeLabel(systemHealth.uptimeSeconds)}</strong></div>
              <div className="madar-stat-tile"><span>المساحة الحرة</span><strong>{systemHealth.storage?.freePercent ?? '—'}%</strong><small>{storageSize(systemHealth.storage?.availableBytes)} من {storageSize(systemHealth.storage?.totalBytes)}</small></div>
              <div className="madar-stat-tile"><span>مسار التخزين</span><strong dir="ltr">{systemHealth.storage?.mountPath ?? '—'}</strong></div>
            </div>
          </div>}
        </section>

        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>إدارة المستخدمين والصلاحيات</h2><p>إدارة حسابات الدخول وأدوارها. بيانات الموظفين الميدانيين منفصلة عن حسابات الدخول.</p></div><Button icon="plus" onClick={() => { setEditingUser(null); setActionError(''); setUserModal(true); }}>إضافة مستخدم جديد</Button></div>
          {usersError && <div className="madar-panel-body"><Alert tone="error">{usersError}</Alert></div>}
          {usersLoading ? <LoadingState /> : users?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>اسم المستخدم</th><th>الاسم الكامل</th><th>الدور</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td className="madar-code">{user.username}</td><td>{user.full_name}</td><td><Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>{user.role}</Badge></td><td><Badge tone={user.active ? 'success' : 'warning'}>{user.active ? 'نشط' : 'موقوف'}</Badge></td><td>{String(user.created_at).slice(0, 10)}</td><td><div className="madar-inline-wrap"><Button variant="ghost" size="small" onClick={() => { setEditingUser(user); setActionError(''); setUserModal(true); }}>الصلاحيات / كلمة المرور</Button>{user.active && user.id !== authStatus?.user?.id && <Button variant="ghost" size="small" onClick={() => deactivateUser(user)}>تعطيل</Button>}</div></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="لا توجد حسابات مستخدمين" />}
        </section>

        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>النسخ الاحتياطي للنظام</h2><p>نسخ محلية لقاعدة SQLite ومجلد التخزين. الاستعادة تتحقق من سلامة SQLite وتوافق المخطط قبل استبدال البيانات.</p></div><div className="madar-inline-wrap"><Button variant="secondary" icon="upload" onClick={() => { setActionError(''); setRestoreModal(true); }}>استعادة نسخة</Button><Button icon="archive" disabled={saving} onClick={createBackup}>{saving ? 'جارٍ إنشاء النسخة…' : 'إنشاء نسخة احتياطية الآن (ZIP)'}</Button></div></div>
          {backupsError && <div className="madar-panel-body"><Alert tone="error">{backupsError}</Alert></div>}
          {backupsLoading ? <LoadingState /> : backups?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>اسم النسخة</th><th>الحجم</th><th>تاريخ الإنشاء</th><th>تنزيل</th></tr></thead><tbody>{backups.map((backup) => <tr key={backup.filename}><td className="madar-code">{backup.filename}</td><td>{fileSize(backup.sizeBytes)}</td><td>{String(backup.modifiedAt).replace('T', ' ').slice(0, 19)}</td><td><a className="madar-button madar-button-secondary madar-button-small" href={`/api/system/backups/${encodeURIComponent(backup.filename)}/download`}><Icon name="download" size={13} /> تنزيل</a></td></tr>)}</tbody></table></div> : <EmptyState icon="archive" title="لا توجد نسخ احتياطية" description="أنشئ نسخة ZIP لحفظ قاعدة البيانات وملفات التخزين المحلية." />}
        </section>
      </>}

      <Modal open={userModal} onClose={() => setUserModal(false)} title={editingUser ? `تعديل حساب ${editingUser.username}` : 'إضافة مستخدم جديد'} description="تُخزن كلمات المرور كقيمة bcrypt، وتُلغى جلسات المستخدم عند تغيير كلمة المرور.">
        <form onSubmit={saveUser}><div className="madar-form-stack">
          {!editingUser && <><Input label="اسم المستخدم *" name="username" required minLength={3} maxLength={64} /><Input label="الاسم الكامل *" name="full_name" required minLength={2} maxLength={120} />
            <Input label="كلمة المرور المؤقتة *" name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" /></>}
          <Select label="الدور" name="role" defaultValue={editingUser?.role ?? 'operations'}><option value="operations">عمليات</option><option value="admin">مدير</option></Select>
          {editingUser && <><Select label="الحالة" name="active" defaultValue={String(Boolean(editingUser.active))}><option value="true">نشط</option><option value="false">موقوف</option></Select><Input label="كلمة مرور جديدة (اختياري)" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" /></>}
        </div>{actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setUserModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المستخدم'}</Button></div></form>
      </Modal>

      <Modal open={restoreModal} onClose={() => { if (!saving) { setRestoreModal(false); setRestoreFile(null); } }} title="استعادة نسخة احتياطية" description="سيجري التحقق من الملف أولاً. قاعدة البيانات والتخزين الحاليان سيُستبدلان بعد نجاح التحقق.">
        <form onSubmit={restoreBackup}><div className="madar-form-stack"><Alert tone="warning">تحذير: الاستعادة تستبدل بيانات MADAR الحالية. تُلغى جميع جلسات الدخول بعد نجاحها.</Alert><Input label="ملف نسخة MADAR V2 ZIP *" type="file" accept=".zip,application/zip" required onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} />{progress > 0 && <progress value={progress} max="100" aria-label="تقدم رفع النسخة" />}</div>{actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" disabled={saving} onClick={() => setRestoreModal(false)}>إلغاء</Button><Button type="submit" variant="danger" disabled={!restoreFile || saving}>{saving ? 'جارٍ التحقق والاستعادة…' : 'استعادة النسخة'}</Button></div></form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
