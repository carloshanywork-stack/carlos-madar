import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatDate, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';

const inventoryTabs = [
  { value: 'materials', label: 'المخزن الرئيسي' },
  { value: 'offcuts', label: 'المخزن الثانوي' },
  { value: 'movements', label: 'حركة المخزون' },
];

export default function WarehousePage() {
  const [tab, setTab] = useState('materials');
  const { data: materials, loading: materialsLoading, error: materialsError, reload: reloadMaterials } = useApi('/api/warehouse/materials');
  const { data: offcuts, loading: offcutsLoading, error: offcutsError, reload: reloadOffcuts } = useApi('/api/warehouse/offcuts?status=available');
  const { data: movements, loading: movementsLoading, error: movementsError, reload: reloadMovements } = useApi('/api/warehouse/movements');
  const { data: productionOrders } = useApi('/api/workshop/orders?status=in_production');
  const [modal, setModal] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [sourceWarehouse, setSourceWarehouse] = useState('main');
  const [selectedOffcutIds, setSelectedOffcutIds] = useState([]);
  const [stockCount, setStockCount] = useState(null);
  const [countValues, setCountValues] = useState({});
  const [search, setSearch] = useState('');
  const { notice, showToast, clearToast } = useToast();

  const filteredMaterials = useMemo(() => (materials ?? []).filter((item) =>
    `${item.code} ${item.name} ${item.specification ?? ''}`.toLowerCase().includes(search.toLowerCase())), [materials, search]);
  const filteredOffcuts = useMemo(() => (offcuts ?? []).filter((item) =>
    `${item.name} ${item.material_code ?? ''} ${item.dimensions} ${item.origin_workshop_order_code ?? ''}`.toLowerCase().includes(search.toLowerCase())), [offcuts, search]);

  const refreshInventory = useCallback(async () => {
    await Promise.all([reloadMaterials(), reloadOffcuts(), reloadMovements()]);
  }, [reloadMaterials, reloadMovements, reloadOffcuts]);

  async function createMaterial(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const unitCostCents = egpToCents(form.get('unitCost'), { allowZero: true });
      await api.post('/api/warehouse/materials', {
        code: form.get('code'), name: form.get('name'), specification: form.get('specification') || undefined,
        unit: form.get('unit'), minStock: Number(form.get('minStock') || 0), unitCostCents,
        initialStock: Number(form.get('initialStock') || 0),
      });
      setModal('');
      await refreshInventory();
      showToast('تم إنشاء بطاقة المادة.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function createOffcut(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/warehouse/offcuts', {
        name: form.get('name'), dimensions: form.get('dimensions'), quantity: Number(form.get('quantity')),
        unit: form.get('unit'), materialId: form.get('materialId') ? Number(form.get('materialId')) : undefined,
        unitCostCents: egpToCents(form.get('unitCost') || '0', { allowZero: true }), notes: form.get('notes') || undefined,
      });
      setModal('');
      await refreshInventory();
      showToast('تم تسجيل الباقي في المخزن الثانوي.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function issueMaterial(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const payload = {
      workshopOrderId: Number(form.get('workshopOrderId')),
      sourceWarehouse,
      quantity: Number(form.get('quantity')),
      notes: form.get('notes') || undefined,
    };
    if (sourceWarehouse === 'main') payload.materialId = Number(form.get('materialId'));
    else payload.offcutId = Number(form.get('offcutId'));
    try {
      await api.post('/api/warehouse/issue', payload);
      setModal('');
      await refreshInventory();
      showToast('تم صرف المادة وربط الحركة بأمر الورشة.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function sellScrap(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const totalSaleAmountCents = egpToCents(form.get('totalSaleAmount'), { allowZero: false });
      await api.post('/api/warehouse/offcuts/scrap-sales', {
        offcutIds: selectedOffcutIds,
        totalSaleAmountCents,
        buyerName: form.get('buyerName') || undefined,
      });
      setModal('');
      setSelectedOffcutIds([]);
      await refreshInventory();
      showToast('سُجل بيع الخردة وأُضيف المبلغ للخزينة.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function startCount() {
    setFormError('');
    try {
      const session = await api.post('/api/warehouse/stock-counts/start', {});
      const initial = {};
      for (const row of session.lines.main) initial[`main:${row.material_id}`] = String(row.snapshot_quantity);
      for (const row of session.lines.offcuts) initial[`offcut:${row.offcut_id}`] = String(row.snapshot_quantity);
      setStockCount(session);
      setCountValues(initial);
      setModal('count');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  async function reconcileCount(event) {
    event.preventDefault();
    if (!stockCount) return;
    setSaving(true);
    setFormError('');
    const main = stockCount.lines.main.map((row) => ({ materialId: row.material_id, countedQuantity: Number(countValues[`main:${row.material_id}`]) }));
    const countOffcuts = stockCount.lines.offcuts.map((row) => ({ offcutId: row.offcut_id, countedQuantity: Number(countValues[`offcut:${row.offcut_id}`]) }));
    try {
      await api.post(`/api/warehouse/stock-counts/${stockCount.id}/reconcile`, { main, offcuts: countOffcuts });
      setModal('');
      setStockCount(null);
      await refreshInventory();
      showToast('أُغلقت جلسة الجرد وسُجلت الفروقات.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  const currentError = tab === 'materials' ? materialsError : tab === 'offcuts' ? offcutsError : movementsError;
  const currentLoading = tab === 'materials' ? materialsLoading : tab === 'offcuts' ? offcutsLoading : movementsLoading;

  return (
    <>
      <PageHeader kicker="المواد · المخازن" title="المخزون والمواد" description="متابعة رصيد الألواح في المخزن الرئيسي والقصاصات القابلة لإعادة الاستخدام في المخزن الثانوي." actions={<><Button variant="secondary" icon="download" onClick={() => { window.location.href = '/api/warehouse/export.xlsx'; }}>تصدير Excel</Button><Button variant="secondary" icon="check" onClick={startCount}>جلسة جرد</Button>{tab === 'materials' ? <Button icon="plus" onClick={() => { setFormError(''); setModal('material'); }}>مادة جديدة</Button> : <Button icon="plus" onClick={() => { setFormError(''); setModal('offcut'); }}>تسجيل باقي</Button>}</>} />
      <div className="madar-warehouse-toolbar madar-section">
        <Tabs items={inventoryTabs} value={tab} onChange={(value) => { setTab(value); setSearch(''); }} ariaLabel="أقسام المخزون" />
        <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في سجل المخزون" aria-label="بحث المخزون" /></label>
        <div className="madar-inline-wrap">
          {tab !== 'movements' && <Button variant="secondary" size="small" icon="arrow" onClick={() => { setFormError(''); setSourceWarehouse('main'); setModal('issue'); }}>صرف لأمر ورشة</Button>}
          {tab === 'offcuts' && <Button variant="secondary" size="small" icon="wallet" onClick={() => { setSelectedOffcutIds([]); setFormError(''); setModal('scrap'); }}>بيع خردة محددة</Button>}
        </div>
      </div>
      {currentError && <div className="madar-section"><Alert tone="error">{currentError}</Alert></div>}
      <section className="madar-panel madar-section">
        {currentLoading ? <LoadingState label="جارٍ تحميل سجل المخزون" /> : tab === 'materials' ? (
          filteredMaterials.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>كود المادة</th><th>المادة والمواصفة</th><th>الرصيد</th><th>حد الطلب</th><th>تكلفة الوحدة</th><th>الحالة</th></tr></thead><tbody>{filteredMaterials.map((item) => <tr key={item.id}><td className="madar-code">{item.code}</td><td><div className="madar-table-primary">{item.name}</div><small className="madar-table-muted">{item.specification || '—'}</small></td><td><strong>{item.stock}</strong> {item.unit}</td><td>{item.min_stock} {item.unit}</td><td className="madar-money">{formatMoney(item.unit_cost_cents)}</td><td>{item.is_low_stock ? <Badge tone="warning">مخزون منخفض</Badge> : <Badge tone="success">متاح</Badge>}</td></tr>)}</tbody></table></div> : <EmptyState icon="boxes" title="لا توجد مواد مسجلة" description="أنشئ بطاقة مادة ثم استخدم فاتورة مشتريات لزيادة الرصيد." action={<Button icon="plus" onClick={() => setModal('material')}>إضافة مادة</Button>} />
        ) : tab === 'offcuts' ? (
          filteredOffcuts.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الباقي</th><th>الأبعاد</th><th>الكمية</th><th>المادة المرتبطة</th><th>مصدره</th><th>تاريخ التسجيل</th></tr></thead><tbody>{filteredOffcuts.map((item) => <tr key={item.id}><td><div className="madar-table-primary">{item.name}</div><small className="madar-code">#{item.id}</small></td><td>{item.dimensions}</td><td>{item.quantity} {item.unit}</td><td>{item.material_code || 'غير مصنف'}</td><td>{item.origin_workshop_order_code ? <Link className="madar-code madar-table-link" to={`/workshop/${item.origin_workshop_order_id}`}>{item.origin_workshop_order_code}</Link> : 'تسجيل يدوي'}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState icon="boxes" title="المخزن الثانوي فارغ" description="سجل بواقي الإنتاج القابلة لإعادة الاستخدام من أوامر الورشة أو يدوياً." action={<Button icon="plus" onClick={() => setModal('offcut')}>تسجيل باقي</Button>} />
        ) : (
          movements?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>التاريخ</th><th>المادة</th><th>نوع الحركة</th><th>الكمية</th><th>المخزن</th><th>المرجع</th><th>ملاحظات</th></tr></thead><tbody>{movements.filter((movement) => `${movement.material_code ?? ''} ${movement.material_name ?? ''} ${movement.reference ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((movement) => <tr key={movement.id}><td>{formatDate(movement.created_at)}</td><td>{movement.material_name ?? 'باقي خامة'}<small className="madar-code madar-block">{movement.material_code ?? ''}</small></td><td><MovementBadge kind={movement.kind} /></td><td>{movement.quantity}</td><td>{movement.warehouse === 'main' ? 'رئيسي' : 'ثانوي'}</td><td>{movement.workshop_order_code ? <Link className="madar-code madar-table-link" to={`/workshop/${movement.source_id}`}>{movement.workshop_order_code}</Link> : <span className="madar-code">{movement.reference || '—'}</span>}</td><td>{movement.notes || '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon="chart" title="لا توجد حركات مخزون" description="تظهر هنا المشتريات والصرف والجرد وبيع الخردة." />
        )}
      </section>

      <Modal open={modal === 'material'} onClose={() => setModal('')} title="إضافة مادة للمخزن الرئيسي" description="الرصيد الابتدائي يسجل حركة شراء افتتاحية في سجل المخزون." wide>
        <form onSubmit={createMaterial}><div className="madar-form-grid">
          <Input label="كود المادة *" name="code" required maxLength={64} placeholder="ACR-3MM-WHITE" />
          <Input label="اسم المادة *" name="name" required maxLength={200} />
          <Input label="المواصفة" name="specification" maxLength={1000} />
          <Input label="وحدة القياس *" name="unit" required maxLength={50} placeholder="لوح" />
          <Input label="الرصيد الافتتاحي" name="initialStock" type="number" min="0" step="1" defaultValue="0" />
          <Input label="حد إعادة الطلب" name="minStock" type="number" min="0" step="1" defaultValue="0" />
          <Input label="تكلفة الوحدة (جنيه) *" name="unitCost" type="text" inputMode="decimal" required defaultValue="0.00" />
        </div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المادة'}</Button></div></form>
      </Modal>

      <Modal open={modal === 'offcut'} onClose={() => setModal('')} title="تسجيل باقي خامة" description="تبقى القصاصات في المخزن الثانوي ويمكن صرفها جزئياً لأمر ورشة.">
        <form onSubmit={createOffcut}><div className="madar-form-grid">
          <Input label="اسم الباقي *" name="name" required maxLength={200} />
          <Input label="الأبعاد أو الوصف *" name="dimensions" required maxLength={200} />
          <Input label="الكمية *" name="quantity" type="number" step="any" min="0.000001" required />
          <Input label="الوحدة *" name="unit" required maxLength={50} />
          <Select className="madar-form-full" label="المادة المرتبطة (اختياري)" name="materialId" defaultValue=""><option value="">بدون ربط</option>{(materials ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</Select>
          <Input label="تكلفة الوحدة (جنيه)" name="unitCost" type="text" inputMode="decimal" defaultValue="0.00" />
          <Textarea className="madar-form-full" label="ملاحظات" name="notes" maxLength={2000} />
        </div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ التسجيل…' : 'تسجيل الباقي'}</Button></div></form>
      </Modal>

      <Modal open={modal === 'issue'} onClose={() => setModal('')} title="صرف خامة لأمر ورشة" description="يُسجل الصرف على أمر في مرحلة الإنتاج فقط.">
        <form onSubmit={issueMaterial}><div className="madar-form-stack">
          <Select label="أمر الورشة *" name="workshopOrderId" required defaultValue=""><option value="" disabled>اختر أمر الإنتاج</option>{(productionOrders ?? []).map((order) => <option key={order.id} value={order.id}>{order.order_code} · {order.product_name} · {order.client_name}</option>)}</Select>
          <Select label="المخزن المصدر *" value={sourceWarehouse} onChange={(event) => setSourceWarehouse(event.target.value)}><option value="main">المخزن الرئيسي</option><option value="secondary">المخزن الثانوي</option></Select>
          {sourceWarehouse === 'main' ? <Select label="المادة *" name="materialId" required defaultValue=""><option value="" disabled>اختر المادة</option>{(materials ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.stock} {item.unit})</option>)}</Select> : <Select label="الباقي *" name="offcutId" required defaultValue=""><option value="" disabled>اختر الباقي</option>{(offcuts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit}</option>)}</Select>}
          <Input label="الكمية *" name="quantity" type="number" min="0.000001" step={sourceWarehouse === 'main' ? '1' : 'any'} required />
          <Textarea label="ملاحظات" name="notes" maxLength={2000} />
          <Alert tone="info">الصرف من المخزن الرئيسي يكون بوحدات صحيحة. استخدم المخزن الثانوي للقصاصات الجزئية.</Alert>
        </div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving || !productionOrders?.length}>{saving ? 'جارٍ الصرف…' : 'تأكيد الصرف'}</Button></div></form>
      </Modal>

      <Modal open={modal === 'scrap'} onClose={() => setModal('')} title="بيع خردة وبواقي" description="حدد بواقي متاحة، وسيسجل النظام إيراد البيع في الخزينة.">
        <form onSubmit={sellScrap}><div className="madar-form-stack">
          <div className="madar-scrap-picker">{(offcuts ?? []).map((item) => <Checkbox key={item.id} checked={selectedOffcutIds.includes(item.id)} onChange={(event) => setSelectedOffcutIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} title={item.name} description={`${item.dimensions} · ${item.quantity} ${item.unit}`} />)}</div>
          {!offcuts?.length && <EmptyState icon="boxes" title="لا توجد بواقي متاحة" description="حدد بواقي متاحة للبيع أولاً." />}
          <Input label="إجمالي قيمة البيع (جنيه) *" name="totalSaleAmount" type="text" inputMode="decimal" required placeholder="0.00" />
          <Input label="اسم المشتري" name="buyerName" maxLength={200} />
        </div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving || !selectedOffcutIds.length}>{saving ? 'جارٍ التسجيل…' : 'تأكيد البيع'}</Button></div></form>
      </Modal>

      <Modal open={modal === 'count'} onClose={() => setModal('')} title="جلسة جرد فعلي" description={stockCount ? `جلسة رقم ${stockCount.id} · أدخل الكميات الفعلية ثم أكد التسوية.` : ''} wide>
        {stockCount && <form onSubmit={reconcileCount}><div className="madar-count-sections">
          <CountSection title="المخزن الرئيسي" rows={stockCount.lines.main} keyPrefix="main" countValues={countValues} setCountValues={setCountValues} />
          <CountSection title="المخزن الثانوي" rows={stockCount.lines.offcuts} keyPrefix="offcut" countValues={countValues} setCountValues={setCountValues} />
        </div>{formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ التسوية…' : 'حفظ الجرد والتسوية'}</Button></div></form>}
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}

function MovementBadge({ kind }) {
  const labels = { purchase: 'شراء / استلام', issue: 'صرف للإنتاج', scrap_sale: 'بيع خردة', variance_gain: 'زيادة جرد', variance_loss: 'نقص جرد' };
  const tones = { purchase: 'success', issue: 'info', scrap_sale: 'warning', variance_gain: 'success', variance_loss: 'danger' };
  return <Badge tone={tones[kind] ?? 'info'}>{labels[kind] ?? kind}</Badge>;
}

function CountSection({ title, rows, keyPrefix, countValues, setCountValues }) {
  return (
    <section className="madar-count-section"><div className="madar-section-head"><h3 className="madar-section-title">{title}</h3><span className="madar-badge">{rows.length}</span></div>
      {rows.length ? <div className="madar-count-list">{rows.map((row) => {
        const rowId = keyPrefix === 'main' ? row.material_id : row.offcut_id;
        const id = `${keyPrefix}:${rowId}`;
        const label = keyPrefix === 'main' ? `${row.material_code} · ${row.material_name}` : `${row.name} · ${row.dimensions}`;
        return <div className="madar-count-row" key={id}><div><strong>{label}</strong><small>الرصيد بالنظام: {row.snapshot_quantity} {row.unit}</small></div><label className="madar-field"><span>المعدود</span><input type="number" min="0" step="any" required value={countValues[id] ?? ''} onChange={(event) => setCountValues((current) => ({ ...current, [id]: event.target.value }))} /></label></div>;
      })}</div> : <div className="madar-picker-empty">لا توجد عناصر في هذا المخزن.</div>}
    </section>
  );
}
