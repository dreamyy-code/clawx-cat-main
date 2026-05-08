import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ExternalLink, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type ProviderAccount,
  type ProviderConfig,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type ArkMode = 'apikey' | 'codeplan';

function isArkCodePlanMode(
  vendorId: string,
  baseUrl?: string,
  modelId?: string,
  presetBaseUrl?: string,
  presetModelId?: string,
): boolean {
  if (vendorId !== 'ark') return false;
  if (!baseUrl || !modelId || !presetBaseUrl || !presetModelId) return false;
  return baseUrl.trim() === presetBaseUrl && modelId.trim() === presetModelId;
}

function getUserAgentHeader(headers?: Record<string, string>): string {
  if (!headers) return '';
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'user-agent');
  return key ? headers[key] : '';
}

function mergeHeadersWithUserAgent(headers: Record<string, string> | undefined, userAgent: string): Record<string, string> {
  const newHeaders = { ...headers };
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'user-agent') {
        delete newHeaders[key];
      }
    }
  }
  if (userAgent.trim()) {
    newHeaders['User-Agent'] = userAgent.trim();
  }
  return newHeaders;
}

function normalizeFallbackModels(input: string[] | string | undefined | null): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : [];
  return arr.map(s => s.trim()).filter(Boolean);
}

function fallbackModelsEqual(a: string[], b: string[] | undefined | null): boolean {
  const normA = normalizeFallbackModels(a);
  const normB = normalizeFallbackModels(b);
  if (normA.length !== normB.length) return false;
  return normA.every((v, i) => v === normB[i]);
}

function normalizeFallbackProviderIds(input: string[] | undefined | null): string[] {
  if (!input) return [];
  return input.map(s => s.trim()).filter(Boolean);
}

function fallbackProviderIdsEqual(a: string[], b: string[] | undefined | null): boolean {
  const normA = normalizeFallbackProviderIds(a);
  const normB = normalizeFallbackProviderIds(b);
  if (normA.length !== normB.length) return false;
  const setB = new Set(normB);
  return normA.every(v => setB.has(v));
}

interface ProviderDetailsProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
  onClose?: () => void;
}

