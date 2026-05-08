import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Save,
  Settings2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomSelect } from '@/components/ui/custom-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore, type ProviderAccount } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { buildProviderListItems, getEffectiveProviderModel } from '@/lib/provider-accounts';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { SwitchConfigWizardDialog } from '@/components/settings/SwitchConfigWizardDialog';
import { FeedbackState } from '@/components/common/FeedbackState';
import { toast } from 'sonner';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from './usage-history';
const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 2;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 3;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;
const USAGE_AUTO_REFRESH_INTERVAL_MS = 15_000;

const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];

function isHiddenUsageSource(source?: string): boolean {
  if (!source) return false;
  const normalizedSource = source.trim().toLowerCase();
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}

type ConfigSummary = {
  defaultModel?: string;
  selection?: { primary?: string; fallbacks: string[] };
  authProfileProviders?: string[];
  sourceKeys?: Record<string, string>;
  providers?: Record<string, Record<string, unknown>>;
  rawConfig?: Record<string, unknown>;
};

type ProviderRuntimeSummary = {
  providerKey: string;
  sourceProviderKey: string;
  baseUrl: string;
  apiProtocol: string;
  models: string[];
  primaryModelRef?: string | null;
  fallbackModelRefs: string[];
  hasCredential: boolean;
  keyMasked?: string;
};

