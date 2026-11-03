import { useApi } from '../../lib/useApi.js';
import Icon from '../ui/Icon.jsx';

export default function StatusPills() {
  const { data, loading } = useApi('/api/health');
  const connected = data?.status === 'ok';
  return (
    <div className="madar-status-pills" aria-label="حالة النظام">
      <span className="madar-status-pill">
        <span className={`madar-status-indicator ${connected ? 'online' : loading ? 'checking' : 'offline'}`} />
        {connected ? 'الخادم متصل' : loading ? 'جارٍ الاتصال' : 'الخادم غير متاح'}
      </span>
      <span className="madar-status-pill"><Icon name="shield" size={13} /> تشغيل محلي</span>
    </div>
  );
}