export function ProviderDetails({
  item,
  allProviders,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
  onClose,
}: ProviderDetailsProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, status } = item;
  
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [userAgent, setUserAgent] = useState(getUserAgentHeader(account.headers));
  const [modelId, setModelId] = useState(account.model || '');
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const effectiveDocsUrl = account.vendorId === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField);
  const showUserAgentField = account.vendorId === 'custom';

  useEffect(() => {
    setNewKey('');
    setShowKey(false);
    setBaseUrl(account.baseUrl || '');
    setApiProtocol(account.apiProtocol || 'openai-completions');
    setUserAgent(getUserAgentHeader(account.headers));
    setModelId(account.model || '');
    setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
    setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
    setArkMode(
      isArkCodePlanMode(
        account.vendorId,
        account.baseUrl,
        account.model,
        typeInfo?.codePlanPresetBaseUrl,
        typeInfo?.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
  }, [account, typeInfo?.codePlanPresetBaseUrl, typeInfo?.codePlanPresetModelId]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      if (showModelIdField && !modelId.trim()) {
        toast.error(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      const updates: Partial<ProviderConfig> = {};
      if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
        updates.baseUrl = baseUrl.trim() || undefined;
      }
      if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
        updates.apiProtocol = apiProtocol;
      }
      if (showModelIdField && (modelId.trim() || undefined) !== (account.model || undefined)) {
        updates.model = modelId.trim() || undefined;
      }
      const existingUserAgent = getUserAgentHeader(account.headers).trim();
      const nextUserAgent = userAgent.trim();
      if (nextUserAgent !== existingUserAgent) {
        updates.headers = mergeHeadersWithUserAgent(account.headers, nextUserAgent);
      }
      if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
        updates.fallbackModels = normalizedFallbackModels;
      }
      if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
        updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
      }

      if (Object.keys(updates).length > 0) {
        payload.updates = updates;
      }

      if (payload.newApiKey || payload.updates) {
        await onSaveEdits(payload);
        toast.success(t('aiProviders.toast.saved'));
        setNewKey('');
      }
    } catch (err) {
      toast.error(`${t('aiProviders.toast.failedSave')}: ${err}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const inputClasses = "app-field h-[44px] rounded-xl border border-border/60 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40";
  const labelClasses = "text-[13px] text-foreground/80 font-medium";
  const sectionLabelClasses = "text-[15px] font-bold text-foreground/90";

  return (
    <div className="space-y-6 pb-6 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Header Area */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-5 mb-2 px-2">
        <div>
          <h2 className="text-[18px] font-bold text-foreground tracking-tight">
            配置详情 - {account.label}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1">
            修改该提供商的 API Key、模型、协议和回退配置
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onClose && (
            <Button
              variant="outline"
              onClick={onClose}
              className="rounded-lg h-9 shadow-sm font-medium"
            >
              {t('common:actions.cancel', '取消')}
            </Button>
          )}
          <Button
            onClick={handleSaveEdits}
            disabled={saving || validating}
            className="rounded-lg h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-medium px-5"
          >
            {(saving || validating) ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t('common:actions.save', '保存更改')}
          </Button>
        </div>
      </div>

      <div className="space-y-8 px-2">
        {effectiveDocsUrl && (
          <div className="flex justify-start -mt-4">
            <a
              href={effectiveDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
            >
              {t('aiProviders.dialog.customDoc', 'View Documentation')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* API Key Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <Label className={sectionLabelClasses}>{t('aiProviders.dialog.apiKey', 'API Key')}</Label>
              <p className="text-[13px] text-muted-foreground">
                {hasConfiguredCredentials(account, status)
                  ? t('aiProviders.dialog.apiKeyConfigured', 'Key is already configured.')
                  : t('aiProviders.dialog.apiKeyMissing', 'Missing API key.')}
              </p>
            </div>
            {hasConfiguredCredentials(account, status) ? (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2.5 py-1 rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                {t('aiProviders.card.configured', 'Configured')}
              </div>
            ) : null}
          </div>

          {typeInfo?.apiKeyUrl && (
            <div className="flex justify-start">
              <a
                href={typeInfo.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                tabIndex={-1}
              >
                {t('aiProviders.oauth.getApiKey', 'Get API Key')} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="space-y-2">
            <Label className={labelClasses}>{t('aiProviders.dialog.replaceApiKey', 'Update API Key')}</Label>
            <div className="relative max-w-xl">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired', 'Not required') : t('aiProviders.card.editKey', 'Enter new key...'))}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className={cn(inputClasses, 'pr-10')}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {t('aiProviders.dialog.replaceApiKeyHelp', 'Leave blank to keep existing key.')}
            </p>
          </div>
        </div>

        {/* Model Config Section */}
        {canEditModelConfig && (
          <div className="space-y-5 pt-4 border-t border-border/40">
            <p className={sectionLabelClasses}>{t('aiProviders.sections.model', 'Model Configuration')}</p>
            {typeInfo?.showBaseUrl && (
              <div className="space-y-2 max-w-xl">
                <Label className={labelClasses}>{t('aiProviders.dialog.baseUrl', 'Base URL')}</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={typeInfo?.placeholder || 'https://api.openai.com/v1'}
                  className={inputClasses}
                />
              </div>
            )}
            {showModelIdField && (
              <div className="space-y-2 max-w-xl">
                <Label className={labelClasses}>{t('aiProviders.dialog.modelId', 'Model ID')}</Label>
                <Input
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                  className={inputClasses}
                />
              </div>
            )}
            
            {account.vendorId === 'custom' && (
              <div className="space-y-2 max-w-xl pt-1">
                <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                <div className="flex gap-2 text-[13px]">
                  <button
                    type="button"
                    onClick={() => setApiProtocol('openai-completions')}
                    className={cn("flex-1 py-2 px-3 rounded-xl border transition-colors", apiProtocol === 'openai-completions' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                  >
                    {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApiProtocol('openai-responses')}
                    className={cn("flex-1 py-2 px-3 rounded-xl border transition-colors", apiProtocol === 'openai-responses' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                  >
                    {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApiProtocol('anthropic-messages')}
                    className={cn("flex-1 py-2 px-3 rounded-xl border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-card border-border/70 shadow-sm font-medium" : "border-transparent bg-background text-muted-foreground hover:bg-card")}
                  >
                    {t('aiProviders.protocols.anthropic', 'Anthropic')}
                  </button>
                </div>
              </div>
            )}
            
            {showUserAgentField && (
              <div className="space-y-2 max-w-xl pt-1">
                <Label className={labelClasses}>{t('aiProviders.dialog.userAgent', 'Custom User-Agent')}</Label>
                <Input
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  placeholder={t('aiProviders.dialog.userAgentPlaceholder', 'Mozilla/5.0...')}
                  className={inputClasses}
                />
              </div>
            )}
          </div>
        )}

        {/* Fallback Config Section */}
        <div className="space-y-5 pt-4 border-t border-border/40">
          <p className={sectionLabelClasses}>{t('aiProviders.sections.fallback', 'Fallback Configuration')}</p>
          <div className="space-y-2 max-w-xl">
            <Label className={labelClasses}>{t('aiProviders.dialog.fallbackModelIds', 'Fallback Model IDs')}</Label>
            <textarea
              value={fallbackModelsText}
              onChange={(e) => setFallbackModelsText(e.target.value)}
              placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder', 'E.g. gpt-4o\nclaude-3.5-sonnet')}
              className="app-field min-h-24 w-full rounded-xl border px-3 py-2 text-[14px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40 bg-background"
            />
            <p className="text-[13px] text-muted-foreground">
              {t('aiProviders.dialog.fallbackModelIdsHelp', 'Models to try if the main model fails.')}
            </p>
          </div>
          
          <div className="space-y-3 max-w-xl pt-2">
            <Label className={labelClasses}>{t('aiProviders.dialog.fallbackProviders', 'Fallback Providers')}</Label>
            {fallbackOptions.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions', 'No other providers available.')}</p>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-border/60 p-4 shadow-sm bg-background">
                {fallbackOptions.map((candidate) => (
                  <label key={candidate.account.id} className="flex items-center gap-3 text-[14px] cursor-pointer group/label">
                    <input
                      type="checkbox"
                      checked={fallbackProviderIds.includes(candidate.account.id)}
                      onChange={() => toggleFallbackProvider(candidate.account.id)}
                      className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50 w-4 h-4"
                    />
                    <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
