import { useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { hasUniversalRegionAccess, regionAccessLabel } from '../../lib/regions.js';
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
import Tabs from '../../components/ui/Tabs.jsx';
import AuditLogPage from './AuditLogPage.jsx';

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

function parseAssignedRegions(value) {
  return [...new Set(String(value ?? '').split(/[\n,،]+/).map((region) => region.trim()).filter(Boolean))];
}

function roleLabel(role) {
  return ({
    admin: 'مدير',
    finance: 'محاسبة / مالية',
    accountant: 'محاسب',
    sales: 'مبيعات',
    operations: 'عمليات',
    purchasing: 'مشتريات',
    rep: 'مندوب ميداني',
  })[role] ?? role;
}

export default function SettingsPage() {
  const { data: health, loading, error, reload } = useApi('/api/health');
  const { data: authStatus } = useApi('/api/auth/status');
  const isAdmin = authStatus?.user?.role === 'admin';
  const { data: systemHealth, loading: systemHealthLoading, error: systemHealthError, reload: reloadSystemHealth } = useApi('/api/system/health', { enabled: isAdmin });
  const { data: apkStatus, loading: apkStatusLoading, error: apkStatusError, reload: reloadApkStatus } = useApi('/download/apk/status', { enabled: isAdmin });
  const { data: users, loading: usersLoading, error: usersError, reload: reloadUsers } = useApi('/api/users', { enabled: isAdmin });
  const { data: backups, loading: backupsLoading, error: backupsError, reload: reloadBackups } = useApi('/api/system/backups', { enabled: isAdmin });
  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userRole, setUserRole] = useState('operations');
  const [settingsTab, setSettingsTab] = useState('system');
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
        const role = form.get('role');
        const payload = {
          username: form.get('username'),
          full_name: form.get('full_name'),
          role,
          active: form.get('active') === 'true',
          assignedRegions: role === 'rep' ? parseAssignedRegions(form.get('assignedRegions')) : [],
        };
        if (form.get('password')) payload.password = form.get('password');
        await api.put(`/api/users/${editingUser.id}`, payload);
      } else {
        const role = form.get('role');
        await api.post('/api/users', {
          username: form.get('username'),
          full_name: form.get('full_name'),
          role,
          password: form.get('password'),
          assignedRegions: role === 'rep' ? parseAssignedRegions(form.get('assignedRegions')) : [],
        });
      }
      setUserModal(false);
      setEditingUser(null);
      await reloadUsers();
      showToast(editingUser ? 'تم تحديث حساب المستخدم.' : 'تم إنشاء حساب المستخدم.');
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function deactivateUser(user) {
    if (!window.confirm(`سيتم حذف حساب ${user.username} حذفاً منطقياً مع الاحتفاظ بسجل الزيارات وإلغاء جلساته. متابعة؟`)) return;
    try {
      await api.delete(`/api/users/${user.id}`);
      await reloadUsers();
      showToast('تم حذف الحساب من قائمة المستخدمين وإلغاء جلساته.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  async function setRepActive(user, active) {
    if (!active && !window.confirm(`سيُقفل حساب ${user.username} فوراً وتُلغى جميع جلساته. متابعة؟`)) return;
    try {
      await api.put(`/api/users/${user.id}`, { isActive: active ? 1 : 0 });
      await reloadUsers();
      showToast(active ? 'تم تفعيل حساب المندوب.' : 'تم قفل حساب المندوب وإلغاء جلساته فوراً.');
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
      <PageHeader
        kicker="النظام · الإصدار والتشغيل"
        title="إعدادات النظام"
        description="إدارة حسابات الدخول والنسخ الاحتياطي المحلي واستعادة النظام."
        actions={isAdmin && apkStatus?.available ? (
          <a
            className="madar-button madar-button-primary"
            href="/download/apk"
            download="madar-rep.apk"
            title="تنزيل حزمة تطبيق المندوب الميداني لهواتف أندرويد"
          >
            <Icon name="download" size={15} />
            <span>تنزيل تطبيق المندوب (APK)</span>
          </a>
        ) : null}
      />
      {isAdmin && <div className="madar-section"><Tabs
        items={[{ value: 'system', label: 'إعدادات النظام' }, { value: 'audit', label: 'سجل العمليات والرقابة' }]}
        value={settingsTab}
        onChange={setSettingsTab}
        ariaLabel="إعدادات النظام والرقابة"
      /></div>}
      <div className="madar-grid madar-grid-2 madar-section">
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">إصدار التطبيق</span><div className="madar-runtime-brand"><span className="madar-brand-mark light">M</span><div><strong>MADAR</strong><small>v2.0.0</small></div></div><p className="madar-page-description">نظام إدارة التشغيل والصيانة · نسخة محلية.</p>{isAdmin && <small className="madar-page-description">{apkStatusLoading && !apkStatus ? 'جارٍ فحص ملف APK…' : apkStatusError ? 'تعذر فحص ملف APK.' : apkStatus?.available ? `APK جاهز للتحميل · ${fileSize(apkStatus.sizeBytes)}${apkStatus.artifactType === 'fallback' ? ' · نسخة تجريبية / بانتظار الإصدار الجديد' : ''}` : 'لا يوجد ملف APK متاح حالياً.'}</small>}</section>
        <section className="madar-panel madar-panel-pad madar-runtime-card"><span className="madar-page-kicker">اتصال API</span>{loading && !health ? <LoadingState label="جارٍ فحص الخادم" /> : error ? <Alert tone="error">{error}</Alert> : <div className="madar-health-row"><span className="madar-health-pulse" /><div><strong>{health?.service ?? 'MADAR V2'}</strong><small>الخادم يستجيب للطلبات.</small></div><Badge tone="success">متصل</Badge></div>}<Button variant="secondary" size="small" onClick={reload}>إعادة الفحص</Button></section>
      </div>

      {isAdmin && settingsTab === 'audit' ? <AuditLogPage /> : !isAdmin ? <div className="madar-section"><Alert tone="info">إدارة المستخدمين والنسخ الاحتياطية وسجل الرقابة متاحة لحسابات المدير فقط.</Alert></div> : <>
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
          <div className="madar-panel-header"><div><h2>تطبيق المندوب (APK)</h2><p>نزّل النسخة المتاحة حالياً. يُفضّل استخدام إصدار موقّع للتوزيع والتحديث.</p></div><Button variant="secondary" size="small" icon="refresh" disabled={apkStatusLoading} onClick={reloadApkStatus}>تحديث الحالة</Button></div>
          <div className="madar-panel-body madar-stack">
            {apkStatusError && <Alert tone="error">{apkStatusError}</Alert>}
            {apkStatusLoading && !apkStatus ? <LoadingState label="جارٍ فحص ملف APK" /> : apkStatus && <>
              {!apkStatus.available ? <Alert tone="warning">لا يوجد APK متاح على الخادم حالياً. بعد بناء الإصدار الجديد سيظهر زر التنزيل هنا.</Alert> : <div className="madar-health-row">
                <span className="madar-health-pulse" />
                <div><strong>{apkStatus.artifactType === 'release' ? 'إصدار موقّع جاهز' : 'نسخة تجريبية / بانتظار بناء الإصدار الجديد'}</strong><small>{fileSize(apkStatus.sizeBytes)} · آخر تحديث {String(apkStatus.modifiedAt).replace('T', ' ').slice(0, 19)}</small></div>
                <Badge tone={apkStatus.artifactType === 'release' ? 'success' : 'warning'}>{apkStatus.artifactType === 'release' ? 'إصدار' : 'تجريبية'}</Badge>
              </div>}
              {apkStatus.available && <a className="madar-button madar-button-primary" href="/download/apk" aria-label="تنزيل تطبيق المندوب APK"><Icon name="download" size={15} /><span>تنزيل APK المندوب</span></a>}
              {apkStatus.transitionAvailable && <>
                <Alert tone="warning">للهواتف التي تستخدم إصدار Debug القديم 2.0.2 (رقم 4) فقط: نزّل حزمة الانتقال 2.0.4 (رقم 6) وثبّتها فوق التطبيق الحالي بعد حفظ العمل المعلّق. هذه حزمة Debug وليست إصدار الإنتاج الرسمي؛ لا تحذف التطبيق القديم قبل التأكد من حفظ بياناته.</Alert>
                <a className="madar-button madar-button-secondary" href="/download/apk/debug-transition" aria-label="تنزيل حزمة انتقال Debug للهواتف القديمة"><Icon name="download" size={15} /><span>تنزيل حزمة الانتقال للهواتف القديمة</span></a>
              </>}
            </>}
          </div>
        </section>

        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>إدارة المستخدمين والمناديب</h2><p>أنشئ حسابات المندوبين، وأسند أوامر التشغيل لهم، واقفل الحساب فوراً مع إلغاء الجلسات. تغطية المندوب تشمل كافة المناطق.</p></div><Button icon="plus" onClick={() => { setEditingUser(null); setUserRole('operations'); setActionError(''); setUserModal(true); }}>إضافة مستخدم / مندوب</Button></div>
          {usersError && <div className="madar-panel-body"><Alert tone="error">{usersError}</Alert></div>}
          {usersLoading ? <LoadingState /> : users?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>اسم المستخدم</th><th>الاسم الكامل</th><th>الدور</th><th>نطاق المناطق</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td className="madar-code">{user.username}</td><td>{user.full_name}</td><td><Badge tone={user.role === 'admin' ? 'info' : user.role === 'rep' ? 'success' : 'neutral'}>{roleLabel(user.role)}</Badge></td><td>{user.role === 'rep' ? regionAccessLabel(user.assignedRegions) : '—'}</td><td><Badge tone={user.active ? 'success' : 'warning'}>{user.active ? 'نشط' : 'موقوف'}</Badge></td><td>{String(user.created_at).slice(0, 10)}</td><td><div className="madar-inline-wrap"><Button variant="ghost" size="small" onClick={() => { setEditingUser(user); setUserRole(user.role); setActionError(''); setUserModal(true); }}>تعديل الحساب</Button>{user.role === 'rep' && <Button variant="ghost" size="small" onClick={() => setRepActive(user, !user.active)}>{user.active ? 'قفل فوراً' : 'تفعيل'}</Button>}{user.id !== authStatus?.user?.id && <Button variant="ghost" size="small" onClick={() => deactivateUser(user)}>حذف</Button>}</div></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="لا توجد حسابات مستخدمين" />}
        </section>

        <section className="madar-panel madar-section">
          <div className="madar-panel-header"><div><h2>النسخ الاحتياطي للنظام</h2><p>نسخ محلية لقاعدة SQLite ومجلد التخزين. الاستعادة تتحقق من سلامة SQLite وتوافق المخطط قبل استبدال البيانات.</p></div><div className="madar-inline-wrap"><Button variant="secondary" icon="upload" onClick={() => { setActionError(''); setRestoreModal(true); }}>استعادة نسخة</Button><Button icon="archive" disabled={saving} onClick={createBackup}>{saving ? 'جارٍ إنشاء النسخة…' : 'إنشاء نسخة احتياطية الآن (ZIP)'}</Button></div></div>
          {backupsError && <div className="madar-panel-body"><Alert tone="error">{backupsError}</Alert></div>}
          {backupsLoading ? <LoadingState /> : backups?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>اسم النسخة</th><th>الحجم</th><th>تاريخ الإنشاء</th><th>تنزيل</th></tr></thead><tbody>{backups.map((backup) => <tr key={backup.filename}><td className="madar-code">{backup.filename}</td><td>{fileSize(backup.sizeBytes)}</td><td>{String(backup.modifiedAt).replace('T', ' ').slice(0, 19)}</td><td><a className="madar-button madar-button-secondary madar-button-small" href={`/api/system/backups/${encodeURIComponent(backup.filename)}/download`}><Icon name="download" size={13} /> تنزيل</a></td></tr>)}</tbody></table></div> : <EmptyState icon="archive" title="لا توجد نسخ احتياطية" description="أنشئ نسخة ZIP لحفظ قاعدة البيانات وملفات التخزين المحلية." />}
        </section>
      </>}

      <Modal open={userModal} onClose={() => setUserModal(false)} title={editingUser ? `تعديل حساب ${editingUser.username}` : 'إضافة مستخدم أو مندوب'} description="تُخزن كلمات المرور كقيمة bcrypt، ويؤدي قفل المندوب أو تغيير كلمة المرور إلى إلغاء جلساته.">
        <form onSubmit={saveUser}><div className="madar-form-stack">
          <Input key={`username-${editingUser?.id ?? 'new'}`} label="اسم المستخدم *" name="username" defaultValue={editingUser?.username ?? ''} required minLength={3} maxLength={64} />
          <Input key={`fullname-${editingUser?.id ?? 'new'}`} label="الاسم الكامل *" name="full_name" defaultValue={editingUser?.full_name ?? ''} required minLength={2} maxLength={120} />
          {!editingUser && <Input label="كلمة المرور المؤقتة *" name="password" type="password" required minLength={4} maxLength={72} autoComplete="new-password" />}
          <Select key={`role-${editingUser?.id ?? 'new'}`} label="الدور" name="role" value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="operations">عمليات</option><option value="sales">مبيعات</option><option value="purchasing">مشتريات</option><option value="finance">محاسبة / مالية</option><option value="accountant">محاسب</option><option value="rep">مندوب ميداني</option><option value="admin">مدير</option></Select>
          {userRole === 'rep' && <Input key={`regions-${editingUser?.id ?? 'new'}`} label="مناطق إضافية محددة (اختياري)" name="assignedRegions" defaultValue={hasUniversalRegionAccess(editingUser?.assignedRegions) ? '' : editingUser?.assignedRegions?.join('، ') ?? ''} hint="اتركه فارغاً لمنح المندوب وصولاً تلقائياً إلى كافة المناطق. أدرج مناطق فقط عند الحاجة لتقييد الوصول." />}
          {editingUser && <><Select key={`active-${editingUser.id}`} label="حالة الحساب" name="active" defaultValue={String(Boolean(editingUser.active))}><option value="true">نشط</option><option value="false">موقوف</option></Select><Input label="كلمة مرور جديدة (اختياري)" name="password" type="password" minLength={4} maxLength={72} autoComplete="new-password" /></>}
        </div>{actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setUserModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المستخدم'}</Button></div></form>
      </Modal>

      <Modal open={restoreModal} onClose={() => { if (!saving) { setRestoreModal(false); setRestoreFile(null); } }} title="استعادة نسخة احتياطية" description="سيجري التحقق من الملف أولاً. قاعدة البيانات والتخزين الحاليان سيُستبدلان بعد نجاح التحقق.">
        <form onSubmit={restoreBackup}><div className="madar-form-stack"><Alert tone="warning">تحذير: الاستعادة تستبدل بيانات MADAR الحالية. تُلغى جميع جلسات الدخول بعد نجاحها.</Alert><Input label="ملف نسخة MADAR V2 ZIP *" type="file" accept=".zip,application/zip" required onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} />{progress > 0 && <progress value={progress} max="100" aria-label="تقدم رفع النسخة" />}</div>{actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" disabled={saving} onClick={() => setRestoreModal(false)}>إلغاء</Button><Button type="submit" variant="danger" disabled={!restoreFile || saving}>{saving ? 'جارٍ التحقق والاستعادة…' : 'استعادة النسخة'}</Button></div></form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
