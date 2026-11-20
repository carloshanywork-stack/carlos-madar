import { useState, useRef, useEffect } from 'react';

/**
 * CustomerSignatureModal
 * Provides "Signature on Glass" functionality allowing bank managers or client reps
 * to digitally sign off on completed maintenance or delivery.
 */
export default function CustomerSignatureModal({
  isOpen = false,
  onClose = () => {},
  onSave = () => {},
  clientName = '',
  machineCode = '',
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      clearCanvas();
    }
  }, [isOpen]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasSignature(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;

    const dataUrl = canvas.toDataURL('image/png');
    onSave({
      signatureDataUrl: dataUrl,
      signerName: signerName.trim() || 'مسؤول الموقع',
      signerTitle: signerTitle.trim() || 'مشرف الفرع',
      signedAt: new Date().toISOString(),
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="rep-signature-modal-backdrop" dir="rtl">
      <div className="rep-signature-modal-card">
        <div className="rep-signature-modal-header">
          <div>
            <h3>✍️ توقيع مسؤول العميل على الاستلام</h3>
            <p>تأكيد إتمام أعمال الصيانة وتسليم الماكينة {machineCode ? `(#${machineCode})` : ''}</p>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>✕</button>
        </div>

        <div className="rep-signature-inputs">
          <input
            type="text"
            placeholder="اسم المسؤول / المستلم (اختياري)"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="rep-sig-input"
          />
          <input
            type="text"
            placeholder="الصفة / المسمى الوظيفي (مثال: مدير الفرع)"
            value={signerTitle}
            onChange={(e) => setSignerTitle(e.target.value)}
            className="rep-sig-input"
          />
        </div>

        <div className="rep-signature-canvas-wrap">
          <div className="canvas-instruction">يرجى التوقيع داخل الإطار أدناه:</div>
          <canvas
            ref={canvasRef}
            width={380}
            height={160}
            className="rep-signature-canvas"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>

        <div className="rep-signature-footer">
          <button type="button" className="btn-clear-sig" onClick={clearCanvas}>
            🔄 مسح التوقيع
          </button>
          <div className="action-buttons">
            <button type="button" className="btn-cancel" onClick={onClose}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-confirm-sig"
              disabled={!hasSignature}
              onClick={handleSave}
            >
              اعتماد وحفظ التوقيع ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
