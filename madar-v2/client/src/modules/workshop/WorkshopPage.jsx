import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatDate, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import EmployeeCheckboxList from '../../components/ui/EmployeeCheckboxList.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import QuotationEstimatorModal from './QuotationEstimatorModal.jsx';
import ProcurementHub from './ProcurementHub.jsx';

const stages = [
  { value: 'in_production', label: 'قيد التشغيل' },
  { value: 'ready', label: 'جاهز للتسليم' },
  { value: 'delivered_archived', label: 'تم التسليم ومؤرشف' },
  { value: 'quotations', label: 'عروض الأسعار والتسعير' },
  { value: 'procurement', label: 'المشتريات والتوريدات' },
];
const machineLabels = { cnc_router: 'CNC Router', laser: 'Laser', both: 'Both', manual: 'Manual' };

export default function WorkshopPage({ canMutate = false, canViewFinance = false, defaultStage = null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab');
  const [stage, setStage] = useState(defaultStage || queryTab || 'in_production');
  const isQuotationsTab = stage === 'quotations';
  const isProcurementTab = stage === 'procurement';

  const { data: orders, loading: ordersLoading, error: ordersError, reload: reloadOrders } = useApi(
    isQuotationsTab || isProcurementTab ? null : `/api/workshop/orders?status=${stage}`
  );
  const { data: quotations, loading: quotesLoading, error: quotesError, reload: reloadQuotes } = useApi(
    isQuotationsTab ? '/api/workshop/quotations' : null
  );

  const { data: clients } = useApi('/api/clients');
  const { data: materials } = useApi('/api/warehouse/materials');

  const [createOpen, setCreateOpen] = useState(false);
  const [estimatorOpen, setEstimatorOpen] = useState(false);
  const [readyOrder, setReadyOrder] = useState(null);
  const [selectedTechnicians, setSelectedTechnicians] = useState([]);
  const [registerOffcut, setRegisterOffcut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const { notice, showToast, clearToast } = useToast();

  const filteredOrders = useMemo(() => (orders ?? []).filter((order) =>
    `${order.order_code} ${order.client_name} ${order.product_name}`.toLowerCase().includes(search.toLowerCase())), [orders, search]);

  const filteredQuotes = useMemo(() => (quotations ?? []).filter((q) =>
    `${q.quotation_code} ${q.client_name} ${q.title}`.toLowerCase().includes(search.toLowerCase())), [quotations, search]);

  async function createOrder(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const salePriceCents = egpToCents(form.get('salePrice'), { allowZero: true });
      await api.post('/api/workshop/orders', {
        clientId: Number(form.get('clientId')),
        productName: form.get('productName'),
        description: form.get('description') || undefined,
        machineType: form.get('machineType'),
        targetDeliveryDate: form.get('targetDeliveryDate'),
        salePriceCents,
        technicianIds: selectedTechnicians,
      });
      setCreateOpen(false);
      setSelectedTechnicians([]);
      if (stage !== 'in_production') setStage('in_production');
      else await reloadOrders();
      showToast('تم إنشاء أمر تشغيل جديد.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function markReady(event) {
    event.preventDefault();
    if (!readyOrder) return;
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const offcuts = registerOffcut ? [{
        name: form.get('offcutName'),
        dimensions: form.get('offcutDimensions'),
        quantity: Number(form.get('offcutQuantity')),
        unit: form.get('offcutUnit'),
        materialId: form.get('materialId') ? Number(form.get('materialId')) : undefined,
      }] : [];
      await api.post(`/api/workshop/orders/${readyOrder.id}/ready`, { offcuts });
      setReadyOrder(null);
      setRegisterOffcut(false);
      await reloadOrders();
      showToast('تم تحويل الأمر إلى جاهز للتسليم.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function deliverOrder(order) {
    if (!window.confirm(`تأكيد تسليم ${order.order_code}؟ سيتم إنشاء فاتورة بيع تلقائياً.`)) return;
    setSaving(true);
    try {
      const delivered = await api.post(`/api/workshop/orders/${order.id}/deliver`, {});
      if (stage !== 'delivered_archived') setStage('delivered_archived');
      else await reloadOrders();
      showToast(canViewFinance
        ? `تم التسليم والأرشفة. أُنشئت الفاتورة ${delivered.invoice.code} بقيمة ${formatMoney(delivered.invoice.total_cents)}.`
        : 'تم التسليم وأرشفة الأمر.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function handleApproveQuote(quoteId) {
    setSaving(true);
    try {
      await api.post(`/api/workshop/quotations/${quoteId}/approve`);
      await reloadQuotes();
      showToast('تم اعتماد عرض السعر وتجميد اللقطة بنجاح.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function handleConvertQuote(quoteId) {
    setSaving(true);
    try {
      const converted = await api.post(`/api/workshop/quotations/${quoteId}/convert-to-order`, {});
      showToast(`تم تحويل عرض السعر بنجاح إلى أمر تشغيل برقم ${converted.orderCode}`);
      setStage('in_production');
      await reloadOrders();
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  const loading = isQuotationsTab ? quotesLoading : ordersLoading;
  const error = isQuotationsTab ? quotesError : ordersError;

  return (
    <>
      <PageHeader
        kicker="الإنتاج · الورشة"
        title="تشغيل الورشة والتسعير"
        description="تسعير مقايسات اللافتات، اعتماد عروض الأسعار، وإدارة ومتابعة أوامر التشغيل."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" icon="calculator" onClick={() => setEstimatorOpen(true)}>
              حاسبة تسعير جديدة
            </Button>
            {canMutate && (
              <Button icon="plus" onClick={() => { setFormError(''); setSelectedTechnicians([]); setCreateOpen(true); }}>
                إنشاء أمر تشغيل مباشر
              </Button>
            )}
          </div>
        }
      />

      <div className="madar-list-toolbar madar-section">
        <Tabs
          items={stages.map((item) => ({
            ...item,
            count: item.value === 'quotations' ? quotations?.length : (stage === item.value ? orders?.length : undefined),
          }))}
          value={stage}
          onChange={(val) => { setStage(val); setSearchParams({ tab: val }); }}
          ariaLabel="مراحل تشغيل الورشة"
        />
        {!isProcurementTab && (
          <label className="madar-field madar-search">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isQuotationsTab ? 'ابحث برقم العرض أو العميل أو العنوان' : 'ابحث برقم الأمر أو العميل أو المنتج'}
              aria-label="بحث أوامر الورشة"
            />
          </label>
        )}
      </div>

      {isProcurementTab ? (
        <section className="madar-section">
          <ProcurementHub canMutate={canMutate} canViewFinance={canViewFinance} />
        </section>
      ) : (
        <>
          {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}

          <section className="madar-panel madar-section">
            {loading ? (
              <LoadingState label={isQuotationsTab ? 'جارٍ تحميل عروض الأسعار' : 'جارٍ تحميل أوامر الورشة'} />
            ) : isQuotationsTab ? (
          filteredQuotes.length ? (
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>كود العرض</th>
                    <th>العميل</th>
                    <th>عنوان المقايسة</th>
                    <th>المنتج</th>
                    {canViewFinance && <th>التكلفة المقدرة</th>}
                    {canViewFinance && <th>صافي سعر البيع</th>}
                    {canViewFinance && <th>الهامش</th>}
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((q) => (
                    <tr key={q.id}>
                      <td className="madar-code" style={{ fontWeight: 700 }}>{q.quotation_code}</td>
                      <td>
                        <div className="madar-table-primary">{q.client_name}</div>
                        <small className="madar-code">{q.client_code}</small>
                      </td>
                      <td>{q.title}</td>
                      <td>{q.product_type === 'channel_letters' ? 'حروف أكريليك مضيئة' : q.product_type}</td>
                      {canViewFinance && <td>{formatMoney(q.estimated_cost_cents)}</td>}
                      {canViewFinance && <td className="madar-money">{formatMoney(q.net_sale_price_cents)}</td>}
                      {canViewFinance && (
                        <td>
                          <span style={{ color: (q.target_margin || 0) >= 0.20 ? '#16a34a' : '#e11d48', fontWeight: 600 }}>
                            {Math.round((q.target_margin || 0) * 100)}%
                          </span>
                        </td>
                      )}
                      <td><Badge status={q.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {q.status !== 'approved' && q.status !== 'converted_to_order' && (
                            <Button size="small" variant="secondary" disabled={saving} onClick={() => handleApproveQuote(q.id)}>
                              اعتماد
                            </Button>
                          )}
                          {q.status === 'approved' && (
                            <Button size="small" variant="primary" disabled={saving} onClick={() => handleConvertQuote(q.id)}>
                              تحويل للإنتاج
                            </Button>
                          )}
                          {q.status === 'converted_to_order' && <span className="madar-table-muted">تم التحويل</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="calculator"
              title="لا توجد عروض أسعار"
              description="استخدم حاسبة التسعير لإنشاء مقايسة حروف مضيئة أو لافتات بدقة متناهية."
              action={<Button icon="plus" onClick={() => setEstimatorOpen(true)}>حاسبة تسعير جديدة</Button>}
            />
          )
        ) : filteredOrders.length ? (
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead>
                <tr>
                  <th>أمر التشغيل</th>
                  <th>العميل</th>
                  <th>المنتج</th>
                  <th>نوع الآلة</th>
                  <th>موعد التسليم</th>
                  {canViewFinance && <th>السعر</th>}
                  <th>التصميم</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td><Link className="madar-table-link madar-code" to={`/workshop/${order.id}`}>{order.order_code}</Link></td>
                    <td><div className="madar-table-primary">{order.client_name}</div><small className="madar-code">{order.client_code}</small></td>
                    <td>{order.product_name}</td>
                    <td>{machineLabels[order.machine_type] ?? order.machine_type}</td>
                    <td>{formatDate(order.target_delivery_date)}</td>
                    {canViewFinance && <td className="madar-money">{formatMoney(order.sale_price_cents)}</td>}
                    <td>{order.design_file_count}</td>
                    <td><Badge status={order.status} /></td>
                    <td>
                      {canMutate && order.status === 'in_production' ? (
                        <Button size="small" variant="secondary" icon="check" onClick={() => { setFormError(''); setReadyOrder(order); }}>جاهز</Button>
                      ) : canMutate && order.status === 'ready' ? (
                        <Button size="small" icon="arrow" disabled={saving} onClick={() => deliverOrder(order)}>تسليم</Button>
                      ) : (
                        <span className="madar-table-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="factory"
            title={search ? 'لا توجد نتائج مطابقة' : 'لا توجد أوامر في هذه المرحلة'}
            description={search ? 'راجع كلمة البحث ثم حاول مرة أخرى.' : canMutate ? 'أنشئ أمر تشغيل لتسجيل المنتج والآلة وموعد التسليم.' : 'لا توجد أوامر تشغيل مسجلة في هذه المرحلة.'}
            action={canMutate && stage === 'in_production' && !search && <Button icon="plus" onClick={() => setCreateOpen(true)}>إنشاء أمر تشغيل</Button>}
          />
        )}
      </section>
      </>
      )}

      {/* Estimator Modal */}
      <QuotationEstimatorModal
        open={estimatorOpen}
        onClose={() => setEstimatorOpen(false)}
        clients={clients ?? []}
        onCreated={() => {
          showToast('تم حفظ المقايسة وعرض السعر بنجاح.');
          if (stage === 'quotations') reloadQuotes();
          else setStage('quotations');
        }}
      />

      {/* Create Order Modal */}
      {canMutate && (
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="إنشاء أمر تشغيل مباشر" description="تُحفظ الأسعار بالجنيه إلى سنتات صحيحة، وتُسجل فاتورة البيع عند التسليم." wide>
          <form onSubmit={createOrder}>
            <div className="madar-form-grid">
              <Select className="madar-form-full" label="العميل *" name="clientId" required defaultValue="">
                <option value="" disabled>اختر العميل</option>
                {(clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}
              </Select>
              <Input label="اسم المنتج *" name="productName" required maxLength={300} placeholder="مثال: حروف أكريليك مضيئة 3D" />
              <Select label="نوع الآلة *" name="machineType" required defaultValue="cnc_router">
                <option value="cnc_router">CNC Router</option>
                <option value="laser">Laser</option>
                <option value="both">Both</option>
                <option value="manual">Manual</option>
              </Select>
              <Input label="موعد التسليم المتوقع *" name="targetDeliveryDate" type="date" required />
              <Input label="سعر البيع (جنيه) *" name="salePrice" type="text" inputMode="decimal" required placeholder="0.00" hint="سعر البيع المتفق عليه قبل الضريبة." />
              <Textarea className="madar-form-full" label="وصف أو مواصفات" name="description" maxLength={10000} />
              <div className="madar-form-full">
                <EmployeeCheckboxList department="Workshop" selectedIds={selectedTechnicians} onChange={setSelectedTechnicians} title="الفنيون المكلّفون (اختياري)" />
              </div>
            </div>
            {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
            <div className="madar-form-actions">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Button>
              <Button type="submit" disabled={saving || !clients?.length}>{saving ? 'جارٍ الإنشاء…' : 'إنشاء أمر التشغيل'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Ready Order Modal */}
      {canMutate && (
        <Modal open={readyOrder !== null} onClose={() => { setReadyOrder(null); setRegisterOffcut(false); }} title="إنهاء مرحلة التصنيع" description={readyOrder ? `${readyOrder.order_code} · يمكنك تسجيل فضلات الخامة لإعادتها للمخزن الثانوي.` : ''}>
          <form onSubmit={markReady}>
            <div className="madar-form-stack">
              <Checkbox checked={registerOffcut} onChange={(event) => setRegisterOffcut(event.target.checked)} label="تسجيل باقي خامة قابل لإعادة الاستخدام في المخزن" />
              {registerOffcut && (
                <div className="madar-form-grid madar-offcut-form">
                  <Input label="اسم الخامة *" name="offcutName" required maxLength={200} />
                  <Input label="الأبعاد أو الوصف *" name="offcutDimensions" required maxLength={200} />
                  <Input label="الكمية *" name="offcutQuantity" type="number" step="any" min="0.000001" required />
                  <Input label="الوحدة *" name="offcutUnit" required maxLength={50} placeholder="لوح، متر، كجم…" />
                  <Select className="madar-form-full" label="ربط بمادة (اختياري)" name="materialId" defaultValue="">
                    <option value="">بدون ربط</option>
                    {(materials ?? []).map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name}</option>)}
                  </Select>
                </div>
              )}
            </div>
            {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
            <div className="madar-form-actions">
              <Button variant="secondary" onClick={() => setReadyOrder(null)}>إلغاء</Button>
              <Button type="submit" disabled={saving}>{saving ? 'جارٍ التحديث…' : 'تأكيد الجاهزية'}</Button>
            </div>
          </form>
        </Modal>
      )}

      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
