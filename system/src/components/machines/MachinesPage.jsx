import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, FileSpreadsheet, HardDrive, Plus, RefreshCw, Search, X } from 'lucide-react'
import MachineCode from '../MachineCode'

export default function MachinesPage({ data, search, setSearch, onAdd, onRefresh, notify, apiClient }) {
  const [importing, setImporting] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [collisionCount, setCollisionCount] = useState(0)
  const importRef = useRef(null)
  useEffect(() => {
    if (!collisionCount || !selectedFile) return undefined
    document.body.classList.add('modal-open')
    return () => document.body.classList.remove('modal-open')
  }, [collisionCount, selectedFile])

  const machines = useMemo(() => {
    const query = String(search || '').trim().toLocaleLowerCase('ar')
    return (data?.machines || []).filter((machine) => (
      [machine.code, machine.nameAr, machine.nameEn, machine.area]
        .filter(Boolean).join(' ').toLocaleLowerCase('ar').includes(query)
    ))
  }, [data?.machines, search])

  const importFile = async (file, resolution = null) => {
    if (!file || importing) return
    const form = new FormData()
    form.append('file', file)
    setImporting(true)
    try {
      const action = resolution
      const url = action ? '/machines/import?' + action + '=true' : '/machines/import'
      const result = await apiClient(url, { method: 'POST', body: form })
      setSelectedFile(null)
      setCollisionCount(0)
      if (importRef.current) importRef.current.value = ''
      await onRefresh?.()
      notify?.('اكتمل الاستيراد: إضافة ' + result.added + ' ماكينة، تحديث ' + (result.updated || 0) + ' ماكينة، وتجاوز ' + result.skipped + ' صف.')
    } catch (error) {
      if (error.status === 409 && error.body?.hasConflicts) {
        setCollisionCount(error.body.conflictCount || 0)
      } else {
        setSelectedFile(null)
        if (importRef.current) importRef.current.value = ''
        notify?.(error.message || 'تعذر استيراد ملف الماكينات.')
      }
    } finally {
      setImporting(false)
    }
  }

  const cancelImport = () => {
    setSelectedFile(null)
    setCollisionCount(0)
    if (importRef.current) importRef.current.value = ''
  }

  return <div className="page-enter" aria-labelledby="machines-page-title">
    <header className="page-heading">
      <div>
        <span className="section-eyebrow">الأصول والمواقع</span>
        <h2 id="machines-page-title">قاعدة الماكينات</h2>
        <p>مرجع موحد لأكواد الماكينات ومناطقها.</p>
      </div>
      <div className="heading-actions machines-import-actions">
        <label className={'button button-secondary ' + (importing ? 'button-disabled' : '')}>
          <input ref={importRef} type="file" accept=".csv,.xlsx" disabled={importing} onChange={(event) => {
            const file = event.target.files?.[0] || null
            setSelectedFile(file)
            setCollisionCount(0)
            if (file) importFile(file)
          }}/>
          {importing ? <RefreshCw size={16} className="spin"/> : <FileSpreadsheet size={17}/>}
          {importing ? 'جارٍ الاستيراد...' : 'استيراد Excel / CSV'}
        </label>
        <button type="button" className="button button-primary" onClick={onAdd}>
          <Plus size={17}/> إضافة ماكينة
        </button>
      </div>
    </header>

    <div className="toolbar">
      <label className="search-box">
        <Search size={17}/>
        <input value={search || ''} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالكود أو الاسم أو المنطقة..." aria-label="البحث في الماكينات"/>
        {search && <button type="button" onClick={() => setSearch('')} aria-label="مسح البحث"><X size={14}/></button>}
      </label>
      <span className="result-count">{machines.length} ماكينة</span>
    </div>

    <section className="panel machine-table-panel" aria-label="جدول الماكينات">
      {machines.length ? <div className="table-wrap machine-table-wrap">
        <table>
          <thead><tr><th>كود الماكينة</th><th>الاسم بالعربي</th><th>الاسم بالإنجليزي</th><th>المنطقة</th><th>أوامر مرتبطة</th></tr></thead>
          <tbody>{machines.map((machine) => <tr key={machine.id}>
            <td><MachineCode className="code-cell" value={machine.code}/></td>
            <td className="machine-name-cell">{machine.nameAr || '—'}</td>
            <td>{machine.nameEn || '—'}</td>
            <td>{machine.area || '—'}</td>
            <td><span className="machine-record"><HardDrive size={13}/>{machine.orderCount ? machine.orderCount + ' أوامر' : 'جاهزة'}</span></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="empty-state">
        <div className="empty-icon"><HardDrive size={23}/></div>
        <h3>{search ? 'لا توجد نتائج مطابقة' : 'قاعدة الماكينات فارغة'}</h3>
        <p>{search ? 'جرّب كلمات بحث أخرى.' : 'أضف ماكينة أو استورد ملف CSV / Excel.'}</p>
        {!search && <button type="button" className="button button-primary button-small" onClick={onAdd}><Plus size={15}/> إضافة ماكينة</button>}
      </div>}
    </section>

    <p className="import-tip"><CircleHelp size={16}/><span>تُعرض المنطقة فقط، وتُقبل عناوين المنطقة العربية والإنجليزية في ملفات الاستيراد.</span></p>
    {collisionCount > 0 && selectedFile && createPortal(<div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !importing && cancelImport()}>
      <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="machine-import-conflict-title" dir="rtl">
        <div className="modal-header"><div><span className="section-eyebrow">تعارض أكواد الماكينات</span><h2 id="machine-import-conflict-title">بعض الماكينات مسجلة مسبقًا</h2></div>
          <button type="button" className="icon-button" disabled={importing} onClick={cancelImport} aria-label="إلغاء الاستيراد"><X size={19}/></button>
        </div>
        <div className="modal-form">
          <p>يوجد {collisionCount} كودًا من هذا الملف في النظام. هل تريد تحديث بيانات الماكينات الموجودة أم تخطيها؟</p>
          <div className="modal-actions">
            <button type="button" className="button button-ghost" disabled={importing} onClick={cancelImport}>إلغاء</button>
            <button type="button" className="button button-secondary" disabled={importing} onClick={() => importFile(selectedFile, 'skipExisting')}>تخطي المسجل</button>
            <button type="button" className="button button-primary" disabled={importing} onClick={() => importFile(selectedFile, 'overwrite')}>{importing ? 'جارٍ الاستيراد...' : 'تحديث'}</button>
          </div>
        </div>
      </section>
    </div>, document.body)}
  </div>
}
