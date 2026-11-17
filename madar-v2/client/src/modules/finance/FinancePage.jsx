import { useEffect, useMemo, useState } from 'react';
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
import {
  clearFinanceQueue,
  enqueueFinanceOperation,
  getFinanceQueue,
  removeFinanceQueueItem,
  syncFinanceQueue,
} from './finance-offline-queue.js';

const tabs = [
  { value: 'treasury', label: 'الخزينة' },
  { value: 'sales', label: 'فواتير المبيعات' },
  { value: 'purchase', label: 'فواتير المشتريات' },
];

function settlementOperationKey(userId, invoiceId, operationType) {
  return `madar.finance.settlement.pending.v1:${userId}:${operationType}:${invoiceId}`;
}

function createSettlementOperationId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('This browser cannot create a secure payment retry identifier.');
  return globalThis.crypto.randomUUID();
}

export default function FinancePage() {
  const [tab, setTab] = useState('treasury');
  const { data: treasury, loading: treasuryLoading, error: treasuryError, reload: reloadTreasury } = useApi('/api/finance/treasury');
  const { data: salesInvoices, loading: salesLoading, error: salesError, reload: reloadSales } = useApi('/api/finance/invoices?kind=sales');
  const { data: purchaseInvoices, loading: purchaseLoading, error: purchaseError, reload: reloadPurchases } = useApi('/api/finance/invoices?kind=purchase');
  const { data: materials } = useApi('/api/warehouse/materials');
  const { data: employees } = useApi('/api/employees');
  const { data: authStatus } = useApi('/api/auth/status');
  const [modal, setModal] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [purchaseLines, setPurchaseLines] = useState([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [financeQueue, setFinanceQueue] = useState(() => getFinanceQueue());
  const [syncingQueue, setSyncingQueue] = useState(false);
  const { notice, showToast, clearToast } = useToast();

  useEffect(() => {
    const handler = () => setFinanceQueue(getFinanceQueue());
    window.addEventListener('madar-finance-queue-updated', handler);
    return () => window.removeEventListener('madar-finance-queue-updated', handler);
  }, []);

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
    const amountCents = egpToCents(form.get('amount'), { allowZero: false });
    const payload = {
      kind: form.get('kind'),
      category: form.get('category'),
      amountCents,
      employeeId: form.get('employeeId') ? Number(form.get('employeeId')) : undefined,
      reference: form.get('reference') || undefined,
      notes: form.get('notes') || undefined,
    };

    if (!navigator.onLine) {
      enqueueFinanceOperation({
        type: 'treasury_entry',
        label: `حركة خزينة (${payload.kind === 'income' ? 'إيراد' : 'مصروف'} ${form.get('amount')} ج.م)`,
        endpoint: '/api/finance/treasury/entries',
        payload,
      });
      setModal('');
      setSaving(false);
      showToast('تم حفظ حركة الخزينة دون اتصال. ستتم المزامنة تلقائياً عند الاتصال بالخادم.');
      return;
    }

    try {
      await api.post('/api/finance/treasury/entries', payload);
      setModal('');
      await reloadTreasury();
      showToast('تم تسجيل الحركة النقدية وتحديث الرصيد.');
    } catch (caught) {
      if (!caught?.status || caught.status === 0) {
        enqueueFinanceOperation({
          type: 'treasury_entry',
          label: `حركة خزينة (${payload.kind === 'income' ? 'إيراد' : 'مصروف'} ${form.get('amount')} ج.م)`,
          endpoint: '/api/finance/treasury/entries',
          payload,
        });
        setModal('');
        showToast('الخادم غير متاح؛ تم حفظ الحركة في طابور العمليات دون اتصال.');
      } else {
        setFormError(errorMessage(caught));
      }
    } finally {
      setSaving(false);
    }
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
    const items = purchaseLines.map((line) => ({
      materialId: Number(line.materialId),
      quantity: Number(line.quantity),
      unitCostCents: egpToCents(line.unitCost, { allowZero: true }),
    }));
    const payload = {
      supplier: form.get('supplier'),
      employeeId: form.get('employeeId') ? Number(form.get('employeeId')) : undefined,
      items,
      notes: form.get('notes') || undefined,
    };

    if (!navigator.onLine) {
      enqueueFinanceOperation({
        type: 'purchase_invoice',
        label: `فاتورة شراء: ${payload.supplier} (${items.length} أصناف)`,
        endpoint: '/api/finance/invoices/purchase',
        payload,
      });
      setModal('');
      setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
      setSaving(false);
      showToast('تم حفظ فاتورة الشراء دون اتصال. ستتم المزامنة تلقائياً عند الاتصال بالخادم.');
      return;
    }

    try {
      await api.post('/api/finance/invoices/purchase', payload);
      setModal('');
      setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
      await reloadPurchases();
      showToast('تم إنشاء فاتورة الشراء وتحديث المخزون.');
    } catch (caught) {
      if (!caught?.status || caught.status === 0) {
        enqueueFinanceOperation({
          type: 'purchase_invoice',
          label: `فاتورة شراء: ${payload.supplier} (${items.length} أصناف)`,
          endpoint: '/api/finance/invoices/purchase',
          payload,
        });
        setModal('');
        setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]);
        showToast('الخادم غير متاح؛ تم حفظ فاتورة الشراء في طابور العمليات دون اتصال.');
      } else {
        setFormError(errorMessage(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  async function settleInvoice(event) {
    event.preventDefault();
    if (!selectedInvoice) return;
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const isPurchase = selectedInvoice.kind === 'purchase';
    const operationType = isPurchase ? 'purchase_payment' : 'sales_receipt';
    const amountCents = egpToCents(form.get('amount'), { allowZero: false });
    const notes = String(form.get('notes') || '').trim();
    const operationId = createSettlementOperationId();
    const endpoint = `/api/finance/invoices/${selectedInvoice.id}/${isPurchase ? 'payment' : 'receipt'}`;
    const payload = {
      amountCents,
      notes: notes || undefined,
      operationId,
    };

    if (!navigator.onLine) {
      enqueueFinanceOperation({
        type: 'settlement',
        label: `سند ${isPurchase ? 'صرف' : 'قبض'} فاتورة ${selectedInvoice.code} (${form.get('amount')} ج.م)`,
        endpoint,
        payload,
      });
      setModal('');
      setSelectedInvoice(null);
      setSaving(false);
      showToast(`تم حفظ سند ${isPurchase ? 'الصرف' : 'القبض'} دون اتصال. ستتم المزامنة تلقائياً.`);
      return;
    }

    let operationKey;
    try {
      operationKey = settlementOperationKey(authStatus?.user?.id, selectedInvoice.id, operationType);
      const result = await api.post(endpoint, payload);
      if (operationKey) {
        try { window.localStorage.removeItem(operationKey); } catch {}
      }
      setModal('');
      setSelectedInvoice(null);
      await Promise.all([reloadSales(), reloadPurchases(), reloadTreasury()]);
      showToast(`${isPurchase ? 'تم تسجيل سند الصرف' : 'تم تسجيل سند القبض'}. الرصيد المتبقي ${formatMoney(result.invoice.remaining_cents)}.`);
    } catch (caught) {
      if (!caught?.status || caught.status === 0) {
        enqueueFinanceOperation({
          type: 'settlement',
          label: `سند ${isPurchase ? 'صرف' : 'قبض'} فاتورة ${selectedInvoice.code} (${form.get('amount')} ج.م)`,
          endpoint,
          payload,
        });
        setModal('');
        setSelectedInvoice(null);
        showToast(`الخادم غير متاح؛ تم حفظ سند ${isPurchase ? 'الصرف' : 'القبض'} في طابور العمليات دون اتصال.`);
      } else {
        if (caught?.status >= 400 && caught.status < 500
            && caught?.payload?.code !== 'FINANCE_OPERATION_ID_CONFLICT' && operationKey) {
          try { window.localStorage.removeItem(operationKey); } catch {}
        }
        setFormError(errorMessage(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  const invoiceCount = (salesInvoices?.length ?? 0) + (purchaseInvoices?.length ?? 0);

  return (
    <>
      <PageHeader kicker="الماليات · رقابة النقد" title="الخزينة والفواتير" description="رصيد النقدية لحظياً، مدفوعات المشتريات، وفواتير البيع والتحصيلات المرتبطة بها." actions={<><Button variant="secondary" icon="plus" onClick={() => { setFormError(''); setModal('treasury'); }}>حركة خزينة</Button><Button icon="plus" onClick={() => { setFormError(''); setPurchaseLines([{ materialId: '', quantity: '1', unitCost: '0.00' }]); setModal('purchase'); }}>فاتورة شراء</Button></>} />

      {financeQueue.length > 0 && (
        <section className="madar-panel madar-panel-pad madar-section" style={{ borderRight: '4px solid #126b57', background: 'var(--surface-color, #fffdf5)' }}>
          <div className="madar-panel-header" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <Icon name="clock" size={18} />
                طابور المعاملات المالية دون اتصال
                <Badge tone="warning">{financeQueue.length}</Badge>
              </h3>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
                هناك {financeQueue.length} معاملة محفوظة محلياً. ستتم المزامنة تلقائياً عند توفر الاتصال، أو اضغط مزامنة الآن.
              </p>
            </div>
            <div className="madar-inline-wrap">
              <Button size="small" variant="secondary" onClick={() => setModal('queue')}>عرض الطابور</Button>
              <Button
                size="small"
                icon="refresh"
                disabled={syncingQueue}
                onClick={async () => {
                  setSyncingQueue(true);
                  try {
                    const res = await syncFinanceQueue();
                    if (res.syncedCount > 0) {
                      showToast(`تمت مزامنة ${res.syncedCount} معاملة مالية بنجاح.`);
                      await Promise.all([reloadTreasury(), reloadSales(), reloadPurchases()]);
                    } else if (res.failedCount > 0) {
                      showToast('تعذرت مزامنة بعض المعاملات بسبب أخطاء تحقق.');
                    } else {
                      showToast('الخادم غير متاح حالياً للمزامنة.');
                    }
                  } finally {
                    setSyncingQueue(false);
                  }
                }}
              >
                {syncingQueue ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
              </Button>
            </div>
          </div>
        </section>
      )}

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

      <Modal open={modal === 'queue'} onClose={() => setModal('')} title="طابور المعاملات المالية دون اتصال" description="المعاملات التي سُجلت أثناء انقطاع الاتصال بالسيرفر.">
        <div className="madar-form-stack">
          {financeQueue.length === 0 ? (
            <p>لا توجد معاملات مالية معلقة.</p>
          ) : (
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>المعاملة</th>
                    <th>الحالة</th>
                    <th>تاريخ التسجيل</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {financeQueue.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.label}</strong>
                        {item.lastError && (
                          <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '11px', marginTop: '2px' }}>
                            {item.lastError}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge tone={item.status === 'failed' ? 'danger' : item.status === 'syncing' ? 'info' : 'warning'}>
                          {item.status === 'failed' ? 'خطأ' : item.status === 'syncing' ? 'جارٍ الإرسال' : 'بانتظار المزامنة'}
                        </Badge>
                      </td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => removeFinanceQueueItem(item.id)}
                        >
                          حذف
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="madar-form-actions">
            {financeQueue.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm('هل أنت متأكد من مسح جميع المعاملات المعلّقة؟')) {
                    clearFinanceQueue();
                  }
                }}
              >
                مسح الكل
              </Button>
            )}
            <Button variant="secondary" onClick={() => setModal('')}>إغلاق</Button>
          </div>
        </div>
      </Modal>

      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
