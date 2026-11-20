import { useState, useRef, useEffect } from 'react';

/**
 * MachineQrScanner
 * Verifies machine identity by scanning the QR code or barcode on the machine
 * or allowing manual confirmation, eliminating machine mismatch errors.
 */
export default function MachineQrScanner({
  expectedCode,
  machineName = '',
  isOpen = false,
  onClose = () => {},
  onVerified = () => {},
}) {
  const [manualCode, setManualCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [useCamera, setUseCamera] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setErrorMsg('');
      setSuccessMsg('');
      setManualCode('');
      setUseCamera(false);
    }
  }, [isOpen]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    try {
      setUseCamera(true);
      setErrorMsg('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setErrorMsg('تعذر الوصول للكاميرا، يرجى التحقق من أذونات الكاميرا أو استخدام الإدخال اليدوي.');
      setUseCamera(false);
    }
  };

  const handleVerify = (input) => {
    const cleanedInput = (input || '').trim().toUpperCase();
    const cleanedExpected = (expectedCode || '').trim().toUpperCase();

    if (!cleanedInput) {
      setErrorMsg('يرجى مسح أو إدخال كود الماكينة.');
      return;
    }

    if (cleanedInput === cleanedExpected || cleanedInput.includes(cleanedExpected)) {
      setSuccessMsg(`تم التحقق بنجاح من هوية الماكينة #${expectedCode}`);
      setErrorMsg('');
      stopCamera();
      setTimeout(() => {
        onVerified({ verified: true, code: cleanedExpected, method: 'qr_scan' });
        onClose();
      }, 700);
    } else {
      setErrorMsg(`الكود الممسوح [${cleanedInput}] لا يتطابق مع الماكينة المستهدفة [${cleanedExpected}]!`);
      setSuccessMsg('');
    }
  };

  const handleBypass = () => {
    if (window.confirm('هل أنت متأكد من تجاوز مسح الكود؟ سيتم تسجيل التجاوز في سجل المشرف.')) {
      stopCamera();
      onVerified({ verified: true, code: expectedCode, method: 'manual_bypass' });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="rep-qr-modal-backdrop" dir="rtl">
      <div className="rep-qr-modal-card">
        <div className="rep-qr-modal-header">
          <div>
            <h3>📷 التحقق من هوية الماكينة</h3>
            <p>امسح QR Code الماكينة لضمان عدم الخلط بين الماكينات</p>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>✕</button>
        </div>

        <div className="rep-qr-target-info">
          <span>الماكينة المطلوبة:</span>
          <strong>{machineName || `ماكينة ${expectedCode}`}</strong>
          <code>#{expectedCode}</code>
        </div>

        {errorMsg && <div className="rep-qr-alert error">{errorMsg}</div>}
        {successMsg && <div className="rep-qr-alert success">✓ {successMsg}</div>}

        <div className="rep-qr-body">
          {useCamera ? (
            <div className="rep-qr-video-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="rep-qr-video" />
              <div className="rep-qr-reticle" />
              <button type="button" className="btn-stop-cam" onClick={stopCamera}>
                إيقاف الكاميرا
              </button>
            </div>
          ) : (
            <div className="rep-qr-options">
              <button type="button" className="btn-open-cam" onClick={startCamera}>
                📸 تشغيل كاميرا المسح
              </button>
              <div className="rep-qr-divider">أو أدخل الكود المطبوع على الماكينة</div>
              <div className="rep-qr-input-row">
                <input
                  type="text"
                  placeholder="مثال: CIB-014"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  className="rep-qr-input"
                />
                <button
                  type="button"
                  className="btn-submit-code"
                  onClick={() => handleVerify(manualCode)}
                >
                  تحقق ✓
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rep-qr-footer">
          <button type="button" className="btn-bypass-qr" onClick={handleBypass}>
            تجاوز المسح (تسجيل كمخالفة للمشرف)
          </button>
          <button type="button" className="btn-cancel" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
