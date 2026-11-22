import { useMemo, useState } from 'react';
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
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import './workshop.css';

export default function ProcurementHub({ canMutate = false, canViewFinance = false, initialWorkshopOrderId = null }) {
  const [subTab, setSubTab] = useState('orders'); // 'requests' | 'orders' | 'receipts'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { notice, showToast, clearToast } = useToast();

  // Modals state
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [createPoOpen, setCreatePoOpen] = useState(false);
  const [createGrnOpen, setCreateGrnOpen] = useState(false);
  const [createCashPurchaseOpen, setCreateCashPurchaseOpen] = useState(false);
  const [viewPoDetail, setViewPoDetail] = useState(null);
  const [viewGrnDetail, setViewGrnDetail] = useState(null);

  // Form states for Direct Cash Purchase
  const [cashSupplier, setCashSupplier] = useState('');
  const [cashMaterialId, setCashMaterialId] = useState('');
  const [cashQuantity, setCashQuantity] = useState('1');
  const [cashUnitCostEgp, setCashUnitCostEgp] = useState('');
  const [cashWarehouse, setCashWarehouse] = useState('main');
  const [cashWorkshopOrderId, setCashWorkshopOrderId] = useState(initialWorkshopOrderId || '');
  const [cashNotes, setCashNotes] = useState('');

  // Queries
  const { data: requests, loading: reqLoading, error: reqError, reload: reloadRequests } = useApi(
    subTab === 'requests' ? '/api/workshop/procurement/requests' : null
  );
  const { data: orders, loading: ordersLoading, error: ordersError, reload: reloadOrders } = useApi(
    subTab === 'orders' ? '/api/workshop/procurement/orders' : null
  );
  const { data: receipts, loading: recLoading, error: recError, reload: reloadReceipts } = useApi(
    subTab === 'receipts' ? '/api/workshop/procurement/receipts' : null
  );

  // Auxiliary data for creation modals
  const { data: materials } = useApi('/api/warehouse/materials');
  const { data: workshopOrders } = useApi('/api/workshop/orders?status=in_production');
  const { data: openRequests } = useApi(createPoOpen ? '/api/workshop/procurement/requests?status=draft' : null);
  const { data: approvedPos } = useApi(createGrnOpen ? '/api/workshop/procurement/orders' : null);

  // Filtered lists
  const filteredRequests = useMemo(() => {
    return (requests ?? []).filter((item) => {
      const matchSearch = `${item.request_code} ${item.material_name} ${item.material_code} ${item.workshop_order_code || ''}`
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [requests, search, statusFilter]);

  const filteredOrders = useMemo(() => {
    return (orders ?? []).filter((item) => {
      const matchSearch = `${item.po_code} ${item.supplier} ${item.workshop_order_code || ''}`
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, search, statusFilter]);

  const filteredReceipts = useMemo(() => {
    return (receipts ?? []).filter((item) => {
      const matchSearch = `${item.receipt_code} ${item.po_code} ${item.supplier || ''} ${item.workshop_order_code || ''}`
        .toLowerCase()
        .includes(search.toLowerCase());
      return matchSearch;
    });
  }, [receipts, search]);

  // Form states for Create PO
  const [poSupplier, setPoSupplier] = useState('');
  const [poWorkshopOrderId, setPoWorkshopOrderId] = useState(initialWorkshopOrderId || '');
  const [poExpectedDate, setPoExpectedDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState([{ materialId: '', quantity: '1', unitCostEgp: '', purchaseRequestId: '' }]);

  // Form states for Create GRN
  const [selectedPoForGrn, setSelectedPoForGrn] = useState('');
  const [grnPoData, setGrnPoData] = useState(null);
  const [grnPoLoading, setGrnPoLoading] = useState(false);
  const [grnItems, setGrnItems] = useState([]);
  const [grnNotes, setGrnNotes] = useState('');

  // Handle PO creation
  async function handleCreatePO(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (!poSupplier.trim()) throw new Error('اسم المورّد مطلوب.');
      if (poItems.length === 0) throw new Error('يجب إضافة بند واحد على الأقل في أمر الشراء.');

      const validatedItems = poItems.map((item, idx) => {
        if (!item.materialId) throw new Error(`حدد المادة للبند رقم ${idx + 1}.`);
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`أدخل كمية صحيحة للبند رقم ${idx + 1}.`);
        const unitCostCents = egpToCents(item.unitCostEgp, { allowZero: true });
        return {
          materialId: Number(item.materialId),
          quantity: qty,
          unitCostCents,
          purchaseRequestId: item.purchaseRequestId ? Number(item.purchaseRequestId) : undefined,
        };
      });

      await api.post('/api/workshop/procurement/orders', {
        supplier: poSupplier.trim(),
        workshopOrderId: poWorkshopOrderId ? Number(poWorkshopOrderId) : undefined,
        expectedDate: poExpectedDate || undefined,
        notes: poNotes.trim() || undefined,
        items: validatedItems,
      });

      setCreatePoOpen(false);
      setPoSupplier('');
      setPoNotes('');
      setPoItems([{ materialId: '', quantity: '1', unitCostEgp: '', purchaseRequestId: '' }]);
      if (subTab === 'orders') await reloadOrders();
      showToast('تم إنشاء أمر الشراء بنجاح بصيغة مسودة.');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Handle Approve PO
  async function handleApprovePO(orderId) {
    if (!window.confirm('هل أنت متأكد من اعتماد أمر الشراء؟ بعد الاعتماد يمكن استلام البضاعة بالمخزن.')) return;
    setSaving(true);
    try {
      await api.post(`/api/workshop/procurement/orders/${orderId}/approve`);
      await reloadOrders();
      showToast('تم اعتماد أمر الشراء بنجاح.');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  // Handle Create Purchase Request
  async function handleCreatePR(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(e.currentTarget);
    try {
      const materialId = Number(form.get('materialId'));
      const requestedQuantity = Number(form.get('requestedQuantity'));
      const workshopOrderId = form.get('workshopOrderId') ? Number(form.get('workshopOrderId')) : undefined;
      const notes = form.get('notes') ? String(form.get('notes')).trim() : undefined;

      if (!materialId) throw new Error('اختر المادة المطلوبة.');
      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) throw new Error('أدخل كمية مطلوبة صحيحة.');

      await api.post('/api/workshop/procurement/requests', {
        materialId,
        requestedQuantity,
        workshopOrderId,
        notes,
      });

      setCreatePrOpen(false);
      if (subTab === 'requests') await reloadRequests();
      showToast('تم إنشاء طلب الشراء بنجاح.');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Handle PO selection in GRN modal
  async function handleSelectPoForGrn(poId) {
    setSelectedPoForGrn(poId);
    if (!poId) {
      setGrnPoData(null);
      setGrnItems([]);
      return;
    }
    setGrnPoLoading(true);
    setFormError('');
    try {
      const fullPo = await api.get(`/api/workshop/procurement/orders/${poId}`);
      setGrnPoData(fullPo);
      const itemsInitial = (fullPo.items || []).map((it) => {
        const remaining = Math.max(0, it.quantity - it.received_quantity);
        return {
          poItemId: it.id,
          materialName: it.material_name,
          materialCode: it.material_code,
          materialUnit: it.material_unit,
          orderedQty: it.quantity,
          alreadyReceived: it.received_quantity,
          remainingQty: remaining,
          quantityReceived: String(remaining),
          quantityAccepted: String(remaining),
          quantityRejected: '0',
          warehouse: 'main',
        };
      });
      setGrnItems(itemsInitial);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setGrnPoLoading(false);
    }
  }

  // Handle Create Goods Receipt
  async function handleCreateGRN(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (!selectedPoForGrn) throw new Error('اختر أمر الشراء المعتمد المراد استلامه.');
      if (grnItems.length === 0) throw new Error('لا توجد بنود للاستلام.');

      const itemsPayload = grnItems
        .filter((it) => Number(it.quantityReceived) > 0)
        .map((it) => {
          const qtyRec = Number(it.quantityReceived);
          const qtyAcc = Number(it.quantityAccepted);
          const qtyRej = Number(it.quantityRejected || 0);

          if (qtyAcc > it.remainingQty) {
            throw new Error(`الكمية المقبولة للبند "${it.materialName}" (${qtyAcc}) تتجاوز الكمية المتبقية (${it.remainingQty}).`);
          }
          if (qtyAcc + qtyRej > qtyRec) {
            throw new Error(`مجموع المقبول والمرفوض يتجاوز المستلم للبند "${it.materialName}".`);
          }

          return {
            poItemId: it.poItemId,
            quantityReceived: qtyRec,
            quantityAccepted: qtyAcc,
            quantityRejected: qtyRej,
            warehouse: it.warehouse || 'main',
          };
        });

      if (itemsPayload.length === 0) {
        throw new Error('يجب تحديد كمية استلام أكبر من صفر لبند واحد على الأقل.');
      }

      const res = await api.post('/api/workshop/procurement/receipts', {
        purchaseOrderId: Number(selectedPoForGrn),
        notes: grnNotes.trim() || undefined,
        items: itemsPayload,
      });

      setCreateGrnOpen(false);
      setSelectedPoForGrn('');
      setGrnPoData(null);
      setGrnItems([]);
      setGrnNotes('');
      if (subTab === 'receipts') await reloadReceipts();
      else setSubTab('receipts');
      showToast(`تم إثبات استلام البضاعة برقم ${res.receipt_code} وزيادة المخزون بنجاح.`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Handle Direct Cash Purchase
  async function handleCashPurchase(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (!cashSupplier.trim()) throw new Error('اسم المورّد مطلوب.');
      if (!cashMaterialId) throw new Error('حدد الخامة / المادة المراد شراؤها.');
      const qty = Number(cashQuantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('أدخل كمية صحيحة أكبر من صفر.');
      const unitCostCents = egpToCents(cashUnitCostEgp, { allowZero: false });
      if (unitCostCents <= 0) throw new Error('أدخل سعر وحدة صحيح أكبر من صفر.');

      const operationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined;

      const res = await api.post('/api/workshop/procurement/cash-purchase', {
        supplier: cashSupplier.trim(),
        materialId: Number(cashMaterialId),
        quantity: qty,
        unitCostCents,
        warehouseId: cashWarehouse,
        workshopOrderId: cashWorkshopOrderId ? Number(cashWorkshopOrderId) : undefined,
        notes: cashNotes.trim() || undefined,
        operationId,
      });

      setCreateCashPurchaseOpen(false);
      setCashSupplier('');
      setCashMaterialId('');
      setCashQuantity('1');
      setCashUnitCostEgp('');
      setCashWarehouse('main');
      setCashNotes('');

      if (subTab === 'orders') await reloadOrders();
      else if (subTab === 'receipts') await reloadReceipts();
      else await reloadRequests();

      showToast(`تم تنفيذ الشراء النقدي المباشر بنجاح: أمر شراء ${res.poCode} وإذن استلام ${res.receiptCode} وفاتورة مسددة ${res.invoiceCode}.`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const currentLoading = subTab === 'requests' ? reqLoading : subTab === 'orders' ? ordersLoading : recLoading;
  const currentError = subTab === 'requests' ? reqError : subTab === 'orders' ? ordersError : recError;
  const currentReload = subTab === 'requests' ? reloadRequests : subTab === 'orders' ? reloadOrders : reloadReceipts;

  return (
    <div className="madar-procurement-hub">
      {/* Subtabs bar */}
      <div className="madar-list-toolbar" style={{ marginBottom: 16 }}>
        <Tabs
          items={[
            { value: 'orders', label: 'أوامر الشراء (PO)', count: orders?.length },
            { value: 'receipts', label: 'أذون استلام البضاعة (GRN)', count: receipts?.length },
            { value: 'requests', label: 'طلبات الشراء (PR)', count: requests?.length },
          ]}
          value={subTab}
          onChange={(val) => { setSubTab(val); setStatusFilter('all'); setSearch(''); }}
          ariaLabel="أقسام المشتريات والتوريدات"
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="madar-field madar-search">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالكود أو المورّد أو الخامة..."
              aria-label="بحث في المشتريات"
            />
          </label>

          {canMutate && (
            <Button
              variant="secondary"
              icon="wallet"
              onClick={() => { setFormError(''); setCreateCashPurchaseOpen(true); }}
            >
              شراء نقدي مباشر
            </Button>
          )}

          {canMutate && subTab === 'orders' && (
            <Button icon="plus" onClick={() => { setFormError(''); setCreatePoOpen(true); }}>
              أمر شراء جديد
            </Button>
          )}

          {canMutate && subTab === 'receipts' && (
            <Button icon="plus" onClick={() => { setFormError(''); setCreateGrnOpen(true); }}>
              إثبات استلام بضاعة
            </Button>
          )}

          {canMutate && subTab === 'requests' && (
            <Button icon="plus" onClick={() => { setFormError(''); setCreatePrOpen(true); }}>
              طلب شراء جديد
            </Button>
          )}
        </div>
      </div>

      {currentError && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="error">
            {currentError}
            <div style={{ marginTop: 8 }}>
              <Button size="small" variant="secondary" icon="refresh" onClick={currentReload}>
                إعادة المحاولة
              </Button>
            </div>
          </Alert>
        </div>
      )}

      {/* --- Tab 1: Purchase Orders (PO) --- */}
      {subTab === 'orders' && (
        <section className="madar-panel">
          {currentLoading ? (
            <LoadingState label="جارٍ تحميل أوامر الشراء..." />
          ) : filteredOrders.length ? (
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>كود أمر الشراء</th>
                    <th>المورّد</th>
                    <th>أمر التشغيل المرتبط</th>
                    <th>موعد التسليم المتوقع</th>
                    <th>عدد البنود</th>
                    {canViewFinance && <th>إجمالي القيمة</th>}
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((po) => (
                    <tr key={po.id}>
                      <td className="madar-code" style={{ fontWeight: 700 }}>{po.po_code}</td>
                      <td><strong>{po.supplier}</strong></td>
                      <td>
                        {po.workshop_order_code ? (
                          <span className="madar-code">{po.workshop_order_code}</span>
                        ) : (
                          <span className="madar-table-muted">مشتريات مخزن عام</span>
                        )}
                      </td>
                      <td>{formatDate(po.expected_date)}</td>
                      <td>{po.items_count || 1} بنود</td>
                      {canViewFinance && <td className="madar-money">{formatMoney(po.total_cents)}</td>}
                      <td><Badge status={po.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button
                            size="small"
                            variant="secondary"
                            icon="file"
                            onClick={async () => {
                              try {
                                const full = await api.get(`/api/workshop/procurement/orders/${po.id}`);
                                setViewPoDetail(full);
                              } catch (err) {
                                showToast(errorMessage(err), 'error');
                              }
                            }}
                          >
                            تفاصيل البنود
                          </Button>
                          {canMutate && po.status === 'draft' && (
                            <Button
                              size="small"
                              variant="primary"
                              disabled={saving}
                              icon="check"
                              onClick={() => handleApprovePO(po.id)}
                            >
                              اعتماد
                            </Button>
                          )}
                          {canMutate && (po.status === 'approved' || po.status === 'partially_received') && (
                            <Button
                              size="small"
                              variant="secondary"
                              icon="archive"
                              onClick={() => {
                                setFormError('');
                                setCreateGrnOpen(true);
                                handleSelectPoForGrn(String(po.id));
                              }}
                            >
                              استلام بضاعة
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="boxes"
              title="لا توجد أوامر شراء"
              description="أوامر الشراء تمكنك من متابعة التعاقد مع الموردين والتوريدات الواردة للورشة."
              action={
                canMutate && (
                  <Button icon="plus" onClick={() => { setFormError(''); setCreatePoOpen(true); }}>
                    إنشاء أمر شراء جديد
                  </Button>
                )
              }
            />
          )}
        </section>
      )}

      {/* --- Tab 2: Goods Receipts (GRN) --- */}
      {subTab === 'receipts' && (
        <section className="madar-panel">
          {currentLoading ? (
            <LoadingState label="جارٍ تحميل أذون استلام البضاعة..." />
          ) : filteredReceipts.length ? (
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>كود إذن الاستلام</th>
                    <th>أمر الشراء (PO)</th>
                    <th>المورّد</th>
                    <th>أمر التشغيل المرتبط</th>
                    <th>تاريخ الاستلام</th>
                    <th>الكمية المقبولة</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((gr) => (
                    <tr key={gr.id}>
                      <td className="madar-code" style={{ fontWeight: 700 }}>{gr.receipt_code}</td>
                      <td className="madar-code">{gr.po_code}</td>
                      <td>{gr.supplier || '—'}</td>
                      <td>
                        {gr.workshop_order_code ? (
                          <span className="madar-code">{gr.workshop_order_code}</span>
                        ) : (
                          <span className="madar-table-muted">مخزن عام</span>
                        )}
                      </td>
                      <td>{formatDate(gr.received_at || gr.created_at)}</td>
                      <td><strong>{gr.total_accepted_quantity ?? gr.items_count} وحدة</strong></td>
                      <td><Badge status={gr.status} /></td>
                      <td>
                        <Button
                          size="small"
                          variant="secondary"
                          icon="file"
                          onClick={async () => {
                            try {
                              const full = await api.get(`/api/workshop/procurement/receipts/${gr.id}`);
                              setViewGrnDetail(full);
                            } catch (err) {
                              showToast(errorMessage(err), 'error');
                            }
                          }}
                        >
                          عرض الأصناف
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="archive"
              title="لا توجد أذون استلام مسجلة"
              description="أذون الاستلام تثبت دخول الخامات للمخزن وتحديث الرصيد التراكمي وتكلفة الشراء."
              action={
                canMutate && (
                  <Button icon="plus" onClick={() => { setFormError(''); setCreateGrnOpen(true); }}>
                    إثبات استلام بضاعة
                  </Button>
                )
              }
            />
          )}
        </section>
      )}

      {/* --- Tab 3: Purchase Requests (PR) --- */}
      {subTab === 'requests' && (
        <section className="madar-panel">
          {currentLoading ? (
            <LoadingState label="جارٍ تحميل طلبات الشراء..." />
          ) : filteredRequests.length ? (
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>كود الطلب</th>
                    <th>المادة المطلوبة</th>
                    <th>الكمية المطلوبة</th>
                    <th>أمر التشغيل المرتبط</th>
                    <th>تاريخ الطلب</th>
                    <th>الحالة</th>
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((pr) => (
                    <tr key={pr.id}>
                      <td className="madar-code" style={{ fontWeight: 700 }}>{pr.request_code}</td>
                      <td>
                        <div><strong>{pr.material_name}</strong></div>
                        <small className="madar-code">{pr.material_code}</small>
                      </td>
                      <td><strong>{pr.requested_quantity} {pr.material_unit || ''}</strong></td>
                      <td>
                        {pr.workshop_order_code ? (
                          <span className="madar-code">{pr.workshop_order_code}</span>
                        ) : (
                          <span className="madar-table-muted">طلب عام</span>
                        )}
                      </td>
                      <td>{formatDate(pr.created_at)}</td>
                      <td><Badge status={pr.status} /></td>
                      <td>{pr.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="boxes"
              title="لا توجد طلبات شراء مسجلة"
              description="يمكن للمهندسين والفنيين طلب خامات غير متوفرة لربطها بأمر التشغيل."
              action={
                canMutate && (
                  <Button icon="plus" onClick={() => { setFormError(''); setCreatePrOpen(true); }}>
                    إنشاء طلب شراء
                  </Button>
                )
              }
            />
          )}
        </section>
      )}

      {/* --- Modal: Create Purchase Order (PO) --- */}
      {createPoOpen && (
        <Modal
          title="إنشاء أمر شراء توريد (Purchase Order)"
          onClose={() => setCreatePoOpen(false)}
          width="800px"
        >
          <form onSubmit={handleCreatePO} className="madar-stack">
            {formError && <Alert tone="error">{formError}</Alert>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input
                label="اسم المورّد / الشركة"
                required
                value={poSupplier}
                onChange={(e) => setPoSupplier(e.target.value)}
                placeholder="مثال: شركة النصر للأكريليك والمعادن"
              />

              <Select
                label="أمر التشغيل المرتبط (اختياري)"
                value={poWorkshopOrderId}
                onChange={(e) => setPoWorkshopOrderId(e.target.value)}
              >
                <option value="">بدون أمر تشغيل (تغذية مخزن عام)</option>
                {(workshopOrders ?? []).map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.order_code} - {wo.client_name} ({wo.product_name})
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input
                label="تاريخ التوريد المتوقع"
                type="date"
                value={poExpectedDate}
                onChange={(e) => setPoExpectedDate(e.target.value)}
              />

              <Textarea
                label="ملاحظات وشروط التوريد"
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="أي شروط فنية أو تفاصيل السداد..."
                rows={2}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--madar-border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontSize: '0.95rem' }}>بنود أمر الشراء ({poItems.length})</strong>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  icon="plus"
                  onClick={() => setPoItems([...poItems, { materialId: '', quantity: '1', unitCostEgp: '', purchaseRequestId: '' }])}
                >
                  إضافة بند خامة
                </Button>
              </div>

              {poItems.map((item, idx) => (
                <div key={idx} className="madar-po-line-item-row">
                  <Select
                    label={`الخامة #${idx + 1}`}
                    required
                    value={item.materialId}
                    onChange={(e) => {
                      const updated = [...poItems];
                      updated[idx].materialId = e.target.value;
                      // autofill unit cost if material has default cost
                      const mat = materials?.find((m) => String(m.id) === e.target.value);
                      if (mat && mat.unit_cost_cents && !updated[idx].unitCostEgp) {
                        updated[idx].unitCostEgp = (mat.unit_cost_cents / 100).toFixed(2);
                      }
                      setPoItems(updated);
                    }}
                  >
                    <option value="">اختر الخامة</option>
                    {(materials ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.code}) - وحدة: {m.unit || 'قطعة'}
                      </option>
                    ))}
                  </Select>

                  <Input
                    label="الكمية"
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={item.quantity}
                    onChange={(e) => {
                      const updated = [...poItems];
                      updated[idx].quantity = e.target.value;
                      setPoItems(updated);
                    }}
                  />

                  <Input
                    label="سعر الوحدة (ج.م)"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={item.unitCostEgp}
                    onChange={(e) => {
                      const updated = [...poItems];
                      updated[idx].unitCostEgp = e.target.value;
                      setPoItems(updated);
                    }}
                  />

                  {openRequests?.length > 0 ? (
                    <Select
                      label="ربط بطلب شراء"
                      value={item.purchaseRequestId}
                      onChange={(e) => {
                        const updated = [...poItems];
                        updated[idx].purchaseRequestId = e.target.value;
                        setPoItems(updated);
                      }}
                    >
                      <option value="">لا يوجد</option>
                      {openRequests.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.request_code} ({pr.material_name})
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div>
                      <small style={{ color: 'var(--madar-muted)' }}>إجمالي البند:</small>
                      <div style={{ fontWeight: 700, marginTop: 6 }}>
                        {formatMoney(Math.round(Number(item.quantity || 0) * Number(item.unitCostEgp || 0) * 100))}
                      </div>
                    </div>
                  )}

                  {poItems.length > 1 && (
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      icon="trash"
                      style={{ color: '#ef4444' }}
                      onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))}
                    />
                  )}
                </div>
              ))}

              <div style={{ textAlign: 'left', marginTop: 12, fontSize: '1rem', fontWeight: 700 }}>
                إجمالي أمر الشراء التقديري:{' '}
                <span className="madar-money">
                  {formatMoney(
                    poItems.reduce(
                      (sum, it) => sum + Math.round(Number(it.quantity || 0) * Number(it.unitCostEgp || 0) * 100),
                      0
                    )
                  )}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button type="button" variant="secondary" onClick={() => setCreatePoOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'جارٍ الحفظ...' : 'حفظ أمر الشراء'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- Modal: Create Goods Receipt (GRN) --- */}
      {createGrnOpen && (
        <Modal
          title="إثبات استلام بضاعة بالمخزن (Goods Receipt Note)"
          onClose={() => { setCreateGrnOpen(false); setSelectedPoForGrn(''); setGrnPoData(null); }}
          width="820px"
        >
          <form onSubmit={handleCreateGRN} className="madar-stack">
            {formError && <Alert tone="error">{formError}</Alert>}

            <Select
              label="اختر أمر الشراء المعتمد المراد استلامه"
              required
              value={selectedPoForGrn}
              onChange={(e) => handleSelectPoForGrn(e.target.value)}
            >
              <option value="">اختر أمر شراء معتمد</option>
              {(approvedPos ?? [])
                .filter((p) => p.status === 'approved' || p.status === 'partially_received')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_code} - {p.supplier} (الحالة: {p.status === 'approved' ? 'معتمد' : 'مستلم جزئياً'})
                  </option>
                ))}
            </Select>

            {grnPoLoading && <LoadingState label="جارٍ تحميل بنود أمر الشراء..." />}

            {grnPoData && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background: 'var(--madar-surface-alt)', padding: 12, borderRadius: 6, marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: '0.85rem' }}>
                    <div><strong>أمر الشراء:</strong> <span className="madar-code">{grnPoData.po_code}</span></div>
                    <div><strong>المورّد:</strong> {grnPoData.supplier}</div>
                    <div><strong>أمر التشغيل المرتبط:</strong> {grnPoData.workshop_order_code || 'مخزن عام'}</div>
                  </div>
                </div>

                <strong style={{ display: 'block', marginBottom: 8 }}>فحص وتوزيع كميات الاستلام:</strong>
                {grnItems.map((item, idx) => (
                  <div key={item.poItemId} className="madar-grn-item-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{item.materialName} ({item.materialCode})</strong>
                      <span className="madar-badge madar-badge-info">
                        مطلوب: {item.orderedQty} · استُلم سابقاً: {item.alreadyReceived} · متبقٍ: {item.remainingQty}
                      </span>
                    </div>

                    <div className="madar-grn-item-grid">
                      <Input
                        label="الكمية المستلمة فعلياً"
                        type="number"
                        step="any"
                        min="0"
                        max={item.remainingQty}
                        required
                        value={item.quantityReceived}
                        onChange={(e) => {
                          const updated = [...grnItems];
                          updated[idx].quantityReceived = e.target.value;
                          updated[idx].quantityAccepted = e.target.value;
                          updated[idx].quantityRejected = '0';
                          setGrnItems(updated);
                        }}
                      />

                      <Input
                        label="الكمية المقبولة (تُضاف للمخزون)"
                        type="number"
                        step="any"
                        min="0"
                        max={item.remainingQty}
                        required
                        value={item.quantityAccepted}
                        onChange={(e) => {
                          const updated = [...grnItems];
                          updated[idx].quantityAccepted = e.target.value;
                          const rec = Number(updated[idx].quantityReceived || 0);
                          const acc = Number(e.target.value || 0);
                          updated[idx].quantityRejected = String(Math.max(0, rec - acc));
                          setGrnItems(updated);
                        }}
                      />

                      <Input
                        label="الكمية المرفوضة (تالف/غير مطابق)"
                        type="number"
                        step="any"
                        min="0"
                        value={item.quantityRejected}
                        onChange={(e) => {
                          const updated = [...grnItems];
                          updated[idx].quantityRejected = e.target.value;
                          setGrnItems(updated);
                        }}
                      />

                      <Select
                        label="مخزن الإيداع"
                        value={item.warehouse}
                        onChange={(e) => {
                          const updated = [...grnItems];
                          updated[idx].warehouse = e.target.value;
                          setGrnItems(updated);
                        }}
                      >
                        <option value="main">المخزن الرئيسي</option>
                        <option value="secondary">المخزن الثانوي</option>
                      </Select>
                    </div>
                  </div>
                ))}

                <Textarea
                  label="ملاحظات الفحص والاستلام"
                  value={grnNotes}
                  onChange={(e) => setGrnNotes(e.target.value)}
                  placeholder="رقم بوليصة الشحن، حالة العبوات، أي ملاحظات جودة..."
                  rows={2}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button type="button" variant="secondary" onClick={() => setCreateGrnOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={saving || !selectedPoForGrn}>
                {saving ? 'جارٍ تسجيل الاستلام...' : 'تأكيد استلام البضاعة'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- Modal: Create Purchase Request (PR) --- */}
      {createPrOpen && (
        <Modal
          title="إنشاء طلب شراء احتياج (Purchase Request)"
          onClose={() => setCreatePrOpen(false)}
          width="560px"
        >
          <form onSubmit={handleCreatePR} className="madar-stack">
            {formError && <Alert tone="error">{formError}</Alert>}

            <Select label="الخامة المطلوبة" name="materialId" required>
              <option value="">اختر الخامة</option>
              {(materials ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code}) - الرصيد الحالي: {m.stock}
                </option>
              ))}
            </Select>

            <Input
              label="الكمية المطلوبة"
              name="requestedQuantity"
              type="number"
              step="any"
              min="0.01"
              required
              placeholder="مثال: 5"
            />

            <Select label="أمر التشغيل المرتبط (اختياري)" name="workshopOrderId" defaultValue={initialWorkshopOrderId || ''}>
              <option value="">بدون أمر تشغيل (احتياج ورشة عام)</option>
              {(workshopOrders ?? []).map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.order_code} - {wo.client_name} ({wo.product_name})
                </option>
              ))}
            </Select>

            <Textarea
              label="مبررات الطلب والمواصفات المطلوبة"
              name="notes"
              placeholder="أبعاد معينة، سمك محدد، استعجال للتشغيل..."
              rows={3}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Button type="button" variant="secondary" onClick={() => setCreatePrOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'جارٍ الإرسال...' : 'إرسال طلب الشراء'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- Modal: Direct Cash Purchase (شراء نقدي مباشر) --- */}
      {createCashPurchaseOpen && (
        <Modal
          title="شراء نقدي مباشر (توريد وفاتورة وصرف نقدي فوري)"
          onClose={() => setCreateCashPurchaseOpen(false)}
          width="750px"
        >
          <form onSubmit={handleCashPurchase} className="madar-stack">
            {formError && <Alert tone="error">{formError}</Alert>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input
                label="اسم المورّد / جهة الشراء"
                required
                value={cashSupplier}
                onChange={(e) => setCashSupplier(e.target.value)}
                placeholder="مثال: أكرليك مصر الحديثة"
              />

              <Select
                label="أمر التشغيل المرتبط (اختياري)"
                value={cashWorkshopOrderId}
                onChange={(e) => setCashWorkshopOrderId(e.target.value)}
              >
                <option value="">بدون أمر تشغيل (تغذية مخزن عام)</option>
                {(workshopOrders ?? []).map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.order_code} - {wo.client_name} ({wo.product_name})
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
              <Select
                label="الخامة / المادة"
                required
                value={cashMaterialId}
                onChange={(e) => {
                  setCashMaterialId(e.target.value);
                  const sel = (materials ?? []).find((m) => m.id === Number(e.target.value));
                  if (sel && sel.unit_cost_cents) {
                    setCashUnitCostEgp(String(sel.unit_cost_cents / 100));
                  }
                }}
              >
                <option value="">-- اختر المادة --</option>
                {(materials ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} - {m.name} ({m.stock} {m.unit} متاح)
                  </option>
                ))}
              </Select>

              <Input
                label="الكمية"
                type="number"
                step="any"
                min="0.001"
                required
                value={cashQuantity}
                onChange={(e) => setCashQuantity(e.target.value)}
              />

              <Input
                label="سعر الوحدة (ج.م)"
                type="number"
                step="0.01"
                min="0"
                required
                value={cashUnitCostEgp}
                onChange={(e) => setCashUnitCostEgp(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Select
                label="المخزن المستلم"
                value={cashWarehouse}
                onChange={(e) => setCashWarehouse(e.target.value)}
              >
                <option value="main">المخزن الرئيسي (Main Warehouse)</option>
                <option value="secondary">المخزن الثانوي / الفضلات (Secondary)</option>
              </Select>

              <div style={{ background: 'var(--madar-surface-alt)', padding: '10px 14px', borderRadius: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--madar-muted)' }}>إجمالي المبلغ المنصرف نقداً:</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--madar-primary)' }}>
                  {formatMoney(Math.round(Number(cashQuantity || 0) * (Number(cashUnitCostEgp || 0) * 100)))}
                </span>
              </div>
            </div>

            <Textarea
              label="ملاحظات وبيان الصرف النقدي"
              value={cashNotes}
              onChange={(e) => setCashNotes(e.target.value)}
              placeholder="مثال: شراء كاش عاجل مع استلام فوري لسد عجز تشغيل"
              rows={2}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <Button type="button" variant="secondary" onClick={() => setCreateCashPurchaseOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" loading={saving} icon="check">
                إتمام الشراء والصرف الفوري
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- Modal: View PO Details --- */}
      {viewPoDetail && (
        <Modal
          title={`تفاصيل أمر الشراء: ${viewPoDetail.po_code}`}
          onClose={() => setViewPoDetail(null)}
          width="750px"
        >
          <div className="madar-stack">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, background: 'var(--madar-surface-alt)', padding: 12, borderRadius: 6 }}>
              <div><strong>المورّد:</strong> {viewPoDetail.supplier}</div>
              <div><strong>أمر التشغيل:</strong> {viewPoDetail.workshop_order_code || 'مخزن عام'}</div>
              <div><strong>الحالة:</strong> <Badge status={viewPoDetail.status} /></div>
              <div><strong>تاريخ الإنشاء:</strong> {formatDate(viewPoDetail.created_at)}</div>
              <div><strong>تاريخ التوريد المتوقع:</strong> {formatDate(viewPoDetail.expected_date)}</div>
              {canViewFinance && <div><strong>إجمالي القيمة:</strong> <span className="madar-money">{formatMoney(viewPoDetail.total_cents)}</span></div>}
            </div>

            <h4 style={{ margin: '14px 0 6px 0', fontWeight: 700 }}>بنود أمر الشراء ({viewPoDetail.items?.length || 0})</h4>
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>الخامة</th>
                    <th>كود الخامة</th>
                    <th>الكمية المطلوبة</th>
                    <th>الكمية المستلمة</th>
                    {canViewFinance && <th>سعر الوحدة</th>}
                    {canViewFinance && <th>إجمالي البند</th>}
                  </tr>
                </thead>
                <tbody>
                  {(viewPoDetail.items || []).map((it) => (
                    <tr key={it.id}>
                      <td><strong>{it.material_name}</strong></td>
                      <td className="madar-code">{it.material_code}</td>
                      <td>{it.quantity} {it.material_unit}</td>
                      <td>
                        <span style={{ color: it.received_quantity >= it.quantity ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>
                          {it.received_quantity} {it.material_unit}
                        </span>
                      </td>
                      {canViewFinance && <td>{formatMoney(it.unit_cost_cents)}</td>}
                      {canViewFinance && <td className="madar-money">{formatMoney(it.line_total_cents)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {viewPoDetail.receipts?.length > 0 && (
              <>
                <h4 style={{ margin: '14px 0 6px 0', fontWeight: 700 }}>أذون الاستلام المسجلة على هذا الأمر ({viewPoDetail.receipts.length})</h4>
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead>
                      <tr><th>رقم إذن الاستلام</th><th>تاريخ الاستلام</th><th>الحالة</th><th>ملاحظات</th></tr>
                    </thead>
                    <tbody>
                      {viewPoDetail.receipts.map((gr) => (
                        <tr key={gr.id}>
                          <td className="madar-code">{gr.receipt_code}</td>
                          <td>{formatDate(gr.received_at || gr.created_at)}</td>
                          <td><Badge status={gr.status} /></td>
                          <td>{gr.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button variant="secondary" onClick={() => setViewPoDetail(null)}>إغلاق</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- Modal: View GRN Details --- */}
      {viewGrnDetail && (
        <Modal
          title={`تفاصيل إذن استلام بضاعة: ${viewGrnDetail.receipt_code}`}
          onClose={() => setViewGrnDetail(null)}
          width="750px"
        >
          <div className="madar-stack">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, background: 'var(--madar-surface-alt)', padding: 12, borderRadius: 6 }}>
              <div><strong>أمر الشراء:</strong> <span className="madar-code">{viewGrnDetail.po_code}</span></div>
              <div><strong>المورّد:</strong> {viewGrnDetail.supplier}</div>
              <div><strong>أمر التشغيل:</strong> {viewGrnDetail.workshop_order_code || 'مخزن عام'}</div>
              <div><strong>تاريخ الاستلام:</strong> {formatDate(viewGrnDetail.received_at || viewGrnDetail.created_at)}</div>
              <div><strong>الحالة:</strong> <Badge status={viewGrnDetail.status} /></div>
              <div><strong>ملاحظات:</strong> {viewGrnDetail.notes || '—'}</div>
            </div>

            <h4 style={{ margin: '14px 0 6px 0', fontWeight: 700 }}>الأصناف المستلمة ({viewGrnDetail.items?.length || 0})</h4>
            <div className="madar-table-wrap">
              <table className="madar-table">
                <thead>
                  <tr>
                    <th>الخامة</th>
                    <th>كود الخامة</th>
                    <th>مستلم</th>
                    <th>مقبول</th>
                    <th>مرفوض</th>
                    <th>مخزن الإيداع</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewGrnDetail.items || []).map((it) => (
                    <tr key={it.id}>
                      <td><strong>{it.material_name}</strong></td>
                      <td className="madar-code">{it.material_code}</td>
                      <td>{it.quantity_received}</td>
                      <td style={{ color: '#16a34a', fontWeight: 700 }}>{it.quantity_accepted}</td>
                      <td style={{ color: it.quantity_rejected > 0 ? '#ef4444' : 'inherit' }}>{it.quantity_rejected}</td>
                      <td>{it.warehouse === 'main' ? 'المخزن الرئيسي' : 'المخزن الثانوي'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button variant="secondary" onClick={() => setViewGrnDetail(null)}>إغلاق</Button>
            </div>
          </div>
        </Modal>
      )}

      <Toast notice={notice} onClose={clearToast} />
    </div>
  );
}
