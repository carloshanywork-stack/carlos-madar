import { useEffect, useState } from 'react';

function displayUnit(unit) {
  if (unit === 'set' || unit === 'طقم') return 'طقم';
  if (unit === 'piece' || unit === 'قطعة' || !unit) return 'قطعة';
  return unit;
}

export default function QuantityModal({ open, reason, initialValue = '', onConfirm, onClose }) {
  const [quantity, setQuantity] = useState('');

  useEffect(() => {
    if (open) setQuantity(initialValue === '' ? '' : String(initialValue));
  }, [initialValue, open, reason?.id]);

  if (!open || !reason) return null;

  const parsedQuantity = Number(quantity);
  const valid = quantity !== '' && Number.isSafeInteger(parsedQuantity) && parsedQuantity >= 1;
  const unit = displayUnit(reason.default_unit ?? reason.unit);
  const changeQuantity = (change) => {
    const current = quantity === '' ? 0 : Number(quantity);
    const next = Math.max(1, (Number.isSafeInteger(current) ? current : 0) + change);
    setQuantity(String(next));
  };

  return (
    <div
      dir="rtl"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center',
        padding: '16px', background: 'rgba(2, 6, 23, 0.78)', backdropFilter: 'blur(4px)',
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-quantity-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onConfirm?.({ reasonId: Number(reason.id), quantity: parsedQuantity, unit });
        }}
        style={{
          width: 'min(100%, 420px)', padding: '22px', borderRadius: '16px',
          border: '1px solid rgba(6, 182, 212, 0.45)', background: '#0f172a',
          color: '#f8fafc', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
        }}
      >
        <header style={{ marginBottom: '22px' }}>
          <h2 id="maintenance-quantity-title" style={{ margin: 0, color: '#f8fafc', fontSize: '20px' }}>تحديد الكمية المستهلكة</h2>
          <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: '14px' }}>{reason.name}</p>
        </header>

        <label htmlFor="maintenance-quantity-input" style={{ display: 'block', marginBottom: '8px', fontWeight: 700 }}>
          العدد المطلوب <span style={{ color: '#fb7185' }}>*</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button type="button" aria-label="زيادة الكمية" onClick={() => changeQuantity(1)} style={controlStyle}>+</button>
          <input
            id="maintenance-quantity-input"
            autoFocus
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            style={{
              minWidth: 0, flex: 1, padding: '11px', borderRadius: '9px',
              border: `1px solid ${valid ? '#06b6d4' : '#f87171'}`,
              background: '#020617', color: '#f8fafc', textAlign: 'center', fontSize: '20px',
            }}
          />
          <button type="button" aria-label="تقليل الكمية" disabled={!valid || parsedQuantity <= 1} onClick={() => changeQuantity(-1)} style={controlStyle}>−</button>
          <span style={{ padding: '8px 12px', borderRadius: '999px', background: 'rgba(6, 182, 212, 0.15)', color: '#67e8f9', border: '1px solid rgba(6, 182, 212, 0.4)', whiteSpace: 'nowrap' }}>{unit}</span>
        </div>
        {!valid && <p role="alert" style={{ margin: '8px 0 0', color: '#fca5a5', fontSize: '13px' }}>أدخل عدداً صحيحاً موجباً (1 أو أكثر).</p>}

        <footer style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', marginTop: '24px' }}>
          <button type="submit" disabled={!valid} style={{ ...actionStyle, background: valid ? '#0891b2' : '#334155', color: valid ? '#ecfeff' : '#94a3b8', cursor: valid ? 'pointer' : 'not-allowed' }}>
            تأكيد الإضافة
          </button>
          <button type="button" onClick={onClose} style={{ ...actionStyle, background: '#1e293b', color: '#cbd5e1', border: '1px solid #475569' }}>إلغاء</button>
        </footer>
      </form>
    </div>
  );
}

const controlStyle = {
  width: '40px', height: '40px', borderRadius: '9px', border: '1px solid #155e75',
  background: '#164e63', color: '#cffafe', fontSize: '22px', cursor: 'pointer',
};

const actionStyle = {
  minHeight: '40px', padding: '9px 16px', borderRadius: '9px', border: '1px solid transparent', fontWeight: 700,
};
