/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { resolveSupportedLanguage } from '../../shared/language';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';
type GatewayStartupProfile = 'auto' | 'full' | 'server-lite';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  closeToTrayOnClose: boolean;
  showCloseToTrayTip: boolean;
  telemetryEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayStartupProfile: GatewayStartupProfile;
  gatewayStartupExtraArgs: string;
  gatewayPort: number;
  bridgeEnabled: boolean;
  bridgePort: number;
  bridgeAllowRemote: boolean;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setCloseToTrayOnClose: (value: boolean) => void;
  setShowCloseToTrayTip: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayStartupProfile: (value: GatewayStartupProfile) => void;
  setGatewayStartupExtraArgs: (value: string) => void;
  setGatewayPort: (port: number) => void;
  setBridgeEnabled: (value: boolean) => void;
  setBridgePort: (port: number) => void;
  setBridgeAllowRemote: (value: boolean) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setDevModeUnlocked: (value: boolean) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  closeToTrayOnClose: true,
  showCloseToTrayTip: true,
  telemetryEnabled: true,
  gatewayAutoStart: true,
  gatewayStartupProfile: 'auto' as GatewayStartupProfile,
  gatewayStartupExtraArgs: '',
  gatewayPort: 18789,
  bridgeEnabled: false,
  bridgePort: 18989,
  bridgeAllowRemote: false,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  devModeUnlocked: false,
  setupComplete: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          set((state) => ({
            ...state,
            ...settings,
            ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
          }));
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApiFetch('/api/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: theme }),
        }).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: resolvedLanguage }),
        }).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApiFetch('/api/settings/launchAtStartup', {
          method: 'PUT',
          body: JSON.stringify({ value: launchAtStartup }),
        }).catch(() => { });
      },
      setCloseToTrayOnClose: (closeToTrayOnClose) => {
        set({ closeToTrayOnClose });
        void hostApiFetch('/api/settings/closeToTrayOnClose', {
          method: 'PUT',
          body: JSON.stringify({ value: closeToTrayOnClose }),
        }).catch(() => { });
      },
      setShowCloseToTrayTip: (showCloseToTrayTip) => {
        set({ showCloseToTrayTip });
        void hostApiFetch('/api/settings/showCloseToTrayTip', {
          method: 'PUT',
          body: JSON.stringify({ value: showCloseToTrayTip }),
        }).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApiFetch('/api/settings/telemetryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: telemetryEnabled }),
        }).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => { });
      },
      setGatewayStartupProfile: (gatewayStartupProfile) => {
        set({ gatewayStartupProfile });
        void hostApiFetch('/api/settings/gatewayStartupProfile', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayStartupProfile }),
        }).catch(() => { });
      },
      setGatewayStartupExtraArgs: (gatewayStartupExtraArgs) => {
        set({ gatewayStartupExtraArgs });
        void hostApiFetch('/api/settings/gatewayStartupExtraArgs', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayStartupExtraArgs }),
        }).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => { });
      },
      setBridgeEnabled: (bridgeEnabled) => {
        set({ bridgeEnabled });
        void hostApiFetch('/api/settings/bridgeEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: bridgeEnabled }),
        }).catch(() => { });
      },
      setBridgePort: (bridgePort) => {
        set({ bridgePort });
        void hostApiFetch('/api/settings/bridgePort', {
          method: 'PUT',
          body: JSON.stringify({ value: bridgePort }),
        }).catch(() => { });
      },
      setBridgeAllowRemote: (bridgeAllowRemote) => {
        set({ bridgeAllowRemote });
        void hostApiFetch('/api/settings/bridgeAllowRemote', {
          method: 'PUT',
          body: JSON.stringify({ value: bridgeAllowRemote }),
        }).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => {
        set({ updateChannel });
        void hostApiFetch('/api/settings/updateChannel', {
          method: 'PUT',
          body: JSON.stringify({ value: updateChannel }),
        }).catch(() => { });
      },
      setAutoCheckUpdate: (autoCheckUpdate) => {
        set({ autoCheckUpdate });
        void hostApiFetch('/api/settings/autoCheckUpdate', {
          method: 'PUT',
          body: JSON.stringify({ value: autoCheckUpdate }),
        }).catch(() => { });
      },
      setAutoDownloadUpdate: (autoDownloadUpdate) => {
        set({ autoDownloadUpdate });
        void hostApiFetch('/api/settings/autoDownloadUpdate', {
          method: 'PUT',
          body: JSON.stringify({ value: autoDownloadUpdate }),
        }).catch(() => { });
      },
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApiFetch('/api/settings/devModeUnlocked', {
          method: 'PUT',
          body: JSON.stringify({ value: devModeUnlocked }),
        }).catch(() => { });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'clawx-settings',
    }
  )
);
