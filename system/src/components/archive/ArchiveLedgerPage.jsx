import { useEffect, useState } from 'react'
import { Factory, RefreshCw } from 'lucide-react'

const machineNames = { cnc_router: 'CNC Router', laser: 'Laser', both: 'كلاهما', manual: 'تجميع يدوي' }

export default function ArchiveLedgerPage({ apiClient, maintenanceLedger }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiClient('/manufacturing/orders?status=delivered_archived')
      setOrders(Array.isArray(result) ? result : [])
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل أوامر التشغيل المؤرشفة.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  return <div className="archive-ledger-stack">
    <section className="panel archive-manufacturing-ledger">
      <div className="panel-heading"><div><span className="section-eyebrow">التشغيل</span><h3>أوامر التشغيل المسلمة والمؤرشفة</h3></div>
        <div className="heading-actions"><span className="result-count">{orders.length} أمر</span><button className="button button-ghost button-small" onClick={load} disabled={loading} aria-label="تحديث أوامر التشغيل المؤرشفة"><RefreshCw size={14}/> تحديث</button></div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {loading ? <div className="loading-inline">جارٍ تحميل سجل التشغيل...</div> : orders.length ? <div className="table-wrap"><table>
        <thead><tr><th>رقم الأمر</th><th>العميل</th><th>المنتج</th><th>الماكينة</th><th>فاتورة العميل</th><th>تاريخ التسليم</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id}>
          <td><strong className="code-cell">{order.order_code}</strong></td><td>{order.client_name}</td><td>{order.product_name}</td>
          <td>{machineNames[order.machine_type] || order.machine_type}</td><td>{order.invoice_code || '—'}</td>
          <td>{order.delivered_at ? String(order.delivered_at).slice(0, 10) : '—'}</td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline"><Factory size={16}/> لا توجد أوامر تشغيل مسلّمة ومؤرشفة بعد.</div>}
    </section>
    {maintenanceLedger}
  </div>
}
