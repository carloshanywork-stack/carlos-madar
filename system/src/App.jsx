import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { io as createSocket } from 'socket.io-client'
import MachineCode from './components/MachineCode'
import MachineAreaSelector from './components/MachineAreaSelector'
import MachinesPage from './components/machines/MachinesPage'
import AreaFileExplorerModal from './components/machines/AreaFileExplorerModal'
import OrdersPage from './components/orders/OrdersPage'
import OrderFormModal from './components/orders/OrderFormModal'
import UsersPage from './components/users/UsersPage'
import EmployeesPage from './components/employees/EmployeesPage'
import AccountingPage from './components/accounting/AccountingPage'
import ArchiveAnalysisPage from './components/archive/ArchiveAnalysisPage'
import SettingsPage from './components/settings/SettingsPage'
import {
  Activity, Archive, ArrowDownLeft, ArrowLeft, ArrowUpRight, Ban, Boxes, Building2, Check, CheckCircle2,
  Bell, ChevronDown, CircleDollarSign, ClipboardList, CloudUpload, FileImage, FileSpreadsheet, Filter,
  HardDrive, LayoutDashboard, LogOut, Menu, Moon, Package, Plus, Search, Settings, ShieldCheck, Sun,
  SlidersHorizontal, Sparkles, Users, Wrench, X, ImagePlus, Trash2, Download, MapPin, Clock3,
   CircleHelp, AlertTriangle, RefreshCw, Presentation, Boxes as BoxesIcon, Folder, Pencil, FileText, BriefcaseBusiness, BookOpenCheck,
} from 'lucide-react'

const roleNames = { admin: 'المدير العام', sales: 'المبيعات', operations: 'التشغيل والصيانة', purchasing: 'المشتريات والمخازن' }
const statusNames = { in_progress: 'قيد التنفيذ', review: 'بانتظار الاعتماد', archived: 'مؤرشف' }
const roleLinks = {
  admin: ['overview', 'clients', 'orders', 'machines', 'inventory', 'finance', 'accounting', 'reports', 'analysis', 'settings', 'users', 'employees'],
  sales: ['overview', 'clients', 'orders', 'finance'],
  operations: ['overview', 'orders', 'machines', 'inventory'],
  purchasing: ['overview', 'inventory'],
}
const navItems = [
  { key: 'overview', label: 'لوحة التحكم', icon: LayoutDashboard },
  { key: 'clients', label: 'العملاء', icon: Building2 },
  { key: 'orders', label: 'أوامر التشغيل', icon: ClipboardList },
  { key: 'machines', label: 'قاعدة الماكينات', icon: HardDrive },
  { key: 'inventory', label: 'المخزون والمشتريات', icon: Boxes },
  { key: 'finance', label: 'الخزينة والماليات', icon: CircleDollarSign },
  { key: 'accounting', label: 'المحاسبة والرواتب', icon: BookOpenCheck },
  { key: 'reports', label: 'الأرشيف والتقارير', icon: Archive },
  { key: 'analysis', label: 'تحليل الأرشيف', icon: Activity },
  { key: 'settings', label: 'الإعدادات', icon: Settings },
  { key: 'users', label: 'المستخدمون', icon: Users },
  { key: 'employees', label: 'الموظفون', icon: BriefcaseBusiness },
]
const viewPaths = { overview: '/', clients: '/clients', orders: '/orders', machines: '/machines', inventory: '/inventory', finance: '/finance', accounting: '/accounting', reports: '/archive', analysis: '/analysis', settings: '/settings', users: '/users', employees: '/employees' }

function viewFromPath(pathname) {
  if (/^\/orders\/\d+\/?$/.test(pathname)) return 'order-detail'
  const segment = pathname.split('/').filter(Boolean)[0]
  if (segment === 'archive') return 'reports'
  return Object.entries(viewPaths).find(([, route]) => route === `/${segment}`)?.[0] || 'overview'
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(url.startsWith('/api') ? url : `/api${url}`, { credentials: 'same-origin', ...options, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || 'تعذر تنفيذ الطلب.')
    error.status = response.status
    error.body = body
    throw error
  }
  const type = response.headers.get('content-type') || ''
  return type.includes('application/json') ? response.json() : response
}

function json(body) { return JSON.stringify(body) }
function normalizeAreaRecord(record) {
  if (!record || typeof record !== 'object') return record
  return { ...record, area: record.area ?? '' }
}
function normalizeBootstrap(payload) {
  if (!payload || typeof payload !== 'object') return payload
  return {
    ...payload,
    machines: Array.isArray(payload.machines) ? payload.machines.map(normalizeAreaRecord) : [],
    orders: Array.isArray(payload.orders) ? payload.orders.map(normalizeOrderAreas) : [],
  }
}
function normalizeOrderAreas(order) {
  if (!order || typeof order !== 'object') return order
  if (!Array.isArray(order.cards)) return order
  return { ...order, cards: order.cards.map(normalizeAreaRecord) }
}
function isOrderModal(modal) {
  const type = typeof modal === 'string' ? modal : modal?.type
  return type === 'order' || type === 'edit-order'
}
function fileUrl(path) { return `/api/files?path=${encodeURIComponent(path || '')}` }
function thumbnailUrl(path) { return `/api/files/thumbnail?path=${encodeURIComponent(path || '')}` }
function money(value) { return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) }
function currencyInputCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim())
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
}
function formatCurrencyCents(cents) {
  if (typeof cents !== 'bigint' || cents < 0n) return '—'
  return `${new Intl.NumberFormat('ar-EG').format(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`
}
function quantity(value) { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 }).format(Number(value || 0)) }
function date(value) {
  if (!value) return '—'
  const parsed = new Date(value.includes?.('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed)
}

function uploadWithProgress(url, form, onProgress, idempotencyKey) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.withCredentials = true
    request.setRequestHeader('Idempotency-Key', idempotencyKey)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    request.onerror = () => reject(new Error('تعذر الاتصال بالخادم أثناء رفع الصور.'))
    request.onload = () => {
      let payload = {}
      try { payload = JSON.parse(request.responseText || '{}') } catch { /* malformed server response */ }
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve(payload)
      } else reject(new Error(payload.error || 'تعذر رفع الصور.'))
    }
    request.send(form)
  })
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = []
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) return resolve(entries)
      entries.push(...batch)
      readBatch()
    }, reject)
    readBatch()
  })
}

async function collectDroppedEntry(entry) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    return [{ file, path: entry.fullPath.replace(/^\/+/, '') }]
  }
  if (!entry.isDirectory) return []
  const children = await readDirectoryEntries(entry.createReader())
  const nested = await Promise.all(children.map(collectDroppedEntry))
  return nested.flat()
}

