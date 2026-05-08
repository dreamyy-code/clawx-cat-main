/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { resolveSupportedLanguage } from '../../shared/language';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `clawx-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  closeToTrayOnClose: boolean;
  showCloseToTrayTip: boolean;
  telemetryEnabled: boolean;
  machineId: string;
  hasReportedInstall: boolean;
  hasSeenCloseToTrayTip: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayStartupProfile: 'auto' | 'full' | 'server-lite';
  gatewayStartupExtraArgs: string;
  gatewayPort: number;
  gatewayToken: string;
  bridgeEnabled: boolean;
  bridgePort: number;
  bridgeToken: string;
  bridgeHttpEnabled: boolean;
  bridgeHttpPort: number;
  bridgeHttpToken: string;
  bridgeAllowRemote: boolean;
  bridgeDiscoveryEnabled: boolean;
  bridgeDiscoveryPort: number;
  bridgeDiscoveryName: string;
  bridgeRelayEnabled: boolean;
  bridgeRelayUrl: string;
  bridgeRelayToken: string;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
}

/**
 * Default settings
 */
function getSystemLocale(): string {
  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  return preferredLanguages[0]
    || (typeof app.getLocale === 'function' ? app.getLocale() : '')
    || Intl.DateTimeFormat().resolvedOptions().locale
    || 'en';
}

function createDefaultSettings(): AppSettings {
  return {
    // General
    theme: 'system',
    language: resolveSupportedLanguage(getSystemLocale()),
    startMinimized: false,
    launchAtStartup: false,
    closeToTrayOnClose: true,
    showCloseToTrayTip: true,
    telemetryEnabled: true,
    machineId: '',
    hasReportedInstall: false,
    hasSeenCloseToTrayTip: false,

    // Gateway
    gatewayAutoStart: true,
    gatewayStartupProfile: 'auto',
    gatewayStartupExtraArgs: '',
    gatewayPort: 18789,
    gatewayToken: generateToken(),
    bridgeEnabled: false,
    bridgePort: 18989,
    bridgeToken: generateToken(),
    bridgeHttpEnabled: false,
    bridgeHttpPort: 18991,
    bridgeHttpToken: generateToken(),
    bridgeAllowRemote: false,
    bridgeDiscoveryEnabled: true,
    bridgeDiscoveryPort: 18990,
    bridgeDiscoveryName: 'ClawX-Cat',
    bridgeRelayEnabled: false,
    bridgeRelayUrl: '',
    bridgeRelayToken: '',
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',

    // Update
    updateChannel: 'stable',
    autoCheckUpdate: true,
    autoDownloadUpdate: false,
    skippedVersions: [],

    // UI State
    sidebarCollapsed: false,
    devModeUnlocked: false,

    // Presets
    selectedBundles: ['productivity', 'developer'],
    enabledSkills: [],
    disabledSkills: [],
  };
}

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults: createDefaultSettings(),
    });
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  return store.get(key);
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  store.set(key, value);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return store.store;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
