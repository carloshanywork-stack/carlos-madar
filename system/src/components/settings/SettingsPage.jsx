import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Folder, HardDrive, Plus, RefreshCw, Settings, Trash2, Upload, Wrench, X } from 'lucide-react'

export default function SettingsPage({ data, onRefresh, notify, apiClient }) {
  const [label, setLabel] = useState('')
  const reasons = Array.isArray(data?.reasons) ? data.reasons : []

  const addReason = async (event) => {
    event.preventDefault()
    const nextLabel = label.trim()
    if (!nextLabel) return
    try {
      await apiClient('/reasons', { method: 'POST', body: JSON.stringify({ label: nextLabel }) })
      setLabel('')
      await onRefresh?.()
      notify?.('تمت إضافة سبب الصيانة.')
    } catch (error) { notify?.(error.message || 'تعذرت إضافة سبب الصيانة.') }
  }

  const removeReason = async (id) => {
    try {
      await apiClient('/reasons/' + id, { method: 'DELETE' })
      await onRefresh?.()
      notify?.('تم إيقاف سبب الصيانة.')
    } catch (error) { notify?.(error.message || 'تعذر إيقاف سبب الصيانة.') }
  }

  return <div className="page-enter">
    <header className="page-heading"><div><span className="section-eyebrow">تهيئة النظام</span><h2>الإعدادات</h2><p>إدارة أسباب الصيانة ومساحة الملفات المحلية.</p></div></header>
    <div className="settings-layout">
      <section className="panel reasons-panel">
        <div className="panel-heading"><div><span className="section-eyebrow">قائمة ديناميكية</span><h3>أسباب الصيانة</h3></div><div className="panel-icon"><Wrench size={18}/></div></div>
        <p className="panel-description">تظهر الأسباب النشطة لموظفي التشغيل عند مراجعة كل ماكينة، ويمكن اختيار أكثر من سبب.</p>
        <form className="inline-add-form" onSubmit={addReason}><input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="أضف سببًا جديدًا..."/><button className="button button-primary button-small"><Plus size={15}/> إضافة</button></form>
        <div className="reason-list">{reasons.map((reason, index) => <div className="reason-row" key={reason.id}><span className="reason-number">{String(index + 1).padStart(2, '0')}</span><strong>{reason.label}</strong><button type="button" className="icon-button danger-icon" onClick={() => removeReason(reason.id)} title="إيقاف السبب" aria-label={'إيقاف ' + reason.label}><Trash2 size={15}/></button></div>)}{!reasons.length && <p className="muted">لا توجد أسباب صيانة.</p>}</div>
      </section>
      <section className="panel settings-info">
        <div className="settings-info-art"><div className="settings-orbit"/><Settings size={38}/></div><span className="section-eyebrow">محلي وقابل للنقل</span><h3>بياناتك في مكانك</h3>
        <p>تُخزّن قاعدة البيانات داخل <code>system/data</code> والملفات في مجلد <code>storage</code> المنفصل.</p>
        <div className="settings-meta"><span><CheckCircle2 size={15}/> SQLite محلية</span><span><CheckCircle2 size={15}/> تخزين ملفات محلي</span><span><CheckCircle2 size={15}/> أدوار وصلاحيات</span></div>
      </section>
    </div>
    <BackupRestorePanel apiClient={apiClient} notify={notify}/>
    <LocalFactoryStorage apiClient={apiClient} onRefresh={onRefresh} notify={notify}/>
  </div>
}

