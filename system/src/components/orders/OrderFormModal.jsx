import { useEffect, useState } from 'react'
import { ArrowLeft, Users, X } from 'lucide-react'

const numberFormat = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 })
const missingClientMessage = 'يجب اختيار العميل لتكوين مسار الحفظ الصحيح'

export default function OrderFormModal({ modal, data, apiClient, onClose, onRefresh, onOrderUpdated, notify }) {
  const modalType = typeof modal === 'string' ? modal : modal?.type
  const editingOrder = modalType === 'edit-order' && typeof modal === 'object' ? modal.order : null
  const initialMachines = !editingOrder && Array.isArray(modal?.initialMachines) ? modal.initialMachines : []
  const clients = Array.isArray(data?.clients) ? data.clients : []
  const [type, setType] = useState(editingOrder?.type === 'maintenance' || modal?.initialType === 'maintenance' ? 'maintenance' : 'operation')
  const [clientId, setClientId] = useState(String(editingOrder?.clientId ?? editingOrder?.client?.id ?? ''))
  const [employeeIds, setEmployeeIds] = useState((editingOrder?.employeeIds || (editingOrder?.assignedEmployeeId ? [editingOrder.assignedEmployeeId] : [])).map(String))
  const [selectedMachineIds, setSelectedMachineIds] = useState((initialMachines || []).map((machine) => String(machine.id)))
  const [employees, setEmployees] = useState([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [notes, setNotes] = useState(String(editingOrder?.notes ?? ''))
  const [costs, setCosts] = useState({
    materials: String(editingOrder?.materialCost ?? 0),
    operations: String(editingOrder?.operatingCost ?? 0),
    sale: String(editingOrder?.sellingPrice ?? 0),
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingEmployees(true)
    apiClient('/employees?active=true')
      .then((rows) => { if (!cancelled) setEmployees(Array.isArray(rows) ? rows : []) })
      .catch((requestError) => { if (!cancelled) setError(requestError.message || 'تعذر تحميل الموظفين.') })
      .finally(() => { if (!cancelled) setLoadingEmployees(false) })
    return () => { cancelled = true }
  }, [apiClient])

  const materialCost = Number(costs.materials || 0)
  const operatingCost = Number(costs.operations || 0)
  const sellingPrice = Number(costs.sale || 0)
  const expectedProfit = sellingPrice - materialCost - operatingCost

  const setCost = (key, value) => setCosts((current) => ({ ...current, [key]: value }))
  const validate = () => {
    const parsedClientId = Number(clientId)
    if (!Number.isSafeInteger(parsedClientId) || parsedClientId < 1 || !clients.some((client) => Number(client.id) === parsedClientId)) return missingClientMessage
    if (!['operation','maintenance'].includes(type)) return 'اختر نوع أمر صالحًا.'
    const financialValues = [costs.materials, costs.operations, costs.sale].map((value) => Number(value || 0))
    if (financialValues.some((value) => !Number.isFinite(value) || value < 0)) return 'يجب أن تكون القيم المالية أرقامًا موجبة أو صفرًا.'
    return ''
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitting) return
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError('')
    setSubmitting(true)
    try {
      const payload = {
        clientId: Number(clientId),
        type,
        notes: String(notes || '').trim(),
        employeeIds: employeeIds.map(Number),
        machineIds: selectedMachineIds.map(Number),
      }
      if (type === 'maintenance') {
        if (initialMachines.length) payload.machineIds = [...new Set([...payload.machineIds, ...initialMachines.map((machine) => Number(machine.id))])]
      } else {
        payload.materialCost = materialCost
        payload.operatingCost = operatingCost
        payload.sellingPrice = sellingPrice
        payload.totalCost = materialCost + operatingCost
      }
      const result = editingOrder
        ? await apiClient('/orders/' + editingOrder.id, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiClient('/orders', { method: 'POST', body: JSON.stringify(payload) })
      await onRefresh?.()
      if (editingOrder) await onOrderUpdated?.(editingOrder.id)
      notify?.(editingOrder ? 'تم تحديث بيانات الأمر ' + (result.code || editingOrder.code) + '.' : 'تم إنشاء الأمر ' + result.code + '.')
      onClose?.()
    } catch (requestError) {
      const message = requestError.message || 'تعذر حفظ الأمر، تحقق من المدخلات ثم أعد المحاولة.'
      setError(message)
      notify?.(message)
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => { if (!submitting) onClose?.() }
  const heading = editingOrder ? 'تعديل بيانات الأمر' : 'إنشاء أمر تشغيل'

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="order-form-heading" dir="rtl">
      <div className="modal-header"><div><span className="section-eyebrow">مَدَار · سير العمل</span><h2 id="order-form-heading">{heading}</h2></div>
        <button type="button" className="icon-button" disabled={submitting} onClick={close} aria-label="إغلاق"><X size={19}/></button>
      </div>
      <form className="modal-form" onSubmit={submit} onInvalidCapture={(event) => {
        if (event.target?.name === 'clientId') {
          event.preventDefault()
          setError(missingClientMessage)
          notify?.(missingClientMessage)
        }
      }} onChange={() => error && setError('')}>
        <label className="field"><span>العميل<b> *</b></span>
          <select name="clientId" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
            <option value="" disabled>اختر العميل</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}
          </select>
          {!clients.length && <small className="field-help">أضف عميلًا أولًا قبل إنشاء الأمر.</small>}
        </label>

        <label className="field"><span>نوع الأمر<b> *</b></span>
          <select value={type} onChange={(event) => setType(event.target.value)} required>
            <option value="operation">أمر تشغيل</option>
            <option value="maintenance">صيانة</option>
          </select>
        </label>

        <label className="field"><span>فريق العمل (متساوون)</span>
          <select multiple value={employeeIds} onChange={(event) => setEmployeeIds(Array.from(event.target.selectedOptions, (option) => option.value))} size={Math.min(5, Math.max(3, employees.length))}>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.department}</option>)}
          </select>
          <small className="field-help">يمكن اختيار أكثر من موظف؛ لا يوجد قائد أو توزيع حصص.</small>
        </label>
        <label className="field"><span>أنواع الماكينات من الدليل</span>
          <select multiple value={selectedMachineIds} onChange={(event) => setSelectedMachineIds(Array.from(event.target.selectedOptions, (option) => option.value))} size={Math.min(6, Math.max(3, data.machines.length))}>
            {data.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.code} — {machine.nameAr}</option>)}
          </select>
        </label>

        {type === 'maintenance' ? <div className="maintenance-assignee-field">
          {initialMachines.length > 0 && <section className="preselected-machines" aria-label="الماكينات المطلوب استكمالها">
            <div><strong>الماكينات المحددة مسبقًا</strong><span>{initialMachines.length} ماكينة من تحليل المنطقة</span></div>
            <ul>{initialMachines.map((machine) => <li key={machine.id}><b>{machine.code}</b><span>{machine.name_ar || machine.nameAr}</span></li>)}</ul>
          </section>}
          <span className="maintenance-note"><Users size={15}/> أوامر الصيانة لا تتضمن بيانات مالية.</span>
        </div> : <>
          <div className="form-row">
            <label className="field"><span>تكلفة الخامات (ج.م)</span><input type="number" min="0" step="0.01" value={costs.materials} onChange={(event) => setCost('materials', event.target.value)}/></label>
            <label className="field"><span>تكلفة التشغيل (ج.م)</span><input type="number" min="0" step="0.01" value={costs.operations} onChange={(event) => setCost('operations', event.target.value)}/></label>
          </div>
          <label className="field"><span>قيمة البيع / العقد (ج.م)</span><input type="number" min="0" step="0.01" value={costs.sale} onChange={(event) => setCost('sale', event.target.value)}/></label>
          <div className="cost-total">
            <div><span>إجمالي التكلفة</span><strong>{numberFormat.format(materialCost + operatingCost)} ج.م</strong></div>
            <div><span>ربح تقديري غير مكتمل</span><strong>{numberFormat.format(expectedProfit)} ج.م</strong></div>
          </div>
          <small className="field-help">لا يمثل ربحًا محاسبيًا مكتملًا؛ استهلاك مواد أوامر العمل غير مفعّل في هذه المرحلة.</small>
        </>}

        <label className="field"><span>ملاحظات</span><textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="تفاصيل أو متطلبات إضافية..."/></label>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-ghost" disabled={submitting} onClick={close}>إلغاء</button>
          <button type="submit" className="button button-primary" disabled={submitting}>{submitting ? 'جارٍ الحفظ...' : editingOrder ? 'حفظ التعديلات' : 'إنشاء الأمر'} {!submitting && <ArrowLeft size={15}/>}</button>
        </div>
      </form>
    </section>
  </div>
}
