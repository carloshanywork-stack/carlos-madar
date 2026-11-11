import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatDate, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';

const tabs = [
  { value: 'treasury', label: 'الخزينة' },
  { value: 'sales', label: 'فواتير المبيعات' },
  { value: 'purchase', label: 'فواتير المشتريات' },
];

export default function FinancePage() {
  const [tab, setTab] = useState('treasury');
  const { data: treasury, loading: treasuryLoading, error: treasuryError, reload: reloadTreasury } = useApi('/api/finance/treasury');
  const { data: salesInvoices, loading: salesLoading, error: salesError, reload: reloadSales } = useApi('/api/finance/invoices?kind=sales');
  const { data: purchaseInvoices, loading: purchaseLoading, error: purchaseError, reload: reloadPurchases } = useApi('/api/finance/invoices?kind=purchase');
  const { data: materials } = useApi('/api/warehouse/materials');
  const { data: employees } = useApi('/api/employees');
  const [modal, setModal] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [purchaseLines, setPurchaseLines] = useState([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const { notice, showToast, clearToast } = useToast();

  const currentInvoices = tab === 'sales' ? salesInvoices : purchaseInvoices;
  const currentLoading = tab === 'sales' ? salesLoading : purchaseLoading;
  const currentError = tab === 'sales' ? salesError : purchaseError;
  const filteredInvoices = useMemo(() => (currentInvoices ?? []).filter((invoice) =>
    `${invoice.code} ${invoice.client_name ?? ''} ${invoice.supplier ?? ''} ${invoice.workshop_order_code ?? ''}`.toLowerCase().includes(search.toLowerCase())), [currentInvoices, search]);

  async function createTreasuryEntry(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const amountCents = egpToCents(form.get('amount'), { allowZero: false });
      await api.post('/api/finance/treasury/entries', {
        kind: form.get('kind'), category: form.get('category'), amountCents,
        employeeId: form.get('employeeId') ? Number(form.get('employeeId')) : undefined,
        reference: form.get('reference') || undefined, notes: form.get('notes') || undefined,
      });
      setModal('');
      await reloadTreasury();
      showToast('تم تسجيل الحركة النقدية وتحديث الرصيد.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  function updateLine(index, field, value) {
    setPurchaseLines((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function appendPurchaseLine() {
    setPurchaseLines((lines) => [...lines, { materialId: '', quantity: '1', unitCost: '0.00' }]);
  }

  async function createPurchase(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const items = purchaseLines.map((line) => ({
        materialId: Number(line.materialId),
        quantity: Number(line.quantity),
        unitCostCents: egpToCents(line.unitCost, { allowZero: true }),
      }));
      await api.post('/api/finance/invoices/purchase', {
        supplier: form.get('supplier'),
        employeeId: form.get('employeeId') ? Number(form.get('employeeId')) : undefined,
        items,
        notes: form.get('notes') || undefined,
      });
      setModal('');
      setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
      await reloadPurchases();
      showToast('تم إنشاء فاتورة الشراء وتحديث المخزون.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function settleInvoice(event) {
    event.preventDefault();
    if (!selectedInvoice) return;
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const isPurchase = selectedInvoice.kind === 'purchase';
    try {
      const amountCents = egpToCents(form.get('amount'), { allowZero: false });
      const result = await api.post(`/api/finance/invoices/${selectedInvoice.id}/${isPurchase ? 'payment' : 'receipt'}`, { amountCents, notes: form.get('notes') || undefined });
      setModal('');
      setSelectedInvoice(null);
      await Promise.all([reloadSales(), reloadPurchases(), reloadTreasury()]);
      showToast(`${isPurchase ? 'تم تسجيل سند الصرف' : 'تم تسجيل سند القبض'}. الرصيد المتبقي ${formatMoney(result.invoice.remaining_cents)}.`);
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  const invoiceCount = (salesInvoices?.length ?? 0) + (purchaseInvoices?.length ?? 0);

  return (
    <>
      <PageHeader kicker="الماليات · رقابة النقد" title="الخزينة والفواتير" description="رصيد النقدية لحظياً، مدفوعات المشتريات، وفواتير البيع والتحصيلات المرتبطة بها." actions={<><Button variant="secondary" icon="plus" onClick={() => { setFormError(''); setModal('treasury'); }}>حركة خزينة</Button><Button icon="plus" onClick={() => { setFormError(''); setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]); setModal('purchase'); }}>فاتورة شراء</Button></>} />
      <section className="madar-finance-balance madar-panel">
        <div className="madar-finance-balance-copy"><span className="madar-page-kicker">الرصيد النقدي الحالي</span><strong className="madar-money">{treasuryLoading && !treasury ? '—' : formatMoney(treasury?.cashBalanceCents)}</strong><span>يُحتسب من إجمالي الإيرادات مطروحاً منه المصروفات المسجلة.</span></div>
        <div className="madar-finance-balance-icon"><Icon name="wallet" size={25} /></div>
        <div className="madar-finance-mini-stats"><div><strong>{treasury?.entries?.length ?? 0}</strong><span>آخر حركة ظاهرة</span></div><div><strong>{invoiceCount}</strong><span>فاتورة بيع وشراء</span></div></div>
      </section>
      <div className="madar-section madar-finance-switch"><Tabs items={tabs.map((item) => ({ ...item, count: item.value === 'sales' ? salesInvoices?.length : item.value === 'purchase' ? purchaseInvoices?.length : undefined }))} value={tab} onChange={(value) => { setTab(value); setSearch(''); }} ariaLabel="أقسام الشؤون المالية" />{tab !== 'treasury' && <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث برقم الفاتورة أو العميل" aria-label="بحث الفواتير" /></label>}</div>
      {tab === 'treasury' ? <section className="madar-panel madar-section"><div className="madar-panel-header"><div><h2>آخر حركات الخزينة</h2><p>حتى 100 حركة، مع مرجع الفاتورة أو أمر العمل</p></div><Button variant="secondary" size="small" icon="refresh" onClick={reloadTreasury}>تحديث</Button></div>{treasuryError && <div className="madar-panel-body"><Alert tone="error">{treasuryError}</Alert></div>}{treasuryLoading && !treasury ? <LoadingState /> : treasury?.entries?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>التصنيف</th><th>المبلغ</th><th>الموظف</th><th>مرجع الفاتورة / الطلب</th><th>المستخدم</th></tr></thead><tbody>{treasury.entries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td><Badge tone={entry.kind === 'income' ? 'success' : 'danger'}>{entry.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td>{entry.category}</td><td className="madar-money"><strong>{formatMoney(entry.amount_cents)}</strong></td><td>{entry.employee_name || '—'}</td><td>{entry.invoice_code ? <Link className="madar-code madar-table-link" to="/finance">{entry.invoice_code}</Link> : entry.maintenance_order_code ? <Link className="madar-code madar-table-link" to={`/maintenance`}>{entry.maintenance_order_code}</Link> : entry.workshop_order_code || entry.reference || '—'}</td><td>{entry.created_by_name || '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon="wallet" title="لا توجد حركات مالية" description="سجّل رأس المال الافتتاحي أو أنشئ فاتورة مشتريات أو قبضاً." action={<Button icon="plus" onClick={() => setModal('treasury')}>تسجيل حركة</Button>} />}</section> : <section className="madar-panel madar-section"><div className="madar-panel-header"><div><h2>{tab === 'sales' ? 'فواتير المبيعات' : 'فواتير المشتريات'}</h2><p>{tab === 'sales' ? 'تظهر فاتورة الورشة برقم أمر التشغيل المرتبط.' : 'فواتير الشراء تزيد المخزون وتُسجل التزاماً؛ سدادها بسند صرف مستقل.'}</p></div></div>{currentError && <div className="madar-panel-body"><Alert tone="error">{currentError}</Alert></div>}{currentLoading ? <LoadingState label="جارٍ تحميل الفواتير" /> : filteredInvoices.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr>{tab === 'sales' ? <><th>رقم الفاتورة</th><th>العميل</th><th>رقم أمر التشغيل</th><th>تاريخ الفاتورة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>حالة السداد</th><th>تحصيل</th></> : <><th>رقم الفاتورة</th><th>المورد</th><th>تاريخ الفاتورة</th><th>الأصناف</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>سداد</th></>}</tr></thead><tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}>{tab === 'sales' ? <><td className="madar-code">{invoice.code}</td><td>{invoice.client_name || '—'}</td><td>{invoice.workshop_order_code ? <Link className="madar-code madar-table-link" to={`/workshop/${invoice.workshop_order_id}`}>{invoice.workshop_order_code}</Link> : '—'}</td><td>{formatDate(invoice.created_at)}</td><td className="madar-money">{formatMoney(invoice.total_cents)}</td><td className="madar-money">{formatMoney(invoice.paid_total_cents)}</td><td className="madar-money">{formatMoney(invoice.remaining_cents)}</td><td><Badge status={invoice.payment_status} /></td><td>{invoice.remaining_cents > 0 ? <Button size="small" variant="secondary" icon="wallet" onClick={() => { setSelectedInvoice(invoice); setFormError(''); setModal('receipt'); }}>سند قبض</Button> : <Badge tone="success">مكتمل</Badge>}</td></> : <><td className="madar-code">{invoice.code}</td><td>{invoice.supplier || '—'}</td><td>{formatDate(invoice.created_at)}</td><td>{invoice.item_count ?? '—'}</td><td className="madar-money">{formatMoney(invoice.total_cents)}</td><td className="madar-money">{formatMoney(invoice.paid_total_cents)}</td><td className="madar-money">{formatMoney(invoice.remaining_cents)}</td><td><Badge status={invoice.payment_status} /></td><td>{invoice.remaining_cents > 0 ? <Button size="small" variant="secondary" icon="wallet" onClick={() => { setSelectedInvoice(invoice); setFormError(''); setModal('payment'); }}>سند صرف</Button> : <Badge tone="success">مكتمل</Badge>}</td></>}</tr>)}</tbody></table></div> : <EmptyState icon="file" title={tab === 'sales' ? 'لا توجد فواتير مبيعات' : 'لا توجد فواتير مشتريات'} description={tab === 'sales' ? 'تصدر الفاتورة تلقائياً عند تسليم أمر الورشة.' : 'سجل فاتورة شراء لزيادة أرصدة المواد.'} action={tab === 'purchase' && <Button icon="plus" onClick={() => setModal('purchase')}>فاتورة شراء</Button>} />}</section>}

      <Modal open={modal === 'treasury'} onClose={() => setModal('')} title="تسجيل حركة خزينة" description="يُسجل المبلغ كعدد صحيح من السنتات. المصروفات تتطلب رصيداً كافياً.">
        <form onSubmit={createTreasuryEntry}><div className="madar-form-stack"><Select label="نوع الحركة *" name="kind" required defaultValue="income"><option value="income">إيراد / إيداع</option><option value="expense">مصروف نقدي</option></Select><Input label="التصنيف *" name="category" required maxLength={200} placeholder="رأس مال افتتاحي، مصروف تشغيل…" /><Input label="المبلغ (جنيه) *" name="amount" type="text" inputMode="decimal" required placeholder="0.00" /><Select label="توقيع الموظف (اختياري)" name="employeeId" defaultValue=""><option value="">بدون توقيع موظف</option>{(employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.department}</option>)}</Select><Input label="المرجع" name="reference" maxLength={300} /><Textarea label="ملاحظات" name="notes" maxLength={2000} /></div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'تسجيل الحركة'}</Button></div></form>
      </Modal>

      <Modal open={modal === 'purchase'} onClose={() => setModal('')} title="فاتورة مشتريات" description="الفاتورة تزيد رصيد المواد وتُسجل التزاماً على الخزينة؛ سدادها يتم بسند صرف مستقل." wide>
        <form onSubmit={createPurchase}><div className="madar-form-grid"><Input label="اسم المورد *" name="supplier" required maxLength={200} /><Select label="الموظف" name="employeeId" defaultValue=""><option value="">بدون توقيع موظف</option>{(employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.department}</option>)}</Select></div>
          <div className="madar-purchase-lines">
            {purchaseLines.map((line, index) => <div className="madar-purchase-line" key={`purchase-${index}`}>
              <Select label={`المادة ${index + 1} *`} value={line.materialId} onChange={(event) => updateLine(index, 'materialId', event.target.value)} required><option value="" disabled>اختر المادة</option>{(materials ?? []).map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name} (الرصيد {material.stock})</option>)}</Select>
              <Input label="الكمية *" type="number" min="1" step="1" required value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} />
              <Input label="تكلفة الوحدة (جنيه) *" type="text" inputMode="decimal" required value={line.unitCost} onChange={(event) => updateLine(index, 'unitCost', event.target.value)} />
              {purchaseLines.length > 1 && <Button className="madar-remove-line" variant="ghost" icon="close" iconOnly aria-label="حذف الصنف" onClick={() => setPurchaseLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))} />}
            </div>)}
            <Button variant="secondary" size="small" icon="plus" onClick={appendPurchaseLine}>إضافة صنف</Button>
          </div>
          <Textarea className="madar-form-full madar-purchase-notes" label="ملاحظات" name="notes" maxLength={2000} />
          <Alert tone="info">تُحسب الإجماليات في الخادم بدقة صحيحة؛ أي سطر ينتج جزءاً من سنت يُرفض قبل حفظ الفاتورة.</Alert>
          {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving || !materials?.length}>{saving ? 'جارٍ تسجيل الفاتورة…' : 'حفظ الفاتورة'}</Button></div>
        </form>
      </Modal>

      <Modal open={modal === 'receipt' || modal === 'payment'} onClose={() => { setModal(''); setSelectedInvoice(null); }} title={modal === 'payment' ? 'سند صرف' : 'سند قبض'} description={selectedInvoice ? `${selectedInvoice.code} · ${selectedInvoice.kind === 'purchase' ? selectedInvoice.supplier : selectedInvoice.client_name}` : ''}>
        {selectedInvoice && <form onSubmit={settleInvoice}><div className="madar-form-stack"><div className="madar-receipt-due"><span>المبلغ المتبقي</span><strong className="madar-money">{formatMoney(selectedInvoice.remaining_cents)}</strong></div><Input label={modal === 'payment' ? 'المبلغ المصروف (جنيه) *' : 'المبلغ المستلم (جنيه) *'} name="amount" type="text" inputMode="decimal" required placeholder="0.00" /><Textarea label={modal === 'payment' ? 'ملاحظات سند الصرف' : 'ملاحظات سند القبض'} name="notes" maxLength={2000} /></div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ التسجيل…' : modal === 'payment' ? 'تسجيل سند الصرف' : 'تسجيل سند القبض'}</Button></div></form>}
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
