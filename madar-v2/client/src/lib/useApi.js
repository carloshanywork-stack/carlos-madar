import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function useApi(path, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!enabled || !path) return null;
    setLoading(true);
    setError('');
    try {
      const result = await api.get(path);
      setData(result);
      return result;
    } catch (caught) {
      setError(caught.message || 'تعذر تحميل البيانات.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, path]);

  useEffect(() => { reload(); }, [reload]);

  return { data, setData, loading, error, reload };
}
