import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Cpu, Download, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomSelect } from '@/components/ui/custom-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostApiFetch } from '@/lib/host-api';
import { parseProviderJson } from '@/lib/parse-provider-json';
import { ITERATIVECAT_DEFAULT_BASE_URL } from '@/config/build-profile';
import { IterativeCatProviderWizard } from './IterativeCatProviderWizard';
import minimaxIcon from '@/assets/providers/minimax.svg';
import { toast } from 'sonner';

export type SwitchProviderPresetId = 'iterativecat' | 'siliconflow' | 'minimax-token-plan' | 'aliyun-bailian' | 'custom';
type SwitchProviderStep = 'pick' | 'form' | 'iterativecat';
type SwitchProviderTab = 'manual' | 'paste';

type ProviderPreset = {
  id: SwitchProviderPresetId;
  title: string;
  subtitle: string;
  name: string;
  baseUrl: string;
  api: string;
  iconType: 'iterativecat' | 'cpu' | 'minimax' | 'download' | 'plus';
  iconClassName: string;
  modelId?: string;
};

const API_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI / Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

const MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic';
const MINIMAX_DEFAULT_MODEL_OPTIONS = [
  { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
];
const ITERATIVECAT_PRESET_BASE_URL = ITERATIVECAT_DEFAULT_BASE_URL;

const PRESETS: ProviderPreset[] = [
  { id: 'iterativecat', title: '迭代猫', subtitle: '一站式接入 GPT-5、Claude 等主流模型', name: 'iterativecat', baseUrl: ITERATIVECAT_PRESET_BASE_URL, api: 'openai-completions', iconType: 'iterativecat', iconClassName: 'bg-blue-50 text-blue-600', modelId: 'gpt-5.4' },
  { id: 'siliconflow', title: '硅基流动 (SiliconFlow)', subtitle: '高性能大模型推理服务', name: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', iconType: 'cpu', iconClassName: 'bg-purple-50 text-purple-600' },
  { id: 'minimax-token-plan', title: 'MiniMax Token Plan', subtitle: 'Anthropic Messages 兼容接入', name: 'minimax-token-plan', baseUrl: MINIMAX_BASE_URL, api: 'anthropic-messages', iconType: 'minimax', iconClassName: 'bg-sky-50 text-sky-600', modelId: 'MiniMax-M2.7' },
  { id: 'aliyun-bailian', title: '阿里云百炼', subtitle: '通义千问系列模型', name: 'aliyun-bailian', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', iconType: 'download', iconClassName: 'bg-orange-50 text-orange-600' },
  { id: 'custom', title: '自定义服务商', subtitle: '配置任意 OpenAI 兼容接口', name: 'custom', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', iconType: 'plus', iconClassName: 'bg-gray-50 text-gray-600' },
];

function PresetIcon({ preset }: { preset: ProviderPreset }) {
  if (preset.iconType === 'iterativecat') {
    return (
      <div className="rounded-md bg-white p-2 shadow-sm">
        <img src="https://www.iterativecat.cn/logo.png" alt="IterativeCat" className="h-5 w-5 object-contain" />
      </div>
    );
  }

  if (preset.iconType === 'minimax') {
    return (
      <div className="rounded-md bg-white p-2 shadow-sm">
        <img src={minimaxIcon} alt="MiniMax" className="h-5 w-5 object-contain" />
      </div>
    );
  }

  const IconComponent = (
    preset.iconType === 'cpu' ? Cpu
      : preset.iconType === 'download' ? Download
        : Plus
  );

  return (
    <div className={`rounded-md p-2 ${preset.iconClassName}`}>
      <IconComponent className="h-5 w-5" />
    </div>
  );
}

export function SwitchAddProviderDialog({
  initialPresetId,
  onClose,
  onConfigured,
}: {
  initialPresetId?: SwitchProviderPresetId | null;
  onClose: () => void;
  onConfigured: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<SwitchProviderStep>('pick');
  const [tab, setTab] = useState<SwitchProviderTab>('manual');
  const [selectedPresetId, setSelectedPresetId] = useState<SwitchProviderPresetId | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedPreset = useMemo(
    () => PRESETS.find((item) => item.id === selectedPresetId) ?? null,
    [selectedPresetId],
  );
  const isMiniMaxPreset = selectedPresetId === 'minimax-token-plan';

  useEffect(() => {
    if (!initialPresetId) {
      return;
    }
    const preset = PRESETS.find((item) => item.id === initialPresetId);
    if (!preset) {
      return;
    }
    setSelectedPresetId(preset.id);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setApi(preset.api);
    setApiKey('');
    setModelId(preset.modelId || '');
    setPasteText('');
    setTab('manual');
    setStep(preset.id === 'iterativecat' ? 'iterativecat' : 'form');
  }, [initialPresetId]);

  const enterPreset = (preset: ProviderPreset) => {
    setSelectedPresetId(preset.id);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setApi(preset.api);
    setApiKey('');
    setModelId(preset.modelId || '');
    setPasteText('');
    if (preset.id === 'iterativecat') {
      setStep('iterativecat');
      return;
    }
    setStep('form');
  };

  const handleManualSave = async () => {
    setLoading(true);
    try {
      const normalizedName = name.trim();
      const normalizedModelId = isMiniMaxPreset ? (modelId || 'MiniMax-M2.7') : modelId.trim();
      await hostApiFetch('/api/provider-accounts/switch-upsert', {
        method: 'POST',
        body: JSON.stringify({
          name: normalizedName,
          baseUrl,
          api,
          apiKey: apiKey.trim() || undefined,
          modelId: normalizedModelId || undefined,
        }),
      });
      if (isMiniMaxPreset && normalizedModelId) {
        await hostApiFetch('/api/models/set-primary', {
          method: 'POST',
          body: JSON.stringify({
            modelRef: `${normalizedName}/${normalizedModelId}`,
          }),
        });
      }
      await onConfigured();
      onClose();
      toast.success(isMiniMaxPreset ? 'MiniMax 已添加并设为主模型' : '服务商已添加');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePasteSave = async () => {
    setLoading(true);
    try {
      const parsed = parseProviderJson(pasteText);
      await hostApiFetch('/api/provider-accounts/switch-import', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      await onConfigured();
      onClose();
      toast.success('服务商已导入');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'iterativecat') {
    return (
      <div data-testid="add-provider-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <IterativeCatProviderWizard
          baseUrl={baseUrl}
          modelId={modelId}
          providerLabel={selectedPreset?.title || '服务商'}
          onBaseUrlChange={setBaseUrl}
          onModelIdChange={setModelId}
          onBack={() => setStep('pick')}
          onClose={onClose}
          onConfigured={async () => {
            await onConfigured();
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div data-testid="add-provider-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[430px] overflow-hidden rounded-3xl border border-border/40 bg-card shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-[18px] font-bold text-foreground">添加服务商</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {step === 'pick' ? (
          <div className="space-y-4 px-5 pb-5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => enterPreset(preset)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-white px-4 py-4 text-left shadow-sm transition-all hover:border-blue-400 hover:shadow-md"
              >
                <PresetIcon preset={preset} />
                <div className="flex-1">
                  <p className="text-[15px] font-bold text-foreground">{preset.title}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{preset.subtitle}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-blue-500" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-5 pb-5">
            <div className="mb-5 grid grid-cols-2 rounded-xl bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setTab('manual')}
                className={`rounded-lg px-4 py-2 text-sm ${tab === 'manual' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
              >
                手动配置
              </button>
              <button
                type="button"
                onClick={() => setTab('paste')}
                className={`rounded-lg px-4 py-2 text-sm ${tab === 'paste' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
              >
                粘贴配置
              </button>
            </div>

            {tab === 'manual' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="provider-name">服务商名称 *</Label>
                  <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如: openai" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-api">API 类型</Label>
                  <CustomSelect
                    value={api}
                    options={API_OPTIONS}
                    onValueChange={setApi}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-base-url">Base URL *</Label>
                  <Input id="provider-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                </div>
                {isMiniMaxPreset && (
                  <div className="space-y-2">
                    <Label>默认模型</Label>
                    <CustomSelect
                      value={modelId || 'MiniMax-M2.7'}
                      options={MINIMAX_DEFAULT_MODEL_OPTIONS}
                      onValueChange={setModelId}
                      className="w-full"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="provider-api-key">API Key (可选)</Label>
                  <Input id="provider-api-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">快速选择:</span>
                  {[
                    { label: 'MiniMax', baseUrl: MINIMAX_BASE_URL, api: 'anthropic-messages' },
                    { label: '英伟达', baseUrl: 'https://integrate.api.nvidia.com/v1' },
                    { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
                    { label: '百炼 Coding', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setBaseUrl(preset.baseUrl);
                        if (preset.api) {
                          setApi(preset.api);
                        }
                      }}
                      className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 transition-colors hover:bg-blue-100"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep('pick')}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    返回
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                    <Button onClick={handleManualSave} disabled={loading || !name.trim() || !baseUrl.trim()}>
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      添加
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'粘贴 provider JSON，例如：\n{\n  "name": "MiniMax",\n  "providerJson": {\n    "baseUrl": "https://api.minimaxi.com/anthropic",\n    "api": "anthropic-messages",\n    "apiKey": "sk-...",\n    "models": [{"id":"MiniMax-M2.7","name":"MiniMax-M2.7"}]\n  }\n}'}
                  className="min-h-[240px] w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep('pick')}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    返回
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                    <Button onClick={handlePasteSave} disabled={loading || !pasteText.trim()}>
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      添加
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
