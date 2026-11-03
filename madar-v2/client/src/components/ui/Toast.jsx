import { useEffect } from 'react';
import Icon from './Icon.jsx';

export default function Toast({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timeout);
  }, [notice, onClose]);
  if (!notice) return null;
  return (
    <div className={`madar-toast ${notice.tone === 'error' ? 'error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.tone === 'error' ? 'alert' : 'check'} size={16} />
      <span>{notice.message}</span>
    </div>
  );
}
