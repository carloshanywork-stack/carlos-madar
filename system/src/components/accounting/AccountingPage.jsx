import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BookOpenCheck, RefreshCw, Save, Wallet, Plus, CircleDollarSign } from 'lucide-react'

const mappingLabels = {
  factory_cashbox: 'صندوق المصنع (Madar فقط)',
  customer_receivables: 'ذمم العملاء',
  inventory: 'مخزون المواد',
  work_order_wip: 'مواد تحت التشغيل',
  employee_advances: 'سلف الموظفين',
  sales_tax_payable: 'ضريبة المبيعات المستحقة',
  salary_payable: 'الرواتب المستحقة',
  owner_funding: 'تمويل المالك (اعتماد المحاسب)',
  opening_equity: 'مقابل الأرصدة الافتتاحية',
  sales_revenue: 'إيرادات المبيعات',
  payroll_expense: 'مصروف الرواتب',
  inventory_variance: 'فروقات الجرد',
  work_order_cogs: 'تكلفة مواد أوامر التشغيل (FIFO)',
  inventory_consumption: 'استهلاك مواد عام',
}
const accountTypes = [
  ['asset', 'أصل'], ['liability', 'التزام'], ['equity', 'حقوق ملكية'], ['revenue', 'إيراد'], ['expense', 'مصروف'],
]
const journalStatusLabels = { posted: 'مرحّل', pending_configuration: 'بانتظار اعتماد الربط', reversed: 'معكوس' }
const money = (cents) => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  .format(Number(cents || 0) / 100)
const currentPeriod = () => new Date().toISOString().slice(0, 7)
const blankOpeningLine = () => ({ lineType: 'account', accountId: '', side: 'debit', amount: '', description: '',
  clientId: '', materialId: '', employeeId: '', invoiceCode: '', quantity: '', originalDate: '', dueDate: '' })

