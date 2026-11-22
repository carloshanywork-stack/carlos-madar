import { useState, useMemo } from 'react';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatMoney } from '../../lib/format.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';

export default function QuotationEstimatorModal({ open, onClose, onCreated, clients = [] }) {
  const [productType, setProductType] = useState('channel_letters');
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [targetMargin, setTargetMargin] = useState('25');

  // Lettering specs
  const [letterHeightCm, setLetterHeightCm] = useState('40');
  const [letterCount, setLetterCount] = useState('10');
  const [depthCm, setDepthCm] = useState('8');
  const [acrylicSheetCost, setAcrylicSheetCost] = useState('1250');
  const [forexSheetCost, setForexSheetCost] = useState('450');
  const [ledModuleCost, setLedModuleCost] = useState('12');

  // Banner specs
  const [bannerWidth, setBannerWidth] = useState('4');
  const [bannerHeight, setBannerHeight] = useState('2');
  const [bannerQty, setBannerQty] = useState('1');

  // Cladding specs
  const [claddingWidth, setCladdingWidth] = useState('6');
  const [claddingHeight, setCladdingHeight] = useState('3');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Live Estimate Calculation
  const calculation = useMemo(() => {
    const marginRatio = Math.min(0.95, Math.max(0, (Number(targetMargin) || 25) / 100));

    let matCost = 0;
    let machCost = 0;
    let laborCost = 0;
    let transCost = 400;
    let installCost = 500;
    let overheadCost = 300;

    if (productType === 'channel_letters') {
      const h = Number(letterHeightCm) || 40;
      const n = Number(letterCount) || 1;
      const faceArea = n * 0.65 * Math.pow(h / 100, 2);
      const perimeter = n * (3.5 * h) / 100;
      const sheets = Math.max(1, Math.ceil(faceArea / (2.977 * 0.70)));
      const modules = Math.max(n * 8, Math.ceil((perimeter * 100) / 6));

      const acrylicTotal = sheets * (Number(acrylicSheetCost) || 1250);
      const forexTotal = sheets * (Number(forexSheetCost) || 450);
      const ledTotal = modules * (Number(ledModuleCost) || 12);
      const suppliesTotal = Math.max(1, Math.ceil((modules * 1.5) / 300)) * 400;
      const returnsTotal = Math.round(perimeter * 35);
      const adhesives = n * 20;

      matCost = acrylicTotal + forexTotal + ledTotal + suppliesTotal + returnsTotal + adhesives;
      machCost = Math.max(1, Math.round(((perimeter * 0.08) + 0.5) * 10) / 10) * 200;
      laborCost = Math.max(2, Math.round(((n * 1.5) + (modules * 0.02)) * 10) / 10) * 100;
      installCost = n * 50;
    } else if (productType === 'banner_flex') {
      const w = Number(bannerWidth) || 4;
      const h = Number(bannerHeight) || 2;
      const q = Number(bannerQty) || 1;
      const area = w * h * q;
      const perimeter = 2 * (w + h) * q;

      matCost = (area * 150) + (perimeter * 80) + (perimeter * 10);
      machCost = Math.max(0.5, Math.round(area / 10)) * 250;
      laborCost = Math.max(1, Math.round(perimeter * 0.2)) * 100;
      transCost = 300;
      installCost = 400;
      overheadCost = 200;
    } else if (productType === 'cladding_facade') {
      const w = Number(claddingWidth) || 6;
      const h = Number(claddingHeight) || 3;
      const area = w * h;

      matCost = (area * 1.15 * 850) + (area * 350) + (area * 100);
      machCost = Math.max(2, Math.round(area / 4)) * 200;
      laborCost = Math.max(8, Math.round(area * 1.2)) * 120;
      transCost = 600;
      installCost = 1200;
      overheadCost = 500;
    }

    const totalCost = matCost + machCost + laborCost + transCost + installCost + overheadCost;
    const netSale = totalCost > 0 ? Math.round(totalCost / (1 - marginRatio)) : 0;
    const profit = netSale - totalCost;
    const marginPct = netSale > 0 ? Math.round((profit / netSale) * 1000) / 10 : 0;
    const markupPct = totalCost > 0 ? Math.round((profit / totalCost) * 1000) / 10 : 0;

    return {
      matCost,
      machCost,
      laborCost,
      transCost,
      installCost,
      overheadCost,
      totalCost,
      netSale,
      profit,
      marginPct,
      markupPct,
    };
  }, [productType, letterHeightCm, letterCount, depthCm, acrylicSheetCost, forexSheetCost, ledModuleCost, bannerWidth, bannerHeight, bannerQty, claddingWidth, claddingHeight, targetMargin]);

  async function handleSaveQuotation(event) {
    event.preventDefault();
    if (!clientId) { setError('اختر العميل أولاً.'); return; }
    if (!title.trim()) { setError('اكتب عنواناً أو وصفاً مختصراً لعرض السعر.'); return; }
    setSaving(true);
    setError('');

    try {
      const specs = productType === 'channel_letters' ? {
        letterHeightCm: Number(letterHeightCm),
        letterCount: Number(letterCount),
        depthCm: Number(depthCm),
        acrylicSheetCostCents: egpToCents(acrylicSheetCost),
        forexSheetCostCents: egpToCents(forexSheetCost),
        ledModuleCostCents: egpToCents(ledModuleCost),
      } : productType === 'banner_flex' ? {
        widthM: Number(bannerWidth),
        heightM: Number(bannerHeight),
        quantity: Number(bannerQty),
      } : {
        widthM: Number(claddingWidth),
        heightM: Number(claddingHeight),
      };

      const created = await api.post('/api/workshop/quotations', {
        clientId: Number(clientId),
        title: title.trim(),
        productType,
        specifications: specs,
        targetMargin: (Number(targetMargin) || 25) / 100,
        manualNetSalePriceCents: egpToCents(calculation.netSale),
      });

      if (onCreated) onCreated(created);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="حاسبة تكاليف عروض الأسعار والتصنيع" onClose={onClose}>
      <form onSubmit={handleSaveQuotation} className="madar-stack">
        {error && <div className="madar-alert madar-alert-error">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select label="العميل" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">اختر العميل...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </Select>

          <Select label="نوع المنتج / القالب" value={productType} onChange={(e) => setProductType(e.target.value)}>
            <option value="channel_letters">حروف مجسمة أكريليك مضيئة 3D (الطيار)</option>
            <option value="banner_flex">بانر وفلكس مع شاسيه حديد</option>
            <option value="cladding_facade">واجهة تجليد كلادينج ألومنيوم</option>
          </Select>
        </div>

        <Input
          label="عنوان المقايسة"
          required
          placeholder="مثال: يافطة حروف مضيئة صيدلية النور 10 حروف"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Dynamic Spec Inputs */}
        <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 14, borderRadius: 8 }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>المحددات الهندسية ومواصفات التشغيل</h4>

          {productType === 'channel_letters' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Input label="ارتفاع الحرف (سم)" type="number" min="10" max="300" value={letterHeightCm} onChange={(e) => setLetterHeightCm(e.target.value)} />
              <Input label="عدد الحروف" type="number" min="1" max="100" value={letterCount} onChange={(e) => setLetterCount(e.target.value)} />
              <Input label="بروز الجنب (سم)" type="number" min="3" max="50" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} />
              <Input label="سعر لوح الأكريليك (ج.م)" type="number" value={acrylicSheetCost} onChange={(e) => setAcrylicSheetCost(e.target.value)} />
              <Input label="سعر لوح الفوركس (ج.م)" type="number" value={forexSheetCost} onChange={(e) => setForexSheetCost(e.target.value)} />
              <Input label="سعر ليد الحقن (ج.م)" type="number" value={ledModuleCost} onChange={(e) => setLedModuleCost(e.target.value)} />
            </div>
          )}

          {productType === 'banner_flex' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Input label="العرض (متر)" type="number" step="0.1" value={bannerWidth} onChange={(e) => setBannerWidth(e.target.value)} />
              <Input label="الارتفاع (متر)" type="number" step="0.1" value={bannerHeight} onChange={(e) => setBannerHeight(e.target.value)} />
              <Input label="الكمية" type="number" min="1" value={bannerQty} onChange={(e) => setBannerQty(e.target.value)} />
            </div>
          )}

          {productType === 'cladding_facade' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Input label="عرض الواجهة (متر)" type="number" step="0.1" value={claddingWidth} onChange={(e) => setCladdingWidth(e.target.value)} />
              <Input label="ارتفاع الواجهة (متر)" type="number" step="0.1" value={claddingHeight} onChange={(e) => setCladdingHeight(e.target.value)} />
            </div>
          )}
        </div>

        {/* Financial Profitability Gauge */}
        <div style={{ background: '#0f172a', color: '#f8fafc', padding: 16, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>هامش الربح المستهدف (Target Margin %)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min="5"
                max="60"
                step="1"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
                style={{ width: 140 }}
              />
              <strong style={{ fontSize: '1.1rem', color: '#38bdf8' }}>{targetMargin}%</strong>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, textAlign: 'center' }}>
            <div style={{ background: '#1e293b', padding: 8, borderRadius: 6 }}>
              <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>إجمالي التكلفة</small>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 4 }}>{calculation.totalCost.toLocaleString()} ج.م</div>
            </div>
            <div style={{ background: '#1e293b', padding: 8, borderRadius: 6 }}>
              <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>صافي سعر البيع</small>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#4ade80', marginTop: 4 }}>{calculation.netSale.toLocaleString()} ج.م</div>
            </div>
            <div style={{ background: '#1e293b', padding: 8, borderRadius: 6 }}>
              <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>الربح المتوقع</small>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8', marginTop: 4 }}>{calculation.profit.toLocaleString()} ج.م</div>
            </div>
            <div style={{ background: '#1e293b', padding: 8, borderRadius: 6 }}>
              <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>الزيادة على التكلفة (Markup)</small>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 4 }}>{calculation.markupPct}%</div>
            </div>
          </div>

          {Number(targetMargin) < 20 && (
            <div style={{ marginTop: 10, padding: '6px 10px', background: '#7f1d1d', color: '#fca5a5', borderRadius: 4, fontSize: '0.8rem' }}>
              ⚠️ تنبيه: هامش الربح أقل من 20%. سيتطلب عرض السعر اعتماداً خاصاً من الإدارة قبل إصداره.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ عرض السعر وتجميد اللقطة'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
