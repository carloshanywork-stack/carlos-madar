import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../../lib/api.js';
import { deleteOfflineMapPack, listOfflineMapPacks, listOfflineMapTileKeys, saveOfflineMapPack, saveOfflineMapTiles } from './offline-store.js';
import { OFFLINE_MAP_PACKS } from './map-utils.js';
import { getNativeAuthorizationHeaders } from './native-session.js';
import OfflineRouteMap from './OfflineRouteMap.jsx';
import GoogleRouteMap from './GoogleRouteMap.jsx';

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(value / 1024)} KB`;
}

async function fetchWithTimeout(path, { signal, binary = false, timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      credentials: 'include',
      cache: 'no-store',
      headers: await getNativeAuthorizationHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `تعذر تنزيل بيانات الخريطة (${response.status}).`;
      try {
        const payload = await response.json();
        message = payload.message || payload.error || message;
      } catch { /* Keep the status-based message for non-JSON responses. */ }
      throw new Error(message);
    }
    const result = binary ? await response.blob() : await response.json();
    if (binary && (!result.size || result.size < 1)) throw new Error('أعاد الخادم بلاطة خريطة فارغة.');
    return result;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error(`انتهت مهلة تنزيل بلاطة الخريطة بعد ${Math.round(timeoutMs / 1000)} ثوانٍ.`);
    if (signal?.aborted) throw new Error('تم إيقاف تنزيل الخريطة؛ يمكن استكمالها لاحقاً.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function fetchTileWithRetries(packId, tile, signal) {
  let lastError;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    if (signal.aborted) throw new Error('تم إيقاف تنزيل الخريطة؛ يمكن استكمالها لاحقاً.');
    try {
      const blob = await fetchWithTimeout(`/api/rep/map/tiles/${packId}/${tile.z}/${tile.x}/${tile.y}`, {
        signal,
        binary: true,
        timeoutMs: 6000,
      });
      return { ...tile, blob };
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === 3) break;
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError ?? new Error('تعذر تنزيل بلاطة الخريطة بعد إعادة المحاولة.');
}

export default function OfflineMapPanel({ route, gps, online, offlineOnly, onMachineSelect }) {
  const [selectedId, setSelectedId] = useState(OFFLINE_MAP_PACKS[0].id);
  const [catalog, setCatalog] = useState([]);
  const [installed, setInstalled] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState('');
  const [provider, setProvider] = useState(() => (online && !offlineOnly ? 'google' : 'offline'));
  const [googleConfig, setGoogleConfig] = useState({ loaded: false, enabled: false, apiKey: null });
  const downloadController = useRef(null);

  const selectedDefinition = OFFLINE_MAP_PACKS.find((pack) => pack.id === selectedId) ?? OFFLINE_MAP_PACKS[0];
  const selectedCatalogPack = catalog.find((pack) => pack.id === selectedId);
  const selectedInstalledPack = installed.find((pack) => pack.packId === selectedId);
  const routeMachines = useMemo(() => (route?.regions ?? []).flatMap((region) =>
    (region.machines ?? []).map((machine) => ({ ...machine, regionName: region.regionName }))), [route]);

  async function refreshInstalled() {
    const packs = await listOfflineMapPacks();
    setInstalled(packs);
    return packs;
  }

  useEffect(() => {
    let active = true;
    try {
      const saved = window.localStorage.getItem('madar-rep-offline-map-pack');
      if (OFFLINE_MAP_PACKS.some((pack) => pack.id === saved)) setSelectedId(saved);
    } catch { /* A private browsing context can disable localStorage. */ }
    void refreshInstalled().catch((caught) => { if (active) setError(caught.message || 'تعذر فتح مخزن الخرائط المحلي.'); });
    return () => {
      active = false;
      downloadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!online || offlineOnly) return undefined;
    let active = true;
    setCatalogLoading(true);
    fetchWithTimeout('/api/rep/map/packs')
      .then((result) => { if (active) setCatalog(result.packs ?? []); })
      .catch((caught) => { if (active) setError(caught.message || 'تعذر فحص حزم الخرائط على الخادم.'); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [offlineOnly, online]);

  useEffect(() => {
    if (!online || offlineOnly) setProvider('offline');
  }, [offlineOnly, online]);

  useEffect(() => {
    if (!online || offlineOnly) return undefined;
    let active = true;
    fetchWithTimeout('/api/rep/map/google', { timeoutMs: 6000 })
      .then((result) => {
        if (active) setGoogleConfig({
          loaded: true,
          enabled: Boolean(result?.enabled),
          apiKey: typeof result?.apiKey === 'string' && result.apiKey ? result.apiKey : null,
        });
      })
      .catch(() => {
        if (active) setGoogleConfig({ loaded: true, enabled: false, apiKey: null });
      });
    return () => { active = false; };
  }, [offlineOnly, online]);

  function choosePack(packId) {
    setSelectedId(packId);
    setError('');
    try { window.localStorage.setItem('madar-rep-offline-map-pack', packId); } catch { /* The selection remains available for this session. */ }
  }

  async function downloadPack() {
    if (!online || offlineOnly || downloading) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setError('');
    try {
      const { pack } = await fetchWithTimeout(`/api/rep/map/packs/${selectedId}/manifest`, { signal: controller.signal });
      if (!pack?.available || !Array.isArray(pack.tiles) || !pack.tiles.length) {
        throw new Error(pack?.reason || 'لا توجد حزمة خرائط جاهزة لهذا النطاق على الخادم.');
      }
      const allTileKeys = new Set(pack.tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`));
      const savedTileKeys = new Set((await listOfflineMapTileKeys(selectedId)).filter((key) => allTileKeys.has(key)));
      let completed = savedTileKeys.size;
      let downloadedBytes = pack.tiles
        .filter((tile) => savedTileKeys.has(`${tile.z}/${tile.x}/${tile.y}`))
        .reduce((total, tile) => total + (Number(tile.sizeBytes) || 0), 0);
      setProgress({ completed, total: pack.tiles.length });
      const localPack = {
        ...pack,
        packId: selectedId,
        status: 'downloading',
        downloadedCount: completed,
        downloadedBytes,
      };
      await saveOfflineMapPack(localPack);
      await refreshInstalled();

      const remainingTiles = pack.tiles.filter((tile) => !savedTileKeys.has(`${tile.z}/${tile.x}/${tile.y}`));
      let failedTiles = 0;
      for (let index = 0; index < remainingTiles.length; index += 6) {
        if (controller.signal.aborted) throw new Error('تم إيقاف تنزيل الخريطة. يمكنك استكمال الحزمة لاحقاً.');
        const batch = remainingTiles.slice(index, index + 6);
        const settled = await Promise.allSettled(batch.map((tile) => fetchTileWithRetries(selectedId, tile, controller.signal)));
        const downloaded = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
        failedTiles += settled.filter((result) => result.status === 'rejected').length;
        await saveOfflineMapTiles(selectedId, downloaded);
        completed += downloaded.length;
        downloadedBytes += downloaded.reduce((total, tile) => total + tile.blob.size, 0);
        setProgress({ completed, total: pack.tiles.length });
        await saveOfflineMapPack({ ...localPack, downloadedCount: completed, downloadedBytes, status: 'downloading' });
        if (controller.signal.aborted) throw new Error('تم إيقاف تنزيل الخريطة. يمكنك استكمال الحزمة لاحقاً.');
      }
      const complete = completed === pack.tiles.length && failedTiles === 0;
      const finalStatus = complete ? 'ready' : 'partial';
      await saveOfflineMapPack({ ...localPack, status: finalStatus, downloadedCount: completed, downloadedBytes });
      await refreshInstalled();
      if (!complete) setError(`حُفظت الحزمة جزئياً؛ تعذر تنزيل ${failedTiles} بلاطة بعد 3 محاولات. اضغط «استكمال التنزيل» عند استقرار الاتصال.`);
    } catch (caught) {
      const message = caught.message || 'تعذر تنزيل حزمة الخريطة.';
      setError(message);
      const savedPack = (await listOfflineMapPacks().catch(() => [])).find((pack) => pack.packId === selectedId);
      if (savedPack && savedPack.status !== 'ready') {
        await saveOfflineMapPack({ ...savedPack, status: 'partial', lastError: message }).catch(() => undefined);
        await refreshInstalled().catch(() => undefined);
      }
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
      setDownloading(false);
    }
  }

  async function removePack() {
    if (!selectedInstalledPack) return;
    if (!window.confirm(`حذف خريطة «${selectedDefinition.name}» من ذاكرة هذا الهاتف؟`)) return;
    try {
      await deleteOfflineMapPack(selectedId);
      await refreshInstalled();
    } catch (caught) {
      setError(caught.message || 'تعذر حذف الخريطة المحلية.');
    }
  }

  const downloadAllowed = Boolean(selectedCatalogPack?.available && online && !offlineOnly);
  const onlineNow = online && !offlineOnly;
  return (
    <section className="rep-offline-map-panel" aria-label="خريطة ماكينات اليوم">
      <div className="rep-offline-map-panel-head">
        <div><span className="rep-eyebrow">خريطة Google عند الاتصال · حزم MBTiles محفوظة بلا إنترنت</span><h3>خريطة الماكينات والمسار</h3></div>
        <span className={`rep-map-network ${onlineNow ? 'online' : ''}`}>{onlineNow ? 'متصل · خريطة محدثة' : 'أوفلاين · الخريطة المحلية'}</span>
      </div>
      <div className="rep-map-provider-tabs" role="tablist" aria-label="مصدر الخريطة">
        <button type="button" role="tab" aria-selected={provider === 'google'}
          className={provider === 'google' ? 'active' : ''} disabled={!onlineNow}
          onClick={() => setProvider('google')}
          title={onlineNow ? 'خريطة Google المضمّنة داخل التطبيق' : 'خريطة Google تحتاج اتصالاً بالإنترنت'}>
          <b>Google Maps</b>
          <small>{googleConfig.enabled ? 'طبقة تفاعلية مضمّنة' : googleConfig.loaded ? 'عرض سريع مضمّن' : 'جارٍ التحقق…'}</small>
        </button>
        <button type="button" role="tab" aria-selected={provider === 'offline'}
          className={provider === 'offline' ? 'active' : ''} onClick={() => setProvider('offline')}>
          <b>الخريطة المحلية</b><small>تعمل دون إنترنت</small>
        </button>
      </div>
      {provider === 'google' ? (onlineNow ? (
        !googleConfig.loaded
          ? <p className="rep-map-pack-summary" role="status">جارٍ التحقق من إعداد خريطة Google على الخادم…</p>
          : <GoogleRouteMap apiKey={googleConfig.apiKey} machines={routeMachines} gps={gps} onMachineSelect={onMachineSelect} />
      ) : (
        <p className="rep-map-warning">خريطة Google تحتاج اتصالاً بالإنترنت؛ تم التحويل إلى الخريطة المحلية. نزّل حزمة المنطقة مسبقاً للعمل بلا اتصال.</p>
      )) : <>
      <div className="rep-map-pack-row">
        <label>
          <span>اختر حزمة المنطقة</span>
          <select value={selectedId} onChange={(event) => choosePack(event.target.value)} disabled={downloading}>
            {OFFLINE_MAP_PACKS.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </select>
        </label>
        <div className="rep-map-pack-actions">
          <button type="button" className="rep-button rep-button-primary" onClick={() => void downloadPack()} disabled={!downloadAllowed || downloading}>
            {downloading ? `جارٍ التنزيل ${progress.completed}/${progress.total}` : selectedInstalledPack?.status === 'partial' ? 'استكمال التنزيل' : selectedInstalledPack?.status === 'ready' ? 'تحديث الحزمة' : 'تحميل الخريطة'}
          </button>
          {selectedInstalledPack && <button type="button" className="rep-button rep-button-light" onClick={() => void removePack()} disabled={downloading}>حذف من الهاتف</button>}
          {downloading && <button type="button" className="rep-button rep-button-danger-light" onClick={() => downloadController.current?.abort()}>إيقاف</button>}
        </div>
      </div>
      {downloading && <div className="rep-map-progress" role="progressbar" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.completed}>
        <span style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} />
      </div>}
      <div className="rep-map-pack-summary" role="status">
        {selectedInstalledPack?.status === 'ready'
          ? `محفوظة محلياً · ${formatSize(selectedInstalledPack.sizeBytes)} · ${Number(selectedInstalledPack.tileCount).toLocaleString('ar-EG')} بلاطة${selectedInstalledPack.attribution ? ` · ${selectedInstalledPack.attribution}` : ''}`
          : selectedInstalledPack?.status === 'partial'
            ? `تنزيل جزئي: ${Number(selectedInstalledPack.downloadedCount ?? 0).toLocaleString('ar-EG')} بلاطة محفوظة؛ يمكنك الاستكمال عند توفر الخادم.`
            : selectedCatalogPack?.available
              ? `${selectedCatalogPack.sourceName || 'خريطة الخادم'} · ${formatSize(selectedCatalogPack.sizeBytes)} · ${Number(selectedCatalogPack.tileCount).toLocaleString('ar-EG')} بلاطة · التكبير ${selectedCatalogPack.minZoom}–${selectedCatalogPack.maxZoom}`
              : catalogLoading
                ? 'جارٍ فحص الحزم المحلية على الخادم…'
                : selectedCatalogPack?.reason || (online ? 'تعذر التحقق من حزمة المنطقة.' : 'لا توجد نسخة محلية من هذه المنطقة بعد؛ اتصل بالخادم لتنزيلها أولاً.')}
      </div>
      {!catalog.length && !online && <p className="rep-map-warning">لا يمكن تنزيل خرائط جديدة أثناء انقطاع الاتصال. نزّل الحزمة المطلوبة مسبقاً عبر شبكة MADAR المحلية.</p>}
      {['ready', 'partial'].includes(selectedInstalledPack?.status) && <OfflineRouteMap
        pack={selectedInstalledPack}
        machines={routeMachines}
        gps={gps}
        onMachineSelect={onMachineSelect}
      />}
      {error && <p className="rep-map-error" role="alert">{error}</p>}
      </>}
      <p className="rep-map-disclaimer">خريطة Google تُحمّل فقط عند وجود اتصال، وعند انقطاعه يتحوّل التطبيق إلى حزمة MBTiles المحفوظة على الهاتف. GPS يعمل بلا إنترنت، وإحداثيات المندوب لا تُرسل إلى مزوّد الخرائط في الوضع المحلي.</p>
    </section>
  );
}