function normalizeConfigText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^`+|`+$/g, '').trim();
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}${'•'.repeat(8)}${value.slice(-4)}`;
}

function normalizeProviderToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getProviderKeyCandidates(vendorId: string, label: string): string[] {
  const normalizedVendor = normalizeProviderToken(vendorId);
  const normalizedLabel = normalizeProviderToken(label);
  const candidates = new Set<string>([normalizedVendor, normalizedLabel]);
  if (normalizedVendor.includes('minimax')) candidates.add('minimax');
  if (normalizedVendor.includes('moonshot')) candidates.add('moonshot');
  if (normalizedVendor.includes('siliconflow')) candidates.add('siliconflow');
  if (normalizedVendor.includes('iterativecat')) candidates.add('iterativecat');
  if (normalizedVendor.includes('openrouter')) candidates.add('openrouter');
  if (normalizedVendor.includes('openai')) candidates.add('openai');
  if (normalizedVendor.includes('anthropic')) candidates.add('anthropic');
  if (normalizedVendor.includes('google')) candidates.add('google');
  if (normalizedVendor.includes('ark')) candidates.add('ark');
  return Array.from(candidates);
}

function resolveRuntimeProviderKey(
  account: ProviderAccount,
  runtimeProviders: Record<string, { baseURL?: string; baseUrl?: string }>,
): string | null {
  const accountBaseUrl = normalizeConfigText(account.baseUrl || '');
  const entries = Object.entries(runtimeProviders);

  const exactBaseUrlMatch = entries.find(([, provider]) => {
    const providerBaseUrl = normalizeConfigText(provider.baseURL || provider.baseUrl || '');
    return providerBaseUrl === accountBaseUrl;
  });
  if (exactBaseUrlMatch) {
    return exactBaseUrlMatch[0];
  }

  const candidates = getProviderKeyCandidates(account.vendorId, account.label);
  const fuzzyMatch = entries.find(([key]) => {
    const normalizedKey = normalizeProviderToken(key);
    return candidates.some((candidate) => normalizedKey.includes(candidate) || candidate.includes(normalizedKey));
  });
  return fuzzyMatch?.[0] ?? null;
}

function getModelsFromRuntimeProvider(provider?: Record<string, unknown>): string[] {
  if (!provider) return [];
  const models = provider.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((value) => {
      if (typeof value === 'string') {
        return normalizeConfigText(value);
      }
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return normalizeConfigText(record.id) || normalizeConfigText(record.name);
      }
      return '';
    })
    .filter((value): value is string => Boolean(value));
}

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [addingModelTarget, setAddingModelTarget] = useState<{ providerId: string; providerKey: string } | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [rightPanelTab, setRightPanelTab] = useState<'providers' | 'details'>('providers');
  const [showPrimarySelector, setShowPrimarySelector] = useState(false);
  const [showFallbackSelector, setShowFallbackSelector] = useState(false);
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [showConfigWizard, setShowConfigWizard] = useState(false);
  const [configSummary, setConfigSummary] = useState<ConfigSummary | null>(null);

  const {
    accounts,
    statuses,
    vendors,
    defaultAccountId,
    validateAccountApiKey,
    refreshProviderSnapshot,
  } = useProviderStore();
  const allProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );
  const selectedProviderItem = useMemo(() => {
    return allProviders.find(p => p.account.id === selectedProviderId) || null;
  }, [allProviders, selectedProviderId]);

  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts = window.electron.platform === 'win32'
    ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS
    : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const [usageRefreshNonce, setUsageRefreshNonce] = useState(0);
  function formatUsageSource(source?: string): string | undefined {
    if (!source) return undefined;

    if (isHiddenUsageSource(source)) {
      return undefined;
    }

    return source;
  }

  function shouldHideUsageEntry(entry: UsageHistoryEntry): boolean {
    return (
      isHiddenUsageSource(entry.provider)
      || isHiddenUsageSource(entry.model)
    );
  }

  type FetchState = {
    status: 'idle' | 'loading' | 'done';
    data: UsageHistoryEntry[];
    stableData: UsageHistoryEntry[];
  };
  type FetchAction =
    | { type: 'start' }
    | { type: 'done'; data: UsageHistoryEntry[] }
    | { type: 'failed' }
    | { type: 'reset' };

  const [fetchState, dispatchFetch] = useReducer(
    (state: FetchState, action: FetchAction): FetchState => {
      switch (action.type) {
        case 'start':
          return { ...state, status: 'loading' };
        case 'done':
          return {
            status: 'done',
            data: action.data,
            stableData: resolveStableUsageHistory(state.stableData, action.data),
          };
        case 'failed':
          return { ...state, status: 'done' };
        case 'reset':
          return { status: 'idle', data: [], stableData: [] };
        default:
          return state;
      }
    },
    { status: 'idle' as const, data: [] as UsageHistoryEntry[], stableData: [] as UsageHistoryEntry[] },
  );

  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);
  const usageFetchStatusRef = useRef<FetchState['status']>('idle');

  useEffect(() => {
    usageFetchStatusRef.current = fetchState.status;
  }, [fetchState.status]);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  const refreshConfigSummary = async (): Promise<ConfigSummary> => {
    return hostApiFetch<ConfigSummary>('/api/models/config-summary');
  };

  useEffect(() => {
    let cancelled = false;
    void refreshConfigSummary()
      .then((summary) => {
        if (!cancelled) {
          setConfigSummary(summary);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accounts, defaultAccountId]);

  useEffect(() => {
    if (!isGatewayRunning) {
      return;
    }

    const requestRefresh = () => {
      if (usageFetchStatusRef.current === 'loading') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setUsageRefreshNonce((value) => value + 1);
    };

    const intervalId = window.setInterval(requestRefresh, USAGE_AUTO_REFRESH_INTERVAL_MS);
    const handleFocus = () => {
      requestRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestRefresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isGatewayRunning]);

  useEffect(() => {
    if (usageFetchTimerRef.current) {
      clearTimeout(usageFetchTimerRef.current);
      usageFetchTimerRef.current = null;
    }

    if (!isGatewayRunning) {
      dispatchFetch({ type: 'reset' });
      return;
    }

    dispatchFetch({ type: 'start' });
    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;
    const restartMarker = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}`;
    trackUiEvent('models.token_usage_fetch_started', {
      generation,
      restartMarker,
    });

    // Safety timeout: if the fetch cycle hasn't resolved after 30 s,
    // force-resolve to "done" with empty data to avoid an infinite spinner.
    const safetyTimeout = setTimeout(() => {
      if (usageFetchGenerationRef.current !== generation) return;
      trackUiEvent('models.token_usage_fetch_safety_timeout', {
        generation,
        restartMarker,
      });
      dispatchFetch({ type: 'failed' });
    }, 30_000);

    const fetchUsageHistoryWithRetry = async (attempt: number) => {
      trackUiEvent('models.token_usage_fetch_attempt', {
        generation,
        attempt,
        restartMarker,
      });
      try {
        const entries = await hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history');
        if (usageFetchGenerationRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsagePage(1);
        trackUiEvent('models.token_usage_fetch_succeeded', {
          generation,
          attempt,
          records: normalized.length,
          restartMarker,
        });

        if (normalized.length === 0 && attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'empty',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
        } else {
          if (normalized.length === 0) {
            trackUiEvent('models.token_usage_fetch_exhausted', {
              generation,
              attempt,
              reason: 'empty',
              restartMarker,
            });
          }
          dispatchFetch({ type: 'done', data: normalized });
        }
      } catch (error) {
        if (usageFetchGenerationRef.current !== generation) return;
        trackUiEvent('models.token_usage_fetch_failed_attempt', {
          generation,
          attempt,
          restartMarker,
          message: error instanceof Error ? error.message : String(error),
        });
        if (attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'error',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
          return;
        }
        dispatchFetch({ type: 'failed' });
        trackUiEvent('models.token_usage_fetch_exhausted', {
          generation,
          attempt,
          reason: 'error',
          restartMarker,
        });
      }
    };

    void fetchUsageHistoryWithRetry(1);

    return () => {
      clearTimeout(safetyTimeout);
      if (usageFetchTimerRef.current) {
        clearTimeout(usageFetchTimerRef.current);
        usageFetchTimerRef.current = null;
      }
    };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid, usageFetchMaxAttempts, usageRefreshNonce]);

  const usageHistory = isGatewayRunning
    ? fetchState.data.filter((entry) => !shouldHideUsageEntry(entry))
    : [];
  const stableUsageHistory = isGatewayRunning
    ? fetchState.stableData.filter((entry) => !shouldHideUsageEntry(entry))
    : [];
  const visibleUsageHistory = resolveVisibleUsageHistory(usageHistory, stableUsageHistory, {
    preferStableOnEmpty: isGatewayRunning && fetchState.status === 'loading',
  });
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && fetchState.status === 'loading' && visibleUsageHistory.length === 0;
  const usageRefreshing = isGatewayRunning && fetchState.status === 'loading' && visibleUsageHistory.length > 0;
  const defaultProviderItem = useMemo(
    () => allProviders.find((item) => item.account.id === defaultAccountId) ?? null,
    [allProviders, defaultAccountId]
  );
  const effectiveDefaultProviderItem = useMemo(() => {
    return defaultProviderItem ?? allProviders[0] ?? null;
  }, [allProviders, defaultProviderItem]);
  const fallbackModels = useMemo(() => configSummary?.selection?.fallbacks ?? [], [configSummary?.selection?.fallbacks]);
  const rawProviders = useMemo(
    () => (configSummary?.providers ?? {}) as Record<string, { baseURL?: string; api?: string; models?: unknown[] }>,
    [configSummary?.providers],
  );
  const providerSummaries = useMemo<Record<string, ProviderRuntimeSummary>>(() => {
    const authProfileProviders = new Set(configSummary?.authProfileProviders ?? []);
    const summaries: Record<string, ProviderRuntimeSummary> = {};
    for (const item of allProviders) {
      const providerKey = resolveRuntimeProviderKey(item.account, rawProviders) ?? item.account.vendorId;
      const sourceProviderKey = normalizeConfigText(configSummary?.sourceKeys?.[providerKey] || providerKey);
      const runtimeProvider = rawProviders[providerKey] as Record<string, unknown> | undefined;
      const runtimeModels = getModelsFromRuntimeProvider(runtimeProvider);
      const fallbackModelRefs = fallbackModels.filter(
        (entry) => entry.startsWith(`${providerKey}/`) || entry.startsWith(`${sourceProviderKey}/`),
      );
      const runtimeApiKey = normalizeConfigText(runtimeProvider?.apiKey);
      summaries[item.account.id] = {
        providerKey,
        sourceProviderKey,
        baseUrl: normalizeConfigText(runtimeProvider?.baseURL || runtimeProvider?.baseUrl || item.account.baseUrl || ''),
        apiProtocol: normalizeConfigText(runtimeProvider?.api || item.account.apiProtocol || ''),
        models: runtimeModels.length > 0 ? runtimeModels : (getEffectiveProviderModel(item.account, item.vendor, item.status) ? [getEffectiveProviderModel(item.account, item.vendor, item.status)] : []),
        primaryModelRef:
          (configSummary?.selection?.primary?.startsWith(`${providerKey}/`)
            || configSummary?.selection?.primary?.startsWith(`${sourceProviderKey}/`))
            ? configSummary.selection.primary
            : null,
        fallbackModelRefs,
        hasCredential: Boolean(item.status?.hasKey) || authProfileProviders.has(providerKey) || Boolean(runtimeApiKey),
        keyMasked: item.status?.keyMasked || (runtimeApiKey ? maskSecret(runtimeApiKey) : undefined),
      };
    }
    return summaries;
  }, [allProviders, configSummary, fallbackModels, rawProviders]);
  const visibleProviders = useMemo(() => {
    const runtimeProviderKeys = new Set(Object.keys(rawProviders));
    const dedupedByRuntimeKey = new Map<string, (typeof allProviders)[number]>();
    const scoreProvider = (item: (typeof allProviders)[number]): number => {
      const summary = providerSummaries[item.account.id];
      if (!summary) return 0;
      let score = 0;
      if (summary.baseUrl.trim()) score += 3;
      if (summary.apiProtocol.trim()) score += 2;
      if (summary.models.length > 0) score += 4;
      if (summary.hasCredential) score += 2;
      return score;
    };

    for (const item of allProviders) {
      const summary = providerSummaries[item.account.id];
      if (!summary) continue;
      if (!runtimeProviderKeys.has(summary.providerKey)) continue;

      const canonicalKey = normalizeProviderToken(summary.providerKey);
      const existing = dedupedByRuntimeKey.get(canonicalKey);
      if (!existing) {
        dedupedByRuntimeKey.set(canonicalKey, item);
        continue;
      }

      const existingIsDefault = existing.account.id === defaultAccountId;
      const currentIsDefault = item.account.id === defaultAccountId;
      if (currentIsDefault && !existingIsDefault) {
        dedupedByRuntimeKey.set(canonicalKey, item);
        continue;
      }
      if (!currentIsDefault && !existingIsDefault && scoreProvider(item) > scoreProvider(existing)) {
        dedupedByRuntimeKey.set(canonicalKey, item);
        continue;
      }

      if (!existingIsDefault && !currentIsDefault && item.account.updatedAt > existing.account.updatedAt) {
        dedupedByRuntimeKey.set(canonicalKey, item);
      }
    }

    return Array.from(dedupedByRuntimeKey.values()).sort((left, right) => {
      if (left.account.id === defaultAccountId) return -1;
      if (right.account.id === defaultAccountId) return 1;
      return right.account.updatedAt.localeCompare(left.account.updatedAt);
    });
  }, [allProviders, defaultAccountId, providerSummaries, rawProviders]);
  const visibleProviderIdSet = useMemo(
    () => new Set(visibleProviders.map((item) => item.account.id)),
    [visibleProviders],
  );
  const safeSelectedProviderId = selectedProviderId && visibleProviderIdSet.has(selectedProviderId)
    ? selectedProviderId
    : null;
  const primaryOptions = useMemo(() => {
    const options = visibleProviders.flatMap((item) => {
      const summary = providerSummaries[item.account.id];
      return (summary?.models ?? []).map((model) => ({
        accountId: item.account.id,
        label: item.account.label,
        model,
        modelRef: `${summary.sourceProviderKey}/${model}`,
      }));
    });
    const deduped = new Map<string, (typeof options)[number]>();
    for (const option of options) {
      if (!option.modelRef) continue;
      if (!deduped.has(option.modelRef)) {
        deduped.set(option.modelRef, option);
      }
    }
    return Array.from(deduped.values());
  }, [providerSummaries, visibleProviders]);
  const currentPrimaryLabel = effectiveDefaultProviderItem
    ? (configSummary?.selection?.primary || effectiveDefaultProviderItem.account.label)
    : t('dashboard:models.unset');
  const availableForFallback = useMemo(() => {
    const currentPrimary = configSummary?.selection?.primary || '';
    return primaryOptions.filter((option) => option.modelRef && option.modelRef !== currentPrimary && !fallbackModels.includes(option.modelRef));
  }, [configSummary?.selection?.primary, fallbackModels, primaryOptions]);
  const selectedProviderRuntimeKey = selectedProviderItem
    ? providerSummaries[selectedProviderItem.account.id]?.providerKey ?? null
    : null;
  const editingProviderItem = editingProviderId
    ? visibleProviders.find((item) => item.account.id === editingProviderId) ?? null
    : null;

  const handleSetPrimaryModel = async (modelRef: string, providerId: string) => {
    await hostApiFetch('/api/models/set-primary', {
      method: 'POST',
      body: JSON.stringify({ modelRef }),
    });
    setConfigSummary(await refreshConfigSummary());
    setSelectedProviderId(providerId);
    setRightPanelTab('providers');
    toast.success(t('dashboard:models.toast.primarySet'));
  };

  const handleToggleFallbackModel = async (modelRef: string, isActive: boolean) => {
    await hostApiFetch(`/api/models/${isActive ? 'remove-fallback' : 'add-fallback'}`, {
      method: 'POST',
      body: JSON.stringify({ modelRef }),
    });
    setConfigSummary(await refreshConfigSummary());
    toast.success(t(isActive ? 'dashboard:models.toast.fallbackRemoved' : 'dashboard:models.toast.fallbackSet'));
  };

  const handleAddProviderModel = async () => {
    if (!addingModelTarget || !newModelId.trim()) {
      return;
    }
    await hostApiFetch('/api/models/add-provider-model', {
      method: 'POST',
      body: JSON.stringify({
        providerKey: addingModelTarget.providerKey,
        modelId: newModelId.trim(),
      }),
    });
    setConfigSummary(await refreshConfigSummary());
    setAddingModelTarget(null);
    setNewModelId('');
    toast.success(t('dashboard:models.toast.modelAdded'));
  };

  const handleDeleteProviderModel = async (providerKey: string, modelId: string) => {
    await hostApiFetch('/api/models/remove-provider-model', {
      method: 'POST',
      body: JSON.stringify({ providerKey, modelId }),
    });
    setConfigSummary(await refreshConfigSummary());
    toast.success(t('dashboard:models.toast.modelDeleted'));
  };

  const handleDeleteProvider = async (providerId: string) => {
    const summary = providerSummaries[providerId];
    await hostApiFetch('/api/provider-accounts/switch-delete', {
      method: 'POST',
      body: JSON.stringify({
        accountId: providerId,
        providerKey: summary?.providerKey,
      }),
    });
    await useProviderStore.getState().refreshProviderSnapshot();
    setConfigSummary(await refreshConfigSummary());
    if (selectedProviderId === providerId) {
      setSelectedProviderId(null);
      setRightPanelTab('providers');
    }
    if (editingProviderId === providerId) {
      setEditingProviderId(null);
    }
    setDeletingProviderId(null);
    toast.success(t('dashboard:models.toast.providerDeleted'));
  };

  const handleConfigWizardConfigured = async () => {
    await refreshProviderSnapshot();
    setConfigSummary(await refreshConfigSummary());
  };

  return (
    <div data-testid="models-page" className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-5 py-6 md:px-6 md:py-8 space-y-5">
          <section className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h1 data-testid="models-page-title" className="text-2xl font-bold text-foreground tracking-tight">
                {t('dashboard:models.title')}
              </h1>
              <p className="text-[14px] text-muted-foreground">
                {t('dashboard:models.subtitle')}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setShowConfigWizard(true)}
              className="h-9 self-start rounded-md bg-blue-600 px-4 text-[13px] font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              {t('dashboard:models.actions.configWizard')}
            </Button>
          </section>

          {/* 当前模型 卡片 */}
          <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <h2 className="text-[16px] font-bold text-foreground">{t('dashboard:models.current.title')}</h2>
            </div>
            
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-[13px] font-medium text-muted-foreground mb-2">{t('dashboard:models.current.primary')}</p>
                <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPrimarySelector((value) => !value)}
                  className="h-10 w-full px-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/50 text-[14px] text-blue-900 cursor-pointer hover:bg-blue-50 transition-colors"
                >
                  <span>{currentPrimaryLabel}</span>
                  <ChevronDown className="h-4 w-4 text-blue-500" />
                </button>
                {showPrimarySelector && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-border/40 bg-card p-2 shadow-lg">
                    <div className="space-y-1">
                      {primaryOptions.map((option) => (
                        <button
                          key={option.modelRef || `${option.accountId}:${option.model}`}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                          onClick={async () => {
                            if (option.modelRef) {
                              await handleSetPrimaryModel(option.modelRef, option.accountId);
                            }
                            setShowPrimarySelector(false);
                          }}
                        >
                          <span>{option.label}{option.model ? ` / ${option.model}` : ''}</span>
                          {option.modelRef === (configSummary?.selection?.primary || '') ? <span className="text-blue-600">{t('dashboard:models.current.currentTag')}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] font-medium text-muted-foreground">{t('dashboard:models.current.fallbacks')}</p>
                  <span className="text-[12px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">{fallbackModels.length}</span>
                </div>
                <div className={cn(
                  "rounded-lg border border-border/60 bg-muted/20 p-2",
                  fallbackModels.length === 0 && !showFallbackSelector ? "h-10 flex items-center" : "",
                )}>
                  <div className="space-y-2">
                    {fallbackModels.map((fallback) => (
                      <div key={fallback} className="group flex items-center justify-between rounded-md border border-border/50 bg-card px-3 py-2 text-sm">
                        <span className="truncate font-medium" title={fallback}>{fallback}</span>
                        <button
                          type="button"
                          className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                          onClick={() => void handleToggleFallbackModel(fallback, true)}
                        >
                          <ChevronRight className="h-3.5 w-3.5 rotate-45" />
                        </button>
                      </div>
                    ))}
                    {availableForFallback.length > 0 ? (
                      <div className="relative">
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/70 text-xs text-muted-foreground hover:bg-card",
                            fallbackModels.length === 0 ? "h-10" : "py-2",
                          )}
                          onClick={() => setShowFallbackSelector((value) => !value)}
                        >
                          <Plus className="h-3 w-3" />
                          {t('dashboard:models.current.addFallback')}
                        </button>
                        {showFallbackSelector && (
                          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-56 overflow-auto rounded-2xl border border-border/40 bg-card p-2 shadow-lg">
                            {availableForFallback.map((option) => (
                              <button
                                key={option.modelRef}
                                type="button"
                                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                                onClick={async () => {
                                  if (option.modelRef) {
                                    await handleToggleFallbackModel(option.modelRef, false);
                                  }
                                  setShowFallbackSelector(false);
                                }}
                              >
                                <span>{option.label} / {option.model}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : fallbackModels.length === 0 ? (
                      <div className="py-2 text-center text-xs text-muted-foreground">{t('dashboard:models.current.noFallbacks')}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 服务商列表 卡片 */}
          <section className="rounded-2xl border border-border/40 bg-card shadow-sm overflow-hidden">
            <ProvidersSettings
              selectedProviderId={safeSelectedProviderId}
              onSelectProvider={(id) => {
                setSelectedProviderId(id);
              }}
              displayProvidersOverride={visibleProviders}
              rightPanelTab={rightPanelTab}
              onRightPanelTabChange={(tab) => setRightPanelTab(tab)}
              providerSummaries={providerSummaries}
              onEditProvider={(providerId) => setEditingProviderId(providerId)}
              onDeleteProvider={(providerId) => setDeletingProviderId(providerId)}
              onSetPrimaryModel={handleSetPrimaryModel}
              onToggleFallbackModel={handleToggleFallbackModel}
              onAddModel={(providerId, providerKey) => {
                setSelectedProviderId(providerId);
                setAddingModelTarget({ providerId, providerKey });
              }}
              onDeleteModel={handleDeleteProviderModel}
              detailsContent={
                selectedProviderItem && visibleProviderIdSet.has(selectedProviderItem.account.id) ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
                      <h3 className="mb-4 text-base font-bold text-foreground">{t('dashboard:models.details.gateway.title')}</h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        <DetailField label={t('dashboard:models.details.gateway.port')} value={String(((configSummary?.rawConfig?.gateway as Record<string, unknown> | undefined)?.port) || '')} />
                        <DetailField label={t('dashboard:models.details.gateway.mode')} value={String(((configSummary?.rawConfig?.gateway as Record<string, unknown> | undefined)?.mode) || 'local')} />
                        <DetailField label={t('dashboard:models.details.gateway.authMode')} value={String((((configSummary?.rawConfig?.gateway as Record<string, unknown> | undefined)?.auth as Record<string, unknown> | undefined)?.mode) || 'token')} />
                        <DetailField label="Token" value={String((((configSummary?.rawConfig?.gateway as Record<string, unknown> | undefined)?.auth as Record<string, unknown> | undefined)?.token) || '')} />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
                      <h3 className="mb-4 text-base font-bold text-foreground">{t('dashboard:models.details.auth.title')}</h3>
                      <div className="rounded-lg border border-border/50 bg-background px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          {selectedProviderRuntimeKey || selectedProviderItem.account.vendorId}
                          <span className="ml-2 text-muted-foreground">{selectedProviderItem.account.label}</span>
                          <span className="ml-2 text-green-600">{t('dashboard:models.details.auth.connected')}</span>
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
                      <h3 className="mb-4 text-base font-bold text-foreground">{t('dashboard:models.details.agents.title')}</h3>
                      <div className="grid gap-3">
                        <DetailField label={t('dashboard:models.details.agents.primary')} value={configSummary?.selection?.primary || ''} />
                        <DetailField label={t('dashboard:models.details.agents.workspace')} value={String(((configSummary?.rawConfig?.agents as Record<string, unknown> | undefined)?.workspace) || ((configSummary?.rawConfig?.workspace as string | undefined) || ''))} />
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between bg-muted/30 px-5 py-4 text-left"
                        onClick={() => setShowJsonPreview((value) => !value)}
                      >
                        <h3 className="text-base font-bold text-foreground">{t('dashboard:models.details.rawJson')}</h3>
                        <ChevronRight className={`h-4 w-4 transition-transform ${showJsonPreview ? 'rotate-90' : ''}`} />
                      </button>
                      {showJsonPreview && (
                        <pre className="max-h-[400px] overflow-auto border-t border-border/60 bg-background/50 p-4 text-[11px] text-muted-foreground">
                          {JSON.stringify(configSummary?.rawConfig || {}, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-2xl border border-border/40 bg-card py-16 text-sm text-muted-foreground shadow-sm">
                    {t('dashboard:models.details.selectProviderFirst')}
                  </div>
                )
              }
            />
          </section>

          {/* Token 消耗 卡片 */}
          <section className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V10m0 10l-3-3m3 3l3-3m-3-10V4m0 0l3 3m-3-3l-3 3M4 12h16" />
                </svg>
                <h2 className="text-[16px] font-bold text-foreground">
                  {t('dashboard:models.usage.title')}
                </h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUsageExpanded((value) => !value)}
                className="h-8 rounded-full border-border/50 bg-background px-3 text-[12px]"
              >
                {usageExpanded ? t('common:actions.hide') : t('common:actions.show')}
                <ChevronDown className={`ml-1.5 h-3.5 w-3.5 transition-transform ${usageExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </div>

            {!usageExpanded ? (
              <div className="rounded-2xl border border-border/60 bg-background px-4 py-6 text-center text-[13px] text-muted-foreground shadow-sm">
                {t('dashboard:models.usage.collapsedHint')}
              </div>
            ) : (
            <div>
              {usageLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-background rounded-2xl border border-border/60 border-dashed shadow-sm">
                  <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
                </div>
              ) : visibleUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-background rounded-2xl border border-border/60 border-dashed shadow-sm">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                </div>
              ) : filteredUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-background rounded-2xl border border-border/60 border-dashed shadow-sm">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="app-segment flex rounded-xl p-1 bg-background border border-border/40 shadow-sm">
                        <Button
                          variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('model');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'model' ? "rounded-lg app-segment-active text-foreground h-8" : "rounded-lg text-muted-foreground hover:bg-background h-8"}
                        >
                          {t('dashboard:recentTokenHistory.groupByModel')}
                        </Button>
                        <Button
                          variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('day');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'day' ? "rounded-lg app-segment-active text-foreground h-8" : "rounded-lg text-muted-foreground hover:bg-background h-8"}
                        >
                          {t('dashboard:recentTokenHistory.groupByTime')}
                        </Button>
                      </div>
                      <div className="app-segment flex rounded-xl p-1 bg-background border border-border/40 shadow-sm">
                        <Button
                          variant={usageWindow === '7d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('7d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '7d' ? "rounded-lg app-segment-active text-foreground h-8" : "rounded-lg text-muted-foreground hover:bg-background h-8"}
                        >
                          {t('dashboard:recentTokenHistory.last7Days')}
                        </Button>
                        <Button
                          variant={usageWindow === '30d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('30d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '30d' ? "rounded-lg app-segment-active text-foreground h-8" : "rounded-lg text-muted-foreground hover:bg-background h-8"}
                        >
                          {t('dashboard:recentTokenHistory.last30Days')}
                        </Button>
                        <Button
                          variant={usageWindow === 'all' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('all');
                            setUsagePage(1);
                          }}
                          className={usageWindow === 'all' ? "rounded-lg app-segment-active text-foreground h-8" : "rounded-lg text-muted-foreground hover:bg-background h-8"}
                        >
                          {t('dashboard:recentTokenHistory.allTime')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-[12px] font-medium text-muted-foreground">
                      {usageRefreshing
                        ? t('dashboard:recentTokenHistory.loading')
                        : t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                    </p>
                  </div>

                  <UsageBarChart
                    groups={usageGroups}
                    emptyLabel={t('dashboard:recentTokenHistory.empty')}
                    totalLabel={t('dashboard:recentTokenHistory.totalTokens')}
                    inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                    outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                    cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                  />

                  <div className="space-y-3 pt-2">
                    {pagedUsageHistory.map((entry) => (
                      <div
                        key={`${entry.sessionId}-${entry.timestamp}`}
                        data-testid="token-usage-entry"
                        className="rounded-2xl bg-background border border-border/40 p-4 transition-colors shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[14px] text-foreground truncate">
                              {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                            </p>
                            <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                              {[formatUsageSource(entry.provider), formatUsageSource(entry.agentId), entry.sessionId].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={getUsageTotalClass(entry)}>
                              {formatUsageTotal(entry)}
                            </p>
                            {entry.usageStatus === 'missing' && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {t('dashboard:recentTokenHistory.noUsage')}
                              </p>
                            )}
                            {entry.usageStatus === 'error' && (
                              <p className="text-[11px] text-red-500 dark:text-red-400 mt-0.5">
                                {t('dashboard:recentTokenHistory.usageParseError')}
                              </p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {formatUsageTimestamp(entry.timestamp)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] font-medium text-muted-foreground">
                          {entry.usageStatus === 'available' || entry.usageStatus === undefined ? (
                            <>
                              <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-sky-500"></div>{t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                              <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-violet-500"></div>{t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                              {entry.cacheReadTokens > 0 && (
                                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                              )}
                              {entry.cacheWriteTokens > 0 && (
                                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheWrite', { value: formatTokenCount(entry.cacheWriteTokens) })}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px]">
                              {entry.usageStatus === 'missing'
                                ? t('dashboard:recentTokenHistory.noUsage')
                                : t('dashboard:recentTokenHistory.usageParseError')}
                            </span>
                          )}
                          {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                            <span className="flex items-center gap-1.5 ml-auto text-foreground/80 bg-card px-2 py-0.5 rounded-md shadow-sm border border-border/50">{t('dashboard:recentTokenHistory.cost', { amount: entry.costUsd.toFixed(4) })}</span>
                          )}
                          {devModeUnlocked && entry.content && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 rounded-full px-2.5 text-[11px] border-border/70"
                              onClick={() => setSelectedUsageEntry(entry)}
                            >
                              {t('dashboard:recentTokenHistory.viewContent')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-[12px] font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                        disabled={safeUsagePage <= 1}
                        className="rounded-full px-3 h-8 border-border/40 bg-background hover:bg-accent text-[12px]"
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                        {t('dashboard:recentTokenHistory.prev')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
                        disabled={safeUsagePage >= usageTotalPages}
                        className="rounded-full px-3 h-8 border-border/40 bg-background hover:bg-accent text-[12px]"
                      >
                        {t('dashboard:recentTokenHistory.next')}
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}
          </section>
        </div>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          onClose={() => setSelectedUsageEntry(null)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
        />
      )}
      {editingProviderItem && (
        <SwitchProviderEditDialog
          item={editingProviderItem}
          providerKey={providerSummaries[editingProviderItem.account.id]?.providerKey || editingProviderItem.account.label}
          existingKeyMasked={providerSummaries[editingProviderItem.account.id]?.keyMasked}
          onClose={() => setEditingProviderId(null)}
          onSave={async (payload) => {
            await hostApiFetch('/api/provider-accounts/switch-upsert', {
              method: 'POST',
              body: JSON.stringify({
                name: payload.providerKey,
                baseUrl: payload.updates.baseUrl,
                api: payload.updates.apiProtocol,
                apiKey: payload.newApiKey,
                modelId: payload.updates.model,
              }),
            });
            await useProviderStore.getState().refreshProviderSnapshot();
            setConfigSummary(await refreshConfigSummary());
            setEditingProviderId(null);
            toast.success(t('dashboard:models.toast.providerSaved'));
          }}
          onValidateKey={(key, options) => validateAccountApiKey(editingProviderItem.account.id, key, options)}
        />
      )}
      {addingModelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h3 className="text-lg font-bold">{t('dashboard:models.dialogs.addModel.title')}</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setAddingModelTarget(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-model-id">{t('dashboard:models.dialogs.addModel.modelId')}</Label>
                <Input id="new-model-id" value={newModelId} onChange={(e) => setNewModelId(e.target.value)} placeholder={t('dashboard:models.dialogs.addModel.modelIdPlaceholder')} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddingModelTarget(null)}>{t('common:actions.cancel')}</Button>
                <Button onClick={handleAddProviderModel} disabled={!newModelId.trim()}>
                  <Save className="mr-2 h-4 w-4" />
                  {t('common:actions.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deletingProviderId)}
        title={t('dashboard:models.dialogs.deleteProvider.title')}
        message={t('dashboard:models.dialogs.deleteProvider.message')}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onCancel={() => setDeletingProviderId(null)}
        onConfirm={async () => {
          if (deletingProviderId) {
            await handleDeleteProvider(deletingProviderId);
          }
        }}
        onError={(error) => toast.error(String(error))}
      />
      {showConfigWizard && (
        <SwitchConfigWizardDialog
          onClose={() => setShowConfigWizard(false)}
          onConfigured={async () => {
            await handleConfigWizardConfigured();
          }}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation(['dashboard']);
  return (
    <div className="rounded-lg border border-border/50 bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-foreground">{value || t('dashboard:models.unset')}</p>
    </div>
  );
}

function SwitchProviderEditDialog({
  item,
  providerKey,
  existingKeyMasked,
  onClose,
  onSave,
  onValidateKey,
}: {
  item: ReturnType<typeof buildProviderListItems>[number];
  providerKey: string;
  existingKeyMasked?: string;
  onClose: () => void;
  onSave: (payload: { providerKey: string; updates: Partial<ProviderAccount>; newApiKey?: string }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
}) {
  const { t } = useTranslation(['dashboard', 'common']);
  const apiOptions = [
    { value: 'openai-completions', label: 'OpenAI / Compatible' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'anthropic-messages', label: 'Anthropic Messages' },
  ];
  const [label, setLabel] = useState(item.account.label);
  const [baseUrl, setBaseUrl] = useState(item.account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(item.account.apiProtocol || 'openai-completions');
  const [newApiKey, setNewApiKey] = useState(existingKeyMasked || '');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const quickModels = [
    t('dashboard:models.dialogs.editProvider.quickModels.deepseek'),
    t('dashboard:models.dialogs.editProvider.quickModels.nvidia'),
    t('dashboard:models.dialogs.editProvider.quickModels.siliconflow'),
    t('dashboard:models.dialogs.editProvider.quickModels.bailianCoding'),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-2xl border border-border/70 bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h3 className="text-2xl font-bold text-foreground">{t('dashboard:models.dialogs.editProvider.title')}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="provider-name">{t('dashboard:models.dialogs.editProvider.name')}</Label>
            <Input id="provider-name" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-api-type">{t('dashboard:models.dialogs.editProvider.apiType')}</Label>
            <CustomSelect
              value={apiProtocol || 'openai-completions'}
              options={apiOptions}
              onValueChange={(value) => setApiProtocol(value as ProviderAccount['apiProtocol'])}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-base-url">{t('settings:aiProviders.dialog.baseUrl')} *</Label>
            <Input id="provider-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-api-key">{t('dashboard:models.dialogs.editProvider.apiKeyOptional')}</Label>
            <Input
              id="provider-api-key"
              type="password"
              value={newApiKey}
              onChange={(e) => {
                setApiKeyDirty(true);
                setNewApiKey(e.target.value);
              }}
              placeholder={t('dashboard:models.dialogs.editProvider.apiKeyPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('dashboard:models.dialogs.editProvider.quickPick')}</p>
            <div className="flex flex-wrap gap-2">
              {quickModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  className="rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-600 hover:bg-blue-100"
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={async () => {
                setSaving(true);
                try {
                  const candidateApiKey = apiKeyDirty ? newApiKey.trim() : '';
                  if (candidateApiKey) {
                    const validation = await onValidateKey(candidateApiKey, { baseUrl, apiProtocol });
                    if (!validation.valid) {
                      throw new Error(validation.error || t('dashboard:models.errors.apiKeyValidationFailed'));
                    }
                  }
                  await onSave({
                    providerKey,
                    updates: {
                      label,
                      baseUrl,
                      apiProtocol,
                    },
                    newApiKey: candidateApiKey || undefined,
                  });
                } catch (error) {
                  toast.error(String(error));
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              <Save className="mr-2 h-4 w-4" />
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTokenCount(value: number): string {
  return Intl.NumberFormat().format(value);
}

function getUsageTotalClass(entry: UsageHistoryEntry): string {
  if (entry.usageStatus === 'error') return 'font-bold text-[15px] text-red-500 dark:text-red-400';
  if (entry.usageStatus === 'missing') return 'font-bold text-[15px] text-muted-foreground';
  return 'font-bold text-[15px]';
}

function formatUsageTotal(entry: UsageHistoryEntry): string {
  if (entry.usageStatus === 'error') return '✕';
  if (entry.usageStatus === 'missing') return '—';
  return formatTokenCount(entry.totalTokens);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function UsageBarChart({
  groups,
  emptyLabel,
  totalLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  totalLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center text-[14px] font-medium text-muted-foreground shadow-sm">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

  return (
    <div className="space-y-4 bg-card p-5 rounded-2xl border border-border/70 shadow-sm">
      <div className="flex flex-wrap gap-4 text-[13px] font-medium text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          {cacheLabel}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
            <span className="text-muted-foreground font-medium">
              {totalLabel}: {formatTokenCount(group.totalTokens)}
            </span>
          </div>
          <div className="h-3.5 overflow-hidden rounded-full bg-background">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{
                width: group.totalTokens > 0
                  ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%`
                  : '0%',
              }}
            >
              {group.inputTokens > 0 && (
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.outputTokens > 0 && (
                <div
                  className="h-full bg-violet-500"
                  style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.cacheTokens > 0 && (
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Models;

function UsageContentPopup({
  entry,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
}: {
  entry: UsageHistoryEntry;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-2xl border border-border/70 bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {(entry.model || unknownModelLabel)} • {formatUsageTimestamp(entry.timestamp)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">
            {entry.content}
          </pre>
        </div>
        <div className="flex justify-end border-t border-border/70 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