export default function AccountingPage({ apiClient, data, notify, onRefresh }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [tab, setTab] = useState('reports')
  const [setup, setSetup] = useState({ accounts: [], mappings: [], pending: [] })
  const [reports, setReports] = useState(null)
  const [trialBalance, setTrialBalance] = useState(null)
  const [taxRates, setTaxRates] = useState([])
  const [payroll, setPayroll] = useState({ employees: [], records: [] })
  const [openingBatches, setOpeningBatches] = useState([])
  const [ledger, setLedger] = useState(null)
  const [journalEntries, setJournalEntries] = useState([])
  const [auditEntries, setAuditEntries] = useState([])
  const [journalSourceType, setJournalSourceType] = useState('')
  const [journalSourceId, setJournalSourceId] = useState('')
  const [journalAccountId, setJournalAccountId] = useState('')
  const [auditEntity, setAuditEntity] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [period, setPeriod] = useState(currentPeriod())
  const [payrollForm, setPayrollForm] = useState({ employeeId: '', baseSalary: '', bonus: '0', deduction: '0', cashPaid: '0' })
  const [advanceForm, setAdvanceForm] = useState({ employeeId: '', amount: '', notes: '' })
  const [taxForm, setTaxForm] = useState({ label: '', percent: '' })
  const [accountForm, setAccountForm] = useState({ code: '', name: '', accountType: 'expense' })
  const [openingDate, setOpeningDate] = useState('')
  const [openingLines, setOpeningLines] = useState([blankOpeningLine(), blankOpeningLine()])
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams()
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      const journalQuery = new URLSearchParams(query)
      if (journalSourceType) journalQuery.set('sourceType', journalSourceType)
      if (journalSourceId.trim()) journalQuery.set('sourceId', journalSourceId.trim())
      if (journalAccountId) journalQuery.set('accountId', journalAccountId)
      journalQuery.set('limit', '200')
      const auditQuery = new URLSearchParams(query)
      if (auditEntity) auditQuery.set('entity', auditEntity)
      if (auditAction) auditQuery.set('action', auditAction)
      auditQuery.set('limit', '200')
      const [accountSetup, reportRows, balance, rates, payrollData, openings, journalRows, auditRows] = await Promise.all([
        apiClient('/accounting/setup'), apiClient(`/accounting/reports?${query}`), apiClient(`/accounting/trial-balance?${query}`),
        apiClient('/accounting/tax-rates'), apiClient(`/payroll?period=${encodeURIComponent(period)}`),
        apiClient('/accounting/opening-balances'),
        apiClient(`/accounting/journal?${journalQuery}`), apiClient(`/audit?${auditQuery}`),
      ])
      setSetup(accountSetup)
      setReports(reportRows)
      setTrialBalance(balance)
      setTaxRates(rates)
      setPayroll(payrollData)
      setOpeningBatches(openings)
      setJournalEntries(journalRows)
      setAuditEntries(auditRows)
    } catch (error) { setMessage(error.message || 'تعذر تحميل بيانات المحاسبة.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [apiClient, from, to, period, journalSourceType, journalSourceId, journalAccountId, auditEntity, auditAction])

  useEffect(() => {
    if (location.hash.startsWith('#payroll-record-')) setTab('payroll')
    else if (location.hash.startsWith('#opening-balance-')) setTab('opening')
  }, [location.hash])
  useEffect(() => {
    if (!location.hash) return
    requestAnimationFrame(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [location.hash, tab, payroll.records, openingBatches])

  const activeAccounts = useMemo(() => setup.accounts.filter((account) => account.active), [setup.accounts])
  const selectedPayrollEmployee = payroll.employees.find((employee) => Number(employee.id) === Number(payrollForm.employeeId))
  const submit = async (action, success) => {
    setSaving(true)
    setMessage('')
    try { await action(); await load(); await onRefresh?.(); notify?.(success) }
    catch (error) { setMessage(error.message || 'تعذر حفظ البيانات.'); notify?.(error.message || 'تعذر حفظ البيانات.') }
    finally { setSaving(false) }
  }

  const createPayrollDraft = (event) => {
    event.preventDefault()
    submit(async () => {
      const draft = await apiClient('/payroll', { method: 'POST', body: JSON.stringify({
        employeeId: Number(payrollForm.employeeId), period,
        ...(payrollForm.baseSalary === '' ? {} : { baseSalary: payrollForm.baseSalary }),
        bonus: payrollForm.bonus, deduction: payrollForm.deduction,
      }) })
      const finalized = await apiClient(`/payroll/${draft.id}/finalize`, { method: 'POST', body: JSON.stringify({ cashPaid: payrollForm.cashPaid }) })
      if (finalized.status !== 'finalized') throw new Error('لم يتم إقفال مسير الرواتب.')
    }, 'تم اعتماد مسير الرواتب وتسجيل النقد الفعلي فقط.')
  }

  const createAdvance = (event) => {
    event.preventDefault()
    submit(() => apiClient('/payroll/advances', { method: 'POST', body: JSON.stringify({
      employeeId: Number(advanceForm.employeeId), amount: advanceForm.amount, notes: advanceForm.notes,
    }) }), 'تم تسجيل السلفة النقدية ورصيد الموظف.')
  }

  const saveOpening = (event) => {
    event.preventDefault()
    submit(() => apiClient('/accounting/opening-balances', { method: 'POST', body: JSON.stringify({
      cutoverDate: openingDate,
      lines: openingLines.map((line) => ({ ...line, accountId: Number(line.accountId),
        clientId: line.clientId ? Number(line.clientId) : null,
        materialId: line.materialId ? Number(line.materialId) : null,
        employeeId: line.employeeId ? Number(line.employeeId) : null,
        quantity: line.quantity === '' ? null : Number(line.quantity),
      })),
    }) }), 'تم حفظ مسودة الأرصدة الافتتاحية. لا ترحّلها قبل اعتماد المحاسب.')
  }

  const tabs = [['reports', 'التقارير ودليل الحسابات'], ['journal', 'دفتر القيود'], ['audit', 'سجل التدقيق'],
    ['payroll', 'الرواتب والسلف'], ['opening', 'الأرصدة الافتتاحية']]
  return <div className="page-enter">
    <div className="page-heading"><div><span className="section-eyebrow">القيود والمطابقة</span><h2>المحاسبة والرواتب</h2><p>كل قيد مرحّل متوازن؛ تبقى الحركات معلّقة حتى اعتماد روابط الحسابات المطلوبة.</p></div>
      <button className="button button-ghost" disabled={loading || saving} onClick={load}><RefreshCw size={16}/> تحديث</button></div>
    <div className="filter-panel panel"><div className="filter-fields">
      <label><span>من تاريخ</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
      <label><span>إلى تاريخ</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
      <label><span>فترة الرواتب</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)}/></label>
    </div></div>
    <div className="heading-actions accounting-tabs">{tabs.map(([key, label]) => <button key={key}
      className={`button ${tab === key ? 'button-primary' : 'button-ghost'}`} onClick={() => setTab(key)}>{label}</button>)}</div>
    {message && <div className="inline-error" role="alert">{message}</div>}
    {loading ? <div className="panel loading-inline">جارٍ تحميل بيانات المحاسبة...</div> : <>
      {tab === 'reports' && <>
        <section className="finance-summary-grid">
          <FinanceMetric label="مدين ميزان المراجعة" cents={trialBalance?.totals?.debitCents}/>
          <FinanceMetric label="دائن ميزان المراجعة" cents={trialBalance?.totals?.creditCents}/>
          <div className="finance-stat"><div className="finance-stat-icon blue"><BookOpenCheck size={18}/></div><div><span>توازن الميزان</span><strong>{trialBalance?.balanced ? 'متوازن' : 'غير متوازن'}</strong></div></div>
          <FinanceMetric label="صندوق المصنع" cents={reports?.cashboxBalanceCents}/>
        </section>
        <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">ربحية أوامر العمل</span><h3>فواتير مرتبطة بالأوامر − تكلفة مواد FIFO</h3></div><span className="result-count">{reports?.profitStatus === 'complete' ? 'مكتمل' : reports?.profitStatus === 'pending_work_order_cogs_journals' ? `${reports?.pendingWorkOrderCogsEntries || 0} قيد تكلفة بانتظار اعتماد الحساب` : `يحتاج تحويل ${reports?.unclassifiedHistoricalIssueCount || 0} حركة تاريخية`}</span></div><div className="finance-summary-grid"><FinanceMetric label="إيراد فواتير الأوامر قبل الضريبة" cents={reports?.workOrderRevenueCents}/><FinanceMetric label="تكلفة مواد الأوامر" cents={reports?.workOrderCogsCents}/><FinanceMetric label="الربح الإجمالي المعروف" cents={reports?.grossProfitCents}/></div><p className="field-help">تُحتسب التكلفة من سجلات استهلاك دفعات FIFO، وتُستبعد قيمة البواقي المعاد استخدامها. الحركات التاريخية غير المصنفة لا تُخمّن ضمن أوامر.</p></section>
        <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">الأستاذ العام</span><h3>ميزان المراجعة — اضغط على حساب للتفصيل</h3></div><span className="result-count">{reports?.pendingJournalEntries || 0} قيود معلقة · {reports?.unconfiguredMappingCount || 0} ربط غير معتمد</span></div>
          <div className="table-wrap"><table><thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>
            {(trialBalance?.rows || []).map((row) => <tr key={row.id}><td>{row.code}</td><td><button className="text-link" onClick={() => apiClient(`/accounting/ledger?accountId=${row.id}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`).then(setLedger).catch((error) => setMessage(error.message))}>{row.name}</button></td><td>{accountTypes.find(([type]) => type === row.account_type)?.[1] || row.account_type}</td><td>{money(row.debit_cents)} ج.م</td><td>{money(row.credit_cents)} ج.م</td><td>{money(Math.abs(Number(row.debit_cents) - Number(row.credit_cents)))} ج.م</td></tr>)}
          </tbody></table></div>
        </div>
        {ledger && <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">الأستاذ التفصيلي</span><h3>{ledger.account.code} — {ledger.account.name}</h3></div><button className="button button-ghost button-small" onClick={() => setLedger(null)}>إغلاق</button></div><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المصدر</th><th>الوصف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>{ledger.transactions.map((row) => <tr key={row.id}><td>{row.created_at}</td><td>{row.source_type} · {row.source_id}</td><td>{row.description || row.journal_description}</td><td>{money(row.debit_cents)}</td><td>{money(row.credit_cents)}</td><td>{money(Math.abs(row.balanceCents))}</td></tr>)}</tbody></table></div></div>}
        <div className="accounting-statements">
          <StatementPanel title="الميزانية العمومية" rows={reports?.balanceSheet || []} onAccount={(id) => apiClient(`/accounting/ledger?accountId=${id}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`).then(setLedger).catch((error) => setMessage(error.message))}/>
          <StatementPanel title="قائمة الدخل" rows={reports?.incomeStatement || []} onAccount={(id) => apiClient(`/accounting/ledger?accountId=${id}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`).then(setLedger).catch((error) => setMessage(error.message))}/>
        </div>
        <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">الضرائب والفواتير</span><h3>ملخص ضريبة المبيعات والذمم المفتوحة</h3></div></div>
          <div className="table-wrap"><table><thead><tr><th>النوع</th><th>التفصيل</th><th>الأساس</th><th>الضريبة / المتبقي</th><th>عدد الفواتير</th></tr></thead><tbody>
            {(reports?.taxSummary || []).map((row) => <tr key={`tax-${row.tax_rate_basis_points}`}><td>ضريبة</td><td>{(row.tax_rate_basis_points / 100).toFixed(2)}%</td><td>{money(row.subtotal_cents)} ج.م</td><td>{money(row.tax_cents)} ج.م</td><td>{row.invoice_count}</td></tr>)}
            {(reports?.receivables || []).map((row) => <tr key={`ar-${row.id}`}><td>ذمم</td><td>{row.client_name} · {row.code}</td><td>الإجمالي {money(Math.round(row.total * 100))} ج.م</td><td>{money(Math.round(row.remaining * 100))} ج.م</td><td>{row.created_at}</td></tr>)}
            {!reports?.taxSummary?.length && !reports?.receivables?.length && <tr><td colSpan="5">لا توجد ضرائب أو ذمم مفتوحة ضمن السجل.</td></tr>}
          </tbody></table></div>
          <p className="field-help">أرصدة الذمم المفتوحة تشمل كل تواريخ القطع؛ الضريبة تتبع نطاق التاريخ المحدد أعلاه.</p>
        </div>
        <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">مطابقة التهيئة</span><h3>اعتماد روابط الحسابات</h3></div></div>
          <div className="table-wrap"><table><thead><tr><th>الغرض</th><th>الحساب المعتمد</th><th>الحالة</th></tr></thead><tbody>{setup.mappings.filter((mapping) => mappingLabels[mapping.mapping_key] || mapping.mapping_key.startsWith('expense_category:') || mapping.mapping_key.startsWith('treasury_')).map((mapping) => <tr key={mapping.mapping_key}><td>{mappingLabels[mapping.mapping_key] || mapping.mapping_key}</td><td><select value={mapping.account_id || ''} disabled={saving} onChange={(event) => submit(() => apiClient(`/accounting/mappings/${encodeURIComponent(mapping.mapping_key)}`, { method: 'PUT', body: JSON.stringify({ accountId: Number(event.target.value) }) }), 'تم اعتماد ربط الحساب وترحيل القيود المكتملة.')}>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></td><td>{mapping.approved ? 'معتمد' : 'بانتظار المحاسب'}</td></tr>)}</tbody></table></div>
        </div>
        <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">قيود تنتظر الإعداد</span><h3>قيود لم تُرحّل بعد</h3></div><span className="result-count">{setup.pending.length}</span></div>
          {setup.pending.length ? <div className="table-wrap"><table><thead><tr><th>المصدر</th><th>الوصف</th><th>تاريخ الإنشاء</th></tr></thead><tbody>{setup.pending.map((entry) => <tr key={entry.id}><td>{entry.source_type} · {entry.source_id}</td><td>{entry.description}</td><td>{entry.created_at}</td></tr>)}</tbody></table></div> : <div className="empty-inline">كل القيود قابلة للترحيل بعد اعتماد الروابط المطلوبة.</div>}
        </div>
        <div className="panel modal-form"><h3>إضافة حساب</h3><form className="form-row" onSubmit={(event) => { event.preventDefault(); submit(() => apiClient('/accounting/accounts', { method: 'POST', body: JSON.stringify(accountForm) }), 'تم إنشاء الحساب.') }}><label className="field"><span>الكود</span><input required value={accountForm.code} onChange={(event) => setAccountForm({ ...accountForm, code: event.target.value })}/></label><label className="field"><span>الاسم</span><input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })}/></label><label className="field"><span>النوع</span><select value={accountForm.accountType} onChange={(event) => setAccountForm({ ...accountForm, accountType: event.target.value })}>{accountTypes.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><button className="button button-primary" disabled={saving}><Plus size={15}/> إنشاء</button></form></div>
        <div className="panel modal-form"><h3>نسب ضريبة المبيعات المعتمدة</h3><div className="tax-rate-list">{taxRates.map((rate) => <div className="tax-rate-row" key={rate.id}><span>{rate.label} · {(rate.rate_basis_points / 100).toFixed(2)}%</span>{rate.rate_basis_points > 0 && <button type="button" className="text-button danger-text" disabled={saving} onClick={() => submit(() => apiClient(`/accounting/tax-rates/${rate.id}`, { method: 'DELETE' }), 'تم تعطيل النسبة؛ بقي أثر الفواتير التاريخية محفوظًا.')}>تعطيل</button>}</div>)}</div><form className="form-row" onSubmit={(event) => { event.preventDefault(); submit(() => apiClient('/accounting/tax-rates', { method: 'POST', body: JSON.stringify({ label: taxForm.label, rateBasisPoints: Math.round(Number(taxForm.percent) * 100) }) }), 'تم تسجيل النسبة؛ أصبحت متاحة للمبيعات.') }}><label className="field"><span>وصف الضريبة</span><input required value={taxForm.label} onChange={(event) => setTaxForm({ ...taxForm, label: event.target.value })}/></label><label className="field"><span>النسبة المئوية</span><input required type="number" min="0" max="1000" step="0.01" value={taxForm.percent} onChange={(event) => setTaxForm({ ...taxForm, percent: event.target.value })}/></label><button className="button button-secondary" disabled={saving}><Plus size={15}/> إضافة نسبة</button></form></div>
      </>}
      {tab === 'journal' && <>
        <section className="filter-panel panel"><div className="filter-fields">
          <label><span>نوع المصدر</span><input value={journalSourceType} onChange={(event) => setJournalSourceType(event.target.value)} placeholder="مثال: sales_invoice"/></label>
          <label><span>رقم المصدر</span><input value={journalSourceId} onChange={(event) => setJournalSourceId(event.target.value)} placeholder="رقم الفاتورة أو الحركة"/></label>
          <label><span>الحساب</span><select value={journalAccountId} onChange={(event) => setJournalAccountId(event.target.value)}><option value="">كل الحسابات</option>{setup.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
        </div></section>
        <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">دفتر القيود العام</span><h3>القيود المرحّلة والمعلّقة</h3></div><span className="result-count">{journalEntries.length} قيد</span></div>
          {journalEntries.length ? <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحالة</th><th>مرجع المصدر</th><th>الوصف</th><th>مدين</th><th>دائن</th><th>المنشئ</th><th>السطور</th></tr></thead><tbody>
            {journalEntries.map((entry) => <tr key={entry.id}><td>{entry.created_at}</td><td>{journalStatusLabels[entry.status] || entry.status}</td>
              <td>{entry.source_href ? <button className="text-link" onClick={() => navigate(entry.source_href)} title="فتح شاشة المصدر"><strong>{entry.source_type} · {entry.source_id}</strong></button> : <strong>{entry.source_type} · {entry.source_id}</strong>}<br/><code>{entry.source_key}</code></td><td>{entry.description || '—'}</td>
              <td>{money(entry.total_debit_cents)} ج.م</td><td>{money(entry.total_credit_cents)} ج.م</td><td>{entry.actor_name || '—'}</td>
              <td><details><summary>{entry.lines?.length || 0} سطر</summary>{entry.lines?.length ? <div className="journal-line-list">{entry.lines.map((line) => <div key={line.id}><strong>{line.account_code} — {line.account_name}</strong><span>{line.description || '—'}</span><span>مدين {money(line.debit_cents)} · دائن {money(line.credit_cents)} ج.م</span></div>)}</div> : <span>لا توجد سطور مرحّلة.</span>}</details></td></tr>)}
          </tbody></table></div> : <div className="empty-inline">لا توجد قيود ضمن الفلاتر المحددة.</div>}
        </section>
      </>}
      {tab === 'audit' && <>
        <section className="filter-panel panel"><div className="filter-fields">
          <label><span>نوع الكيان</span><input value={auditEntity} onChange={(event) => setAuditEntity(event.target.value)} placeholder="مثال: stock-count"/></label>
          <label><span>الإجراء</span><input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="مثال: count-items"/></label>
        </div></section>
        <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">سجل التغييرات الحساسة</span><h3>أثر المستخدمين والبيانات</h3></div><span className="result-count">{auditEntries.length} حدث</span></div>
          {auditEntries.length ? <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>الإجراء</th><th>الكيان / المرجع</th><th>التفاصيل</th><th>القيم السابقة والجديدة</th></tr></thead><tbody>
            {auditEntries.map((entry) => <tr key={entry.id}><td>{entry.created_at}</td><td>{entry.actor_name || entry.username || '—'}</td>
              <td>{entry.action}</td><td><strong>{entry.entity} · {entry.entity_id || '—'}</strong></td><td>{entry.details || '—'}</td>
              <td><details><summary>عرض القيم</summary><pre className="audit-json">{JSON.stringify({ old: entry.old_values, new: entry.new_values }, null, 2)}</pre></details></td></tr>)}
          </tbody></table></div> : <div className="empty-inline">لا توجد أحداث تدقيق ضمن الفلاتر المحددة.</div>}
        </section>
      </>}
      {tab === 'payroll' && <>
        <div className="panel modal-form"><div className="panel-heading"><div><span className="section-eyebrow">مسير شهري</span><h3>اعتماد رواتب شهر {period}</h3></div></div><form className="form-grid" onSubmit={createPayrollDraft}>
          <label className="field"><span>الموظف</span><select required value={payrollForm.employeeId} onChange={(event) => setPayrollForm({ ...payrollForm, employeeId: event.target.value, baseSalary: '' })}><option value="">اختر موظفًا</option>{payroll.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} — أساسي {money(employee.monthly_salary_cents)} ج.م</option>)}</select></label>
          <label className="field"><span>الراتب الأساسي (ج.م، اختياري)</span><input type="number" min="0" step="0.01" value={payrollForm.baseSalary} onChange={(event) => setPayrollForm({ ...payrollForm, baseSalary: event.target.value })} placeholder="استخدم الراتب المحفوظ"/></label>
          <div className="modal-hint">الدوام والإضافي يُسحبان تلقائيًا من سجل الحضور: غياب {selectedPayrollEmployee?.attendance?.absence_days ?? 0} يوم · إضافي عادي {selectedPayrollEmployee?.attendance?.ordinary_overtime_minutes ?? 0} دقيقة · إضافي عطلات {selectedPayrollEmployee?.attendance?.holiday_overtime_minutes ?? 0} دقيقة.</div>
          <label className="field"><span>مكافأة (ج.م)</span><input type="number" min="0" step="0.01" value={payrollForm.bonus} onChange={(event) => setPayrollForm({ ...payrollForm, bonus: event.target.value })}/></label>
          <label className="field"><span>خصم (ج.م)</span><input type="number" min="0" step="0.01" value={payrollForm.deduction} onChange={(event) => setPayrollForm({ ...payrollForm, deduction: event.target.value })}/></label>
          <label className="field"><span>المدفوع نقدًا الآن (ج.م)</span><input type="number" min="0" step="0.01" value={payrollForm.cashPaid} onChange={(event) => setPayrollForm({ ...payrollForm, cashPaid: event.target.value })}/><small className="field-help">يُسجل النقد الفعلي فقط؛ الرصيد غير المدفوع يبقى التزامًا.</small></label>
          <button className="button button-primary" disabled={saving}><Save size={15}/> إنشاء المسير وإقفاله</button>
        </form></div>
        <div className="panel modal-form"><h3>صرف سلفة موظف</h3><form className="form-row" onSubmit={createAdvance}><label className="field"><span>الموظف</span><select required value={advanceForm.employeeId} onChange={(event) => setAdvanceForm({ ...advanceForm, employeeId: event.target.value })}><option value="">اختر موظفًا</option>{payroll.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select></label><label className="field"><span>المبلغ (ج.م)</span><input required type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={(event) => setAdvanceForm({ ...advanceForm, amount: event.target.value })}/></label><label className="field"><span>ملاحظات</span><input value={advanceForm.notes} onChange={(event) => setAdvanceForm({ ...advanceForm, notes: event.target.value })}/></label><button className="button button-secondary" disabled={saving}><Wallet size={15}/> صرف السلفة</button></form></div>
           <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">سجل الرواتب</span><h3>تفصيل استحقاقات الموظفين للفترة</h3></div></div><div className="table-wrap"><table><thead><tr><th>الموظف</th><th>أساسي</th><th>غياب</th><th>خصم الغياب</th><th>إضافي عادي</th><th>إضافي عطلات</th><th>مكافأة</th><th>خصم إضافي</th><th>تسوية سلف</th><th>صافي الاستحقاق</th><th>مدفوع</th><th>راتب غير مسدد</th><th>رصيد السلفة</th><th>حالة</th><th/></tr></thead><tbody>{payroll.records.map((record) => <tr key={record.id} id={`payroll-record-${record.id}`}><td>{record.employee_name}</td><td>{money(record.base_salary_cents)}</td><td>{record.absence_days}</td><td>{money(record.absence_deduction_cents)}</td><td>{money(record.ordinary_overtime_cents)}</td><td>{money(record.holiday_overtime_cents)}</td><td>{money(record.bonus_cents)}</td><td>{money(record.deduction_cents)}</td><td>{money(record.advances_applied_cents)}</td><td>{money(record.net_entitlement_cents)}</td><td>{money(record.cash_paid_cents)}</td><td>{money(record.unpaid_salary_cents)}</td><td>{money(record.advance_balance_cents)}</td><td>{record.status === 'finalized' ? 'مقفل' : 'مسودة'}</td><td>{record.unpaid_salary_cents > 0 && <button className="button button-ghost button-small" disabled={saving} onClick={() => { const amount = window.prompt('مبلغ سداد مستحقات الراتب بالجنيه:'); if (amount) submit(() => apiClient(`/payroll/${record.id}/payments`, { method: 'POST', body: JSON.stringify({ amount }) }), 'تم تسجيل سداد الراتب.') }}>سداد مستحق</button>}</td></tr>)}</tbody></table></div></div>
      </>}
      {tab === 'opening' && <>
        <section className="invoice-note"><CircleDollarSign size={17}/><span>لا يُستورد أي تاريخ سابق. جهّز جداول الأرصدة عند تاريخ قطع معتمد، ثم اعتمد قيد افتتاحي متوازن فقط.</span></section>
        {openingBatches.some((batch) => batch.status === 'posted') && <section className="invoice-note"><BookOpenCheck size={17}/><span>يوجد تاريخ قطع مرحّل؛ أُقفلت الأرصدة الافتتاحية. يجب جمع كل جداول القطع في مسودة واحدة قبل الترحيل.</span></section>}
        <div className="panel modal-form"><h3>مسودة جدول الأرصدة</h3><form onSubmit={saveOpening}><fieldset className="opening-form-fields" disabled={saving || openingBatches.some((batch) => batch.status === 'posted')}>
          <label className="field"><span>تاريخ القطع</span><input type="date" required value={openingDate} onChange={(event) => setOpeningDate(event.target.value)}/></label>
          {openingLines.map((line, index) => <div className="filter-fields opening-line" key={index}>
            <label><span>نوع الجدول</span><select value={line.lineType} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, lineType: event.target.value } : item))}><option value="account">حساب عام</option><option value="cashbox">صندوق المصنع</option><option value="inventory">مخزون</option><option value="receivable">ذمم مدينة</option><option value="payable">ذمم دائنة</option><option value="employee_advance">سلفة موظف</option></select></label>
            <label><span>الحساب</span><select required value={line.accountId} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, accountId: event.target.value } : item))}><option value="">اختر</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
            <label><span>الطرف</span><select value={line.side} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, side: event.target.value } : item))}><option value="debit">مدين</option><option value="credit">دائن</option></select></label>
            <label><span>المبلغ (ج.م)</span><input required type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))}/></label>
            {line.lineType === 'inventory' && <><label><span>الصنف</span><select required value={line.materialId} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, materialId: event.target.value } : item))}><option value="">اختر</option>{data.materials.map((item) => <option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select></label><label><span>إجمالي الكمية</span><input required type="number" min="0" step="0.000001" value={line.quantity} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))}/></label></>}
            {line.lineType === 'receivable' && <><label><span>العميل</span><select required value={line.clientId} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, clientId: event.target.value } : item))}><option value="">اختر</option>{data.clients.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>رقم الفاتورة السابقة</span><input required value={line.invoiceCode} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, invoiceCode: event.target.value } : item))}/></label></>}
            {line.lineType === 'payable' && <label><span>مرجع فاتورة / مورد</span><input required value={line.invoiceCode} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, invoiceCode: event.target.value } : item))}/></label>}
            {line.lineType === 'employee_advance' && <label><span>الموظف</span><select required value={line.employeeId} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, employeeId: event.target.value } : item))}><option value="">اختر</option>{payroll.employees.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
             <label><span>تاريخ المستند الأصلي</span><input type="date" value={line.originalDate} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, originalDate: event.target.value } : item))}/></label>
             <label><span>تاريخ الاستحقاق</span><input type="date" value={line.dueDate} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, dueDate: event.target.value } : item))}/></label>
             <label><span>الوصف</span><input value={line.description} onChange={(event) => setOpeningLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))}/></label>
          </div>)}
           <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setOpeningLines((current) => [...current, blankOpeningLine()])}><Plus size={15}/> إضافة سطر</button><button type="submit" className="button button-primary" disabled={saving}><Save size={15}/> حفظ المسودة</button></div>
         </fieldset></form></div>
         <div className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">جدول القطع</span><h3>الأرصدة المحفوظة</h3></div></div><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحالة</th><th>عدد السطور</th><th>مدين</th><th>دائن</th><th/></tr></thead><tbody>{openingBatches.map((batch) => { const debit = batch.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount_cents, 0); const credit = batch.lines.filter((line) => line.side === 'credit').reduce((sum, line) => sum + line.amount_cents, 0); return <tr key={batch.id} id={`opening-balance-${batch.id}`}><td>{batch.cutover_date}</td><td>{batch.status}</td><td>{batch.lines.length}</td><td>{money(debit)}</td><td>{money(credit)}</td><td>{batch.status === 'draft' && <button className="button button-primary button-small" disabled={saving} onClick={() => submit(() => apiClient(`/accounting/opening-balances/${batch.id}/post`, { method: 'POST', body: '{}' }), 'تم ترحيل الأرصدة الافتتاحية.')}>اعتماد</button>}</td></tr> })}</tbody></table></div></div>
      </>}
    </>}
  </div>
}

function FinanceMetric({ label, cents }) {
  return <div className="finance-stat"><div className="finance-stat-icon purple"><CircleDollarSign size={18}/></div><div><span>{label}</span><strong>{money(cents)} <small>ج.م</small></strong></div></div>
}

function StatementPanel({ title, rows, onAccount }) {
  return <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">التقارير المحاسبية</span><h3>{title}</h3></div></div>
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td><button className="text-link" onClick={() => onAccount(row.id)}>{row.code} — {row.name}</button></td>
      <td>{accountTypes.find(([type]) => type === row.account_type)?.[1] || row.account_type}</td>
      <td>{money(row.balance_cents)} ج.م</td>
    </tr>)}</tbody></table></div> : <div className="empty-inline">لا توجد أرصدة ضمن النطاق المحدد.</div>}
  </section>
}
