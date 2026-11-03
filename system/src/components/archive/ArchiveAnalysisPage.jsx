import { useEffect, useMemo, useState } from 'react'
import { Activity, Download, FileSpreadsheet, RefreshCw, Wrench } from 'lucide-react'

export default function ArchiveAnalysisPage({ data, apiClient, onProcessMissing }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState('')
  const [reasonId, setReasonId] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [error, setError] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return params.toString()
  }, [from, to])

  const loadAreas = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiClient(`/analysis/areas${query ? `?${query}` : ''}`)
      setAreas(Array.isArray(result.areas) ? result.areas : [])
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل تحليل المناطق.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadAreas() }, [query])

  const exportBulk = async (format) => {
    if (exporting) return
    setExporting(format)
    setError('')
    try {
      const response = await fetch('/api/export/bulk-maintenance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, area: areaFilter, reasonId, from, to }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'تعذر إنشاء تقرير الصيانة المجمع.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `Madar-Bulk-Maintenance.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(requestError.message || 'تعذر تنزيل التقرير.')
    } finally {
      setExporting('')
    }
  }

  const exportMachineMasterList = async () => {
    if (exporting) return
    setExporting('master-xlsx')
    setError('')
    try {
      const response = await fetch('/api/analysis/export-internal-report', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'xlsx', fullList: true }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'تعذر إنشاء قائمة الماكينات.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'Madar-Machine-Master-List.xlsx'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(requestError.message || 'تعذر تنزيل قائمة الماكينات.')
    } finally {
      setExporting('')
    }
  }

  const reasonOptions = Array.isArray(data?.reasons) ? data.reasons : []
  const totalMachines = areas.reduce((sum, area) => sum + Number(area.total_count || 0), 0)
  const totalCompleted = areas.reduce((sum, area) => sum + Number(area.completed_count || 0), 0)
  const totalMissing = Math.max(0, totalMachines - totalCompleted)

  return <div className="page-enter archive-analysis-page">
    <header className="page-heading">
      <div><span className="section-eyebrow">المراجعة والتحليل</span><h2>تحليل الأرشيف</h2><p>تابع إنجاز الصيانة حسب المنطقة وحدد الماكينات التي تحتاج إلى استكمال.</p></div>
      <div className="heading-actions"><button className="button button-secondary" onClick={() => void loadAreas()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/> تحديث التحليل</button></div>
    </header>

    <section className="panel archive-analysis-filters">
      <div className="panel-heading"><div><span className="section-eyebrow">الفترة / الحملة</span><h3>نطاق تحليل الأرشيف</h3></div><Activity size={18}/></div>
      <div className="archive-analysis-filter-grid">
        <label className="field"><span>من تاريخ الأرشفة</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)}/></label>
        <label className="field"><span>إلى تاريخ الأرشفة</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)}/></label>
        <label className="field"><span>المنطقة لتقرير التصدير</span><select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="">كل المناطق</option>{areas.map((area) => <option key={area.area} value={area.area}>{area.area}</option>)}</select></label>
        <label className="field"><span>سبب / نوع الصيانة للتقرير</span><select value={reasonId} onChange={(event) => setReasonId(event.target.value)}><option value="">كل الأسباب</option>{reasonOptions.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}</select></label>
      </div>
      <div className="archive-analysis-export-actions">
        <span>تقرير العميل:</span>
        <button className="button button-primary" onClick={() => void exportBulk('pptx')} disabled={Boolean(exporting)}><Download size={16}/>{exporting === 'pptx' ? 'جارٍ إنشاء PowerPoint...' : 'PowerPoint'}</button>
        <button className="button button-secondary" onClick={() => void exportBulk('docx')} disabled={Boolean(exporting)}><Download size={16}/>{exporting === 'docx' ? 'جارٍ إنشاء Word...' : 'Word'}</button>
        <span className="internal-report-divider">قائمة كل الماكينات للطباعة:</span>
        <button className="button button-secondary" onClick={() => void exportMachineMasterList()} disabled={Boolean(exporting)}><FileSpreadsheet size={16}/>{exporting === 'master-xlsx' ? 'جارٍ إنشاء Excel...' : 'إكسيل القائمة الكاملة'}</button>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </section>

    <section className="archive-analysis-summary">
      <article className="panel analysis-summary-card"><span>إجمالي الماكينات النشطة</span><strong>{totalMachines}</strong></article>
      <article className="panel analysis-summary-card"><span>أُنجزت في أوامر صيانة مؤرشفة</span><strong>{totalCompleted}</strong></article>
      <article className="panel analysis-summary-card"><span>ماكينات تحتاج للاستكمال</span><strong>{totalMissing}</strong></article>
    </section>

    <div className="archive-analysis-area-heading"><div><span className="section-eyebrow">مؤشرات التقدم</span><h3>إنجاز كل منطقة</h3></div><span className="result-count">{areas.length} منطقة</span></div>
    {loading ? <div className="panel loading-inline">جارٍ تحليل الأرشيف...</div> : areas.length ? <div className="archive-area-grid">
      {areas.map((area) => <article className="panel archive-area-card" key={area.area}>
        <header><div><span className="section-eyebrow">المنطقة</span><h3>{area.area}</h3></div><span className="archive-area-percent">{Number(area.completion_ratio || 0).toLocaleString('ar-EG')}٪</span></header>
        <div className="archive-progress-track" role="progressbar" aria-label={`نسبة الإنجاز في ${area.area}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={area.completion_ratio}>
          <span style={{ width: `${Math.max(0, Math.min(100, Number(area.completion_ratio || 0)))}%` }}/>
        </div>
        <div className="archive-area-counts"><strong>{area.completed_count} من {area.total_count}</strong><span>ماكينة أُنجزت</span><span className="archive-area-missing-count">متبقية: {area.missing_machines.length}</span></div>
        <section className="archive-missing-list">
          <div className="archive-missing-title"><strong>الماكينات غير المنجزة</strong>
            <button className="button button-small button-primary" disabled={!area.missing_machines.length} onClick={() => onProcessMissing?.(area)}><Wrench size={14}/> تدارك النواقص</button>
          </div>
          {area.missing_machines.length ? <ul>{area.missing_machines.map((machine) => <li key={machine.id}><b>{machine.code}</b><span>{machine.name_ar}</span></li>)}</ul> : <p className="archive-all-complete">اكتمل أرشيف الصيانة لجميع ماكينات المنطقة.</p>}
        </section>
      </article>)}
    </div> : <div className="panel empty-inline">لا توجد ماكينات نشطة ضمن النطاق المحدد.</div>}
  </div>
}
