import { useEffect, useRef, useState } from 'react'
import { CloudUpload, Download, FileSpreadsheet, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'

const roleNames = { admin: 'المدير العام', sales: 'المبيعات', operations: 'التشغيل والصيانة', purchasing: 'المشتريات والمخازن' }

export default function UsersPage({ user: currentUser, onCreate, apiClient, notify }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [actionId, setActionId] = useState(null)
  const importRef = useRef(null)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const result = await apiClient('/users')
      setUsers(Array.isArray(result) ? result : [])
    } catch (error) {
      notify?.(error.message || 'تعذر تحميل حسابات المستخدمين.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadUsers() }, [])

  const toggleUser = async (user) => {
    if (togglingId !== null) return
    setTogglingId(user.id)
    try {
      await apiClient('/users/' + user.id, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) })
      await loadUsers()
      notify?.(user.active ? 'تم تعطيل الحساب.' : 'تم تفعيل الحساب.')
    } catch (error) {
      notify?.(error.message || 'تعذر تحديث حالة المستخدم.')
    } finally {
      setTogglingId(null)
    }
  }

  const removeUser = async (user) => {
    if (user.isMaster || user.id === currentUser?.id || actionId !== null) return
    if (!window.confirm(`سيتم تعطيل حساب ${user.fullName} وإخفاؤه مع الاحتفاظ بسجل التدقيق. متابعة؟`)) return
    setActionId(user.id)
    try {
      await apiClient(`/users/${user.id}`, { method: 'DELETE' })
      await loadUsers()
      notify?.('تم حذف الحساب منطقيًا وإبطال جلساته.')
    } catch (error) {
      notify?.(error.message || 'تعذر حذف حساب المستخدم.')
    } finally {
      setActionId(null)
    }
  }

  const resetPassword = async (user) => {
    if (actionId !== null) return
    const password = window.prompt(`أدخل كلمة مرور جديدة لحساب ${user.username} (10 أحرف على الأقل). لا تُحفظ كلمة المرور كنص مكشوف.`)
    if (password === null) return
    if (password.length < 10 || password.length > 200) {
      notify?.('كلمة المرور الجديدة يجب أن تكون بين 10 و200 حرف.')
      return
    }
    setActionId(user.id)
    try {
      await apiClient(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ password }) })
      notify?.('تم تغيير كلمة المرور وحفظها بصيغة مشفّرة.')
    } catch (error) {
      notify?.(error.message || 'تعذر تغيير كلمة المرور.')
    } finally {
      setActionId(null)
    }
  }

  const exportUsers = async () => {
    if (exporting || importing) return
    setExporting(true)
    try {
      const response = await apiClient('/users/export')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'Madar-Users.xlsx'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify?.('تم تنزيل ملف المستخدمين.')
    } catch (error) {
      notify?.(error.message || 'تعذر تصدير ملف المستخدمين.')
    } finally {
      setExporting(false)
    }
  }

  const importUsers = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || importing || exporting) return
    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await apiClient('/users/import', { method: 'POST', body: form })
      await loadUsers()
      notify?.('اكتمل الاستيراد: ' + Number(result.added || 0) + ' مستخدم جديد، ' + Number(result.updated || 0) + ' مستخدم محدّث.')
    } catch (error) {
      notify?.(error.message || 'تعذر استيراد ملف المستخدمين.')
    } finally {
      setImporting(false)
    }
  }

  return <div className="page-enter">
    <header className="page-heading">
      <div><span className="section-eyebrow">إدارة الوصول</span><h2>المستخدمون والصلاحيات</h2><p>أنشئ حسابات الفريق، أو أدر الحسابات الحالية من ملف Excel.</p></div>
      <div className="heading-actions">
        <input ref={importRef} hidden type="file" accept=".xlsx,.xls" disabled={exporting || importing} onChange={importUsers}/>
        <button type="button" className="button button-secondary" disabled={exporting || importing} onClick={exportUsers}>
          {exporting ? <RefreshCw size={16} className="spin"/> : <Download size={16}/>}{exporting ? 'جارٍ التصدير...' : 'تصدير Excel'}
        </button>
        <button type="button" className="button button-secondary" disabled={importing || exporting} onClick={() => importRef.current?.click()}>
          {importing ? <RefreshCw size={16} className="spin"/> : <CloudUpload size={16}/>}{importing ? 'جارٍ الاستيراد...' : 'استيراد Excel'}
        </button>
        <button type="button" className="button button-primary" disabled={importing || exporting} onClick={onCreate}><Plus size={17}/> مستخدم جديد</button>
      </div>
    </header>

    <div className="users-import-note"><FileSpreadsheet size={16}/><span>تُخزّن كلمات المرور بصيغة مشفّرة ولا يمكن عرضها كنص مكشوف. يمكن للمسؤول تعيين كلمة مرور جديدة؛ لا يحتوي ملف التصدير على كلمات المرور الحالية.</span></div>
    <div className="roles-overview">{Object.entries(roleNames).map(([role, label]) => <div className="role-card" key={role}>
      <div className={'role-icon ' + role}><ShieldCheck size={17}/></div>
      <div><strong>{label}</strong><span>{role === 'admin' ? 'تقارير، إعدادات وإدارة كاملة' : role === 'sales' ? 'العملاء وإنشاء أوامر التشغيل' : role === 'operations' ? 'الماكينات والصور والأرشفة' : 'المخزون وفواتير الشراء'}</span></div>
    </div>)}</div>

    <section className="panel users-panel">
      <div className="panel-heading"><div><span className="section-eyebrow">حسابات النظام</span><h3>فريق العمل</h3></div><span className="result-count">{users.length} مستخدم</span></div>
      {loading ? <div className="loading-inline">جارٍ تحميل المستخدمين...</div> : users.length ? <div className="table-wrap"><table>
        <thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>الحالة</th><th>إدارة</th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.id}>
          <td><div className="user-cell"><span className="avatar">{String(user.fullName || 'م').slice(0, 1)}</span><strong>{user.fullName || '—'}</strong>{user.isMaster&&<span className="role-label">المدير الرئيسي</span>}</div></td>
          <td>{user.username || '—'}</td>
          <td><span className="role-label">{roleNames[user.role] || user.role || '—'}</span></td>
          <td><span className={user.active ? 'healthy-stock' : 'low-stock'}><i/>{user.active ? 'نشط' : 'معطل'}</span></td>
          <td><div className="worker-actions"><button type="button" className="text-button" disabled={togglingId !== null || actionId !== null || user.isMaster} onClick={() => toggleUser(user)}>{togglingId === user.id ? 'جارٍ التحديث...' : user.active ? 'تعطيل' : 'تفعيل'}</button><button type="button" className="text-button" disabled={actionId !== null || !user.active} onClick={() => resetPassword(user)}><KeyRound size={14}/> كلمة مرور جديدة</button>{!user.isMaster&&user.id!==currentUser?.id&&<button type="button" className="text-button danger-text" disabled={actionId !== null} onClick={() => removeUser(user)}>{actionId===user.id?<RefreshCw size={14} className="spin"/>:<Trash2 size={14}/>} حذف</button>}</div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline">لا توجد حسابات مستخدمين.</div>}
    </section>
  </div>
}
