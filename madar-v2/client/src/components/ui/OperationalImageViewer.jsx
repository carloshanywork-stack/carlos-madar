import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { sanitizeWindowsFilename, buildOperationalFilename } from '../../lib/operational-filename.js';

export { sanitizeWindowsFilename, buildOperationalFilename };

export default function OperationalImageViewer({
  isOpen = true,
  onClose,
  photos = [],
  currentIndex = 0,
  onIndexChange,
  title,
  subtitle,
  machineCode,
  phaseLabel,
  customHeaderActions,
  customFooter,
  canRotate = true,
  canSaveRotation = false,
  onSaveRotation,
  isSavingRotation = false,
  onPrevMachine,
  onNextMachine,
  hasPrevMachine = false,
  hasNextMachine = false,
}) {
  const [rotationAngle, setRotationAngle] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const activeIndex = Math.max(0, Math.min(currentIndex, photos.length - 1));
  const currentPhoto = photos[activeIndex] || null;
  const currentUrl = typeof currentPhoto === 'string' ? currentPhoto : currentPhoto?.url || '';
  const currentThumbnail = typeof currentPhoto === 'object' ? currentPhoto?.thumbnailUrl : null;

  // Reset rotation and loading states when photo changes
  useEffect(() => {
    setRotationAngle(0);
    setDownloadError('');
    setImageLoading(true);
    setImageError(false);
  }, [currentUrl]);

  const handlePrev = useCallback(() => {
    if (photos.length > 1 && activeIndex > 0) {
      onIndexChange?.(activeIndex - 1);
    } else if (hasPrevMachine && onPrevMachine) {
      onPrevMachine();
    }
  }, [activeIndex, hasPrevMachine, onIndexChange, onPrevMachine, photos.length]);

  const handleNext = useCallback(() => {
    if (photos.length > 1 && activeIndex < photos.length - 1) {
      onIndexChange?.(activeIndex + 1);
    } else if (hasNextMachine && onNextMachine) {
      onNextMachine();
    }
  }, [activeIndex, hasNextMachine, onIndexChange, onNextMachine, photos.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      } else if (event.key === 'ArrowRight') {
        // In RTL, right arrow moves to previous item
        event.preventDefault();
        handlePrev();
      } else if (event.key === 'ArrowLeft') {
        // In RTL, left arrow moves to next item
        event.preventDefault();
        handleNext();
      } else if (event.key === 'ArrowUp' && hasPrevMachine && onPrevMachine) {
        event.preventDefault();
        onPrevMachine();
      } else if (event.key === 'ArrowDown' && hasNextMachine && onNextMachine) {
        event.preventDefault();
        onNextMachine();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, hasNextMachine, hasPrevMachine, isOpen, onClose, onNextMachine, onPrevMachine]);

  if (!isOpen || !currentUrl) return null;

  const downloadFilename = typeof currentPhoto === 'object' && currentPhoto?.filename
    ? sanitizeWindowsFilename(currentPhoto.filename)
    : buildOperationalFilename({
      machineCode: machineCode || (typeof currentPhoto === 'object' ? currentPhoto?.machineCode : null),
      phase: phaseLabel || (typeof currentPhoto === 'object' ? currentPhoto?.phase : null),
      timestamp: typeof currentPhoto === 'object' ? (currentPhoto?.capturedAt || currentPhoto?.createdAt) : null,
      index: activeIndex,
      originalUrl: currentUrl,
    });

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await api.download(currentUrl, downloadFilename);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'تعذر تنزيل الصورة؛ تحقق من الاتصال بالخادم.';
      setDownloadError(message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="madar-operational-image-viewer"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(5, 10, 20, 0.95)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '0.75rem',
        animation: 'madar-fade-in 0.2s ease-out',
        color: '#f8fafc',
        fontFamily: 'inherit',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'عارض الصور التشغيلية'}
      dir="rtl"
    >
      {/* Top Header Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '0.6rem 1rem',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Left Side: Back action, Titles & Metadata */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Permanent Visible Arabic Back Button */}
          <button
            type="button"
            onClick={onClose}
            className="madar-button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#0f766e',
              color: '#ffffff',
              border: '1px solid #14b8a6',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            title="رجوع للقائمة أو الكارت الأصلي (Esc)"
            aria-label="رجوع"
          >
            <span aria-hidden="true" style={{ fontSize: '15px' }}>←</span>
            <span>رجوع</span>
          </button>

          {machineCode && (
            <span
              dir="ltr"
              style={{
                fontFamily: 'Consolas, monospace',
                fontSize: '13px',
                fontWeight: 900,
                background: '#1e293b',
                color: '#38bdf8',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              {machineCode}
            </span>
          )}

          {title && (
            <strong style={{ fontSize: '14px', color: '#f8fafc' }}>
              {title}
            </strong>
          )}

          {subtitle && (
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {subtitle}
            </span>
          )}

          {phaseLabel && (
            <span
              style={{
                padding: '3px 9px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 800,
                background: phaseLabel.includes('بعد') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                color: phaseLabel.includes('after') || phaseLabel.includes('بعد') ? '#34d399' : '#38bdf8',
                border: `1px solid ${phaseLabel.includes('بعد') ? '#059669' : '#0284c7'}`,
              }}
            >
              {phaseLabel}
            </span>
          )}

          {photos.length > 1 && (
            <span
              style={{
                fontSize: '12px',
                color: '#cbd5e1',
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '3px 8px',
                borderRadius: '6px',
                fontWeight: 700,
              }}
            >
              {activeIndex + 1} من {photos.length}
            </span>
          )}
        </div>

        {/* Right Side: Action Controls (Download, Rotation, Machine Nav, Close) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Machine Navigation if provided */}
          {(hasPrevMachine || hasNextMachine) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginInlineEnd: '0.4rem' }}>
              <button
                type="button"
                className="madar-button madar-button-small madar-button-secondary"
                disabled={!hasPrevMachine}
                onClick={onPrevMachine}
                style={{ fontSize: '11px', padding: '4px 8px', cursor: hasPrevMachine ? 'pointer' : 'default', opacity: hasPrevMachine ? 1 : 0.4 }}
                title="الماكينة السابقة"
              >
                ❮ ماكينة سابقة
              </button>
              <button
                type="button"
                className="madar-button madar-button-small madar-button-secondary"
                disabled={!hasNextMachine}
                onClick={onNextMachine}
                style={{ fontSize: '11px', padding: '4px 8px', cursor: hasNextMachine ? 'pointer' : 'default', opacity: hasNextMachine ? 1 : 0.4 }}
                title="الماكينة التالية"
              >
                ماكينة تالية ❯
              </button>
            </div>
          )}

          {/* Secure Download Button */}
          <button
            type="button"
            className="madar-button"
            onClick={handleDownload}
            disabled={downloading || imageError}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: downloading ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.12)',
              color: downloading ? '#38bdf8' : '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '8px',
              padding: '6px 13px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: downloading ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
            }}
            title={`تنزيل الصورة كاملة الدقة باسم: ${downloadFilename}`}
            aria-label="تنزيل الصورة"
          >
            <span>{downloading ? '⏳ جارٍ التنزيل…' : 'تنزيل الصورة ↓'}</span>
          </button>

          {/* Non-destructive Rotation Controls */}
          {canRotate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <button
                type="button"
                onClick={() => setRotationAngle((prev) => (prev + 270) % 360)}
                style={{ background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#fff', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                title="تدوير يسار 90 درجة"
                aria-label="تدوير يسار"
              >
                ⟲ 90°
              </button>
              <button
                type="button"
                onClick={() => setRotationAngle((prev) => (prev + 90) % 360)}
                style={{ background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#fff', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                title="تدوير يمين 90 درجة"
                aria-label="تدوير يمين"
              >
                ⟳ 90°
              </button>
              {canSaveRotation && rotationAngle !== 0 && onSaveRotation && (
                <button
                  type="button"
                  onClick={() => onSaveRotation(rotationAngle)}
                  disabled={isSavingRotation}
                  style={{ background: '#0284c7', border: '1px solid #38bdf8', color: '#fff', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 800 }}
                  title="حفظ اتجاه الصورة في السيرفر"
                >
                  {isSavingRotation ? 'جارٍ الحفظ…' : '💾 حفظ الاتجاه'}
                </button>
              )}
            </div>
          )}

          {/* Module-specific Custom Actions */}
          {customHeaderActions}

          {/* Corner Close Button */}
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#ffffff',
              fontSize: '18px',
              padding: '4px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="إغلاق (Esc)"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
      </header>

      {downloadError && (
        <div
          role="alert"
          style={{
            margin: '0.5rem 0',
            padding: '8px 14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          ⚠️ {downloadError}
        </div>
      )}

      {/* Main Image Stage */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          padding: '0.75rem 0',
          minHeight: 0,
        }}
      >
        {/* Previous Photo Button (Right arrow in RTL) */}
        {photos.length > 1 && (
          <button
            type="button"
            onClick={handlePrev}
            disabled={activeIndex === 0 && !hasPrevMachine}
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              fontSize: '24px',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              cursor: activeIndex === 0 && !hasPrevMachine ? 'default' : 'pointer',
              opacity: activeIndex === 0 && !hasPrevMachine ? 0.3 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              flexShrink: 0,
              transition: 'background 0.15s ease',
            }}
            title="الصورة السابقة (السهم الأيمن)"
            aria-label="الصورة السابقة"
          >
            ❯
          </button>
        )}

        {/* Center Display Image */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            minWidth: 0,
            position: 'relative',
          }}
        >
          {imageLoading && (
            <div
              style={{
                position: 'absolute',
                color: '#94a3b8',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⏳ جارٍ تحميل الصورة بدقة عالية…</span>
            </div>
          )}

          {imageError ? (
            <div
              role="alert"
              style={{
                textAlign: 'center',
                padding: '2rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '12px',
                color: '#f87171',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚠️</div>
              <strong style={{ fontSize: '15px' }}>تعذر تحميل الصورة من السيرفر</strong>
              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '6px 0 0' }}>
                قد تكون الصورة غير متاحة أو انتهت فترة صلاحيتها أو يحتاج الحساب لصلاحيات إضافية.
              </p>
            </div>
          ) : (
            <img
              src={currentUrl}
              alt={title || `صورة ${machineCode || ''}`}
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setImageError(true);
              }}
              style={{
                maxWidth: '86vw',
                maxHeight: photos.length > 1 ? '68vh' : '76vh',
                objectFit: 'contain',
                borderRadius: '10px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transform: `rotate(${rotationAngle}deg)`,
                transition: 'transform 0.25s ease-in-out',
                display: imageLoading ? 'none' : 'block',
              }}
            />
          )}
        </div>

        {/* Next Photo Button (Left arrow in RTL) */}
        {photos.length > 1 && (
          <button
            type="button"
            onClick={handleNext}
            disabled={activeIndex === photos.length - 1 && !hasNextMachine}
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              fontSize: '24px',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              cursor: activeIndex === photos.length - 1 && !hasNextMachine ? 'default' : 'pointer',
              opacity: activeIndex === photos.length - 1 && !hasNextMachine ? 0.3 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              flexShrink: 0,
              transition: 'background 0.15s ease',
            }}
            title="الصورة التالية (السهم الأيسر)"
            aria-label="الصورة التالية"
          >
            ❮
          </button>
        )}
      </div>

      {/* Thumbnails strip for multiple photos */}
      {photos.length > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            padding: '8px 0',
            maxHeight: '75px',
          }}
        >
          {photos.map((photo, index) => {
            const url = typeof photo === 'string' ? photo : photo?.url || '';
            const thumb = typeof photo === 'object' && photo?.thumbnailUrl ? photo.thumbnailUrl : url;
            const isSelected = index === activeIndex;
            return (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => onIndexChange?.(index)}
                style={{
                  width: '56px',
                  height: '56px',
                  padding: 0,
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: isSelected ? '2px solid #14b8a6' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: '#0f172a',
                  cursor: 'pointer',
                  opacity: isSelected ? 1 : 0.6,
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
                title={`الصورة ${index + 1}`}
              >
                <img
                  src={thumb}
                  alt={`مصغرة ${index + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Custom footer actions (e.g. tagging / notes) */}
      {customFooter}
    </div>
  );
}