function BackupRestorePanel({ apiClient, notify }) {
  const [file, setFile] = useState(null)
  const [confirmAction, setConfirmAction] = useState('')
  const [confirmationText, setConfirmationText] = useState('')
  const [working, setWorking] = useState(false)
  const [operationsStatus, setOperationsStatus] = useState(null)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    let mounted = true
    const refreshStatus = async () => {
      try {
        const status = await apiClient('/operations/status')
        if (mounted) { setOperationsStatus(status); setStatusError('') }
      } catch (error) {
        if (mounted) setStatusError(error.message || 'تعذر جلب حالة التشغيل.')
      }
    }
    void refreshStatus()
    const interval = window.setInterval(() => { void refreshStatus() }, 60_000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [apiClient])

  const closeConfirmation = () => {
    if (working) return
    setConfirmAction('')
    setConfirmationText('')
  }

  const createBackup = async () => {
    setWorking(true)
    try {
      const response = await apiClient('/backup/create', { method: 'POST' })
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'madar_backup.zip'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setConfirmAction('')
      notify?.('تم إنشاء وتنزيل النسخة الاحتياطية.')
    } catch (error) {
      notify?.(error.message || 'تعذر إنشاء النسخة الاحتياطية.')
    } finally { setWorking(false) }
  }

  const restoreBackup = async () => {
    if (!file || confirmationText.trim() !== 'استعادة النظام' || working) return
    setWorking(true)
    try {
      const form = new FormData()
      form.append('confirmation', 'RESTORE MADAR')
      form.append('file', file)
      const result = await apiClient('/backup/restore', { method: 'POST', body: form })
      setConfirmAction('')
      setConfirmationText('')
      notify?.(`${result.message || 'بدأت استعادة النظام.'} أعد تحميل الصفحة بعد عودة الخادم.`)
    } catch (error) {
      notify?.(error.message || 'تعذرت استعادة النسخة الاحتياطية.')
    } finally { setWorking(false) }
  }

  return <>
    <section className="panel backup-restore-panel">
      <div className="panel-heading">
        <div><span className="section-eyebrow">حماية البيانات</span><h3>النسخ الاحتياطي والاستعادة</h3></div>
        <div className="panel-icon"><HardDrive size={18}/></div>
      </div>
      <p className="panel-description">تتضمن النسخة قاعدة SQLite ومجلد التخزين المحلي. تُحفظ النسخ المجدولة في مجلد Backups على الخادم، بينما ينزّل الزر نسخة مباشرة إلى جهازك.</p>
      <div className="backup-health-grid" aria-live="polite">
        <div><span>جاهزية الخدمة</span><strong>{operationsStatus ? (operationsStatus.ready ? 'جاهز' : 'غير جاهز') : statusError ? 'غير متاح' : 'جارٍ الفحص...'}</strong></div>
        <div><span>آخر نسخة ناجحة</span><strong>{operationsStatus?.backup?.lastSuccessAt ? new Date(operationsStatus.backup.lastSuccessAt).toLocaleString('ar-EG') : 'لم تسجل بعد'}</strong></div>
        <div><span>آخر فشل للنسخ</span><strong>{operationsStatus?.backup?.lastFailureAt ? new Date(operationsStatus.backup.lastFailureAt).toLocaleString('ar-EG') : 'لا يوجد فشل مسجل'}</strong></div>
        <div><span>المساحة المتاحة (التخزين / النسخ)</span><strong>{operationsStatus?.freeSpaceMiB ? `${operationsStatus.freeSpaceMiB.storage ?? '—'} / ${operationsStatus.freeSpaceMiB.backups ?? '—'} MiB` : '—'}</strong></div>
        <div><span>عمليات استرداد معلقة</span><strong>{operationsStatus ? operationsStatus.pendingRecovery.total : '—'}</strong></div>
      </div>
      {statusError && <p className="backup-health-error" role="status">{statusError}</p>}
      <div className="backup-actions">
        <button type="button" className="button button-primary" disabled={working} onClick={() => setConfirmAction('create')}><Download size={16}/> إنشاء نسخة احتياطية</button>
        <label className="button button-secondary replacement-file-picker">
          <input type="file" accept=".zip,application/zip" disabled={working} onChange={(event) => setFile(event.target.files?.[0] || null)}/>
          <Upload size={16}/>{file ? 'تغيير ملف النسخة' : 'اختيار ملف للاستعادة'}
        </label>
        <button type="button" className="button button-danger" disabled={!file || working} onClick={() => { setConfirmationText(''); setConfirmAction('restore') }}><RefreshCw size={15}/> استعادة نظام</button>
      </div>
      {file && <p className="backup-selected-file"><FileText size={14}/><span>{file.name}</span></p>}
      <p className="backup-restore-note"><AlertTriangle size={15}/> الاستعادة تستبدل قاعدة البيانات والتخزين الحاليين. ينشئ الخادم نسخة تراجع قبل التبديل، ثم يعيد التشغيل؛ لا تغلق الجهاز أثناء العملية.</p>
    </section>
    {confirmAction && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeConfirmation()}>
      <section className="modal-card storage-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="backup-confirm-heading" dir="rtl">
        <div className="modal-header">
          <div><span className="section-eyebrow">النسخ المحلي</span><h2 id="backup-confirm-heading">{confirmAction === 'restore' ? 'تأكيد استعادة النظام' : 'إنشاء نسخة احتياطية'}</h2></div>
          <button type="button" className="icon-button" disabled={working} onClick={closeConfirmation} aria-label="إغلاق"><X size={19}/></button>
        </div>
        <div className="modal-form">
          {confirmAction === 'restore' ? <>
            <p className="backup-restore-warning">سيتم استبدال بيانات النظام بكل ما في ملف النسخة المحدد. سيحفظ Madar نسخة تراجع من الوضع الحالي قبل الاستعادة. اكتب <strong>استعادة النظام</strong> للمتابعة.</p>
            <label className="field"><span>تأكيد العملية</span><input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder="استعادة النظام" disabled={working}/></label>
          </> : <p>سينشئ Madar ملف ZIP يضم قاعدة البيانات ومجلد التخزين المحلي، ثم يبدأ تنزيله إلى هذا الجهاز.</p>}
          <div className="modal-actions">
            <button type="button" className="button button-ghost" disabled={working} onClick={closeConfirmation}>إلغاء</button>
            {confirmAction === 'restore'
              ? <button type="button" className="button button-danger" disabled={working || confirmationText.trim() !== 'استعادة النظام' || !file} onClick={() => void restoreBackup()}>{working ? 'جارٍ التحقق...' : 'تأكيد الاستعادة'} <RefreshCw size={15}/></button>
              : <button type="button" className="button button-primary" disabled={working} onClick={() => void createBackup()}>{working ? 'جارٍ إنشاء النسخة...' : 'إنشاء وتنزيل'} <Download size={15}/></button>}
          </div>
        </div>
      </section>
    </div>}
  </>
}