async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || [])
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
  if (entries.length) return (await Promise.all(entries.map(collectDroppedEntry))).flat()
  return Array.from(dataTransfer.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

export default function App() {
  const location = useLocation()
  const routerNavigate = useNavigate()
  const [session, setSession] = useState({ loading: true, needsSetup: false, user: null })
  const [data, setData] = useState(null)
  const view = viewFromPath(location.pathname)
  const routeOrderId = location.pathname.match(/^\/orders\/(\d+)\/?$/)?.[1] || null
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [theme, setTheme] = useState(() => window.localStorage.getItem('madar-theme') || 'light')
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const today = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('madar-theme', theme)
  }, [theme])

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const notify = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3500)
  }

  const refresh = async () => {
    const next = normalizeBootstrap(await api('/bootstrap'))
    setData(next)
    setSession((current) => ({ ...current, user: next.user }))
    return next
  }

  useEffect(() => {
    api('/auth/status').then((status) => {
      setSession({ loading: false, needsSetup: status.needsSetup, user: status.user })
      if (status.user) return api('/bootstrap').then((payload) => setData(normalizeBootstrap(payload)))
    }).catch(() => setSession({ loading: false, needsSetup: false, user: null }))
  }, [])

  useEffect(() => {
    if (!session.user) return undefined
    const socket = createSocket(window.location.origin, { path: '/socket.io' })
    const loadSystemNotifications = () => api('/notifications').then((rows) => {
      setNotifications((Array.isArray(rows) ? rows : []).map((notification) => ({
        ...notification,
        id: notification.id,
        at: notification.created_at,
        read: Boolean(notification.reviewed_at),
      })))
    }).catch(() => setNotifications([]))
    let notificationTimer
    if (session.user.role === 'admin') {
      loadSystemNotifications()
      socket.on('system:notification', loadSystemNotifications)
      notificationTimer = window.setInterval(loadSystemNotifications, 60_000)
    }
    socket.on('areas:folder-added', (folder) => {
      if (session.user.role !== 'admin') {
        setNotifications((current) => [{ id: `${folder.path}-${folder.addedAt}`, title: 'مجلد منطقة جاهز', detail: folder.name, at: folder.addedAt, read: false }, ...current].slice(0, 20))
      }
    })
    return () => { if (notificationTimer) window.clearInterval(notificationTimer); socket.disconnect() }
  }, [session.user?.id])

  useEffect(() => {
    if (!routeOrderId || !session.user) {
      if (!routeOrderId) setSelectedOrder(null)
      return undefined
    }
    let current = true
    api(`/orders/${routeOrderId}`).then((detail) => { if (current) setSelectedOrder(normalizeOrderAreas(detail)) })
      .catch((error) => { if (current) notify(error.message) })
    return () => { current = false }
  }, [routeOrderId, session.user?.id])

  const login = async (body, setup) => {
    setBusy(true)
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: json(body) })
      const next = normalizeBootstrap(await api('/bootstrap'))
      setSession({ loading: false, needsSetup: false, user: next.user })
      setData(next)
    } catch (error) { notify(error.message) } finally { setBusy(false) }
  }

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* session may have expired */ }
    setData(null)
    setSession({ loading: false, needsSetup: false, user: null })
  }

  const run = async (action, success) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      if (success) notify(success)
    } catch (error) { notify(error.message) } finally { setBusy(false) }
  }

  const openOrder = async (order) => {
    routerNavigate(`/orders/${order.id}`)
    setSidebarOpen(false)
  }

  if (session.loading || (session.user && !data)) return <div className="loading-screen"><div className="brand-mark"><Activity /></div><span>جاري تهيئة مَدَار...</span></div>
  if (!session.user) return <AuthScreen needsSetup={session.needsSetup} onSubmit={login} busy={busy} toast={toast} />

  const user = session.user
  const permitted = roleLinks[user.role] || ['overview']
  const unreadNotifications = notifications.filter((notification) => !notification.read).length
  const navigate = (next) => {
    routerNavigate(viewPaths[next] || '/')
    setSidebarOpen(false)
    setSearch('')
    setNotificationsOpen(false)
  }

  return <div className="app-shell" dir="rtl">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup">
        <div className="brand-mark"><Activity size={22} strokeWidth={2.5} /></div>
        <div><strong>مَدَار</strong><span>إدارة التشغيل والصيانة</span></div>
        <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة"><X size={18} /></button>
      </div>
      <div className="workspace-label">مساحة العمل <span className="live-dot" /></div>
      <nav className="main-nav">
        {navItems.filter((item) => permitted.includes(item.key)).map((item) => {
          const Icon = item.icon
          const active = view === item.key || (view === 'order-detail' && item.key === 'orders')
          return <button key={item.key} className={`nav-link ${active ? 'nav-link-active' : ''}`} onClick={() => navigate(item.key)}>
            <Icon size={18} /><span>{item.label}</span>{item.key === 'orders' && data?.stats.pendingReview > 0 && user.role === 'admin' && <b>{data.stats.pendingReview}</b>}
          </button>
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div className="storage-icon"><HardDrive size={17} /></div><div><strong>تخزين محلي آمن</strong><span>البيانات داخل جهازك</span></div><CheckCircle2 size={15} className="storage-check" /></div>
        <button className="profile-row" onClick={logout} title="تسجيل الخروج"><div className="avatar">{(user.fullName || 'م').slice(0, 1)}</div><div className="profile-info"><strong>{user.fullName}</strong><span>{roleNames[user.role]}</span></div><LogOut size={17} className="logout-icon" /></button>
      </div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة" />}
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title"><button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="القائمة"><Menu size={20} /></button><div><span>{today}</span><h1>{view === 'order-detail' ? selectedOrder?.code || 'تفاصيل الأمر' : view === 'finance' && user.role === 'sales' ? 'فواتير المبيعات' : navItems.find((item) => item.key === view)?.label || 'تفاصيل الأمر'}</h1></div></div>
        <div className="topbar-actions">
          <button className="command-trigger" onClick={() => setCommandOpen(true)} title="بحث سريع (Ctrl+K)"><Search size={15}/><span>بحث سريع</span><kbd>Ctrl K</kbd></button>
          <button className="icon-button theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الليلي'} aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الليلي'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
          <div className="notification-wrap"><button className="icon-button notification-button" onClick={() => setNotificationsOpen((current) => !current)} aria-label="إشعارات النظام" aria-expanded={notificationsOpen}><Bell size={17}/>{unreadNotifications > 0&&<b>{unreadNotifications}</b>}</button>{notificationsOpen&&<section className="notification-popover"><div className="notification-heading"><strong>إشعارات النظام</strong><span>{notifications.filter((notification) => !notification.resolved_at).length}</span></div>{notifications.length ? notifications.map((notification) => <button className="notification-item" key={notification.id} onClick={async () => {
            if (session.user.role === 'admin' && !notification.read && Number.isInteger(Number(notification.id))) {
              try { await api(`/notifications/${notification.id}/review`, { method: 'POST' }) } catch { /* list refresh remains available */ }
              setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item))
            }
            navigate(notification.source_type === 'backup' || notification.source_type === 'recovery' ? 'settings' : 'inventory')
          }}><span className="notification-dot"/><span><strong>{notification.title}</strong><small>{notification.detail} · {date(notification.at)}</small></span></button>) : <p className="notification-empty">لا توجد إشعارات جديدة.</p>}</section>}</div>
          <div className="local-badge"><span className="live-dot" /> النظام يعمل محليًا</div>
          <div className="topbar-user"><span><strong>{user.fullName}</strong><small>{roleNames[user.role]}</small></span><div className="top-avatar">{(user.fullName || 'م').slice(0, 1)}</div></div>
        </div>
      </header>
      <div className="page-content">
        <Routes>
          <Route path="/" element={<Overview data={data} user={user} onNavigate={navigate} onOpenOrder={openOrder} />} />
          <Route path="/clients" element={<ClientsPage data={data} search={search} setSearch={setSearch} onCreate={() => setModal('client')} onRefresh={refresh} notify={notify} />} />
          <Route path="/orders" element={<OrdersPage data={data} user={user} search={search} setSearch={setSearch} onCreate={() => setModal('order')} onOpen={openOrder} onEdit={(order) => setModal({ type: 'edit-order', order })} onDelete={async (order) => { await api('/orders/' + order.id, { method: 'DELETE' }); await refresh() }} notify={notify} formatMoney={money} />} />
          <Route path="/orders/:orderId" element={selectedOrder && String(selectedOrder.id) === routeOrderId ? <OrderDetail order={selectedOrder} data={data} user={user} onBack={() => navigate('orders')} onRefresh={async () => { await refresh(); setSelectedOrder(normalizeOrderAreas(await api(`/orders/${selectedOrder.id}`))) }} onEdit={() => setModal({ type: 'edit-order', order: selectedOrder })} onDelete={async () => { await refresh(); navigate('orders') }} notify={notify} onPreview={(photo, side, photos) => setLightbox({ photo, side, photos })} onAddMachine={() => setModal({ type: 'add-machine', order: selectedOrder })} onIssue={() => setModal({ type: 'issue', order: selectedOrder })} /> : <div className="panel loading-inline">جارٍ تحميل الأمر...</div>} />
         <Route path="/machines" element={<MachinesPage data={data} search={search} setSearch={setSearch} onAdd={() => setModal('machine')} onRefresh={refresh} notify={notify} apiClient={api} />} />
          <Route path="/inventory" element={<InventoryPage data={data} user={user} onAdd={() => setModal('material')} onPurchase={() => setModal('purchase')} onIssue={() => setModal('issue')} onOtherInvoice={() => setModal('other-invoice')} onRefresh={refresh} notify={notify} />} />
          <Route path="/finance" element={<FinancePage user={user} data={data} notify={notify} onCreateSale={() => setModal('sale')} onAddTreasury={() => setModal('treasury')} onAddFunding={() => setModal('funding')} onOtherInvoice={() => setModal('other-invoice')} onRecordReceipt={(invoice) => setModal({ type: 'receipt', invoice })} onCorrectPurchase={(invoice) => setModal({ type: 'purchase-correction', invoice })} />} />
          <Route path="/accounting" element={<AccountingPage apiClient={api} data={data} notify={notify} onRefresh={refresh} />} />
          <Route path="/archive" element={<ReportsPage data={data} />} />
          <Route path="/analysis" element={<ArchiveAnalysisPage data={data} apiClient={api} onProcessMissing={(area) => setModal({
            type: 'order', initialType: 'maintenance', initialMachines: area.missing_machines,
          })} />} />
           <Route path="/settings" element={<SettingsPage data={data} apiClient={api} onRefresh={refresh} notify={notify} />} />
            <Route path="/users" element={<UsersPage user={user} apiClient={api} onCreate={() => setModal('user')} notify={notify} />} />
            <Route path="/employees" element={<EmployeesPage apiClient={api} onRefresh={refresh} notify={notify} />} />
            <Route path="/workers" element={<Navigate to="/employees" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </main>
    {modal && (isOrderModal(modal)
      ? <OrderFormModal key={(typeof modal === 'string' ? modal : modal.type) + '-' + (typeof modal === 'object' ? modal.order?.id || '' : '')} modal={modal} data={data} apiClient={api} onClose={() => setModal(null)} onRefresh={refresh} onOrderUpdated={async (id) => setSelectedOrder(normalizeOrderAreas(await api(`/orders/${id}`)))} notify={notify} />
      : <ModalHost key={`${typeof modal === 'string' ? modal : modal.type}:${typeof modal === 'object' ? modal.order?.id || '' : ''}`} modal={modal} setModal={setModal} data={data} onRefresh={refresh} run={run} notify={notify} />)}
    {commandOpen && <CommandPalette data={data} onClose={() => setCommandOpen(false)} onSelect={(item) => {
      setCommandOpen(false)
      if (item.kind === 'order') openOrder(item.record)
      else {
        const target = item.kind === 'client' ? 'clients' : 'machines'
        navigate(target)
        setSearch(item.query)
      }
    }} />}
    {lightbox && <Lightbox lightbox={lightbox} onClose={() => setLightbox(null)} onChange={(photo) => setLightbox((current) => current && ({ ...current, photo }))} />}
    {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    {busy && <div className="busy-line" />}
  </div>
}

function AuthScreen({ needsSetup, onSubmit, busy, toast }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event) => {
    event.preventDefault()
    onSubmit({ fullName, username, password }, needsSetup)
  }
  return <div className="auth-screen" dir="rtl">
    <div className="auth-art"><div className="art-glow" /><div className="brand-lockup auth-brand"><div className="brand-mark"><Activity size={22} /></div><div><strong>مَدَار</strong><span>منظومة التشغيل والصيانة</span></div></div><div className="art-copy"><div className="eyebrow"><Sparkles size={15} /> منظومة أعمال متكاملة</div><h1>كل تفاصيل<br />التشغيل في <em>مكان واحد.</em></h1><p>من إدارة العملاء وأوامر التشغيل إلى أرشفة الصور ومتابعة المخزون — ببيانات محلية تبقى تحت سيطرتك.</p><div className="art-stats"><div><strong>١٠٠٪</strong><span>تخزين محلي</span></div><i /><div><strong>٤</strong><span>أدوار وصلاحيات</span></div><i /><div><strong>٢٤/٧</strong><span>جاهز للعمل</span></div></div></div><div className="art-lines"><span /><span /><span /></div><div className="art-footer">MADAR OPERATIONS SUITE <span>•</span> v1.0</div></div>
    <div className="auth-panel"><div className="auth-form-wrap"><div className="auth-kicker">{needsSetup ? 'إعداد النظام للمرة الأولى' : 'مرحبًا بعودتك'}</div><h2>{needsSetup ? 'أنشئ حساب المدير' : 'تسجيل الدخول'}</h2><p className="auth-subtitle">{needsSetup ? 'سيكون هذا الحساب هو المدير العام للنظام.' : 'أدخل بيانات حسابك للوصول إلى مساحة العمل.'}</p>
      <form onSubmit={submit} className="stack-form">{needsSetup && <Field label="الاسم الكامل"><input required autoFocus value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="مثال: أحمد محمد" /></Field>}<Field label="اسم المستخدم"><input required autoFocus={!needsSetup} minLength={3} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="أدخل اسم المستخدم" /></Field><Field label="كلمة المرور"><input required minLength={needsSetup ? 10 : 1} type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={needsSetup ? '١٠ أحرف على الأقل' : 'أدخل كلمة المرور'} /></Field><button className="button button-primary button-wide" disabled={busy}>{busy ? 'جارٍ التحقق...' : needsSetup ? 'إنشاء حساب المدير' : 'دخول إلى النظام'}<ArrowLeft size={17} /></button></form>
      <div className="auth-security"><ShieldCheck size={17} /><span>اتصال محلي محمي — بياناتك لا تغادر جهازك</span></div><div className="auth-copyright">© ٢٠٢٦ مَدَار لإدارة التشغيل والصيانة</div>{toast && <div className="inline-error">{toast}</div>}</div></div>
  </div>
}

function CommandPalette({ data, onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const results = useMemo(() => {
    const items = [
      ...data.clients.map((record) => ({ kind: 'client', record, title: record.name, detail: `${record.code} · عميل`, query: record.code })),
      ...data.machines.map((record) => ({ kind: 'machine', record, title: record.nameAr, detail: `${record.code} · ${record.area || 'ماكينة'}`, query: record.code })),
      ...data.orders.map((record) => ({ kind: 'order', record, title: record.code, detail: `${record.clientName} · ${record.type === 'maintenance' ? 'صيانة' : 'تشغيل'}`, query: record.code })),
    ]
    const normalized = query.trim().toLocaleLowerCase('ar')
    return items.filter((item) => !normalized || `${item.title} ${item.detail} ${item.query}`.toLocaleLowerCase('ar').includes(normalized)).slice(0, 12)
  }, [data, query])
  useEffect(() => setActiveIndex(0), [query])
  const chooseActive = () => results[activeIndex] && onSelect(results[activeIndex])
  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="البحث السريع">
      <div className="command-search"><Search size={20}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, results.length - 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)) }
        if (event.key === 'Enter') { event.preventDefault(); chooseActive() }
      }} placeholder="ابحث عن عميل أو ماكينة أو أمر برقم الكود..."/><kbd>ESC</kbd><button className="icon-button" onClick={onClose} aria-label="إغلاق البحث"><X size={17}/></button></div>
      <div className="command-results" role="listbox">{results.map((item, index) => {
        const Icon = item.kind === 'client' ? Building2 : item.kind === 'machine' ? HardDrive : ClipboardList
        return <button key={`${item.kind}-${item.record.id}`} role="option" aria-selected={activeIndex === index} className={`command-result ${activeIndex === index ? 'command-result-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(item)}><span className="command-result-icon"><Icon size={17}/></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowLeft size={15}/></button>
      })}{!results.length&&<div className="command-empty">لا توجد نتائج مطابقة.</div>}</div>
      <div className="command-footer"><span>↑ ↓ للتنقل</span><span>Enter للفتح</span><span>بحث في العملاء والماكينات والأوامر</span></div>
    </section>
  </div>
}

function Lightbox({ lightbox, onClose, onChange }) {
  const currentIndex = Math.max(0, lightbox.photos.indexOf(lightbox.photo))
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onChange(lightbox.photos[Math.min(currentIndex + 1, lightbox.photos.length - 1)])
      if (event.key === 'ArrowLeft') onChange(lightbox.photos[Math.max(currentIndex - 1, 0)])
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentIndex, lightbox.photos, onChange, onClose])
  return <div className="lightbox-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="lightbox-dialog" role="dialog" aria-modal="true" aria-label="معاينة الصورة">
      <header><span>{lightbox.side === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'} · {currentIndex + 1} / {lightbox.photos.length}</span><button className="icon-button" onClick={onClose} aria-label="إغلاق المعاينة"><X size={20}/></button></header>
      <div className="lightbox-image-wrap"><button className="lightbox-nav" disabled={currentIndex === 0} onClick={() => onChange(lightbox.photos[currentIndex - 1])} aria-label="الصورة السابقة"><ArrowLeft size={22}/></button><div className="lightbox-rotator"><img className="lightbox-image" src={fileUrl(lightbox.photo)} alt="معاينة الصورة الأصلية"/></div><button className="lightbox-nav" disabled={currentIndex >= lightbox.photos.length - 1} onClick={() => onChange(lightbox.photos[currentIndex + 1])} aria-label="الصورة التالية"><ArrowLeft size={22}/></button></div>
      <footer>يتم تحميل الأصل بالحجم الكامل للمعاينة فقط، وتُستخدم الصورة المصغرة في قائمة الصور.</footer>
    </section>
  </div>
}

function Overview({ data, user, onNavigate, onOpenOrder }) {
  const stats = [
    { label: 'إجمالي العملاء', value: data.stats.clients, sub: 'ملفات العملاء النشطة', icon: Building2, color: 'blue', link: 'clients' },
    { label: 'أوامر قيد التنفيذ', value: data.stats.activeOrders, sub: `${data.stats.pendingReview} بانتظار الاعتماد`, icon: ClipboardList, color: 'orange', link: 'orders' },
    { label: 'الماكينات المسجلة', value: data.stats.machines, sub: 'ضمن قاعدة البيانات', icon: HardDrive, color: 'green', link: 'machines' },
    { label: 'أصناف تحتاج متابعة', value: data.stats.lowStock, sub: 'وصلت حد إعادة الطلب', icon: Package, color: 'purple', link: 'inventory' },
  ]
  const orders = data.orders.filter((order) => order.status !== 'archived').slice(0, 5)
  return <div className="page-enter">
    <section className="welcome-banner"><div className="welcome-copy"><div className="eyebrow"><span className="live-dot" /> مساحة تشغيل موحدة</div><h2>أهلًا، {user.fullName.split(' ')[0]} <span className="wave">✦</span></h2><p>نظرة سريعة على أداء التشغيل والصيانة اليوم.</p><button className="button button-white" onClick={() => onNavigate(user.role === 'purchasing' ? 'inventory' : 'orders')}>استكشف أوامر التشغيل <ArrowLeft size={16} /></button></div><div className="welcome-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="dashboard-illustration"><div className="illustration-top"><span/><span/><span/></div><div className="illustration-body"><div className="illustration-side"/><div className="illustration-content"><i/><i/><div><b/><b/><b/><b/></div></div></div><div className="illustration-check"><Check size={16}/></div></div><div className="welcome-spark spark-a">✳</div><div className="welcome-spark spark-b">✦</div></div><div className="banner-index">01 <i /> OVERVIEW</div></section>
    <section className="stats-grid">{stats.map((item) => { const Icon = item.icon; return <button key={item.label} className="stat-card" onClick={() => onNavigate(item.link)}><div className={`stat-icon ${item.color}`}><Icon size={19}/></div><div className="stat-meta"><span>{item.label}</span><small>{item.sub}</small></div><strong className="stat-value">{item.value}</strong><span className="stat-arrow"><ArrowUpRight size={16}/></span></button> })}</section>
    <section className="content-grid overview-grid"><div className="panel recent-panel"><div className="panel-heading"><div><span className="section-eyebrow">متابعة العمل</span><h3>أحدث أوامر التشغيل</h3></div><button className="text-button" onClick={() => onNavigate('orders')}>عرض الكل <ArrowLeft size={15}/></button></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>رقم الأمر</th><th>العميل</th><th>النوع</th><th>الحالة</th><th>التاريخ</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id} onClick={() => onOpenOrder(order)} className="clickable-row"><td><strong className="code-cell">{order.code}</strong></td><td>{order.clientName}</td><td>{order.type === 'maintenance' ? 'صيانة' : 'تشغيل'}</td><td><StatusBadge status={order.status}/></td><td>{date(order.createdAt)}</td><td><ArrowLeft size={14} className="muted"/></td></tr>)}</tbody></table></div> : <EmptyState icon={ClipboardList} title="لا توجد أوامر بعد" description="أنشئ أول أمر تشغيل لبدء متابعة العمل." action={<button className="button button-primary button-small" onClick={() => onNavigate('orders')}>الذهاب للأوامر</button>} />}</div>
      <div className="panel quick-panel"><div className="panel-heading"><div><span className="section-eyebrow">وصول سريع</span><h3>اختصارات العمل</h3></div><div className="panel-icon"><Sparkles size={18}/></div></div><div className="quick-list"><QuickAction icon={Building2} label="إضافة عميل جديد" detail="إنشاء ملف ومجلد عميل" onClick={() => onNavigate('clients')}/><QuickAction icon={ClipboardList} label="إنشاء أمر تشغيل" detail="ابدأ أمرًا جديدًا" onClick={() => onNavigate('orders')}/><QuickAction icon={HardDrive} label="تحديث الماكينات" detail="استيراد ملف بيانات" onClick={() => onNavigate('machines')}/><QuickAction icon={Boxes} label="متابعة المخزون" detail={`${data.stats.lowStock} أصناف منخفضة`} onClick={() => onNavigate('inventory')}/></div><div className="local-note"><ShieldCheck size={16}/><span>تتم معالجة ملفاتك محليًا، وتبقى الصور داخل مجلد التخزين الآمن.</span></div></div></section>
    <div className="bottom-meta"><span><Activity size={14}/> مَدَار — منصة إدارة التشغيل والصيانة</span><span>قاعدة البيانات محلية وكلمات المرور محفوظة بتجزئة آمنة</span>{user.role==='admin'&&<span>هامش الربح المتوقع: {money(data.stats.totalProfit)} ج.م</span>}</div>
  </div>
}

function ClientsPage({ data, search, setSearch, onCreate, onRefresh, notify }) {
  const [logoBusy, setLogoBusy] = useState(null)
  const clients = data.clients.filter((client) => `${client.name} ${client.code} ${client.phone}`.toLowerCase().includes(search.toLowerCase()))
  const uploadLogo = async (clientId, file) => {
    if (!file) return
    setLogoBusy(clientId)
    try { const form = new FormData(); form.append('logo', file); await api(`/clients/${clientId}/logo`, { method: 'POST', body: form }); await onRefresh(); notify('تم تحديث شعار العميل.') }
    catch (error) { notify(error.message) } finally { setLogoBusy(null) }
  }
  return <div className="page-enter"><PageHeading eyebrow="إدارة العلاقات" title="العملاء" description="ملفات العملاء وهوياتهم البصرية في مكان واحد." action={<button className="button button-primary" onClick={onCreate}><Plus size={17}/> إضافة عميل</button>} /><div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم العميل أو الكود..."/><span className="result-count">{clients.length} عميل</span></div>{clients.length ? <div className="client-grid">{clients.map((client) => <article className="client-card" key={client.id}><div className="client-card-top"><div className="client-logo" style={{ backgroundColor: `${client.primaryColor}12`, color: client.primaryColor }}>{client.logoPath ? <img src={fileUrl(client.logoPath)} alt=""/> : client.name.slice(0, 1)}</div><span className="client-code">{client.code}</span><label className="logo-upload" title="رفع شعار"><ImagePlus size={15}/><input type="file" accept="image/*" onChange={(event) => uploadLogo(client.id, event.target.files?.[0])}/></label></div><h3>{client.name}</h3><p>{client.contactName || 'لا يوجد مسؤول اتصال'}</p><div className="client-meta"><span><ArrowDownLeft size={14}/>{client.phone || '—'}</span><span className="color-dots"><i style={{ background: client.primaryColor }}/><i style={{ background: client.secondaryColor }}/></span></div><div className="client-card-footer"><span><HardDrive size={14}/> مجلد العميل جاهز</span><span>{data.orders.filter((order) => order.clientId === client.id).length} أوامر</span></div>{logoBusy === client.id && <div className="card-uploading">جارٍ رفع الشعار...</div>}</article>)}</div> : <EmptyState icon={Building2} title="لا يوجد عملاء مطابقون" description="أضف عميلًا جديدًا أو غيّر كلمات البحث." action={<button className="button button-primary button-small" onClick={onCreate}><Plus size={15}/> إضافة عميل</button>}/>}</div>
}

function OrderDetail({ order, data, user, onBack, onRefresh, onEdit, onDelete, notify, onPreview, onAddMachine, onIssue }) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [draggingFolder, setDraggingFolder] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [machineAreas, setMachineAreas] = useState([])
  const [selectedAreas, setSelectedAreas] = useState([])
  const [areasLoading, setAreasLoading] = useState(true)
  const [areasLoadError, setAreasLoadError] = useState('')
  const [processingFolder, setProcessingFolder] = useState('')
  const [processingProgress, setProcessingProgress] = useState(0)
  const [processingJobId, setProcessingJobId] = useState('')
  const [addingAreaMachines, setAddingAreaMachines] = useState(false)
  const [machineSearch, setMachineSearch] = useState({})
  const [machineSelections, setMachineSelections] = useState({})
  const [bindingFolders, setBindingFolders] = useState({})
  const [boundFolderIds, setBoundFolderIds] = useState([])
  const [eradicatedFolderIds, setEradicatedFolderIds] = useState([])
  const [eradicatingFolders, setEradicatingFolders] = useState({})
  const [excludingCards, setExcludingCards] = useState({})
  const [eradicatingCards, setEradicatingCards] = useState({})
  const [excludedCardIds, setExcludedCardIds] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [orderHistory, setOrderHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const canOperate = ['admin','operations'].includes(user.role)
  const canIssue = ['admin','operations','purchasing'].includes(user.role)
  const canEditOrder = ['admin','sales','operations'].includes(user.role)
  const hasStorageClient = Boolean(order.client?.id && String(order.client?.code || '').trim() && String(order.client?.name || '').trim())
  const requireStorageClient = () => {
    if (hasStorageClient) return true
    notify('يجب اختيار العميل لتكوين مسار الحفظ الصحيح')
    return false
  }
  useEffect(() => {
    let active = true
    api('/machines/areas').then((areas) => { if (active) setMachineAreas(areas) })
      .catch((error) => { if (active) { setAreasLoadError(error.message); notify(error.message) } })
      .finally(() => { if (active) setAreasLoading(false) })
    return () => { active = false }
  }, [])
  const loadOrderHistory = async () => {
    if (user.role !== 'admin') return
    setHistoryLoading(true)
    try { setOrderHistory(await api(`/orders/${order.id}/history`)) }
    catch (error) { notify(error.message || 'تعذر تحميل سجل الأمر.') }
    finally { setHistoryLoading(false) }
  }
  useEffect(() => {
    let active = true
    if (user.role === 'admin') {
      setHistoryLoading(true)
      api(`/orders/${order.id}/history`).then((rows) => { if (active) setOrderHistory(rows) })
        .catch((error) => { if (active) notify(error.message || 'تعذر تحميل سجل الأمر.') })
        .finally(() => { if (active) setHistoryLoading(false) })
    } else setOrderHistory([])
    return () => { active = false }
  }, [order.id, order.updatedAt, user.role])
  useEffect(() => {
    setMachineSearch({})
    setMachineSelections({})
    setBindingFolders({})
    setBoundFolderIds([])
    setEradicatedFolderIds([])
    setEradicatingFolders({})
    setExcludingCards({})
    setEradicatingCards({})
    setExcludedCardIds([])
    setProcessingFolder('')
    setProcessingProgress(0)
    setProcessingJobId('')
    setUploading(false)
  }, [order.id])
  useEffect(() => {
    let active = true
    api(`/orders/${order.id}/processing-status`).then(async (status) => {
      if (!active) return
      if (status.status === 'processing') {
        setUploading(true)
        setProcessingFolder(status.sourceFolder || 'مجلد الصور')
        setProcessingProgress(status.percentage || 0)
        setProcessingJobId(status.jobId || '')
      } else if (status.status === 'completed') {
        await onRefresh()
      } else if (status.status === 'failed') {
        notify(status.error || 'تعذرت معالجة مجلد الصور.')
      }
    }).catch(() => {})
    return () => { active = false }
  }, [order.id])
  useEffect(() => {
    if (!processingJobId) return undefined
    let active = true
    let inFlight = false
    const pollStatus = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const status = await api(`/orders/${order.id}/processing-status`)
        if (!active) return
        if (status.status === 'processing') {
          setProcessingFolder(status.sourceFolder || 'مجلد الصور')
          setProcessingProgress(status.percentage || 0)
          return
        }
        setProcessingJobId('')
        setProcessingFolder('')
        setUploading(false)
        if (status.status === 'completed') {
          setProcessingProgress(100)
          await onRefresh()
          const result = status.result || {}
          notify(`تمت معالجة مجلد ${status.sourceFolder || 'الصور'}: ${result.received || 0} صورة، ومطابقة ${result.cards || 0} ماكينة.`)
        } else if (status.status === 'failed') {
          notify(status.error || 'تعذرت معالجة مجلد الصور.')
        } else {
          await onRefresh()
        }
      } catch {
        // Keep polling through transient network failures; the server task keeps running.
      } finally {
        inFlight = false
      }
    }
    const interval = setInterval(pollStatus, 1200)
    pollStatus()
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [order.id, processingJobId])
  const uploadArea = async (files, relativePaths = []) => {
    if (!files?.length || processingJobId) return
    if (!requireStorageClient()) return
    setUploading(true)
    setUploadProgress(0)
    try {
      const form = new FormData()
      Array.from(files).forEach((file, index) => { form.append('files', file); form.append('paths', relativePaths[index] || file.webkitRelativePath || file.name) })
      const result = await uploadWithProgress(`/api/orders/${order.id}/area`, form, setUploadProgress, crypto.randomUUID())
      await onRefresh()
      notify(`تم استلام ${result.received} صورة ومطابقة ${result.cards} ماكينة.`)
    } catch (error) { notify(error.message) } finally { setUploading(false) }
  }
  const openServerFolderPicker = async () => {
    if (!requireStorageClient()) return
    if (processingJobId) return
    if (!selectedAreas.length) { notify('اختر منطقة واحدة على الأقل قبل اختيار مجلد الصور.'); return }
    setFolderPickerOpen(true)
  }
  const insertAllAreaMachines = async () => {
    if (!canOperate || !selectedAreas.length || addingAreaMachines) return
    setAddingAreaMachines(true)
    try {
      const query = selectedAreas.map((area) => `areas=${encodeURIComponent(area)}`).join('&')
      const machines = await api(`/machines/by-areas?${query}`)
      const activeCards = new Map(order.cards.map((card) => [Number(card.machineId), card]))
      const restoredIds = new Set()
      let added = 0
      let restored = 0
      let alreadyPresent = 0
      const errors = []
      for (const machine of machines) {
        const existingCard = activeCards.get(Number(machine.id))
        if (existingCard && !excludedCardIds.includes(existingCard.id)) {
          alreadyPresent += 1
          continue
        }
        try {
          const result = await api(`/orders/${order.id}/cards`, { method: 'POST', body: json({ machineId: machine.id }) })
          if (result.id) restoredIds.add(result.id)
          if (result.restored) restored += 1
          else added += 1
        } catch (error) {
          if (error.status === 409) alreadyPresent += 1
          else errors.push(`${machine.code}: ${error.message}`)
        }
      }
      if (restoredIds.size) setExcludedCardIds((current) => current.filter((id) => !restoredIds.has(id)))
      await onRefresh()
      const resultMessage = `تم إدراج ${added} ماكينة بلا صور، واستعادة ${restored} بطاقة مستبعدة، والماكينات الموجودة مسبقًا: ${alreadyPresent}.`
      notify(errors.length ? `${resultMessage} تعذر إدراج ${errors.length} ماكينة.` : resultMessage)
      if (errors.length) console.error('Failed inserting selected-area machines:', errors)
    } catch (error) {
      notify(error.message)
    } finally {
      setAddingAreaMachines(false)
    }
  }
  const processServerFolder = async (folderPath) => {
    if (!requireStorageClient()) return
    if (processingJobId) return
    setFolderPickerOpen(false)
    setProcessingFolder(folderPath)
    setProcessingProgress(0)
    setUploading(true)
    try {
      const result = await api('/process-area', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: json({ orderId: order.id, folderPath, areas: selectedAreas }),
      })
      if (result.status === 'processing' && result.jobId) {
        setProcessingProgress(result.percentage || 0)
        setProcessingJobId(result.jobId)
        return
      }
      await onRefresh()
      notify(`تمت معالجة مجلد ${folderPath}: ${result.received || 0} صورة، ومطابقة ${result.cards || 0} ماكينة.`)
      setProcessingFolder('')
      setUploading(false)
    } catch (error) {
      try {
        const status = await api(`/orders/${order.id}/processing-status`)
        if (status.status === 'processing' && status.jobId) {
          setProcessingFolder(status.sourceFolder || folderPath)
          setProcessingProgress(status.percentage || 0)
          setProcessingJobId(status.jobId)
          return
        }
      } catch { /* preserve the original request error */ }
      setProcessingFolder('')
      setUploading(false)
      notify(error.message)
    }
  }
  const dropFolder = async (event) => {
    event.preventDefault()
    setDraggingFolder(false)
    if (!canOperate || uploading || processingJobId) return
    try {
      const files = await collectDroppedFiles(event.dataTransfer)
      await uploadArea(files.map((item) => item.file), files.map((item) => item.path))
    } catch (error) { notify(error.message || 'تعذر قراءة المجلد المسحوب.') }
  }
  const saveCard = async (cardId, patch) => {
    try { await api(`/orders/${order.id}/cards/${cardId}`, { method: 'PATCH', body: json(patch) }); await onRefresh(); return true }
    catch (error) { notify(error.message); return false }
  }
  const removePhoto = async (card, photoPath) => {
    return removePhotos(card, [photoPath])
  }
  const removePhotos = async (card, photoPaths) => {
    if (!photoPaths.length) return
    try {
      await api(`/orders/${order.id}/cards/${card.id}/photos`, { method:'DELETE', body:json({paths:photoPaths}) })
      await onRefresh()
      notify(photoPaths.length === 1 ? 'تم حذف الصورة.' : `تم حذف ${photoPaths.length} صور.`)
      return true
    }
    catch(error){notify(error.message); return false}
  }
  const movePhotos = (card, photoPaths, targetSide) => {
    const moving = new Set(photoPaths)
    if (targetSide === 'before') {
      const beforePhotos = [
        ...card.beforePhotos.filter((photo) => !moving.has(photo)),
        ...card.beforePhotos.filter((photo) => moving.has(photo)),
        ...card.afterPhotos.filter((photo) => moving.has(photo)),
      ]
      const afterPhotos = card.afterPhotos.filter((photo) => !moving.has(photo))
      return saveCard(card.id, { beforePhotos, afterPhotos })
    }
    const afterPhotos = [
      ...card.afterPhotos.filter((photo) => !moving.has(photo)),
      ...card.afterPhotos.filter((photo) => moving.has(photo)),
      ...card.beforePhotos.filter((photo) => moving.has(photo)),
    ]
    const beforePhotos = card.beforePhotos.filter((photo) => !moving.has(photo))
    return saveCard(card.id, { beforePhotos, afterPhotos })
  }
  const archive = async () => {
    if (!requireStorageClient()) return
    if (!window.confirm('سيتم حفظ صور هذا الأمر في أرشيفه داخل مجلد العميل. هل تريد المتابعة؟')) return
    try { await api(`/orders/${order.id}/archive`, {method:'POST'}); notify('تم اعتماد الأمر ونقله إلى الأرشيف.'); onBack() }
    catch(error){notify(error.message)}
  }
  const deleteOrder = async () => {
    setDeleting(true)
    try {
      const result = await api(`/orders/${order.id}`, { method: 'DELETE' })
      notify(result.storageRemoved
        ? 'تم حذف مجلد الأمر وملفاته من التخزين، مع الاحتفاظ بسجل الحذف لأغراض التدقيق.'
        : 'تم إخفاء الأمر مع الاحتفاظ بسجل الحذف؛ لم يكن له مجلد ملفات في التخزين.')
      setConfirmDelete(false)
      await onDelete()
    } catch (error) { notify(error.message) }
    finally { setDeleting(false) }
  }
  const setReview = async () => {
    try { await api(`/orders/${order.id}/status`,{method:'PATCH',body:json({status:'review'})}); await onRefresh(); notify('تم إرسال الأمر للمراجعة.') }
    catch(error){notify(error.message)}
  }
  const bindFolder = async (folder, machine) => {
    if (!requireStorageClient()) return
    if (!canOperate || order.status === 'archived' || !machine || bindingFolders[folder.id]) return
    setBindingFolders((current) => ({ ...current, [folder.id]: true }))
    try {
      const result = await api('/storage/bind-folder', {
        method: 'POST', body: json({
          orderId: order.id, folderId: folder.id, originalFolderName: folder.name,
          originalFolderPath: folder.originalFolderPath, machineCode: machine.code,
        }),
      })
      setBoundFolderIds((current) => current.includes(folder.id) ? current : [...current, folder.id])
      setMachineSelections((current) => ({ ...current, [folder.id]: '' }))
      notify(`تمت إعادة تسمية المجلد إلى ${result.updatedFolderPath} وإضافة بطاقة ${result.machine.code}.`)
      await onRefresh()
      return result
    } catch (error) {
      notify(error?.message || 'تعذر ربط مجلد الصور.')
    } finally {
      setBindingFolders((current) => ({ ...current, [folder.id]: false }))
    }
  }
  const excludeMachine = async (card) => {
    if (!canOperate || order.status === 'archived' || excludingCards[card.id]) return
    if (!window.confirm(`استبعاد الماكينة ${card.machineCode} وصورها من هذا الأمر؟ ستبقى الصور محفوظة في التخزين ولن تدخل في المعالجة أو التصدير.`)) return
    setExcludingCards((current) => ({ ...current, [card.id]: true }))
    try {
      await api(`/orders/${order.id}/cards/${card.id}/exclude`, { method: 'POST' })
      setExcludedCardIds((current) => current.includes(card.id) ? current : [...current, card.id])
      notify(`تم استبعاد الماكينة ${card.machineCode} وصورها من الأمر.`)
      await onRefresh()
    } catch (error) {
      notify(error.message)
    } finally {
      setExcludingCards((current) => ({ ...current, [card.id]: false }))
    }
  }
  const eradicateUnknownFolder = async (folder) => {
    if (!canOperate || order.status === 'archived' || eradicatingFolders[folder.id]) return
    if (!window.confirm(`سيتم مسح مجلد «${folder.name}» وصوره نهائيًا من التخزين، مع الاحتفاظ بسجل الإزالة. لا يمكن التراجع عن حذف الملفات. هل تريد المتابعة؟`)) return
    setEradicatingFolders((current) => ({ ...current, [folder.id]: true }))
    try {
      await api('/machines/eradicate', {
        method: 'DELETE',
        body: json({ orderId: order.id, folderId: folder.id, folderPath: folder.originalFolderPath || '' }),
      })
      setEradicatedFolderIds((current) => current.includes(folder.id) ? current : [...current, folder.id])
      notify(`تم مسح مجلد «${folder.name}» وصوره نهائيًا.`)
      await onRefresh()
    } catch (error) {
      await onRefresh().catch(() => {})
      notify(error.message)
    } finally {
      setEradicatingFolders((current) => ({ ...current, [folder.id]: false }))
    }
  }
  const eradicateMachineCard = async (card) => {
    if (!canOperate || order.status === 'archived' || eradicatingCards[card.id]) return
    if (!window.confirm(`سيتم حذف صور الماكينة ${card.machineCode} من هذا الأمر نهائيًا، وإخفاء الماكينة من قاعدة الماكينات مع الاحتفاظ بسجلها التاريخي. لا يمكن استعادة الملفات. هل تريد المتابعة؟`)) return
    setEradicatingCards((current) => ({ ...current, [card.id]: true }))
    try {
      const result = await api('/machines/eradicate', {
        method: 'DELETE',
        body: json({ orderId: order.id, cardId: card.id, machineCode: card.machineCode }),
      })
      setExcludedCardIds((current) => current.includes(card.id) ? current : [...current, card.id])
      notify(`تمت إزالة الماكينة ${result.machineCode} من قاعدة الماكينات، ومسح صورها من هذا الأمر.`)
      await onRefresh()
    } catch (error) {
      await onRefresh().catch(() => {})
      notify(error.message)
    } finally {
      setEradicatingCards((current) => ({ ...current, [card.id]: false }))
    }
  }
  const filteredMachines = (query) => (data.machines || []).filter((machine) => (
    `${machine.code} ${machine.nameAr} ${machine.nameEn} ${machine.area}`
      .toLocaleLowerCase('ar').includes((query || '').trim().toLocaleLowerCase('ar'))
  )).slice(0, 8)
  const visibleUnrecognizedFolders = order.unrecognizedFolders.filter((folder) => !boundFolderIds.includes(folder.id) && !eradicatedFolderIds.includes(folder.id))
  const visibleCards = order.cards.filter((card) => !excludedCardIds.includes(card.id))
  return <div className="page-enter"><button className="back-link" onClick={onBack}><ArrowLeft size={16}/> العودة إلى الأوامر</button><div className="order-detail-heading"><div><div className="eyebrow">{order.code} <span className="eyebrow-dot"/> {order.client.name}</div><h2>تفاصيل الأمر</h2><p>{order.type==='maintenance'?'أمر صيانة':'أمر تشغيل'} · أنشئ في {date(order.createdAt)} · <StatusBadge status={order.status}/></p></div><div className="detail-actions">{canEditOrder&&<button className="button button-secondary" onClick={onEdit}><Pencil size={16}/> تعديل الأمر</button>}{user.role==='admin'&&<button className="button button-danger" onClick={()=>setConfirmDelete(true)}><Trash2 size={16}/> حذف الأمر</button>}{order.status!=='archived'&&canOperate&&<><button className="button button-secondary" onClick={onAddMachine}><Plus size={16}/> إضافة ماكينة</button>{order.status==='in_progress'&&<button className="button button-secondary" onClick={setReview}><CheckCircle2 size={16}/> إرسال للمراجعة</button>}{visibleCards.length>0&&<button className="button button-primary" onClick={archive}><Archive size={16}/> اعتماد وأرشفة</button>}</>}{order.status!=='archived'&&canIssue&&<button className="button button-secondary" onClick={onIssue}><ArrowUpRight size={16}/> صرف خامة لهذا الأمر</button>}</div></div>
    <div className="order-info-strip"><div><span>العميل</span><strong>{order.client.name} <small>{order.client.code}</small></strong></div><div><span>عدد الماكينات</span><strong>{visibleCards.length}</strong></div><div><span>التكلفة التقديرية</span><strong>{money(order.totalCost)} ج.م</strong></div><div><span>المنطقة</span><strong>{[...new Set(visibleCards.map((card)=>card.area).filter(Boolean))].join('، ')||'—'}</strong></div>{user.role==='admin'&&<><div><span>تكلفة الخامات التقديرية</span><strong>{money(order.materialCost)} ج.م</strong></div><div><span>تكلفة مواد FIFO الفعلية</span><strong>{money(order.actualMaterialCogs)} ج.م</strong></div><div><span>تكلفة التشغيل</span><strong>{money(order.operatingCost)} ج.م</strong></div><div><span>قيمة البيع</span><strong>{money(order.sellingPrice)} ج.م</strong></div><div><span>الربح المتوقع</span><strong className={order.profit>=0?'profit-positive':'profit-negative'}>{money(order.profit)} ج.م</strong></div></>}</div>
    {user.role==='admin'&&<section className="panel inventory-panel"><div className="panel-heading"><div><span className="section-eyebrow">تكلفة فعلية بقيمة FIFO</span><h3>صرف مواد الأمر</h3></div><span className="result-count">{money(order.actualMaterialCogs)} ج.م</span></div>{order.inventoryIssues?.length?<div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الخامة</th><th>المرجع</th><th>الكمية</th><th>قيمة الصرف</th><th>تكلفة الأمر</th><th>القيد</th></tr></thead><tbody>{order.inventoryIssues.map((issue)=><tr key={issue.id}><td>{date(issue.created_at)}</td><td>{issue.material_label||'—'}</td><td>{issue.reference||'—'}</td><td>{quantity(issue.requested_quantity)}</td><td>{money(issue.gross_cost_cents/100)} ج.م</td><td>{money(issue.cogs_cents/100)} ج.م</td><td>{issue.journal_status==='posted'?'مرحّل':issue.journal_status==='pending_configuration'?'بانتظار اعتماد الحساب':issue.journal_status||'دون تكلفة'}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لم يُسجل صرف مواد لهذا الأمر بعد.</div>}</section>}
     {canOperate&&order.status!=='archived'&&<section className={`upload-area panel ${draggingFolder?'upload-area-dragging':''} ${uploading?'upload-area-busy':''}`} onDragOver={(event)=>{event.preventDefault();if(!uploading)setDraggingFolder(true)}} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget))setDraggingFolder(false)}} onDrop={dropFolder}><div className="upload-icon"><CloudUpload size={22}/></div><div className="upload-copy"><h3>{processingFolder?`جارٍ معالجة ${processingFolder}`:draggingFolder?'أفلت المجلد لبدء الرفع':'إضافة صور المنطقة'}</h3><p>اختر المنطقة أولًا، ثم اختر مجلدًا محفوظًا على الخادم أو أفلت مجلدًا من جهازك.</p><span><FileImage size={14}/> صور JPG وPNG وWEBP · حتى 25MB للصورة</span>{uploading&&!processingFolder&&<div className="upload-progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin="0" aria-valuemax="100"><div><i style={{width:`${uploadProgress}%`}}/></div><strong>{uploadProgress}%</strong></div>}{processingFolder&&<span className="server-folder-processing"><RefreshCw size={14} className="spin"/> تتم قراءة الصور من مجلد الخادم...</span>}</div><div className="area-picker-control"><MachineAreaSelector areas={machineAreas} selectedAreas={selectedAreas} onChange={setSelectedAreas} loading={areasLoading} error={areasLoadError} disabled={uploading||addingAreaMachines}/><button type="button" className="button button-primary" disabled={uploading||addingAreaMachines||selectedAreas.length===0} onClick={openServerFolderPicker}>{uploading?<RefreshCw size={16} className="spin"/>:<Folder size={16}/>} {uploading?'جارٍ المعالجة...':'اختيار مجلد الصور'}</button>{canOperate&&<button type="button" className="button button-secondary insert-area-machines-button" disabled={uploading||addingAreaMachines||order.status==='archived'||selectedAreas.length===0} onClick={insertAllAreaMachines}>{addingAreaMachines?<RefreshCw size={15} className="spin"/>:<Plus size={15}/>} {addingAreaMachines?'جارٍ إدراج الماكينات...':'إدراج جميع ماكينات المنطقة'}</button>}</div></section>}
    {processingFolder&&<div className="server-folder-progress" role="status"><div className="server-folder-progress-label"><RefreshCw size={14} className="spin"/><span>تتم قراءة الصور من المجلد بنسبة {processingProgress}%</span></div><div className="upload-progress" role="progressbar" aria-valuenow={processingProgress} aria-valuemin="0" aria-valuemax="100"><div><i style={{width:`${processingProgress}%`}}/></div><strong>{processingProgress}%</strong></div></div>}
    {visibleUnrecognizedFolders.length > 0 && <section className="unrecognized-section">
      <div className="section-title-row"><div><span className="section-eyebrow">تحتاج مراجعة</span><h3>مجلدات غير معروفة <span className="count-badge">{visibleUnrecognizedFolders.length}</span></h3></div><p>ابحث عن كود الماكينة، راجع بياناتها، ثم اربط المجلد.</p></div>
      <div className="unrecognized-list">{visibleUnrecognizedFolders.map((folder) => {
        const query = String(machineSearch[folder.id] || '').trim()
        const exactCodeMatch = (data.machines || []).find((machine) => machine.code.toLocaleLowerCase('ar') === query.toLocaleLowerCase('ar'))
        const selectedMachine = (data.machines || []).find((machine) => String(machine.id) === String(machineSelections[folder.id] || '')) || exactCodeMatch
        const candidates = filteredMachines(query)
        return <div className="unrecognized-card" key={folder.id}>
          <div className="folder-symbol"><FileImage size={19}/></div>
          <div className="folder-info"><strong>{folder.name}</strong><span>{folder.imageCount} صورة · لم يتم التعرف على كود الماكينة</span></div>
          <div className="bind-control">
            <div className="bind-search-field"><Search size={15}/><input aria-label={'البحث عن ماكينة للمجلد ' + folder.name} placeholder="ابحث بالكود أو الاسم..." value={machineSearch[folder.id] || ''} onChange={(event) => {
              const value = event.target.value
              setMachineSearch((current) => ({ ...current, [folder.id]: value }))
              const exact = (data.machines || []).find((machine) => machine.code.toLocaleLowerCase('ar') === value.trim().toLocaleLowerCase('ar'))
              setMachineSelections((current) => ({ ...current, [folder.id]: exact ? String(exact.id) : '' }))
            }}/></div>
            <select aria-label="اختر الماكينة المراد ربطها" value={machineSelections[folder.id] || ''} disabled={!canOperate || order.status === 'archived' || bindingFolders[folder.id] || eradicatingFolders[folder.id]} onChange={(event) => setMachineSelections((current) => ({ ...current, [folder.id]: event.target.value }))}>
              <option value="">اختر الماكينة</option>{candidates.map((machine) => <option value={machine.id} key={machine.id}>{machine.code} — {machine.nameAr}</option>)}
            </select>
            {selectedMachine && <div className="folder-machine-preview" role="status"><strong>{selectedMachine.code} — {selectedMachine.nameAr}</strong><span>المنطقة: {selectedMachine.area || 'غير محددة'}</span></div>}
            {query && !selectedMachine && <span className="folder-machine-hint">{candidates.length ? 'اختر الماكينة من القائمة لعرض بياناتها.' : 'لا توجد ماكينة مطابقة.'}</span>}
             <button type="button" className="button button-primary bind-folder-button" disabled={!canOperate || order.status === 'archived' || !selectedMachine || Boolean(bindingFolders[folder.id]) || Boolean(eradicatingFolders[folder.id])} onClick={() => bindFolder(folder, selectedMachine)}>
               {bindingFolders[folder.id] ? <RefreshCw size={15} className="spin"/> : null}{bindingFolders[folder.id] ? 'جارٍ الربط...' : 'ربط'}
             </button>
             <button type="button" className="button button-danger button-small eradicate-folder-button" disabled={!canOperate || order.status === 'archived' || Boolean(eradicatingFolders[folder.id]) || Boolean(bindingFolders[folder.id])} onClick={() => eradicateUnknownFolder(folder)} title="حذف مجلد الصور نهائيًا">
               {eradicatingFolders[folder.id] ? <RefreshCw size={13} className="spin"/> : <Trash2 size={13}/>} {eradicatingFolders[folder.id] ? 'جارٍ المسح...' : 'حذف المجلد'}
             </button>
          </div>
        </div>
      })}</div>
    </section>}
     {visibleCards.length ? <div className="cards-stack"><div className="section-title-row cards-title"><div><span className="section-eyebrow">مراجعة الصور والإجراءات</span><h3>بطاقات الماكينات <span className="count-badge">{visibleCards.length}</span></h3></div><span className="drag-hint"><SlidersHorizontal size={15}/> اسحب صورة أو مجموعة بين العمودين · Shift للتحديد المتتابع</span></div>{visibleCards.map((card)=><MachineCard key={card.id} card={card} order={order} reasons={data.reasons} canOperate={canOperate&&order.status!=='archived'} saveCard={saveCard} removePhotos={removePhotos} movePhotos={movePhotos} onPreview={onPreview} onExclude={excludeMachine} excluding={Boolean(excludingCards[card.id])} onEradicate={eradicateMachineCard} eradicating={Boolean(eradicatingCards[card.id])}/>)}</div> : <EmptyState icon={HardDrive} title="لا توجد ماكينات مرتبطة بهذا الأمر" description="ارفع مجلد صور المنطقة أو أضف ماكينة يدويًا للبدء." action={canOperate&&order.status!=='archived'&&<button className="button button-secondary" onClick={onAddMachine}><Plus size={16}/> إضافة ماكينة</button>}/>}
       {user.role==='admin'&&<section className="panel order-history-panel"><div className="panel-heading"><div><span className="section-eyebrow">أثر التغييرات</span><h3>سجل الأمر</h3></div><button className="button button-ghost button-small" disabled={historyLoading} onClick={loadOrderHistory}><RefreshCw size={14} className={historyLoading?'spin':''}/> تحديث</button></div>{historyLoading&&!orderHistory.length?<div className="loading-inline">جارٍ تحميل السجل...</div>:orderHistory.length?<div className="order-history-list">{orderHistory.map((entry)=><article className="order-history-entry" key={entry.id}><div><strong>{entry.action} · {entry.entity}</strong><small>{entry.actor_name||'مستخدم محذوف'} · {entry.created_at}</small>{entry.details&&<span>{entry.details}</span>}</div>{(entry.old_values||entry.new_values)&&<details><summary>تفاصيل التغيير</summary><pre>{JSON.stringify({old:entry.old_values,new:entry.new_values},null,2)}</pre></details>}</article>)}</div>:<div className="empty-inline">لا توجد تغييرات مسجلة لهذا الأمر.</div>}</section>}
       {order.notes&&<div className="order-note"><CircleHelp size={16}/><span>{order.notes}</span></div>}{folderPickerOpen&&<AreaFileExplorerModal apiClient={api} onClose={()=>setFolderPickerOpen(false)} onSelect={processServerFolder}/>} {confirmDelete&&<div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&!deleting&&setConfirmDelete(false)}><section className="modal-card confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-order-title" dir="rtl"><div className="modal-header"><div><span className="section-eyebrow">إجراء لا يمكن التراجع عنه من الواجهة</span><h2 id="delete-order-title">تأكيد حذف الأمر</h2></div><button className="icon-button" disabled={deleting} onClick={()=>setConfirmDelete(false)} aria-label="إغلاق"><X size={19}/></button></div><div className="modal-form"><p>هل تريد حذف الأمر <strong>{order.code}</strong>؟ سيتم إخفاؤه من النظام دون مسح بياناته نهائيًا.</p><div className="modal-actions"><button type="button" className="button button-ghost" disabled={deleting} onClick={()=>setConfirmDelete(false)}>إلغاء</button><button type="button" className="button button-danger" disabled={deleting} onClick={deleteOrder}>{deleting?'جارٍ الحذف...':'حذف الأمر'} <Trash2 size={15}/></button></div></div></section></div>}</div>
}

function MachineCard({ card, order, reasons, canOperate, saveCard, removePhotos, movePhotos, onPreview, onExclude, excluding, onEradicate, eradicating }) {
  const [note, setNote] = useState(card.note || '')
  const [reasonIds, setReasonIds] = useState(card.reasonIds || [])
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const lastSelected = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const toggleReason = (id) => {
    const next = reasonIds.includes(id) ? reasonIds.filter((value)=>value!==id) : [...reasonIds,id]
    setReasonIds(next)
    saveCard(card.id,{reasonIds:next})
  }
  const togglePhotoSelection = (photo, side, extendRange = false) => {
    if (!canOperate) return
    setSelectedPhotos((current) => {
      const next = new Set(current)
      const previous = lastSelected.current
      const sidePhotos = side === 'before' ? card.beforePhotos : card.afterPhotos
      if (extendRange && previous?.side === side) {
        const start = sidePhotos.indexOf(previous.photo)
        const end = sidePhotos.indexOf(photo)
        if (start >= 0 && end >= 0) {
          sidePhotos.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => next.add(item))
        } else next.has(photo) ? next.delete(photo) : next.add(photo)
      } else next.has(photo) ? next.delete(photo) : next.add(photo)
      lastSelected.current = { photo, side }
      return [...next]
    })
  }
  const handleDragEnd = ({ active, over }) => {
    if (!over || !canOperate) return
    const payload = active.data.current
    const target = over.data.current
    if (!payload || !target || payload.cardId !== card.id || target.cardId !== card.id) return
    const photos = selectedPhotos.includes(payload.photo) ? selectedPhotos : [payload.photo]
    movePhotos(card, photos, target.side)
    setSelectedPhotos([])
    lastSelected.current = null
  }
  const moveSelected = async (side) => {
    if (!selectedPhotos.length) return
    const success = await movePhotos(card, selectedPhotos, side)
    if (success) { setSelectedPhotos([]); lastSelected.current = null }
  }
  const deleteSelected = async () => {
    if (!selectedPhotos.length || !window.confirm(`حذف ${selectedPhotos.length} صورة نهائيًا من منطقة العمل؟`)) return
    const success = await removePhotos(card, selectedPhotos)
    if (success) { setSelectedPhotos([]); lastSelected.current = null }
  }
  return <article className="machine-card"><div className="machine-card-head"><div className="machine-identity"><div className="machine-card-icon"><HardDrive size={18}/></div><div><h4>{card.nameAr} <span>{card.nameEn}</span></h4><div className="machine-subline"><MachineCode value={card.machineCode}/><span><MapPin size={13}/>{card.area||'منطقة غير محددة'}</span></div></div></div><div className="machine-card-head-actions">{card.beforePhotos.length+card.afterPhotos.length===0&&<span className="no-images-badge">لا توجد صور</span>}<span className="machine-images-count"><FileImage size={14}/>{card.beforePhotos.length+card.afterPhotos.length} صورة</span>{canOperate&&<button type="button" className="button button-small machine-exclude-button" disabled={excluding||eradicating} onClick={() => onExclude(card)} title="استبعاد الماكينة وصورها من هذا الأمر">{excluding ? <RefreshCw size={13} className="spin"/> : <Ban size={13}/>} {excluding ? 'جارٍ الاستبعاد...' : 'استبعاد'}</button>}{canOperate&&<button type="button" className="button button-small button-danger machine-eradicate-button" disabled={excluding||eradicating} onClick={() => onEradicate(card)} title="إزالة الماكينة ومسح صورها من هذا الأمر">{eradicating ? <RefreshCw size={13} className="spin"/> : <Trash2 size={13}/>} {eradicating ? 'جارٍ المسح...' : 'إزالة الماكينة'}</button>}</div></div>
    {selectedPhotos.length>0&&<div className="bulk-photo-actions"><strong>تم تحديد {selectedPhotos.length} صورة</strong><button className="button button-small button-secondary" onClick={()=>moveSelected('before')}>نقل إلى «قبل»</button><button className="button button-small button-secondary" onClick={()=>moveSelected('after')}>نقل إلى «بعد»</button><button className="button button-small button-danger" onClick={deleteSelected}><Trash2 size={14}/> حذف المحدد</button><button className="text-button" onClick={()=>setSelectedPhotos([])}>إلغاء التحديد</button></div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}><div className="before-after-grid"><PhotoColumn cardId={card.id} side="before" photos={card.beforePhotos} canOperate={canOperate} selectedPhotos={selectedPhotos} onToggleSelection={togglePhotoSelection} onRemove={(photo)=>removePhotos(card,[photo])} onPreview={onPreview}/><PhotoColumn cardId={card.id} side="after" photos={card.afterPhotos} canOperate={canOperate} selectedPhotos={selectedPhotos} onToggleSelection={togglePhotoSelection} onRemove={(photo)=>removePhotos(card,[photo])} onPreview={onPreview}/></div></DndContext>
     <div className="machine-card-footer"><div className="reason-control"><span className="field-caption">أسباب الصيانة</span>{reasons.length?<details className="reason-multiselect"><summary><span>{reasonIds.length ? `${reasonIds.length} أسباب محددة` : 'اختر سببًا أو أكثر'}</span><ChevronDown size={14}/></summary><div className="reason-options">{reasons.map((reason)=><button type="button" key={reason.id} disabled={!canOperate} onClick={()=>toggleReason(reason.id)} className={`reason-tag ${reasonIds.includes(reason.id)?'reason-selected':''}`}>{reasonIds.includes(reason.id)&&<Check size={12}/>} {reason.label}</button>)}</div></details>:<small className="muted">لا توجد أسباب مضافة</small>}</div><div className="note-control"><label className="field-caption" htmlFor={`note-${card.id}`}>ملاحظات فنية (داخلية)</label><textarea id={`note-${card.id}`} disabled={!canOperate} maxLength={2000} value={note} onChange={(event)=>setNote(event.target.value)} onBlur={()=>note!==String(card.note || '')&&saveCard(card.id,{note})} placeholder="ملاحظة داخلية لا تظهر في تقارير العميل..." rows="2"/></div></div>
  </article>
}

function PhotoColumn({ cardId, side, photos, canOperate, selectedPhotos, onToggleSelection, onRemove, onPreview }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${cardId}-${side}`, data: { cardId, side } })
  const before = side === 'before'
  return <div ref={setNodeRef} className={`photo-column ${isOver ? 'photo-column-over' : ''}`}>
    <div className={`photo-column-heading ${before ? 'before-heading' : 'after-heading'}`}><span><i/>{before ? 'قبل الصيانة' : 'بعد الصيانة'}</span><small>{photos.length} صور</small></div>
    {photos.length ? <VirtualPhotoGrid cardId={cardId} side={side} photos={photos} canOperate={canOperate} selectedPhotos={selectedPhotos} onToggleSelection={onToggleSelection} onRemove={onRemove} onPreview={onPreview}/> : <div className="photo-empty">{canOperate ? 'اسحب الصور إلى هنا' : 'لا توجد صور'}<ImagePlus size={18}/></div>}
  </div>
}

function VirtualPhotoGrid({ cardId, side, photos, canOperate, selectedPhotos, onToggleSelection, onRemove, onPreview }) {
  const scrollRef = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const columns = Math.max(1, Math.floor((width + 7) / 81))
  const rowCount = Math.ceil(photos.length / columns)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 111,
    overscan: 1,
  })
  const height = Math.min(260, rowCount * 111)
  return <div className="photo-grid-scroll" ref={scrollRef} style={{ height }}>
    <div className="photo-grid-virtual" style={{ height: virtualizer.getTotalSize(), '--photo-columns': columns }}>
      {virtualizer.getVirtualItems().map((row) => <div className="photo-grid-row" key={row.key} style={{ transform: `translateY(${row.start}px)` }}>
        {photos.slice(row.index * columns, (row.index + 1) * columns).map((photo) => <PhotoTile key={photo} cardId={cardId} side={side} photo={photo} canOperate={canOperate} selected={selectedPhotos.includes(photo)} onToggleSelection={onToggleSelection} onRemove={onRemove} onPreview={() => onPreview(photo, side, photos)}/>) }
      </div>)}
    </div>
  </div>
}

