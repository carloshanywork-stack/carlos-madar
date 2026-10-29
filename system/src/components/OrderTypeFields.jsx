import { Users } from 'lucide-react'

export default function OrderTypeFields({ type, workers, assignedWorkerId, costParts, setCostParts, formatMoney, roleNames }) {
  if (type === 'maintenance') {
    return <div className="maintenance-assignee-field">
      <label className="field">
        <span>الفني أو الموظف المسؤول<b> *</b></span>
        <select name="assignedWorkerId" required defaultValue={assignedWorkerId || ''}>
          <option value="" disabled>{workers.length ? 'اختر الموظف المسؤول' : 'لا يوجد موظفون نشطون'}</option>
          {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName} — {roleNames[worker.role] || worker.role}</option>)}
        </select>
        {!workers.length && <small className="field-help">أضف حساب موظف نشطًا أولًا.</small>}
      </label>
      <span className="maintenance-note"><Users size={15}/> الأوامر من نوع الصيانة لا تتضمن حقولًا مالية.</span>
    </div>
  }

  return <>
    <div className="form-row">
      <label className="field"><span>تكلفة الخامات (ج.م)</span><input name="materialCost" type="number" min="0" step="0.01"
        value={costParts.materials} onChange={(event) => setCostParts((current) => ({ ...current, materials: event.target.value }))}/></label>
      <label className="field"><span>تكلفة التشغيل (ج.م)</span><input name="operatingCost" type="number" min="0" step="0.01"
        value={costParts.operations} onChange={(event) => setCostParts((current) => ({ ...current, operations: event.target.value }))}/></label>
    </div>
    <label className="field"><span>قيمة البيع / العقد (ج.م)</span><input name="sellingPrice" type="number" min="0" step="0.01"
      value={costParts.selling} onChange={(event) => setCostParts((current) => ({ ...current, selling: event.target.value }))}/></label>
    <div className="cost-total">
      <div><span>إجمالي التكلفة</span><strong>{formatMoney(Number(costParts.materials || 0) + Number(costParts.operations || 0))} ج.م</strong></div>
      <div><span>الربح المتوقع</span><strong>{formatMoney(Number(costParts.selling || 0) - Number(costParts.materials || 0) - Number(costParts.operations || 0))} ج.م</strong></div>
    </div>
  </>
}