function LocalFactoryStorage({ apiClient, onRefresh, notify }) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [wipeMachinesOpen, setWipeMachinesOpen] = useState(false)
  const [wipingMachines, setWipingMachines] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [replacementToken, setReplacementToken] = useState('')
  const [replacementUploading, setReplacementUploading] = useState(false)
  const pathParts = path ? path.split('/').filter(Boolean) : []
  const affectsMachineArchives = Boolean(deleteTarget && (() => {
    const segments = String(deleteTarget.path || '').replace(/\\/g, '/').split('/').filter(Boolean)
    const inExcelArchives = segments.length >= 2 && segments[0].toLowerCase() === 'uploads' && segments[1].toLowerCase() === 'excel'
    return inExcelArchives && (deleteTarget.type === 'folder' && segments.length === 2
      || deleteTarget.type === 'file' && segments.length === 3 && /^machines_import_.+\.(csv|xlsx)$/i.test(segments[2]))
  })())

  const loadEntries = async () => {
    setLoading(true)
    try {
      const query = path ? '?path=' + encodeURIComponent(path) : ''
      const result = await apiClient('/storage/files' + query)
      setEntries(Array.isArray(result) ? result : [])
    } catch (error) {
      setEntries([])
      notify?.(error.message || 'تعذرت قراءة التخزين المحلي.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadEntries() }, [path])

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      const result = await apiClient('/storage/files', { method: 'DELETE', body: JSON.stringify({ path: deleteTarget.path }) })
      setDeleteTarget(null)
      await loadEntries()
      notify?.(result.archivedMachines
        ? 'تم حذف الأرشيف وأرشفة ' + result.archivedMachines + ' سجل ماكينة مع الحفاظ على تاريخها وعلاقاتها.'
        : 'تم حذف العنصر من تخزين المصنع المحلي.')
    } catch (error) { notify?.(error.message || 'تعذر حذف العنصر.') }
    finally { setDeleting(false) }
  }

  const wipeMachineCatalog = async () => {
    if (wipingMachines) return
    setWipingMachines(true)
    try {
      const result = await apiClient('/machines/wipe-catalog', { method: 'DELETE' })
      setWipeMachinesOpen(false)
      setReplacementToken(result.replacementToken)
      setReplacementOpen(true)
      void onRefresh?.()
      void loadEntries()
      notify?.(`تمت تهيئة قاعدة الماكينات ومسح محتويات مجلد Machines وإزالة ${result.sourceFilesRemoved || 0} ملف استيراد قديم. اختر ملف الاستبدال الآن.`)
    } catch (error) {
      notify?.(error.message || 'تعذر تهيئة قاعدة الماكينات.')
    } finally { setWipingMachines(false) }
  }

  const uploadMachineReplacement = async (file) => {
    if (!file || replacementUploading) return
    const form = new FormData()
    form.append('file', file)
    setReplacementUploading(true)
    try {
      const result = await apiClient('/machines/import?replacement=true', {
        method: 'POST',
        headers: { 'X-Machine-Replacement-Token': replacementToken },
        body: form,
      })
      setReplacementOpen(false)
      setReplacementToken('')
      await onRefresh?.()
      void loadEntries()
      notify?.(`تم استبدال قاعدة الماكينات: إضافة ${result.added} وتحديث ${result.updated} وتجاوز ${result.skipped} صف.`)
    } catch (error) {
      notify?.(error.message || 'تعذر رفع ملف قاعدة الماكينات الجديدة.')
    } finally { setReplacementUploading(false) }
  }

  return <>
    <section className="panel storage-manager" aria-labelledby="factory-storage-heading">
      <div className="panel-heading"><div><span className="section-eyebrow">ملفات محلية</span><h3 id="factory-storage-heading">تخزين المصنع المحلي</h3></div>
        <button type="button" className="button button-secondary button-small" disabled={loading} onClick={loadEntries}><RefreshCw size={15} className={loading ? 'spin' : ''}/> تحديث</button>
      </div>
      <p className="panel-description">استعرض الملفات والمجلدات المحفوظة محليًا. لن تغادر الملفات هذا الجهاز أو الشبكة المحلية.</p>
      <nav className="storage-breadcrumb" aria-label="مسار تخزين المصنع"><button type="button" onClick={() => setPath('')}>storage</button>{pathParts.map((part, index) => <span key={pathParts.slice(0, index + 1).join('/')}><span>/</span><button type="button" onClick={() => setPath(pathParts.slice(0, index + 1).join('/'))}>{part}</button></span>)}</nav>
      <div className="table-wrap storage-table-wrap"><table>
        <thead><tr><th>الاسم</th><th>النوع</th><th>الحجم</th><th>تاريخ الإنشاء</th><th>إجراء</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan="5" className="storage-empty">جارٍ قراءة التخزين المحلي...</td></tr> : entries.length ? entries.map((entry) => <tr key={entry.path}>
          <td><div className="storage-entry-name">{entry.type === 'folder' ? <Folder size={16}/> : <FileText size={16}/>}<button type="button" disabled={entry.type !== 'folder'} onClick={() => entry.type === 'folder' && setPath(entry.path)}>{entry.name}</button></div></td>
          <td>{entry.type === 'folder' ? 'مجلد' : 'ملف'}</td><td>{entry.type === 'folder' ? '—' : formatSize(entry.size)}</td><td>{formatDate(entry.createdAt)}</td>
         <td><div className="storage-row-actions">
           {entry.path === 'Machines' && entry.type === 'folder' && <button type="button" className="button button-danger button-small machine-catalog-wipe-button" disabled={wipingMachines || replacementUploading} onClick={() => setWipeMachinesOpen(true)} title="تهيئة قاعدة الماكينات ورفع ملف بديل">مسح واستبدال قاعدة الماكينات</button>}
           <button type="button" className="icon-button danger-icon" title="حذف العنصر" aria-label={'حذف ' + entry.name} onClick={() => setDeleteTarget(entry)}><Trash2 size={15}/></button>
         </div></td>
        </tr>) : <tr><td colSpan="5" className="storage-empty">هذا المجلد فارغ.</td></tr>}</tbody>
      </table></div>
    </section>
    {deleteTarget && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteTarget(null)}>
      <section className="modal-card storage-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="storage-delete-heading" dir="rtl">
        <div className="modal-header"><div><span className="section-eyebrow">حذف من التخزين المحلي</span><h2 id="storage-delete-heading">تأكيد الحذف</h2></div><button type="button" className="icon-button" disabled={deleting} onClick={() => setDeleteTarget(null)} aria-label="إغلاق"><X size={19}/></button></div>
        <div className="modal-form"><p>{affectsMachineArchives
          ? 'تحذير: حذف هذا الأرشيف سيؤدي إلى أرشفة سجلات الماكينات وإخفائها من النظام. ستبقى السجلات محفوظة داخليًا للحفاظ على المعرّفات والعلاقات، ولن تُحذف نهائيًا.'
          : <>هل أنت متأكد؟ قد يؤدي ذلك إلى فقدان صور الماكينات.<br/><span lang="en">Are you sure? This may result in lost machine images.</span></>}</p><strong className="storage-delete-name">{deleteTarget.path}</strong>
          <div className="modal-actions"><button type="button" className="button button-ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>إلغاء</button><button type="button" className="button button-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? 'جارٍ الحذف...' : 'حذف نهائي'} <Trash2 size={15}/></button></div>
        </div>
      </section>
    </div>}
    {wipeMachinesOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !wipingMachines && setWipeMachinesOpen(false)}>
      <section className="modal-card storage-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="machine-catalog-wipe-heading" dir="rtl">
        <div className="modal-header"><div><span className="section-eyebrow">استبدال قاعدة الماكينات</span><h2 id="machine-catalog-wipe-heading">تأكيد التهيئة والاستبدال</h2></div><button type="button" className="icon-button" disabled={wipingMachines} onClick={() => setWipeMachinesOpen(false)} aria-label="إغلاق"><X size={19}/></button></div>
        <div className="modal-form"><p>سيتم مسح قاعدة الماكينات الحالية وملف الإكسيل المصدر بالكامل. هل أنت متأكد؟</p><p className="machine-wipe-retention-note">سيتم حذف كل ما داخل مجلد Machines نهائيًا، بما في ذلك مجلدات الماكينات والصور. ستبقى سجلات قاعدة البيانات soft-deleted لحفظ تاريخ الأوامر، ولن تُحذف ملفات استيراد المستخدمين أو المخزون.</p>
          <div className="modal-actions"><button type="button" className="button button-ghost" disabled={wipingMachines} onClick={() => setWipeMachinesOpen(false)}>إلغاء</button><button type="button" className="button button-danger" disabled={wipingMachines} onClick={wipeMachineCatalog}>{wipingMachines ? 'جارٍ التهيئة...' : 'مسح وبدء الاستبدال'} <Trash2 size={15}/></button></div>
        </div>
      </section>
    </div>}
    {replacementOpen && <MachineReplacementModal uploading={replacementUploading} onClose={() => {
      if (replacementUploading) return
      setReplacementOpen(false)
      setReplacementToken('')
    }} onUpload={uploadMachineReplacement}/>}
  </>
}

