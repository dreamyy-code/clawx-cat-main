import rawProfile from '../../build-profile.json';

type BuildProfile = {
  variant?: string;
  displayName?: string;
  iterativeCatBaseUrl?: string;
  updateBaseUrl?: string;
  updateTrack?: string;
  openclawTrack?: string;
  openclawVersion?: string;
};

function normalizeUrl(input: string | undefined, fallback: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/, '');
}

const profile = rawProfile as BuildProfile;

export const APP_BUILD_VARIANT = String(profile.variant || 'main').trim() || 'main';
export const APP_BUILD_DISPLAY_NAME = String(profile.displayName || '主功能版').trim() || '主功能版';
export const ITERATIVECAT_DEFAULT_BASE_URL = normalizeUrl(
  profile.iterativeCatBaseUrl,
  'https://api.iterativecat.cn',
);
export const ITERATIVECAT_DEFAULT_RUNTIME_BASE_URL = `${ITERATIVECAT_DEFAULT_BASE_URL}/v1`;
export const APP_UPDATE_BASE_URL = normalizeUrl(
  profile.updateBaseUrl,
  'https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/stable',
);
export const APP_UPDATE_TRACK = String(profile.updateTrack || '').trim();
export const APP_OPENCLAW_TRACK = String(profile.openclawTrack || 'stable').trim() || 'stable';
export const APP_OPENCLAW_VERSION = String(profile.openclawVersion || '2026.4.2').trim() || '2026.4.2';
