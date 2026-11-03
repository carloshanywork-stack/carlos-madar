import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Folder, FolderOpen, RefreshCw, ShieldCheck, X } from 'lucide-react'

export default function AreaFileExplorerModal({ onClose, onSelect, apiClient, rootLabel = 'Areas' }) {
  const [currentPath, setCurrentPath] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const parts = useMemo(() => currentPath ? currentPath.split('/').filter(Boolean) : [], [currentPath])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const query = currentPath ? '?path=' + encodeURIComponent(currentPath) : ''
    apiClient('/storage/explorer' + query)
      .then((items) => { if (active) setFolders(Array.isArray(items) ? items : []) })
      .catch((requestError) => { if (active) { setFolders([]); setError(requestError.message || 'تعذرت قراءة المجلدات.') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [apiClient, currentPath, reloadKey])

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const navigateTo = (path) => {
    setCurrentPath(path)
    setSelectedPath(path)
  }
  const choose = () => {
    if (!selectedPath) return
    onSelect(selectedPath)
  }

  return <div className="modal-backdrop server-folder-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal-card server-folder-modal" role="dialog" aria-modal="true" aria-labelledby="area-explorer-title" dir="rtl">
      <div className="modal-header">
        <div><span className="section-eyebrow">مَدَار · صور المناطق</span><h2 id="area-explorer-title">اختيار مجلد الصور</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={19}/></button>
      </div>
      <div className="server-folder-modal-content">
        <p className="server-folder-description">تنقّل بين السنوات والمناطق ومجلدات الماكينات. يتم تحميل مستوى واحد عند فتحه.</p>
        <nav className="area-explorer-breadcrumb" aria-label="مسار المجلد">
          <button type="button" aria-current={parts.length ? undefined : 'page'} onClick={() => navigateTo('')}>{rootLabel}</button>
          {parts.map((part, index) => {
            const path = parts.slice(0, index + 1).join('/')
            return <span className="area-breadcrumb-part" key={path}><span aria-hidden="true">/</span><button type="button" aria-current={index === parts.length - 1 ? 'page' : undefined} onClick={() => navigateTo(path)}>{part}</button></span>
          })}
        </nav>
        {loading ? <div className="server-folder-loading"><RefreshCw size={20} className="spin"/> جارٍ تحميل هذا المستوى...</div>
          : error ? <div className="server-folder-empty"><strong>تعذرت قراءة المجلد</strong><small>{error}</small><button type="button" className="button button-secondary button-small" onClick={() => setReloadKey((value) => value + 1)}>إعادة المحاولة</button></div>
            : folders.length ? <div className="server-folder-list" role="list" aria-label="المجلدات الفرعية">{folders.map((folder) => <button type="button" role="listitem" key={folder.path}
              className={'server-folder-option ' + (selectedPath === folder.path ? 'server-folder-option-selected' : '')}
              aria-pressed={selectedPath === folder.path}
              onClick={() => setSelectedPath(folder.path)}
              onDoubleClick={() => navigateTo(folder.path)}>
              <span className="server-folder-option-icon"><FolderOpen size={19}/></span>
              <span className="server-folder-option-copy"><strong>{folder.name}</strong><small>{folder.path}</small></span>
              <ArrowLeft size={16}/>
            </button>)}</div>
              : <div className="server-folder-empty"><span><Folder size={23}/></span><strong>لا توجد مجلدات فرعية</strong><small>{parts.length ? 'يمكنك اختيار هذا المستوى أو الرجوع عبر مسار التنقل.' : 'لا توجد مجلدات تحت ' + rootLabel + '.'}</small></div>}
      </div>
      <div className="server-folder-modal-footer">
        <span><ShieldCheck size={14}/>{selectedPath ? 'المحدد: ' + selectedPath : 'اختر مجلدًا من القائمة'}</span>
        <div>
          <button type="button" className="button button-ghost" onClick={onClose}>إلغاء</button>
          {currentPath && <button type="button" className="button button-secondary" disabled={loading} onClick={() => setSelectedPath(currentPath)}>اختيار المستوى الحالي</button>}
          <button type="button" className="button button-primary" disabled={!selectedPath || loading} onClick={choose}>تأكيد الاختيار</button>
        </div>
      </div>
    </section>
  </div>
}