function MachineReplacementModal({ uploading, onClose, onUpload }) {
  const [file, setFile] = useState(null)
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !uploading && onClose()}>
    <section className="modal-card storage-delete-modal" role="dialog" aria-modal="true" aria-labelledby="machine-replacement-heading" dir="rtl">
      <div className="modal-header"><div><span className="section-eyebrow">قاعدة الماكينات</span><h2 id="machine-replacement-heading">رفع ملف الاستبدال</h2></div><button type="button" className="icon-button" disabled={uploading} onClick={onClose} aria-label="إغلاق"><X size={19}/></button></div>
      <div className="modal-form"><p>اختر ملف Excel أو CSV الجديد لإعادة تفعيل الماكينات وتحديث بياناتها. ستبقى السجلات غير الموجودة في الملف محفوظة ومؤرشفة.</p>
        <label className="button button-secondary replacement-file-picker"><input type="file" accept=".csv,.xlsx" disabled={uploading} onChange={(event) => setFile(event.target.files?.[0] || null)}/><FileSpreadsheet size={16}/>{file ? 'تغيير الملف' : 'اختيار ملف Excel / CSV'}</label>
        {file && <strong className="storage-delete-name">{file.name}</strong>}
        <div className="modal-actions"><button type="button" className="button button-ghost" disabled={uploading} onClick={onClose}>لاحقًا</button><button type="button" className="button button-primary" disabled={!file || uploading} onClick={() => onUpload(file)}>{uploading ? <><RefreshCw size={15} className="spin"/> جارٍ الرفع...</> : 'رفع واستبدال'} <FileSpreadsheet size={15}/></button></div>
      </div>
    </section>
  </div>
}

function formatSize(size) {
  if (!size) return '—'
  if (size < 1024) return size + ' بايت'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(value) + ' ' + units[index]
}

function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z')
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed)
}
