/**
 * MADAR Adaptive Visual Quality Profiler
 * Dynamically selects optimal rendering, decoding, and caching profiles
 * based on device capabilities without transmitting fingerprinting telemetry.
 */

export const QUALITY_TIERS = {
  conservative: {
    key: 'conservative',
    label: 'موفر للموارد',
    englishLabel: 'Conservative',
    previewSize: 800,
    variant: '800',
    maxConcurrentDecodes: 2,
    prefetchWindow: 1,
    maxCacheBytes: 100 * 1024 * 1024, // 100 MB
    storageFraction: 0.02,
    description: 'يحد من استهلاك الذاكرة والإنترنت للأجهزة الضعيفة والمحمولة.',
  },
  balanced: {
    key: 'balanced',
    label: 'متوازن',
    englishLabel: 'Balanced',
    previewSize: 1200,
    variant: 'preview',
    maxConcurrentDecodes: 4,
    prefetchWindow: 1,
    maxCacheBytes: 300 * 1024 * 1024, // 300 MB
    storageFraction: 0.04,
    description: 'توازن مثالي بين سرعة التصفح وجودة العرض للأجهزة العادية.',
  },
  high: {
    key: 'high',
    label: 'جودة عالية',
    englishLabel: 'High',
    previewSize: 1800,
    variant: 'high',
    maxConcurrentDecodes: 6,
    prefetchWindow: 2,
    maxCacheBytes: 600 * 1024 * 1024, // 600 MB
    storageFraction: 0.06,
    description: 'دقة عالية وتفاصيل واضحة لشاشات العمل والتحليل الدقيق.',
  },
  ultra: {
    key: 'ultra',
    label: 'أعلى جودة',
    englishLabel: 'Ultra',
    previewSize: 2400,
    variant: 'high',
    maxConcurrentDecodes: 8,
    prefetchWindow: 3,
    maxCacheBytes: 1200 * 1024 * 1024, // 1.2 GB
    storageFraction: 0.08,
    description: 'أقصى دقة تفصيلية لمحطات العمل القوية والشاشات الكبيرة 4K.',
  },
};

const PREFERENCE_KEY = 'madar_quality_tier_preference';

export function getStoredQualityPreference() {
  if (typeof window === 'undefined' || !window.localStorage) return 'auto';
  const val = window.localStorage.getItem(PREFERENCE_KEY);
  return ['conservative', 'balanced', 'high', 'ultra'].includes(val) ? val : 'auto';
}

export function setStoredQualityPreference(preference) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (['conservative', 'balanced', 'high', 'ultra', 'auto'].includes(preference)) {
    window.localStorage.setItem(PREFERENCE_KEY, preference);
    window.dispatchEvent(new CustomEvent('madar-quality-profile-changed', { detail: { preference } }));
  }
}

/**
 * Pure evaluation function mapping device signals to the recommended quality tier.
 */
export function evaluateAdaptiveTier(signals = {}) {
  const {
    totalMemoryGb = 8,
    cpuCores = 4,
    width = 1920,
    height = 1080,
    dpr = 1,
    isBatteryDischarging = false,
    freeDiskGb = 50,
  } = signals;

  // Constrained / battery / low storage conditions -> Conservative
  if (totalMemoryGb <= 4 || cpuCores <= 2 || freeDiskGb < 2 || isBatteryDischarging) {
    return 'conservative';
  }

  // Workstation class: High RAM (16GB+), High CPU (8+ cores), High-DPI or 2K+ display
  if (totalMemoryGb >= 16 && cpuCores >= 8 && (width >= 2560 || (width >= 1920 && dpr >= 1.5))) {
    return 'ultra';
  }

  // Capable desktop: 8GB+ RAM, 6+ cores, or High-DPI 1080p+ display
  if (totalMemoryGb >= 8 && (cpuCores >= 6 || dpr >= 1.5 || width >= 1920)) {
    return 'high';
  }

  return 'balanced';
}

/**
 * Safely collect local device signals without fingerprinting.
 */
export async function collectDeviceSignals() {
  if (typeof window === 'undefined') {
    return { totalMemoryGb: 8, cpuCores: 4, width: 1920, height: 1080, dpr: 1 };
  }

  let totalMemoryGb = Number(navigator.deviceMemory) || 8;
  let cpuCores = Number(navigator.hardwareConcurrency) || 4;

  // If running in MADAR Desktop, query coarse system capabilities from Electron
  if (window.madarDesktop?.getSystemCapabilities) {
    try {
      const caps = await window.madarDesktop.getSystemCapabilities();
      if (Number.isFinite(caps?.totalMemoryGb)) totalMemoryGb = caps.totalMemoryGb;
      if (Number.isFinite(caps?.cpuCores)) cpuCores = caps.cpuCores;
    } catch {
      // ignore
    }
  }

  let freeDiskGb = 50;
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est.quota) {
        freeDiskGb = Math.max(1, Math.round((est.quota - (est.usage || 0)) / (1024 * 1024 * 1024)));
      }
    } catch {
      // ignore
    }
  }

  let isBatteryDischarging = false;
  if (typeof navigator.getBattery === 'function') {
    try {
      const battery = await navigator.getBattery();
      if (battery && !battery.charging && battery.level < 0.25) {
        isBatteryDischarging = true;
      }
    } catch {
      // ignore
    }
  }

  return {
    totalMemoryGb,
    cpuCores,
    width: window.innerWidth || window.screen?.width || 1920,
    height: window.innerHeight || window.screen?.height || 1080,
    dpr: window.devicePixelRatio || 1,
    isBatteryDischarging,
    freeDiskGb,
  };
}

let cachedResolvedProfile = null;

export async function getActiveAdaptiveProfile(forceRefresh = false) {
  if (cachedResolvedProfile && !forceRefresh) return cachedResolvedProfile;

  const pref = getStoredQualityPreference();
  const signals = await collectDeviceSignals();
  const autoTier = evaluateAdaptiveTier(signals);
  const activeTierKey = pref === 'auto' ? autoTier : pref;
  const tierConfig = QUALITY_TIERS[activeTierKey] || QUALITY_TIERS.balanced;

  cachedResolvedProfile = {
    ...tierConfig,
    isAuto: pref === 'auto',
    preference: pref,
    autoEvaluatedTier: autoTier,
    signals,
  };

  return cachedResolvedProfile;
}
