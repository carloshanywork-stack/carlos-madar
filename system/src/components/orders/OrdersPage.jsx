import { useEffect, useState } from 'react'
import { Archive, ClipboardList, Pencil, Plus, Search, Trash2, X } from 'lucide-react'

const filters = [
  { key: 'in_progress', label: 'قيد التنفيذ' },
  { key: 'review', label: 'للاعتماد' },
  { key: 'archived', label: 'الأرشيف' },
]
const statusLabels = { in_progress: 'قيد التنفيذ', review: 'بانتظار الاعتماد', archived: 'مؤرشف' }
const editableRoles = ['admin', 'sales', 'operations']

export default function OrdersPage({ data, user, search, setSearch, onCreate, onOpen, onEdit, onDelete, notify, formatMoney, orderType = null }) {
  const [filter, setFilter] = useState('in_progress')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const allOrders = Array.isArray(data?.orders) ? data.orders : []
  const canEdit = editableRoles.includes(user?.role)
  const canDelete = user?.role === 'admin'
  const hasActions = canEdit || canDelete
  const maintenanceTable = orderType === 'maintenance'
  const query = String(search || '').trim().toLocaleLowerCase('ar')
  const orders = allOrders.filter((order) => (
    (!orderType || order.type === orderType) && order.status === filter &&
    [order.code, order.clientName].filter(Boolean).join(' ').toLocaleLowerCase('ar').includes(query)
  ))

  useEffect(() => {
    if (!deleteTarget) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !deleting) setDeleteTarget(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [deleteTarget, deleting])

  const confirmDelete = async () => {
    if (!deleteTarget || deleting || typeof onDelete !== 'function') return
    setDeleting(true)
    try {
      await onDelete(deleteTarget)
      notify?.('تم حذف الأمر ' + deleteTarget.code + ' وإخفاؤه من القائمة.')
      setDeleteTarget(null)
    } catch (error) {
      notify?.(error.message || 'تعذر حذف الأمر.')
    } finally {
      setDeleting(false)
    }
  }

  return <div className="page-enter">
    <header className="page-heading">
      <div>
        <span className="section-eyebrow">سير العمل</span>
        <h2>{orderType === 'maintenance' ? 'أوامر الصيانة الميدانية' : 'أوامر التشغيل'}</h2>
        <p>{orderType === 'maintenance' ? 'تابع أعمال المواقع من التنفيذ إلى الاعتماد والأرشفة.' : 'تابع أوامر التشغيل وحالة الماكينات المرتبطة.'}</p>
      </div>
      {editableRoles.includes(user?.role) && <div className="heading-actions">
        <button type="button" className="button button-primary" onClick={onCreate}><Plus size={17}/> أمر جديد</button>
      </div>}
    </header>

    <div className="toolbar order-toolbar">
      <label className="search-box">
        <Search size={17}/>
        <input value={search || ''} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث برقم الأمر أو العميل..." aria-label="البحث في الأوامر"/>
        {search && <button type="button" onClick={() => setSearch('')} aria-label="مسح البحث"><X size={14}/></button>}
      </label>
      <div className="filter-pills" role="group" aria-label="مراحل الأوامر">
        {filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? 'filter-active' : ''}
          aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
          {item.label}{item.key === 'review' && Number(data?.stats?.pendingReview || 0) > 0 && <small>{data.stats.pendingReview}</small>}
        </button>)}
      </div>
    </div>

    <section className="panel orders-table-panel" aria-label={maintenanceTable ? 'جدول أوامر الصيانة' : 'جدول أوامر التشغيل'}>
      {orders.length ? <div className="table-wrap"><table>
        <thead><tr><th>رقم الأمر</th><th>العميل</th>{maintenanceTable
          ? <><th>المنطقة</th><th>عدد الماكينات</th></>
          : <><th>النوع</th><th>الماكينات</th><th>التكلفة التقديرية</th></>}
          <th>الحالة</th><th>التاريخ</th>{hasActions && <th>الإجراءات</th>}</tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id} className="clickable-row" onClick={() => onOpen?.(order)}>
          <td><strong className="code-cell">{order.code || '—'}</strong></td>
          <td>{order.clientName || '—'}</td>
          {maintenanceTable ? <>
            <td>{formatAreaNames(order.areaNames)}</td>
            <td>{Number(order.machineCount || 0)}</td>
          </> : <>
            <td><span className={'type-pill ' + (order.type === 'maintenance' ? 'maintenance' : 'operation')}>{order.type === 'maintenance' ? 'صيانة' : 'تشغيل'}</span></td>
            <td>{Number(order.machineCount || 0)}</td>
            <td>{formatMoney?.(order.totalCost || 0) ?? order.totalCost ?? 0} ج.م</td>
          </>}
          <td><span className={'status-badge status-' + order.status}><i/>{statusLabels[order.status] || order.status || '—'}</span></td>
          <td>{formatDate(order.createdAt)}</td>
          {hasActions && <td><div className="order-row-actions" onClick={(event) => event.stopPropagation()}>
            {canEdit && <button type="button" className="icon-button order-edit-action" onClick={() => onEdit?.(order)} aria-label={'تعديل الأمر ' + order.code} title="تعديل الأمر"><Pencil size={15}/></button>}
            {canDelete && <button type="button" className="icon-button danger-icon order-delete-action" onClick={() => setDeleteTarget(order)} aria-label={'حذف الأمر ' + order.code} title="حذف الأمر"><Trash2 size={15}/></button>}
          </div></td>}
        </tr>)}</tbody>
      </table></div> : <div className="empty-state">
        <div className="empty-icon"><ClipboardList size={23}/></div>
        <h3>{query ? 'لا توجد نتائج مطابقة' : filter === 'archived' ? 'لا توجد أوامر مؤرشفة' : 'لا توجد أوامر هنا'}</h3>
        <p>{query ? 'جرّب كلمات بحث أخرى.' : 'أنشئ أمرًا جديدًا أو غيّر عامل التصفية.'}</p>
        {!query && filter !== 'archived' && editableRoles.includes(user?.role) && <button type="button" className="button button-primary button-small" onClick={onCreate}><Plus size={15}/> إنشاء أمر</button>}
      </div>}
    </section>

    {deleteTarget && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteTarget(null)}>
      <section className="modal-card confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-order-heading" dir="rtl">
        <div className="modal-header"><div><span className="section-eyebrow">حذف آمن</span><h2 id="delete-order-heading">تأكيد حذف الأمر</h2></div>
          <button type="button" className="icon-button" disabled={deleting} onClick={() => setDeleteTarget(null)} aria-label="إغلاق"><X size={19}/></button>
        </div>
        <div className="modal-form">
          <p>هل تريد حذف الأمر <strong>{deleteTarget.code}</strong>؟ سيُخفى من القوائم دون حذف سجله نهائيًا.</p>
          {deleteTarget.status === 'archived' && <p className="order-archive-delete-note"><Archive size={15}/> هذا الأمر مؤرشف؛ سيُطبق عليه إجراء الحذف نفسه.</p>}
          <div className="modal-actions">
            <button type="button" className="button button-ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>إلغاء</button>
            <button type="button" className="button button-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? 'جارٍ الحذف...' : 'حذف الأمر'} <Trash2 size={15}/></button>
          </div>
        </div>
      </section>
    </div>}
  </div>
}

function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z')
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed)
}

function formatAreaNames(value) {
  return String(value || '').split(',').map((area) => area.trim()).filter(Boolean).join('، ') || '—'
}
