/**
 * Loads the Google Maps JavaScript API once per page and returns `google.maps`.
 * The key is supplied by the MADAR server (`GOOGLE_MAPS_API_KEY`); when it is
 * absent the representative app renders the keyless embedded quick view.
 */
let loadedMaps = null;
let loaderPromise = null;

export function loadGoogleMaps(apiKey) {
  const key = String(apiKey ?? '').trim();
  if (!key) return Promise.reject(new Error('مفتاح Google Maps غير مهيأ على الخادم.'));
  if (loadedMaps) return Promise.resolve(loadedMaps);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__madarGoogleMapsReady';
    const finish = (handler) => {
      window.clearTimeout(timeout);
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      handler();
    };
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('انتهت مهلة تحميل خريطة Google. تحقق من الاتصال بالإنترنت.')));
    }, 15000);

    window[callbackName] = () => {
      const maps = window.google?.maps;
      if (!maps?.Map) {
        finish(() => reject(new Error('تعذر تهيئة خريطة Google على هذا الجهاز.')));
        return;
      }
      loadedMaps = maps;
      finish(() => resolve(maps));
    };

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=ar&region=EG&loading=async&callback=${callbackName}`;
    script.onerror = () => {
      finish(() => reject(new Error('تعذر تحميل خريطة Google. تحقق من الاتصال أو قيود مفتاح API.')));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
}
