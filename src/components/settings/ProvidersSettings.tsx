﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  X,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  Settings2,
  XCircle,
  ChevronDown,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import { ITERATIVECAT_DEFAULT_BASE_URL } from '@/config/build-profile';
import {
  buildProviderListItems,
  getEffectiveProviderModel,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { IterativeCatProviderWizard } from './IterativeCatProviderWizard';
import { SwitchAddProviderDialog } from './SwitchAddProviderDialog';

const inputClasses = 'app-field h-[44px] rounded-xl font-mono text-[13px] border focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
type ArkMode = 'apikey' | 'codeplan';

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function isArkCodePlanMode(
  vendorId: string,
  baseUrl: string | undefined,
  modelId: string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (vendorId !== 'ark' || !codePlanPresetBaseUrl || !codePlanPresetModelId) return false;
  return (baseUrl || '').trim() === codePlanPresetBaseUrl && (modelId || '').trim() === codePlanPresetModelId;
}

function shouldShowUserAgentFieldForNewProvider(providerType: ProviderType | null): boolean {
  return providerType === 'custom';
}

export function ProvidersSettings({
  selectedProviderId,
  onSelectProvider,
  rightPanelTab = 'providers',
  onRightPanelTabChange,
  detailsContent,
  displayProvidersOverride,
  providerSummaries,
  onEditProvider,
  onDeleteProvider,
  onSetPrimaryModel,
  onToggleFallbackModel,
  onAddModel,
  onDeleteModel,
}: {
  selectedProviderId: string | null;
  onSelectProvider: (id: string | null) => void;
  rightPanelTab?: 'providers' | 'details';
  onRightPanelTabChange?: (tab: 'providers' | 'details') => void;
  detailsContent?: ReactNode;
  displayProvidersOverride?: ProviderListItem[];
  providerSummaries?: Record<string, {
    providerKey: string;
    sourceProviderKey?: string;
    baseUrl: string;
    apiProtocol: string;
    models: string[];
    primaryModelRef?: string | null;
    fallbackModelRefs: string[];
    hasCredential: boolean;
  }>;
  onEditProvider?: (providerId: string) => void;
  onDeleteProvider?: (providerId: string) => void;
  onSetPrimaryModel?: (modelRef: string, providerId: string) => void;
  onToggleFallbackModel?: (modelRef: string, isActive: boolean) => void;
  onAddModel?: (providerId: string, providerKey: string) => void;
  onDeleteModel?: (providerKey: string, modelId: string) => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    removeAccount,
    setDefaultAccount,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [providersCollapsed, setProvidersCollapsed] = useState(false);
  const computedProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId).sort((left, right) => {
      if (left.account.id === defaultAccountId) return -1;
      if (right.account.id === defaultAccountId) return 1;
      return left.account.label.localeCompare(right.account.label, 'zh-CN');
    }),
    [accounts, statuses, vendors, defaultAccountId],
  );
  const displayProviders = displayProvidersOverride ?? computedProviders;

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div data-testid="providers-settings" className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => onRightPanelTabChange?.('providers')}
            className={cn(
              "flex items-center gap-2 font-bold pb-[13px] -mb-[15px] border-b-[3px]",
              rightPanelTab === 'providers'
                ? "text-blue-600 border-blue-600"
                : "text-muted-foreground border-transparent",
            )}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M2 10h20M2 16h20" />
            </svg>
            <span className="text-[15px]">{t('aiProviders.tabs.list')}</span>
            <span className="bg-blue-100 text-blue-700 text-[11px] px-1.5 py-0.5 rounded-sm">{displayProviders.length}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedProviderId && displayProviders[0]) {
                onSelectProvider(displayProviders[0].account.id);
              }
              onRightPanelTabChange?.('details');
            }}
            className={cn(
              "flex items-center gap-2 font-medium pb-[13px] -mb-[15px] border-b-[3px]",
              rightPanelTab === 'details'
                ? "text-blue-600 border-blue-600"
                : "text-muted-foreground border-transparent",
            )}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span className="text-[15px]">{t('aiProviders.tabs.details')}</span>
          </button>
        </div>
        <Button data-testid="providers-add-button" onClick={() => setShowAddDialog(true)} className={cn("bg-blue-600 hover:bg-blue-700 text-white rounded-md px-4 h-9 shadow-sm font-medium text-[13px]", rightPanelTab === 'details' && "invisible")}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('aiProviders.add', '添加服务商')}
        </Button>
      </div>

      <div className="bg-muted/5 p-5">
      {rightPanelTab === 'details' ? (
        detailsContent ?? (
          <div className="flex items-center justify-center rounded-2xl border border-border/40 bg-card py-16 text-sm text-muted-foreground shadow-sm">
            {t('aiProviders.details.empty')}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-card rounded-2xl border border-border/40 border-dashed shadow-sm">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div data-testid="providers-empty-state" className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-card rounded-2xl border border-border/40 border-dashed shadow-sm">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} className="rounded-md px-6 h-9 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setProvidersCollapsed((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-card px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/20"
          >
            <span>{providersCollapsed ? t('aiProviders.list.expand') : t('aiProviders.list.collapse')}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", providersCollapsed && "-rotate-90")} />
          </button>
          {!providersCollapsed && (
            <div className="grid grid-cols-1 gap-4">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              isDefault={item.account.id === defaultAccountId}
              isSelected={selectedProviderId === item.account.id}
              summary={providerSummaries?.[item.account.id]}
              onSelect={() => onSelectProvider(item.account.id)}
              onDelete={() => {
                if (selectedProviderId === item.account.id) onSelectProvider(null);
                if (onDeleteProvider) {
                  onDeleteProvider(item.account.id);
                  return;
                }
                handleDeleteProvider(item.account.id);
              }}
              onEdit={() => {
                if (onEditProvider) {
                  onEditProvider(item.account.id);
                  return;
                }
                onSelectProvider(item.account.id);
              }}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSetPrimaryModel={onSetPrimaryModel}
              onToggleFallbackModel={onToggleFallbackModel}
              onAddModel={onAddModel}
              onDeleteModel={onDeleteModel}
            />
          ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <SwitchAddProviderDialog
          onClose={() => setShowAddDialog(false)}
          onConfigured={async () => {
            await refreshProviderSnapshot();
          }}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  isDefault: boolean;
  isSelected: boolean;
  summary?: {
    providerKey: string;
    sourceProviderKey?: string;
    baseUrl: string;
    apiProtocol: string;
    models: string[];
    primaryModelRef?: string | null;
    fallbackModelRefs: string[];
    hasCredential: boolean;
  };
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSetPrimaryModel?: (modelRef: string, providerId: string) => void;
  onToggleFallbackModel?: (modelRef: string, isActive: boolean) => void;
  onAddModel?: (providerId: string, providerKey: string) => void;
  onDeleteModel?: (providerKey: string, modelId: string) => void;
}

function ProviderCard({
  item,
  isDefault,
  isSelected,
  summary,
  onSelect,
  onEdit,
  onDelete,
  onSetDefault,
  onSetPrimaryModel,
  onToggleFallbackModel,
  onAddModel,
  onDeleteModel,
}: ProviderCardProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { account, status } = item;
  const [modelsExpanded, setModelsExpanded] = useState(isSelected);
  
  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const effectiveModel = getEffectiveProviderModel(account, item.vendor, status);
  const resolvedModels = summary?.models?.length ? summary.models : (effectiveModel ? [effectiveModel] : []);

  return (
    <div
      data-testid={`provider-card-${account.id}`}
      className={cn(
        "group relative flex cursor-pointer flex-col rounded-2xl border bg-card p-4 transition-all",
        isSelected
          ? "border-blue-500 shadow-sm ring-1 ring-blue-500"
          : "border-border/40 hover:border-border/60 shadow-sm"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-foreground">{account.label}</h3>
            {account.vendorId === 'iterativecat' && (
              <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {t('aiProviders.card.recommended')}
              </span>
            )}
            {isDefault && (
              <span className="flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 border border-blue-200">
                {t('aiProviders.card.default')}
              </span>
            )}
            {!(summary?.hasCredential ?? hasConfiguredCredentials(account, status)) && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 border border-red-200">
                {t('aiProviders.card.missingCredential')}
              </span>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-[13px]">
              <span className="text-muted-foreground whitespace-nowrap">{t('aiProviders.card.baseUrl')}</span>
              <span className="font-medium text-foreground break-all">{summary?.baseUrl || account.baseUrl || typeInfo?.defaultBaseUrl || t('aiProviders.card.defaultBaseUrl')}</span>
            </div>
            {(summary?.apiProtocol || account.apiProtocol) && (
              <div className="flex items-start gap-2 text-[13px]">
                <span className="text-muted-foreground whitespace-nowrap">{t('aiProviders.card.apiProtocol')}</span>
                <span className="font-medium text-foreground break-all">{summary?.apiProtocol || account.apiProtocol}</span>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-border/40 pt-3">
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setModelsExpanded((value) => !value);
              }}
            >
              <Settings2 className="h-4 w-4" />
              <span>{t('aiProviders.card.modelCount', { count: resolvedModels.length })}</span>
              <ChevronDown className={cn("ml-0.5 h-3.5 w-3.5 transition-transform", modelsExpanded && "rotate-180")} />
            </button>
          </div>

          {modelsExpanded && (
            <div className="mt-4 space-y-3 rounded-2xl border border-border/40 bg-background/70 p-3 shadow-inner">
              {resolvedModels.length > 0 ? resolvedModels.map((modelId) => {
                const providerRefKey = summary?.sourceProviderKey || summary?.providerKey || account.vendorId;
                const modelRef = `${providerRefKey}/${modelId}`;
                const isPrimary = summary?.primaryModelRef === modelRef;
                const isFallback = summary?.fallbackModelRefs?.includes(modelRef) ?? false;
                return (
                  <div key={modelRef} className="rounded-lg border border-border/50 bg-card px-3 py-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[16px] font-semibold leading-none text-foreground">{modelId}</p>
                        <p className="mt-1.5 text-[12px] text-muted-foreground">{modelId}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-red-400 hover:bg-red-50 hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteModel?.(providerRefKey, modelId);
                        }}
                        title={t('aiProviders.card.deleteModel')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs",
                          isPrimary
                            ? "border-blue-200 bg-blue-50 text-blue-600"
                            : "border-blue-200 bg-white text-blue-600 hover:bg-blue-50",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetPrimaryModel?.(modelRef, account.id);
                        }}
                      >
                        {t('aiProviders.card.setPrimary')}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs",
                          isFallback
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-amber-200 bg-white text-amber-700 hover:bg-amber-50",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFallbackModel?.(modelRef, isFallback);
                        }}
                      >
                        {isFallback ? t('aiProviders.card.removeFallback') : t('aiProviders.card.setFallback')}
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-lg border border-dashed border-border/60 bg-card px-3 py-3 text-xs text-muted-foreground">
                  {t('aiProviders.card.noModels', '暂无模型，请先添加模型')}
                </p>
              )}
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-xl border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground hover:bg-muted/30"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddModel?.(account.id, summary?.sourceProviderKey || summary?.providerKey || account.vendorId);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t('aiProviders.card.addModel')}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 ml-4 shrink-0">
          {!isDefault && (
            <button
              className="text-blue-500 hover:text-blue-600 transition-colors p-1"
              onClick={(e) => { e.stopPropagation(); onSetDefault(); }}
              title={t('aiProviders.card.default')}
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          <button
            data-testid={`provider-edit-${account.id}`}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title={t('common:actions.edit')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            data-testid={`provider-delete-${account.id}`}
            className="text-red-400 hover:text-red-500 transition-colors p-1"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title={t('common:actions.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onProviderConfigured: (providerId: string) => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

export function LegacyAddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onProviderConfigured,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = selectedType === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    if (selectedType !== 'ark') {
      setArkMode('apikey');
      return;
    }
    setArkMode(
      isArkCodePlanMode(
        'ark',
        baseUrl,
        modelId,
        typeInfo?.codePlanPresetBaseUrl,
        typeInfo?.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: String(payload.authorizationUrl || ''),
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: String(payload.verificationUri || ''),
          userCode: String(payload.userCode || ''),
          expiresIn: Number(payload.expiresIn || 300),
        });
      }
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        // OAuth sign-in should immediately become active default to avoid
        // leaving runtime on an API-key-only provider/model.
        if (accountId) {
          await store.setDefaultAccount(accountId);
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedType, accountId, label }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    // Skip providers that are temporarily hidden from the UI.
    if (type.hidden) return false;

    // MiniMax portal variants are mutually exclusive — hide BOTH variants
    // when either one already exists (account may have vendorId of either variant).
    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((type.id === 'minimax-portal' || type.id === 'minimax-portal-cn') && hasMinimax) return false;

    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id) || type.id === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });
  const featuredType = availableTypes.find((type) => type.id === 'iterativecat') ?? null;
  const standardTypes = availableTypes.filter((type) => type.id !== 'iterativecat');

  const resetSelection = () => {
    setSelectedType(null);
    setValidationError(null);
    setBaseUrl('');
    setModelId('');
    setUserAgent('');
    setShowAdvancedConfig(false);
    setArkMode('apikey');
    setApiKey('');
    setShowKey(false);
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
  };

  const selectProviderType = (type: ProviderType) => {
    const nextType = PROVIDER_TYPE_INFO.find((item) => item.id === type);
    setSelectedType(type);
    setName(type === 'custom' ? t('aiProviders.custom') : nextType?.name || type);
    setBaseUrl(type === 'iterativecat' ? ITERATIVECAT_DEFAULT_BASE_URL : (nextType?.defaultBaseUrl || ''));
    setModelId(type === 'iterativecat' ? 'gemini-3-flash-preview' : (nextType?.defaultModelId || ''));
    setUserAgent('');
    setShowAdvancedConfig(false);
    setArkMode('apikey');
    setValidationError(null);
    setApiKey('');
    setShowKey(false);
  };

  const handleAdd = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && !modelId.trim()) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          headers: userAgent.trim() ? { 'User-Agent': userAgent.trim() } : undefined,
          model: resolveProviderModelForSave(typeInfo, modelId, devModeUnlocked),
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  if (selectedType === 'iterativecat') {
    return (
      <div data-testid="add-provider-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <IterativeCatProviderWizard
          baseUrl={baseUrl}
          modelId={modelId}
          providerLabel={typeInfo?.name || '服务商'}
          onBaseUrlChange={setBaseUrl}
          onModelIdChange={setModelId}
          onBack={resetSelection}
          onClose={onClose}
          onConfigured={async (providerId) => {
            const store = useProviderStore.getState();
            await store.refreshProviderSnapshot();
            onProviderConfigured(providerId);
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div data-testid="add-provider-dialog" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className={cn(
        "w-full max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-card dark:bg-card overflow-hidden",
        "max-w-2xl",
      )}>
        <CardHeader className="relative shrink-0 px-5 pb-2 pt-5">
          <CardTitle className="text-2xl font-serif font-normal">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            data-testid="add-provider-close-button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-card"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-5">
          {!selectedType ? (
            <div className="space-y-4">
              {featuredType && (
                <button
                  data-testid={`add-provider-type-${featuredType.id}`}
                  onClick={() => selectProviderType(featuredType.id)}
                  className="w-full rounded-2xl border border-blue-300 bg-blue-50/70 p-4 text-left shadow-sm transition-all hover:border-blue-400 hover:bg-blue-50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white shadow-sm">
                        {getProviderIconUrl(featuredType.id) ? (
                          <img src={getProviderIconUrl(featuredType.id)} alt={featuredType.name} className={cn('h-6 w-6', shouldInvertInDark(featuredType.id) && 'dark:invert')} />
                        ) : (
                          <span className="text-2xl">{featuredType.icon}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[18px] font-semibold text-blue-700">{featuredType.name}</p>
                        </div>
                        <p className="mt-1 text-[13px] text-blue-600/90">
                          一站式接入 GPT-5、Claude 等主流模型，支持登录鉴权、自动获取 SK 与 data 读取
                        </p>
                      </div>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                      </svg>
                    </div>
                  </div>
                </button>
              )}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {standardTypes.map((type) => (
                  <button
                    data-testid={`add-provider-type-${type.id}`}
                    key={type.id}
                    onClick={() => selectProviderType(type.id)}
                    className="rounded-2xl border border-border/60 bg-card p-4 text-center transition-colors group hover:bg-card"
                  >
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-background shadow-sm transition-transform group-hover:scale-105">
                      {getProviderIconUrl(type.id) ? (
                        <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                      ) : (
                        <span className="text-2xl">{type.icon}</span>
                      )}
                    </div>
                    <p className="font-medium text-[13px]">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-card border border-border/60 shadow-sm">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-background rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                    onClick={resetSelection}
                    className="text-[13px] text-blue-500 hover:text-blue-600 font-medium"
                  >
                    {t('aiProviders.dialog.change')}
                  </button>
                  {effectiveDocsUrl && (
                    <>
                      <span className="mx-2 text-foreground/20">|</span>
                      <a
                        href={effectiveDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.customDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              <>
              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    data-testid="add-provider-name-input"
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="app-segment flex rounded-xl overflow-hidden text-[13px] font-medium shadow-sm p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'app-segment-active text-foreground' : 'text-muted-foreground hover:bg-card'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'app-segment-active text-foreground' : 'text-muted-foreground hover:bg-card'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        data-testid="add-provider-api-key-input"
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      data-testid="add-provider-base-url-input"
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}

                {showModelIdField && (
                  <div className="space-y-2.5">
                    <Label htmlFor="modelId" className={labelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    <Input
                      data-testid="add-provider-model-id-input"
                      id="modelId"
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      value={modelId}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        setValidationError(null);
                      }}
                      className={inputClasses}
                    />
                  </div>
                )}
                {selectedType === 'ark' && codePlanPreset && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (modelId.trim() === codePlanPreset.modelId) {
                            setModelId(typeInfo?.defaultModelId || '');
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'apikey' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelId(codePlanPreset.modelId);
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'codeplan' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {arkMode === 'codeplan' && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc')}
                      </p>
                    )}
                  </div>
                )}
                {selectedType === 'custom' && (
                <div className="space-y-2.5">
                  <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}
                {showUserAgentInAddDialog && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedConfig((value) => !value)}
                      className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
                    >
                      <span>{t('aiProviders.dialog.advancedConfig')}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedConfig && "rotate-180")} />
                    </button>
                    {showAdvancedConfig && (
                      <div className="space-y-2.5 pt-1">
                        <Label htmlFor="userAgent" className={labelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                        <Input
                          id="userAgent"
                          placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                          value={userAgent}
                          onChange={(e) => setUserAgent(e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 border border-border/70 rounded-2xl bg-card shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                {t('aiProviders.oauth.tryAgain')}
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.manual.title')}</h3>
                                <p className="text-[13px] text-muted-foreground text-left bg-background p-4 rounded-xl">
                                  {oauthData.message || t('aiProviders.oauth.manual.desc')}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.manual.openPage')}
                              </Button>

                              <Input
                                placeholder={t('aiProviders.oauth.manual.placeholder')}
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={inputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                {t('aiProviders.oauth.manual.submit')}
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('common:actions.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-background p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-background border border-border/60 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-card"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-border/60" />

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleAdd}
                  className={cn("rounded-full px-8 h-[42px] text-[13px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && modelId.trim().length === 0)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