function PhotoTile({ cardId, side, photo, canOperate, selected, onToggleSelection, onRemove, onPreview }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: photo, data: { cardId, side, photo }, disabled: !canOperate })
  return <div ref={setNodeRef} className={`photo-thumb ${selected ? 'photo-thumb-selected' : ''} ${isDragging ? 'photo-thumb-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform) }} {...attributes} {...listeners} onClick={(event) => { if (event.shiftKey && canOperate) onToggleSelection(photo, side, true); else onPreview() }} title="انقر لمعاينة الصورة بالحجم الكامل">
    <img className="photo-rotated" src={thumbnailUrl(photo)} alt="معاينة صورة ماكينة" loading="lazy" decoding="async"/>
    <div className="photo-overlay"><button type="button" className={`photo-select ${selected ? 'photo-select-active' : ''}`} aria-label={selected ? 'إلغاء تحديد الصورة' : 'تحديد الصورة'} aria-pressed={selected} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onToggleSelection(photo, side, event.shiftKey) }}>{selected && <Check size={13}/>}</button>{canOperate&&<button type="button" className="photo-delete" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(photo) }} title="حذف الصورة"><Trash2 size={14}/></button>}</div>
  </div>
}

function InventoryPage({ data, user, onAdd, onPurchase, onIssue, onOtherInvoice, onRefresh, notify }) {
  const canManage=['admin','purchasing'].includes(user.role)
  const isAdmin=user.role==='admin'
  const [importing,setImporting]=useState(false)
  const [movements,setMovements]=useState([])
  const [stockCounts,setStockCounts]=useState([])
  const [activeCount,setActiveCount]=useState(null)
  const [countItems,setCountItems]=useState([])
  const [countReason,setCountReason]=useState('')
  const [otherInvoices,setOtherInvoices]=useState([])
  const [selectedCountMaterialIds,setSelectedCountMaterialIds]=useState([])
  const [countBusy,setCountBusy]=useState(false)
  const importRef=useRef(null)
  const low=data.materials.filter((material)=>material.stock+material.subStock<=material.minStock)
  useEffect(()=>{api('/inventory/movements').then(setMovements).catch(()=>setMovements([]))},[data])
  const loadStockCounts=async()=>{if(!isAdmin)return;try{setStockCounts(await api('/inventory/stock-counts'))}catch(error){notify(error.message)}}
  useEffect(()=>{loadStockCounts()},[isAdmin,data])
  useEffect(()=>{if(!canManage)return;api('/other-invoices').then(setOtherInvoices).catch((error)=>notify(error.message))},[canManage,data])
  useEffect(()=>{setSelectedCountMaterialIds((current)=>current.filter((id)=>data.materials.some((material)=>material.id===id)))},[data.materials])
  const openStockCount=async(count)=>{try{const detail=await api(`/inventory/stock-counts/${count.id}`);setActiveCount(detail);setCountItems(detail.items.map((item)=>({...item,counted_stock:item.counted_stock??'',counted_sub_stock:item.counted_sub_stock??''})))}catch(error){notify(error.message)}}
  const createStockCount=async()=>{if(!countReason.trim()){notify('اذكر سبب الجرد قبل فتح المحضر.');return}if(!selectedCountMaterialIds.length){notify('حدد صنفًا واحدًا على الأقل للجرد.');return}setCountBusy(true);try{const result=await api('/inventory/stock-counts',{method:'POST',body:json({reason:countReason,materialIds:selectedCountMaterialIds})});setCountReason('');setSelectedCountMaterialIds([]);await loadStockCounts();await openStockCount(result);notify(`تم فتح ${result.code} وقفل ${result.itemCount} صنفًا للحركة.`)}catch(error){notify(error.message)}finally{setCountBusy(false)}}
  const toggleCountMaterial=(materialId)=>setSelectedCountMaterialIds((current)=>current.includes(materialId)?current.filter((id)=>id!==materialId):[...current,materialId])
  const saveCountItems=async()=>{if(countItems.some((item)=>item.counted_stock===''||item.counted_stock==null||item.counted_sub_stock===''||item.counted_sub_stock==null)){notify('أدخل الرصيد الفعلي الأساسي والبواقي لكل صنف قبل الحفظ.');return}setCountBusy(true);try{await api(`/inventory/stock-counts/${activeCount.id}/items`,{method:'PUT',body:json({items:countItems.map((item)=>({materialId:item.material_id,stock:Number(item.counted_stock),subStock:Number(item.counted_sub_stock)}))})});await openStockCount(activeCount);notify('تم حفظ كميات الجرد الفعلية.') }catch(error){notify(error.message)}finally{setCountBusy(false)}}
  const approveCount=async()=>{if(!window.confirm('اعتماد الجرد سيُنشئ تسويات محاسبية ويفك قفل الأصناف. هل راجعت الكميات؟'))return;setCountBusy(true);try{await api(`/inventory/stock-counts/${activeCount.id}/approve`,{method:'POST',body:'{}'});setActiveCount(null);await loadStockCounts();await onRefresh();notify('تم اعتماد محضر الجرد وتسجيل الفروقات.') }catch(error){notify(error.message)}finally{setCountBusy(false)}}
  const cancelCount=async()=>{if(!window.confirm('إلغاء المحضر سيفك قفل الأصناف دون تسويات. متابعة؟'))return;setCountBusy(true);try{await api(`/inventory/stock-counts/${activeCount.id}/cancel`,{method:'POST',body:'{}'});setActiveCount(null);await loadStockCounts();notify('تم إلغاء الجرد وفك قفل الأصناف.')}catch(error){notify(error.message)}finally{setCountBusy(false)}}
  const importInventory=async(file)=>{
    if(!file)return
    const form=new FormData();form.append('file',file);setImporting(true)
    try{const result=await api('/inventory/import',{method:'POST',body:form});await onRefresh();notify(`تم استيراد ${result.added} صنف، وتحديث ${result.updated}، وتجاوز ${result.skipped} صف.`)}
    catch(error){notify(error.message)}finally{setImporting(false);if(importRef.current)importRef.current.value=''}
  }
  const exportInventory=async()=>{
    try{const response=await api('/inventory/export.xlsx');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='Madar-Inventory.xlsx';link.click();URL.revokeObjectURL(url)}catch(error){notify(error.message)}
  }
  const movementName={purchase:'توريد شراء',issue:'صرف',adjustment:'تسوية'}
  return <div className="page-enter">
    <PageHeading eyebrow="سلسلة الإمداد" title="المخزون والمشتريات" description="إدارة الوحدات الكاملة والبواقي، ومتابعة التوريد والاستهلاك." action={<>
      {canManage&&<button className="button button-secondary" onClick={onAdd}><Plus size={16}/> خامة جديدة</button>}
      {canManage&&<button className="button button-primary" onClick={onPurchase}><ArrowDownLeft size={16}/> فاتورة شراء</button>}
      {canManage&&<button className="button button-secondary" onClick={onOtherInvoice}><FileText size={16}/> فاتورة مصروف آخر</button>}
      {['admin','purchasing','operations'].includes(user.role)&&<button className="button button-ghost" onClick={onIssue}><ArrowUpRight size={16}/> صرف خامة</button>}
      {canManage&&<label className={`button button-secondary ${importing?'button-disabled':''}`}><input ref={importRef} type="file" accept=".csv,.xlsx" onChange={(event)=>importInventory(event.target.files?.[0])}/>{importing?<RefreshCw size={16} className="spin"/>:<FileSpreadsheet size={16}/>} استيراد جرد</label>}
      {canManage&&<button className="button button-ghost" onClick={exportInventory}><Download size={16}/> تصدير Excel</button>}
    </>}/>
    <div className="inventory-summary">
      <div className="inventory-summary-card"><div className="summary-glyph orange"><Package size={19}/></div><div><span>إجمالي الأصناف</span><strong>{data.materials.length}</strong></div></div>
      <div className="inventory-summary-card"><div className="summary-glyph red"><AlertTriangle size={19}/></div><div><span>تحتاج إعادة طلب</span><strong>{low.length}</strong></div></div>
      {canManage&&<div className="inventory-summary-card"><div className="summary-glyph blue"><CircleDollarSign size={19}/></div><div><span>قيمة المخزون التقديرية</span><strong>{money(data.materials.reduce((sum,item)=>sum+(item.stock+item.subStock)*item.unitCost,0))} <small>ج.م</small></strong></div></div>}
    </div>
    <div className="panel inventory-panel"><div className="panel-heading"><div><span className="section-eyebrow">إدارة الأصناف</span><h3>أرصدة المخزنين</h3></div><span className="result-count">{data.materials.length} صنف</span></div>
      {data.materials.length?<div className="table-wrap"><table><thead><tr>{isAdmin&&<th>جرد</th>}<th>كود الصنف</th><th>اسم الخامة</th><th>الوحدة</th><th>المخزن الأساسي</th><th>مخزن البواقي</th><th>حد إعادة الطلب</th>{canManage&&<th>تكلفة الوحدة</th>}<th>الحالة</th></tr></thead><tbody>{data.materials.map((item)=><tr key={item.id}>{isAdmin&&<td><input type="checkbox" aria-label={`تحديد ${item.code} للجرد`} checked={selectedCountMaterialIds.includes(item.id)} onChange={()=>toggleCountMaterial(item.id)}/></td>}<td><strong className="code-cell">{item.code}</strong></td><td className="machine-name-cell">{item.name}</td><td>{item.unit}</td><td><strong>{quantity(item.stock)}</strong></td><td><span className="offcut-quantity">{quantity(item.subStock)}</span></td><td>{quantity(item.minStock)}</td>{canManage&&<td>{money(item.unitCost)} ج.م</td>}<td>{item.stock+item.subStock<=item.minStock?<span className="low-stock"><i/>منخفض</span>:<span className="healthy-stock"><i/>متاح</span>}</td></tr>)}</tbody></table></div>:<EmptyState icon={Boxes} title="المخزون فارغ" description="أضف خامة أو استورد جردًا من Excel / CSV." action={canManage&&<button className="button button-primary button-small" onClick={onAdd}><Plus size={15}/> إضافة خامة</button>}/>}
    </div>
    <div className="inventory-callout"><div className="callout-icon"><CircleHelp size={17}/></div><div><strong>خصم تلقائي ذكي للوحدات الكاملة</strong><span>استهلاك 1.75 وحدة يخصم وحدتين من الأساسي، ويضيف 0.25 إلى مخزن البواقي. تُستخدم البواقي المتاحة أولًا.</span></div></div>
    {canManage&&<section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">مستندات المصروف</span><h3>فواتير المصروفات الأخرى وإثباتاتها</h3></div><span className="result-count">{otherInvoices.length} فاتورة</span></div>{otherInvoices.length?<div className="table-wrap"><table><thead><tr><th>الكود</th><th>المورد</th><th>الإجمالي</th><th>البنود</th><th>الإثبات</th><th>التاريخ</th></tr></thead><tbody>{otherInvoices.map((invoice)=><tr key={invoice.id}><td><strong className="code-cell">{invoice.code}</strong></td><td>{invoice.supplier||'—'}</td><td>{money(invoice.total_cents/100)} ج.م</td><td>{invoice.lines?.length||0}</td><td><OtherInvoiceEvidence invoice={invoice} notify={notify}/></td><td>{date(invoice.created_at)}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد فواتير مصروفات أخرى.</div>}</section>}
    {isAdmin&&<section className="panel inventory-panel"><div className="panel-heading"><div><span className="section-eyebrow">جرد مضبوط</span><h3>محاضر الجرد وقفل الحركة</h3></div><span className="result-count">{stockCounts.filter((count)=>count.status==='open').length} مفتوح</span></div>
      <div className="form-row stock-count-open"><label className="field"><span>سبب الجرد</span><input maxLength="1000" required value={countReason} onChange={(event)=>setCountReason(event.target.value)} placeholder="جرد دوري، مطابقة..."/></label><button className="button button-primary" disabled={countBusy||!countReason.trim()||!selectedCountMaterialIds.length} onClick={createStockCount}><Plus size={15}/> فتح محضر للأصناف المحددة ({selectedCountMaterialIds.length})</button></div>
      {stockCounts.length?<div className="table-wrap"><table><thead><tr><th>المحضر</th><th>السبب</th><th>الحالة</th><th>الأصناف</th><th>غير معدود</th><th>التاريخ</th><th/></tr></thead><tbody>{stockCounts.map((count)=><tr key={count.id}><td>{count.code}</td><td>{count.reason||'—'}</td><td>{count.status==='open'?'مفتوح ومقفل':count.status==='approved'?'معتمد':'ملغى'}</td><td>{count.item_count}</td><td>{count.uncounted}</td><td>{date(count.created_at)}</td><td><button className="button button-ghost button-small" onClick={()=>openStockCount(count)}>{count.status==='open'?'إدخال / مراجعة':'عرض'}</button></td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد محاضر جرد.</div>}
      {activeCount&&<div className="stock-count-detail"><div className="panel-heading"><div><span className="section-eyebrow">{activeCount.code} · {activeCount.reason}</span><h3>الكميات الفعلية مقابل الدفترية والفروقات</h3></div><button className="icon-button" onClick={()=>setActiveCount(null)} aria-label="إغلاق"><X size={18}/></button></div><div className="table-wrap"><table><thead><tr><th>الصنف</th><th>أساسي دفتري</th><th>أساسي فعلي</th><th>فرق الأساسي</th><th>بواقي دفتري</th><th>بواقي فعلي</th><th>فرق البواقي</th><th>فرق الإجمالي</th></tr></thead><tbody>{countItems.map((item,index)=>{const mainVariance=item.counted_stock===''||item.counted_stock==null?null:Number((Number(item.counted_stock)-Number(item.recorded_stock)).toFixed(6));const subVariance=item.counted_sub_stock===''||item.counted_sub_stock==null?null:Number((Number(item.counted_sub_stock)-Number(item.recorded_sub_stock)).toFixed(6));const totalVariance=mainVariance==null||subVariance==null?null:Number((mainVariance+subVariance).toFixed(6));const varianceCell=(value)=><td className={value==null?'':value<0?'movement-negative':'movement-positive'}>{value==null?'—':`${value>0?'+':''}${quantity(value)}`}</td>;return <tr key={item.id}><td>{item.code} — {item.name} {item.specification&&`· ${item.specification}`}</td><td>{quantity(item.recorded_stock)}</td><td><input aria-label={`الأساسي الفعلي ${item.name}`} type="number" min="0" step="1" placeholder={String(item.recorded_stock)} disabled={activeCount.status!=='open'} value={item.counted_stock} onChange={(event)=>setCountItems((current)=>current.map((row,i)=>i===index?{...row,counted_stock:event.target.value}:row))}/></td>{varianceCell(mainVariance)}<td>{quantity(item.recorded_sub_stock)}</td><td><input aria-label={`البواقي الفعلية ${item.name}`} type="number" min="0" step="0.000001" placeholder={String(item.recorded_sub_stock)} disabled={activeCount.status!=='open'} value={item.counted_sub_stock} onChange={(event)=>setCountItems((current)=>current.map((row,i)=>i===index?{...row,counted_sub_stock:event.target.value}:row))}/></td>{varianceCell(subVariance)}{varianceCell(totalVariance)}</tr>})}</tbody></table></div>{activeCount.status==='open'&&<div className="modal-actions"><button className="button button-ghost" disabled={countBusy} onClick={saveCountItems}><Save size={15}/> حفظ الكميات</button><button className="button button-primary" disabled={countBusy} onClick={approveCount}><Check size={15}/> اعتماد وتسوية</button><button className="button button-danger" disabled={countBusy} onClick={cancelCount}>إلغاء وفك القفل</button></div>}</div>}
    </section>}
     <div className="panel inventory-panel movement-panel"><div className="panel-heading"><div><span className="section-eyebrow">سجل الحركة</span><h3>آخر حركات المخزون</h3></div><span className="result-count">آخر {movements.length} حركة</span></div>{movements.length?<div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الخامة</th><th>الحركة</th><th>المخزن</th><th>الكمية</th><th>التصنيف / الأمر</th><th>المرجع</th><th>ملاحظات</th></tr></thead><tbody>{movements.slice(0,40).map((movement)=><tr key={movement.id}><td>{date(movement.created_at)}</td><td>{movement.material_name}</td><td>{movementName[movement.kind]||movement.kind}</td><td>{movement.warehouse==='sub'?'البواقي':'الأساسي'}</td><td className={movement.quantity<0?'movement-negative':'movement-positive'}>{quantity(movement.quantity)}</td><td>{movement.order_code|| (movement.issue_classification==='general'?'استهلاك عام':movement.issue_classification==='order'?'أمر تشغيل':'—')}</td><td>{movement.reference||'—'}</td><td className="movement-notes">{movement.notes||'—'}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد حركات مسجلة حتى الآن.</div>}</div>
  </div>
}

function FinancePage({ user, data, notify, onCreateSale, onAddTreasury, onAddFunding, onOtherInvoice, onRecordReceipt, onCorrectPurchase }) {
  const [dashboard,setDashboard]=useState(null)
  const [salesInvoices,setSalesInvoices]=useState([])
  const [from,setFrom]=useState('')
  const [to,setTo]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const isAdmin=user.role==='admin'
  useEffect(()=>{
    let active=true;setLoading(true);setError('')
    const query=new URLSearchParams();if(from)query.set('from',from);if(to)query.set('to',to)
    const request=isAdmin?api(`/finance/dashboard?${query.toString()}`):api('/sales/invoices')
    request.then((result)=>{if(!active)return;if(isAdmin)setDashboard(result);else setSalesInvoices(result)})
      .catch((reason)=>{if(active)setError(reason.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[isAdmin,data,from,to])
  const invoices=isAdmin?(dashboard?.invoices||[]).filter((invoice)=>invoice.kind==='sales'):salesInvoices
  const maximum=Math.max(1,...(dashboard?.monthly||[]).flatMap((month)=>[month.income,month.expense]))
  return <div className="page-enter">
    <PageHeading eyebrow={isAdmin?'إدارة السيولة والأداء':'إصدار ومتابعة الفواتير'} title={isAdmin?'الخزينة والتحليلات المالية':'فواتير المبيعات'} description={isAdmin?'متابعة التدفقات النقدية والذمم وقيمة المخزون وتكلفة مواد أوامر التشغيل بقيمة FIFO.':'إصدار فواتير العملاء وربطها بأوامر التشغيل.'} action={<>
      <button className="button button-primary" onClick={onCreateSale}><Plus size={16}/> فاتورة مبيعات</button>
      {isAdmin&&<button className="button button-secondary" onClick={onAddTreasury}><ArrowUpRight size={16}/> حركة خزينة</button>}
      {isAdmin&&<button className="button button-ghost" onClick={onAddFunding}><CircleDollarSign size={16}/> تمويل الشركة</button>}
      {isAdmin&&<button className="button button-ghost" onClick={onOtherInvoice}><FileText size={16}/> فاتورة مصروفات أخرى</button>}
    </>}/>
    {!isAdmin&&<section className="invoice-note"><CircleHelp size={17}/><span>البيع النقدي يسجل تحصيل كامل الإجمالي عند حفظ الفاتورة؛ البيع الآجل لا يزيد الصندوق حتى تسجيل سند قبض. يمكن ربط الفاتورة بأمر تشغيل قائم.</span></section>}
    {isAdmin&&<section className="filter-panel panel"><div className="filter-fields"><label><span>من تاريخ</span><input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label><label><span>إلى تاريخ</span><input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label></div></section>}
    {error&&<div className="inline-error">{error}</div>}
    {loading?<div className="panel loading-inline">جارٍ تحميل البيانات المالية...</div>:<>
      {isAdmin&&dashboard&&<>
        <section className="finance-summary-grid">
          <FinanceStat label="الوارد النقدي (دون التمويل)" value={dashboard.summary.income} icon={ArrowDownLeft} tone="green"/>
          <FinanceStat label="المنصرف النقدي" value={dashboard.summary.expense} icon={ArrowUpRight} tone="orange"/>
          <FinanceStat label="رصيد صندوق المصنع الحالي" value={dashboard.summary.cashBalance} icon={CircleDollarSign} tone="blue"/>
          <FinanceStat label="قيمة أصول المخزون" value={dashboard.summary.inventoryValue} icon={Boxes} tone="purple"/>
          <div className="finance-stat"><div className="finance-stat-icon gold"><Activity size={18}/></div><div><span>الربح الإجمالي للأوامر المرتبطة</span><strong>{money(dashboard.summary.grossProfit)} <small>ج.م</small></strong><small>{dashboard.summary.profitStatus==='complete'?'إيراد فواتير الأوامر − تكلفة FIFO':dashboard.summary.profitStatus==='pending_work_order_cogs_journals'?`${dashboard.summary.pendingWorkOrderCogsEntries} قيد بانتظار اعتماد الحساب`:`تقديري جزئي؛ ${dashboard.summary.unclassifiedHistoricalIssueCount} صرف تاريخي غير مصنف`}</small></div></div>
        </section>
        <section className="panel cashflow-panel"><div className="panel-heading"><div><span className="section-eyebrow">آخر ستة أشهر</span><h3>التدفق النقدي</h3></div><div className="chart-legend"><span><i className="legend-income"/>وارد</span><span><i className="legend-expense"/>منصرف</span></div></div>
           <div className="cashflow-chart">{dashboard.monthly.map((month)=><button type="button" className="cashflow-month" key={month.month} title="اضغط لتصفية الحركات بهذا الشهر" onClick={()=>{setFrom(`${month.month}-01`);setTo(`${month.month}-${new Date(Number(month.month.slice(0,4)),Number(month.month.slice(5,7)),0).getDate()}`)}}><div className="cashflow-bars"><div className="cashflow-bar income-bar" style={{height:`${Math.max(month.income?5:0,month.income/maximum*100)}%`}} title={`وارد: ${money(month.income)} ج.م`}/><div className="cashflow-bar expense-bar" style={{height:`${Math.max(month.expense?5:0,month.expense/maximum*100)}%`}} title={`منصرف: ${money(month.expense)} ج.م`}/></div><span>{month.label}</span></button>)}</div>
          <div className="cashflow-totals"><span>الوارد خلال الفترة <strong>{money(dashboard.monthly.reduce((sum,item)=>sum+item.income,0))} ج.م</strong></span><span>المنصرف خلال الفترة <strong>{money(dashboard.monthly.reduce((sum,item)=>sum+item.expense,0))} ج.م</strong></span></div>
        </section>
        <section className="panel treasury-panel"><div className="panel-heading"><div><span className="section-eyebrow">حركة الصندوق</span><h3>أحدث حركات الخزينة</h3></div><span className="result-count">{dashboard.entries.length} حركة</span></div>{dashboard.entries.length?<div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>التصنيف</th><th>الموظف</th><th>المبلغ</th><th>المرجع</th><th>المسجل</th></tr></thead><tbody>{dashboard.entries.slice(0,30).map((entry)=><tr key={entry.id}><td>{date(entry.created_at)}</td><td><span className={entry.kind==='income'?'cash-in':'cash-out'}>{entry.kind==='income'?'وارد':'منصرف'}</span></td><td>{entry.category}</td><td>{entry.employee_name||'—'}</td><td>{money(entry.amount)} ج.م</td><td>{entry.invoice_code||entry.reference||'—'}</td><td>{entry.user_name||'—'}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد حركات مالية؛ ستظهر هنا السندات والحركات النقدية اليدوية بعد تسجيلها.</div>}</section>
      </>}
        <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">فواتير المبيعات</span><h3>المستحقات والتحصيل</h3></div><span className="result-count">{invoices.length} فاتورة</span></div>{invoices.length?<div className="table-wrap"><table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>أمر التشغيل</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th><th>محصل</th><th>متبقي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{invoices.map((invoice)=><tr key={invoice.id}><td><strong className="code-cell">{invoice.code}</strong></td><td>{invoice.client_name||'—'}</td><td>{invoice.order_code||'—'}</td><td>{money(invoice.subtotal_cents==null?invoice.total:invoice.subtotal_cents/100)} ج.م</td><td>{money((invoice.tax_cents||0)/100)} ج.م</td><td>{money(invoice.total)} ج.م</td><td>{money(invoice.paid_total)} ج.م</td><td>{money(invoice.remaining)} ج.م</td><td>{invoice.payment_status==='paid'?'مدفوعة':invoice.payment_status==='partial'?'جزئية':'غير مدفوعة'}</td><td>{Number(invoice.remaining)>0&&<button className="button button-ghost button-small" onClick={()=>onRecordReceipt(invoice)}>سند قبض</button>}</td></tr>)}</tbody></table></div>:<EmptyState icon={CircleDollarSign} title="لا توجد فواتير مبيعات" description="أنشئ أول فاتورة لبدء تسجيل الإيرادات." action={<button className="button button-primary button-small" onClick={onCreateSale}><Plus size={15}/> إصدار فاتورة</button>}/>}</section>
        {isAdmin&&dashboard&&<section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">فواتير المشتريات</span><h3>مسددة ومرفقات الإثبات</h3></div></div>{dashboard.invoices.filter((invoice)=>invoice.kind==='purchase').length?<div className="table-wrap"><table><thead><tr><th>رقم الفاتورة</th><th>المورد</th><th>الموظف</th><th>القيمة</th><th>الحالة</th><th>الإثبات والتصحيح</th><th>التاريخ</th></tr></thead><tbody>{dashboard.invoices.filter((invoice)=>invoice.kind==='purchase').slice(0,15).map((invoice)=><tr key={invoice.id}><td><strong className="code-cell">{invoice.code}</strong></td><td>{invoice.supplier||'—'}</td><td>{invoice.employee_name||'—'}</td><td>{money(invoice.total)} ج.م</td><td>{invoice.status==='corrected'?'مصَححة':'مدفوعة'}</td><td><PurchaseEvidence invoice={invoice} notify={notify}/>{invoice.status!=='corrected'&&<button className="button button-danger button-small" onClick={()=>onCorrectPurchase(invoice)}>تصحيح</button>}</td><td>{date(invoice.created_at)}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد فواتير مشتريات حتى الآن.</div>}</section>}
        {isAdmin&&dashboard&&<section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">ذمم العملاء</span><h3>المبالغ المستحقة</h3></div></div>{dashboard.receivables.length?<div className="table-wrap"><table><thead><tr><th>العميل</th><th>الفاتورة</th><th>الإجمالي</th><th>المتبقي</th><th>إجراء</th></tr></thead><tbody>{dashboard.receivables.map((invoice)=><tr key={invoice.id}><td>{invoice.client_name}</td><td>{invoice.code}</td><td>{money(invoice.total)}</td><td>{money(invoice.remaining)}</td><td><button className="button button-ghost button-small" onClick={()=>onRecordReceipt(invoice)}>سند قبض</button></td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد ذمم مفتوحة.</div>}</section>}
        {isAdmin&&dashboard&&<section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">مصروفات غير مخزنية</span><h3>فواتير أخرى مدفوعة</h3></div></div>{dashboard.otherInvoices?.length?<div className="table-wrap"><table><thead><tr><th>الكود</th><th>المورد</th><th>الموظف</th><th>الإجمالي</th><th>التاريخ</th></tr></thead><tbody>{dashboard.otherInvoices.map((invoice)=><tr key={invoice.id}><td>{invoice.code}</td><td>{invoice.supplier||'—'}</td><td>{invoice.employee_name||'—'}</td><td>{money(invoice.total_cents/100)} ج.م</td><td>{date(invoice.created_at)}</td></tr>)}</tbody></table></div>:<div className="empty-inline">لا توجد فواتير مصروفات أخرى.</div>}</section>}
    </>}
  </div>
}

function FinanceStat({label,value,icon:Icon,tone}) { return <div className="finance-stat"><div className={`finance-stat-icon ${tone}`}><Icon size={18}/></div><div><span>{label}</span><strong>{money(value)} <small>ج.م</small></strong></div></div> }

function PurchaseEvidence({ invoice, notify }) {
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const load = () => api(`/inventory/purchases/${invoice.id}/attachments`).then(setAttachments).catch((error) => notify?.(error.message))
  useEffect(() => { load() }, [invoice.id])
  const upload = async (file) => {
    if (!file) return
    const form = new FormData(); form.append('file', file)
    setUploading(true)
    try { await api(`/inventory/purchases/${invoice.id}/attachments`, { method: 'POST', body: form }); await load(); notify?.('تم حفظ مرفق الفاتورة داخل التخزين المحلي.') }
    catch (error) { notify?.(error.message || 'تعذر رفع المرفق.') }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = '' }
  }
  return <div className="purchase-evidence"><label className="button button-ghost button-small"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf" onChange={(event) => upload(event.target.files?.[0])}/>{uploading ? 'جارٍ الرفع...' : 'إرفاق دليل'}</label>
    {attachments.map((attachment) => <a className="text-link" key={attachment.id} href={attachment.downloadUrl}>{attachment.original_name}</a>)}
  </div>
}

function OtherInvoiceEvidence({ invoice, notify }) {
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const load = () => api(`/other-invoices/${invoice.id}/attachments`).then(setAttachments).catch((error) => notify?.(error.message))
  useEffect(() => { load() }, [invoice.id])
  const upload = async (file) => {
    if (!file) return
    const form = new FormData(); form.append('file', file)
    setUploading(true)
    try { await api(`/other-invoices/${invoice.id}/attachments`, { method: 'POST', body: form }); await load(); notify?.('تم حفظ إثبات فاتورة المصروف داخل التخزين المحلي.') }
    catch (error) { notify?.(error.message || 'تعذر رفع الإثبات.') }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = '' }
  }
  return <div className="purchase-evidence"><label className="button button-ghost button-small"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf" onChange={(event) => upload(event.target.files?.[0])}/>{uploading ? 'جارٍ الرفع...' : 'إرفاق دليل'}</label>
    {attachments.map((attachment) => <a className="text-link" key={attachment.id} href={attachment.downloadUrl}>{attachment.original_name}</a>)}
  </div>
}

function InventoryPageLegacy({ data, user, onAdd, onPurchase, onIssue }) {
  const canManage=['admin','purchasing'].includes(user.role)
  const low=data.materials.filter((material)=>material.stock<=material.minStock)
  return <div className="page-enter"><PageHeading eyebrow="سلسلة الإمداد" title="المخزون والمشتريات" description="متابعة أرصدة الخامات وحركات التوريد والصرف." action={<>{canManage&&<button className="button button-secondary" onClick={onAdd}><Plus size={16}/> خامة جديدة</button>}{canManage&&<button className="button button-primary" onClick={onPurchase}><ArrowDownLeft size={16}/> تسجيل فاتورة شراء</button>}{user.role==='admin'&&<button className="button button-ghost" onClick={onIssue}><ArrowUpRight size={16}/> صرف خامة</button>}</>}/><div className="inventory-summary"><div className="inventory-summary-card"><div className="summary-glyph orange"><Package size={19}/></div><div><span>إجمالي الأصناف</span><strong>{data.materials.length}</strong></div></div><div className="inventory-summary-card"><div className="summary-glyph red"><AlertTriangle size={19}/></div><div><span>تحتاج إعادة طلب</span><strong>{low.length}</strong></div></div><div className="inventory-summary-card"><div className="summary-glyph blue"><CircleDollarSign size={19}/></div><div><span>قيمة المخزون التقديرية</span><strong>{money(data.materials.reduce((sum,item)=>sum+item.stock*item.unitCost,0))} <small>ج.م</small></strong></div></div></div><div className="panel inventory-panel"><div className="panel-heading"><div><span className="section-eyebrow">إدارة الأصناف</span><h3>رصيد الخامات</h3></div><span className="result-count">{data.materials.length} صنف</span></div>{data.materials.length?<div className="table-wrap"><table><thead><tr><th>كود الصنف</th><th>اسم الخامة</th><th>الوحدة</th><th>الرصيد الحالي</th><th>حد إعادة الطلب</th><th>تكلفة الوحدة</th><th>الحالة</th></tr></thead><tbody>{data.materials.map((item)=><tr key={item.id}><td><strong className="code-cell">{item.code}</strong></td><td className="machine-name-cell">{item.name}</td><td>{item.unit}</td><td><strong>{money(item.stock)}</strong></td><td>{money(item.minStock)}</td><td>{money(item.unitCost)} ج.م</td><td>{item.stock<=item.minStock?<span className="low-stock"><i/> مخزون منخفض</span>:<span className="healthy-stock"><i/> متوفر</span>}</td></tr>)}</tbody></table></div>:<EmptyState icon={Boxes} title="لا توجد خامات مسجلة" description="أضف الأصناف للمخزن لتتمكن من تسجيل المشتريات ومتابعة الأرصدة." action={canManage&&<button className="button button-primary button-small" onClick={onAdd}><Plus size={15}/> إضافة خامة</button>}/>}</div><div className="inventory-callout"><div className="callout-icon"><Activity size={18}/></div><div><strong>كل حركة مخزنية موثقة</strong><span>عمليات الشراء والصرف تُسجل تلقائيًا في سجل الحركات مع المستخدم والوقت.</span></div><button className="text-button" onClick={()=>api('/inventory/movements').then((movements)=>window.alert(movements.length?`تم تسجيل ${movements.length} حركة مخزنية.`:'لا توجد حركات مسجلة.')).catch((error)=>window.alert(error.message))}>عرض سجل الحركات <ArrowLeft size={14}/></button></div></div>
}

function ReportsPage({ data }) {
  const [clientId,setClientId]=useState('')
  const [area,setArea]=useState('')
  const [reason,setReason]=useState('')
  const [orders,setOrders]=useState([])
  const [selected,setSelected]=useState([])
  const [loading,setLoading]=useState(false)
  const [exporting,setExporting]=useState(false)
  const search=async()=>{setLoading(true);try{const params=new URLSearchParams();if(clientId)params.set('clientId',clientId);if(area)params.set('area',area);if(reason)params.set('reason',reason);const result=await api(`/reports/archive?${params.toString()}`);setOrders(result);setSelected([])}catch(error){window.alert(error.message)}finally{setLoading(false)}}
  useEffect(()=>{search()},[])
  const exportReport=async(format)=>{if(!selected.length)return;setExporting(true);try{const response=await fetch(`/api/reports/export.${format}?ids=${selected.join(',')}`,{credentials:'same-origin'});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'تعذر تصدير التقرير.')};const blob=await response.blob();const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`Madar-Report-${selected.length}-orders.${format}`;anchor.click();URL.revokeObjectURL(url)}catch(error){window.alert(error.message)}finally{setExporting(false)}}
  const toggle=(id)=>setSelected((current)=>current.includes(id)?current.filter((value)=>value!==id):[...current,id])
  return <div className="page-enter"><PageHeading eyebrow="المراجعة والتحليل" title="الأرشيف والتقارير" description="ابحث في الأوامر المعتمدة، وصدّر تقارير PowerPoint وWord وPDF." action={<><button className="button button-primary" disabled={!selected.length||exporting} onClick={()=>exportReport('pptx')}><Presentation size={17}/>{exporting?'جارٍ التصدير...':`PowerPoint${selected.length?` (${selected.length})`:''}`}</button><button className="button button-secondary" disabled={!selected.length||exporting} onClick={()=>exportReport('docx')}><ClipboardList size={16}/> Word</button><button className="button button-ghost" disabled={!selected.length||exporting} onClick={()=>window.open(`/api/reports/print?ids=${selected.join(',')}`,'_blank','noopener,noreferrer')}><Download size={16}/> طباعة / PDF</button></>}/><section className="filter-panel panel"><div className="filter-panel-title"><div className="panel-icon"><Filter size={17}/></div><div><strong>تصفية الأرشيف</strong><span>اجمع أوامر متوافقة في تقرير واحد.</span></div></div><div className="filter-fields"><label><span>العميل</span><select value={clientId} onChange={(event)=>setClientId(event.target.value)}><option value="">كل العملاء</option>{data.clients.map((client)=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label><span>المنطقة</span><input value={area} onChange={(event)=>setArea(event.target.value)} placeholder="مثال: الإسكندرية"/></label><label><span>سبب الصيانة</span><input value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="مثال: تغيير سبوت"/></label><button className="button button-secondary filter-submit" onClick={search}><Search size={16}/> تطبيق</button></div></section><div className="panel archive-panel"><div className="panel-heading"><div><span className="section-eyebrow">الأوامر المعتمدة</span><h3>سجل الأرشيف</h3></div><div className="archive-count">{orders.length} أمر</div></div>{orders.length?<div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="تحديد الكل" checked={!!orders.length&&orders.every((order)=>selected.includes(order.id))} onChange={(event)=>setSelected(event.target.checked?orders.map((order)=>order.id):[])}/></th><th>رقم الأمر</th><th>النوع</th><th>العميل</th><th>الماكينات</th><th>تاريخ الاعتماد</th><th /></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td><input type="checkbox" checked={selected.includes(order.id)} onChange={()=>toggle(order.id)}/></td><td><strong className="code-cell">{order.code}</strong></td><td>{order.type==='maintenance'?'صيانة':'تشغيل'}</td><td>{order.clientName}</td><td>{order.machineCount}</td><td>{date(order.archivedAt)}</td><td><Archive size={15} className="muted"/></td></tr>)}</tbody></table></div>:<EmptyState icon={Archive} title={loading?'جارٍ تحميل الأرشيف...':'الأرشيف فارغ'} description="تظهر هنا أوامر التشغيل والصيانة بعد اعتمادها."/>}</div><div className="report-footnote"><ShieldCheck size={16}/><span>تصدير التقارير متاح للمدير العام فقط. PowerPoint وWord ملفات مباشرة؛ وحفظ PDF يتم من نافذة الطباعة في المتصفح.</span></div></div>
}

function ModalHost({ modal, setModal, data, onRefresh, run, notify }) {
  const modalType = typeof modal === 'string' ? modal : modal.type
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [taxRates, setTaxRates] = useState([])
  const [useCustomTaxRate, setUseCustomTaxRate] = useState(false)
  const [issueClassification, setIssueClassification] = useState(typeof modal === 'object' && modal?.order ? 'order' : 'general')
  const [purchaseLines, setPurchaseLines] = useState([{ materialId: '', name: '', specification: '', unit: 'قطعة', quantity: '1', unitCost: '' }])
  const [otherLines, setOtherLines] = useState([{ description: '', category: '', amount: '' }])
  const purchaseLineTotalCents = purchaseLines.map((line) => {
    const quantityValue = String(line.quantity || '').trim()
    const quantity = /^\d+$/.test(quantityValue) ? BigInt(quantityValue) : null
    const unitCostCents = currencyInputCents(line.unitCost)
    return quantity === null || unitCostCents === null ? null : quantity * unitCostCents
  })
  const purchaseInvoiceTotalCents = purchaseLineTotalCents.every((total) => total !== null)
    ? purchaseLineTotalCents.reduce((sum, total) => sum + total, 0n) : null
  useEffect(() => {
    if (modalType !== 'sale') return undefined
    setUseCustomTaxRate(false)
    let active = true
    api('/accounting/tax-rates').then((rates) => { if (active) setTaxRates(rates) }).catch((error) => { if (active) setSubmitError(error.message) })
    return () => { active = false }
  }, [modalType])
  useEffect(() => {
    if (modalType === 'issue') setIssueClassification(typeof modal === 'object' && modal?.order ? 'order' : 'general')
  }, [modalType, modal?.order?.id])
  const modalHeading = {client:'إضافة عميل جديد',machine:'إضافة ماكينة',material:'إضافة خامة',purchase:'تسجيل فاتورة شراء',sale:'إصدار فاتورة مبيعات',treasury:'تسجيل حركة خزينة',funding:'تمويل صندوق المصنع',receipt:'تسجيل سند قبض', 'other-invoice':'فاتورة مصروفات أخرى', 'purchase-correction':'تصحيح فاتورة شراء',issue:'صرف خامة',user:'إضافة مستخدم', 'add-machine':'إضافة ماكينة للأمر'}[modalType]
  const close=()=>setModal(null)
  const submit=async(event)=>{
    event.preventDefault()
    if(submitting)return
    setSubmitError('')
    setSubmitting(true)
    try {
    const form=new FormData(event.currentTarget)
    const values=Object.fromEntries(form.entries())
    if(modalType==='sale'&&useCustomTaxRate){
      const customRateCents=currencyInputCents(values.customTaxPercent)
      if(customRateCents===null||customRateCents>100000n)throw new Error('أدخل نسبة ضريبية مخصصة من صفر إلى 1000% وبحد أقصى منزلتين عشريتين.')
      values.customTaxRate=true
    }
    if(modalType==='client'){
      const logo=values.logo;delete values.logo
      const result=await api('/clients',{method:'POST',body:json(values)})
      if(logo?.size){const logoData=new FormData();logoData.append('logo',logo);await api(`/clients/${result.id}/logo`,{method:'POST',body:logoData})}
      notify(`تم إنشاء ملف العميل ${result.code} ومجلداته.`)
    }
    if(modalType==='machine'){
      const result=await api('/machines',{method:'POST',body:json(values)});notify(`تم تسجيل الماكينة ${result.code}.`)
    }
    if(modalType==='add-machine'){
      if(values.folderId && !(modal.order?.client?.id && String(modal.order.client.code||'').trim() && String(modal.order.client.name||'').trim())) {
        throw new Error('يجب اختيار العميل لتكوين مسار الحفظ الصحيح')
      }
      if(values.folderId) await api(`/orders/${modal.order.id}/area-folders/${values.folderId}/bind`,{method:'POST',body:json({machineId:Number(values.machineId)})})
      else await api(`/orders/${modal.order.id}/cards`,{method:'POST',body:json({machineId:Number(values.machineId)})})
      notify(values.folderId?'تم ربط المجلد وإضافة بطاقة الماكينة.':'تمت إضافة الماكينة إلى الأمر.')
    }
    if(modalType==='material'){
      const result=await api('/materials',{method:'POST',body:json({...values,stock:Number(values.stock||0),unitCost:Number(values.unitCost||0),minStock:Number(values.minStock||0)})});notify(`تمت إضافة الخامة ${result.code}.`)
    }
    if(modalType==='purchase'){
      const items=purchaseLines.map((item)=>({...item,materialId:item.materialId?Number(item.materialId):null,quantity:Number(item.quantity),unitCost:Number(item.unitCost)}))
      const result=await api('/inventory/purchases',{method:'POST',body:json({supplier:values.supplier,employeeId:values.employeeId?Number(values.employeeId):null,notes:values.notes,items})})
      if(values.evidence?.size){const evidence=new FormData();evidence.append('file',values.evidence);await api(`/inventory/purchases/${result.id}/attachments`,{method:'POST',body:evidence})}
      notify(`تم سداد الفاتورة ${result.code} من صندوق المصنع وتسجيل ${result.items.length} صنف.`)
    }
    if(modalType==='sale'){
      const result=await api('/inventory/sales',{method:'POST',body:json({clientId:Number(values.clientId),orderId:values.orderId?Number(values.orderId):null,subtotal:Number(values.total),taxRateBasisPoints:Number(values.taxRateBasisPoints||0),customTaxRate:values.customTaxRate===true,customTaxPercent:values.customTaxPercent,saleType:values.saleType,notes:values.notes})})
      if(values.saleType==='cash'){
        notify(`تم حفظ الفاتورة النقدية ${result.code} وتحصيل كامل الإجمالي ${money(result.total)} ج.م في صندوق المصنع.`)
      } else {
        notify(`تم اعتماد الفاتورة الآجلة ${result.code} بإجمالي ${money(result.total)} ج.م. يسجل التحصيل اللاحق بسند قبض.`)
      }
    }
    if(modalType==='treasury'){
      await api('/treasury/entries',{method:'POST',body:json({kind:values.kind,amount:Number(values.amount),category:values.category,reference:values.reference,notes:values.notes,employeeId:values.employeeId?Number(values.employeeId):null})});notify('تم تسجيل حركة الخزينة.')
    }
    if(modalType==='funding'){
      await api('/treasury/funding',{method:'POST',body:json({amount:Number(values.amount),reference:values.reference,notes:values.notes})});notify('تم تسجيل التمويل كمصدر غير إيرادي.')
    }
    if(modalType==='receipt'){
      const result=await api(`/treasury/invoices/${modal.invoice.id}/payments`,{method:'POST',body:json({amount:Number(values.amount),reference:values.reference,notes:values.notes})});notify(`تم تسجيل سند القبض؛ المتبقي ${money(result.remaining)} ج.م.`)
    }
    if(modalType==='other-invoice'){
      const result=await api('/other-invoices',{method:'POST',body:json({supplier:values.supplier,employeeId:values.employeeId?Number(values.employeeId):null,notes:values.notes,items:otherLines.map((item)=>({...item,amount:Number(item.amount)}))})})
      let evidenceSaved=true
      if(values.otherEvidence?.size){const evidence=new FormData();evidence.append('file',values.otherEvidence);try{await api(`/other-invoices/${result.id}/attachments`,{method:'POST',body:evidence})}catch(error){evidenceSaved=false;notify(`تم حفظ فاتورة ${result.code}، لكن تعذر حفظ الإثبات: ${error.message}`)}}
      if(evidenceSaved)notify(`تم سداد فاتورة المصروفات ${result.code}، بإجمالي ${money(result.total)} ج.م.${values.otherEvidence?.size?' وحُفظ الإثبات محليًا.':''}`)
    }
    if(modalType==='purchase-correction'){
      const result=await api(`/inventory/purchases/${modal.invoice.id}/correction`,{method:'POST',body:json({reason:values.reason,supplierRefundReceived:values.supplierRefundReceived==='yes'})});notify(`تم تصحيح ${result.code} بعد إثبات عدم صرف الرصيد ورد المبلغ.`)
    }
    if(modalType==='issue'){
      await api('/inventory/issue',{method:'POST',body:json({materialId:Number(values.materialId),quantity:Number(values.quantity),warehouse:values.warehouse||'auto',classification:values.classification,orderId:values.classification==='order'?Number(values.orderId):null,reference:values.reference,notes:values.notes})});notify('تم صرف الخامة وربط تكلفتها الفعلية.')
    }
    if(modalType==='user'){
      await api('/users',{method:'POST',body:json(values)});notify('تم إنشاء حساب المستخدم.')
    }
    await onRefresh();close()
    } catch(error) {
      const message=error.message || 'تعذر حفظ البيانات، تحقق من المدخلات ثم أعد المحاولة.'
      setSubmitError(message)
      notify(message)
    } finally {
      setSubmitting(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&close()}><section className="modal-card"><div className="modal-header"><div><span className="section-eyebrow">مَدَار · إدارة النظام</span><h2>{modalHeading}</h2></div><button className="icon-button" onClick={close}><X size={19}/></button></div><form className="modal-form" onSubmit={submit} onInvalidCapture={()=>setSubmitError('تحقق من الحقول المطلوبة.')} onChange={()=>submitError&&setSubmitError('')}>
    {modalType==='client'&&<><Field label="اسم العميل" required><input name="name" required placeholder="الاسم التجاري"/></Field><div className="form-row"><Field label="مسؤول الاتصال"><input name="contactName" placeholder="الاسم"/></Field><Field label="رقم الهاتف"><input name="phone" placeholder="01xxxxxxxxx"/></Field></div><div className="form-row"><Field label="البريد الإلكتروني"><input type="email" name="email" placeholder="name@company.com"/></Field><Field label="الشعار"><input type="file" name="logo" accept="image/*" className="file-input-native"/></Field></div><Field label="العنوان"><input name="address" placeholder="المدينة، الشارع"/></Field><div className="form-row color-form"><Field label="اللون الأساسي"><input name="primaryColor" type="color" defaultValue="#173a66"/></Field><Field label="اللون الثانوي"><input name="secondaryColor" type="color" defaultValue="#f49b36"/></Field></div></>}
    {modalType==='machine'&&<><div className="form-row"><Field label="كود الماكينة" required><input name="code" required placeholder="مثال: 1312"/></Field><Field label="الاسم بالعربي" required><input name="nameAr" required placeholder="اسم الموقع"/></Field></div><div className="form-row"><Field label="الاسم بالإنجليزي"><input name="nameEn" placeholder="Machine / Branch"/></Field><Field label="المنطقة"><input name="area" placeholder="مثال: مدينة نصر"/></Field></div></>}
    {modalType==='add-machine'&&<><Field label="الماكينة" required><select name="machineId" required defaultValue=""><option value="" disabled>اختر ماكينة</option>{data.machines.filter((machine)=>!modal.order.cards.some((card)=>card.machineId===machine.id)).map((machine)=><option key={machine.id} value={machine.id}>{machine.code} — {machine.nameAr}</option>)}</select></Field><Field label="مجلد صور موجود في منطقة الفرز (اختياري)"><select name="folderId" defaultValue=""><option value="">إضافة بطاقة فارغة</option>{modal.order.unrecognizedFolders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name} — {folder.imageCount} صورة</option>)}</select></Field></>}
     {modalType==='material'&&<><Field label="اسم الخامة" required><input name="name" required placeholder="مثال: لوح أكريليك"/></Field><Field label="المواصفة"><input name="specification" placeholder="السُمك، اللون، الموديل..."/></Field><div className="form-row"><Field label="وحدة القياس"><input name="unit" defaultValue="قطعة"/></Field><Field label="رصيد المخزن الأساسي (وحدات كاملة)"><input name="stock" type="number" step="1" min="0" defaultValue="0"/></Field></div><div className="form-row"><Field label="رصيد مخزن البواقي"><input name="subStock" type="number" step="0.001" min="0" defaultValue="0"/></Field><Field label="سعر شراء الوحدة (ج.م)"><input name="unitCost" type="number" step="0.01" min="0" defaultValue="0"/></Field></div><Field label="حد إعادة الطلب"><input name="minStock" type="number" step="0.01" min="0" defaultValue="0"/></Field></>}
     {modalType==='purchase'&&<><Field label="المورد"><input name="supplier" placeholder="اسم المورد"/></Field><Field label="الموظف"><select name="employeeId" defaultValue=""><option value="">بدون ربط بموظف</option>{(data.employees||[]).map((employee)=><option value={employee.id} key={employee.id}>{employee.name} — {employee.department}</option>)}</select></Field>{purchaseLines.map((line,index)=><section className="purchase-line panel" key={index}><div className="panel-heading"><strong>بند {index+1}</strong>{purchaseLines.length>1&&<button type="button" className="button button-ghost button-small" onClick={()=>setPurchaseLines((current)=>current.filter((_,i)=>i!==index))}>حذف</button>}</div><Field label="قالب صنف من المخزون (اختياري)"><select value={line.materialId} onChange={(event)=>{const selected=data.materials.find((material)=>String(material.id)===event.target.value);setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,materialId:event.target.value,name:selected?.name||item.name,specification:selected?.specification||'',unit:selected?.unit||'قطعة'}:item))}}><option value="">صنف جديد</option>{data.materials.map((material)=><option value={material.id} key={material.id}>{material.code} — {material.name} · {material.specification||material.unit}</option>)}</select></Field><div className="form-row"><Field label="اسم الصنف" required><input required value={line.name} onChange={(event)=>setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></Field><Field label="المواصفة"><input value={line.specification} onChange={(event)=>setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,specification:event.target.value}:item))}/></Field></div><div className="form-row"><Field label="الوحدة" required><input required value={line.unit} onChange={(event)=>setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,unit:event.target.value}:item))}/></Field><Field label="الكمية الكاملة" required><input required type="number" min="1" step="1" value={line.quantity} onChange={(event)=>setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,quantity:event.target.value}:item))}/></Field><Field label="سعر الوحدة (ج.م)" required><input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(event)=>setPurchaseLines((current)=>current.map((item,i)=>i===index?{...item,unitCost:event.target.value}:item))}/></Field></div></section>)}<button type="button" className="button button-ghost" onClick={()=>setPurchaseLines((current)=>[...current,{materialId:'',name:'',specification:'',unit:'قطعة',quantity:'1',unitCost:''}])}><Plus size={15}/> إضافة بند</button><Field label="مرفق فاتورة المورد (صورة أو PDF)"><input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf"/></Field><Field label="ملاحظات / رقم مستند المورد"><input name="notes" placeholder="رقم الفاتورة الأصلية أو تفاصيل..."/></Field><div className="modal-hint">تُسدد الفاتورة كاملة من صندوق المصنع في عملية واحدة. إذا لم يكفِ الرصيد، سجّل تمويلًا معتمدًا أولًا. كل بند يحفظ كمتغير سعر/مواصفة مستقل.</div></>}
      {modalType==='sale'&&<><Field label="العميل" required><select name="clientId" required defaultValue=""><option value="" disabled>اختر العميل</option>{data.clients.map((client)=><option value={client.id} key={client.id}>{client.code} — {client.name}</option>)}</select></Field><Field label="أمر التشغيل (اختياري)"><select name="orderId" defaultValue=""><option value="">بدون ربط بأمر</option>{data.orders.filter((order)=>order.status!=='archived').map((order)=><option value={order.id} key={order.id}>{order.code} · {order.clientName}</option>)}</select><small className="field-help">إذا تم اختيار أمر، يجب أن يكون تابعًا للعميل نفسه.</small></Field><div className="form-row"><Field label="قيمة البيع قبل الضريبة (ج.م)" required><input name="total" type="number" min="0.01" step="0.01" required/></Field><Field label="نسبة ضريبة معتمدة"><select name="taxRateBasisPoints" defaultValue="0">{taxRates.map((rate)=><option key={rate.id} value={rate.rate_basis_points}>{rate.label} · {(rate.rate_basis_points/100).toFixed(2)}%</option>)}</select></Field></div><Field label="نوع البيع"><select name="saleType" defaultValue="credit"><option value="credit">آجل</option><option value="cash">نقدي — تحصيل كامل عند الحفظ</option></select></Field><Field label="ملاحظات"><input name="notes" placeholder="رقم مرجع العميل أو تفاصيل إضافية"/></Field><div className="modal-hint">يشمل الإجمالي ضريبة المبيعات. البيع النقدي يسجل كامل الإجمالي في الصندوق مع حفظ الفاتورة؛ البيع الآجل يسجل ذممًا، وأي تحصيل لاحق يسجل بسند قبض.</div></>}
     {modalType==='treasury'&&<><div className="form-row"><Field label="نوع الحركة" required><select name="kind" defaultValue="expense"><option value="expense">منصرف / مصروف</option><option value="income">وارد / إيراد آخر</option></select></Field><Field label="المبلغ (ج.م)" required><input name="amount" type="number" min="0.01" step="0.01" required/></Field></div><Field label="الموظف"><select name="employeeId" defaultValue=""><option value="">بدون ربط بموظف</option>{(data.employees||[]).map((employee)=><option value={employee.id} key={employee.id}>{employee.name} — {employee.department}</option>)}</select></Field><Field label="التصنيف" required><input name="category" required placeholder="مثال: إيجار، رواتب، صيانة"/></Field><Field label="المرجع"><input name="reference" placeholder="رقم سند أو مستند"/></Field><Field label="ملاحظات"><input name="notes"/></Field></>}
     {modalType==='funding'&&<><Field label="المبلغ المودع فعليًا في صندوق المصنع (ج.م)" required><input name="amount" required type="number" min="0.01" step="0.01"/></Field><Field label="مرجع التمويل"><input name="reference" placeholder="رقم مستند أو إيداع"/></Field><Field label="ملاحظات"><input name="notes" placeholder="مصدر التمويل؛ ليس إيرادًا"/></Field><div className="modal-hint">يسجل التمويل كزيادة في الصندوق ومقابل تمويل مالك معلّق حتى اعتماد الحساب. لا يدخل ضمن إيرادات المبيعات.</div></>}
       {modalType==='receipt'&&<><div className="modal-hint">الفاتورة {modal.invoice?.code} · الإجمالي {money(modal.invoice?.total)} ج.م · المتبقي {money(modal.invoice?.remaining)} ج.م. سجّل المبلغ المستلم فعليًا فقط.</div><Field label="مبلغ سند القبض (ج.م)" required><input name="amount" type="number" min="0.01" max={modal.invoice?.remaining} step="0.01" required/></Field><Field label="مرجع السند"><input name="reference" defaultValue={modal.invoice?.code||''}/></Field><Field label="ملاحظات"><input name="notes"/></Field></>}
     {modalType==='other-invoice'&&<><Field label="المورد"><input name="supplier" placeholder="المورد أو الجهة"/></Field><Field label="الموظف"><select name="employeeId" defaultValue=""><option value="">بدون ربط بموظف</option>{(data.employees||[]).map((employee)=><option value={employee.id} key={employee.id}>{employee.name} — {employee.department}</option>)}</select></Field>{otherLines.map((line,index)=><section className="purchase-line panel" key={index}><div className="panel-heading"><strong>مصروف {index+1}</strong>{otherLines.length>1&&<button type="button" className="button button-ghost button-small" onClick={()=>setOtherLines((current)=>current.filter((_,i)=>i!==index))}>حذف</button>}</div><div className="form-row"><Field label="الوصف" required><input required value={line.description} onChange={(event)=>setOtherLines((current)=>current.map((item,i)=>i===index?{...item,description:event.target.value}:item))}/></Field><Field label="التصنيف" required><input required value={line.category} placeholder="إيجار، صيانة..." onChange={(event)=>setOtherLines((current)=>current.map((item,i)=>i===index?{...item,category:event.target.value}:item))}/></Field><Field label="المبلغ (ج.م)" required><input required type="number" min="0.01" step="0.01" value={line.amount} onChange={(event)=>setOtherLines((current)=>current.map((item,i)=>i===index?{...item,amount:event.target.value}:item))}/></Field></div></section>)}<button type="button" className="button button-ghost" onClick={()=>setOtherLines((current)=>[...current,{description:'',category:'',amount:''}])}><Plus size={15}/> إضافة مصروف</button><Field label="ملاحظات"><input name="notes"/></Field><div className="modal-hint">مصروف غير مخزني؛ يُسدد كاملًا من صندوق المصنع. اعتماد التصنيف المحاسبي مطلوب لترحيل القيد.</div></>}
      {modalType==='other-invoice'&&<Field label="مرفق إثبات اختياري"><input name="otherEvidence" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf" className="file-input-native"/><small className="field-help">يمكن إرفاق صورة أو PDF. سيبقى ملف الفاتورة محليًا، ويمكن إرفاق الإثبات بعد الحفظ إذا تعذر الرفع.</small></Field>}
      {modalType==='purchase-correction'&&<><div className="modal-hint">الفاتورة {modal.invoice?.code} · {money(modal.invoice?.total)} ج.م. يُقبل التصحيح فقط إذا أثبت النظام أن كامل رصيدها ما زال غير مصروف واستُرد المبلغ من المورد.</div><Field label="سبب التصحيح" required><textarea name="reason" required rows="3" maxLength="1000"/></Field><Field label="تأكيد استلام رد المورد" required><select name="supplierRefundReceived" required defaultValue=""><option value="" disabled>اختر</option><option value="yes">استلمت رد المبلغ كاملًا</option><option value="no">لم أستلم المبلغ</option></select></Field></>}
     {modalType==='issue'&&<><Field label="تصنيف الصرف" required><select name="classification" required value={issueClassification} onChange={(event)=>setIssueClassification(event.target.value)}><option value="general">استهلاك عام (ليس لأمر محدد)</option><option value="order">مرتبط بأمر تشغيل</option></select></Field>{issueClassification==='order'&&<Field label="أمر التشغيل" required><select name="orderId" required defaultValue={modal?.order?.id||''}><option value="" disabled>اختر أمر التشغيل</option>{data.orders.filter((order)=>order.status!=='archived').map((order)=><option value={order.id} key={order.id}>{order.code} · {order.clientName}</option>)}</select></Field>}<Field label="الخامة" required><select name="materialId" required defaultValue=""><option value="" disabled>اختر خامة</option>{data.materials.map((material)=><option value={material.id} key={material.id}>{material.name} — الأساسي {quantity(material.stock)} · البواقي {quantity(material.subStock)}</option>)}</select></Field><Field label="مصدر الصرف" required><select name="warehouse" defaultValue="auto"><option value="auto">تلقائي: البواقي أولًا ثم الأساسي</option><option value="sub">مخزن البواقي فقط</option><option value="main">وحدات كاملة من الأساسي (يُسجّل المتبقي كبواقي)</option></select><small className="field-help">تكلفة الصرف تُحسب من أرصدة FIFO؛ قيمة الباقي القابل للاستخدام تُستبعد من تكلفة الأمر.</small></Field><div className="form-row"><Field label="الكمية" required><input name="quantity" required type="number" step="0.01" min="0.01"/></Field><Field label="المرجع"><input name="reference" placeholder="مرجع صرف اختياري"/></Field></div><Field label="ملاحظات"><input name="notes"/></Field></>}
    {modalType==='user'&&<><Field label="الاسم الكامل" required><input name="fullName" required placeholder="اسم الموظف"/></Field><div className="form-row"><Field label="اسم المستخدم" required><input name="username" required minLength="3" autoComplete="off"/></Field><Field label="الدور الوظيفي" required><select name="role" defaultValue="sales"><option value="admin">مدير عام</option><option value="sales">مبيعات</option><option value="operations">تشغيل وصيانة</option><option value="purchasing">مشتريات ومخازن</option></select></Field></div><Field label="كلمة المرور (10 أحرف على الأقل)" required><input name="password" required minLength="10" type="password" autoComplete="new-password"/></Field></>}
      {modalType==='purchase'&&<section className="purchase-calculation-summary" aria-live="polite">{purchaseLines.map((line,index)=>{const material=data.materials.find((item)=>String(item.id)===String(line.materialId));return <div key={index}><span>بند {index+1}{material?` · ${material.code} — ${material.name} · ${material.specification||'بدون مواصفة'} · ${material.unit} · سعر الكود ${money(material.unitCost)} ج.م`:''} · سعر الشراء ${line.unitCost||'—'} ج.م · الكمية ${line.quantity||'—'}</span><strong>{purchaseLineTotalCents[index]===null?'—':`${formatCurrencyCents(purchaseLineTotalCents[index])} ج.م`}</strong></div>})}<strong>إجمالي الفاتورة: {purchaseInvoiceTotalCents===null?'—':`${formatCurrencyCents(purchaseInvoiceTotalCents)} ج.م`}</strong></section>}
      {modalType==='sale'&&<div className="custom-tax-option"><label><input type="checkbox" checked={useCustomTaxRate} onChange={(event)=>setUseCustomTaxRate(event.target.checked)}/> إدخال نسبة ضريبية مخصصة لهذه الفاتورة</label>{useCustomTaxRate&&<Field label="النسبة المخصصة (%)" required><input name="customTaxPercent" type="number" min="0" max="1000" step="0.01" required/></Field>}</div>}
      {submitError&&<div className="inline-error" role="alert">{submitError}</div>}
       <div className="modal-actions"><button type="button" className="button button-ghost" onClick={close}>إلغاء</button><button type="submit" className="button button-primary" disabled={submitting}>{submitting?'جارٍ الحفظ...':modalType==='client'?'إنشاء ملف العميل':modalType==='receipt'?'تسجيل سند القبض':'حفظ البيانات'} {!submitting&&<ArrowLeft size={15}/>}</button></div>
  </form></section></div>
}

function Field({label,children,required}) { return <label className="field"><span>{label}{required&&<b> *</b>}</span>{children}</label> }
function PageHeading({eyebrow,title,description,action}) { return <div className="page-heading"><div><span className="section-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action&&<div className="heading-actions">{action}</div>}</div> }
function SearchBox({value,onChange,placeholder}) { return <label className="search-box"><Search size={17}/><input value={value} onChange={(event)=>onChange(event.target.value)} placeholder={placeholder}/>{value&&<button onClick={()=>onChange('')} aria-label="مسح البحث"><X size={14}/></button>}</label> }
function StatusBadge({status}) { return <span className={`status-badge status-${status}`}><i/>{statusNames[status]||status}</span> }
function EmptyState({icon:Icon,title,description,action}) { return <div className="empty-state"><div className="empty-icon"><Icon size={23}/></div><h3>{title}</h3><p>{description}</p>{action}</div> }
function QuickAction({icon:Icon,label,detail,onClick}) { return <button className="quick-action" onClick={onClick}><span className="quick-icon"><Icon size={17}/></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowLeft size={15}/></button> }
