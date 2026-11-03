import { useEffect } from 'react';
import Button from './Button.jsx';
import Icon from './Icon.jsx';

export default function Modal({ open, title, description, onClose, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="madar-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className={`madar-modal ${wide ? 'madar-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="madar-modal-title">
        <header className="madar-modal-header">
          <div>
            <h2 className="madar-modal-title" id="madar-modal-title">{title}</h2>
            {description && <p className="madar-modal-description">{description}</p>}
          </div>
          <Button icon="close" iconOnly variant="ghost" aria-label="إغلاق" onClick={onClose} />
        </header>
        <div className="madar-modal-body">{children}</div>
      </section>
    </div>
  );
}
