import { useCallback, useState } from 'react';

export function useToast() {
  const [notice, setNotice] = useState(null);
  const showToast = useCallback((message, tone = 'success') => setNotice({ message, tone, id: Date.now() }), []);
  const clearToast = useCallback(() => setNotice(null), []);
  return { notice, showToast, clearToast };
}
