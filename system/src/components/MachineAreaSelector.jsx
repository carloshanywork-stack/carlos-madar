import { ChevronDown } from 'lucide-react'

export default function MachineAreaSelector({ areas = [], selectedAreas = [], onChange, loading = false, error = '', disabled = false }) {
  const areaList = Array.isArray(areas) ? areas : []
  const selection = Array.isArray(selectedAreas) ? selectedAreas : []
  const summary = loading
    ? 'جارٍ تحميل المناطق...'
    : selection.length === 1
      ? selection[0]
      : selection.length > 1
        ? selection.length + ' مناطق محددة'
        : areaList.length
          ? 'اختر منطقة أو أكثر'
          : 'لا توجد مناطق مسجلة'

  const toggle = (name) => {
    if (typeof onChange !== 'function') return
    onChange((currentValue) => {
      const current = Array.isArray(currentValue) ? currentValue : []
      return current.includes(name) ? current.filter((area) => area !== name) : [...current, name]
    })
  }

  return <div className="area-picker-field">
    <span>المنطقة <b>*</b></span>
    <details className="area-multiselect">
      <summary aria-disabled={disabled}>{summary} <ChevronDown size={14}/></summary>
      <div className="area-multiselect-options" role="group" aria-label="المناطق">
        {areaList.map((area) => <label className="area-multiselect-option" key={area.id || area.name}>
          <input type="checkbox" checked={selection.includes(area.name)} disabled={disabled || loading} onChange={() => toggle(area.name)}/>
          <span>{area.name}</span>
        </label>)}
        {!loading && !areaList.length && <small>{error || 'لا توجد مناطق مسجلة في قاعدة الماكينات.'}</small>}
      </div>
    </details>
  </div>
}
