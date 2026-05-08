import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import anthropicIcon from '@/assets/providers/anthropic.svg';
import openaiIcon from '@/assets/providers/openai.svg';
import googleIcon from '@/assets/providers/google.svg';
import moonshotIcon from '@/assets/providers/moonshot.svg';
import minimaxIcon from '@/assets/providers/minimax.svg';
import qwenIcon from '@/assets/providers/qwen.svg';
import customIcon from '@/assets/providers/custom.svg';
import { ITERATIVECAT_DEFAULT_BASE_URL } from '@/config/build-profile';
import confTokenImg from '@/assets/conf_token.png';
import { toast } from 'sonner';
import {
  SwitchAddProviderDialog,
  type SwitchProviderPresetId,
} from './SwitchAddProviderDialog';

type WizardStep = 2 | 3 | 4 | 5;
type ProviderChoice = 'iterativecat' | 'aliyun-bailian' | 'minimax-token-plan' | 'other';

type RecommendedModel = {
  id: string;
  name: string;
  ownedBy: string;
  score: number;
  rank: number;
  price: string;
  tags?: string[];
  badge: string;
};

type WebviewElement = HTMLElement & {
  getWebContentsId?: () => number;
  src?: string;
};

const WebviewTag = 'webview' as unknown as React.ElementType;
const DEFAULT_BASE_URL = ITERATIVECAT_DEFAULT_BASE_URL;
const DEFAULT_MODEL_ID = 'gemini-3-flash-preview';

const MODEL_ICON_BY_OWNER: Record<string, string> = {
  openai: openaiIcon,
  moonshot: moonshotIcon,
  minimax: minimaxIcon,
  alibaba: qwenIcon,
  anthropic: anthropicIcon,
  deepseek: customIcon,
  google: googleIcon,
  'z-ai': customIcon,
};

const recommendedModels: RecommendedModel[] = [
  { id: 'gpt-5.4', name: 'gpt-5.4', ownedBy: 'openai', score: 86.0, rank: 1, price: '输入：$3.75/1M Tokens, 输出：$22.50/1M Tokens', tags: ['Top 1', '性能强', '稳定'], badge: 'O' },
  { id: 'kimi-k2.5', name: 'kimi-k2.5', ownedBy: 'moonshot', score: 84.8, rank: 2, price: '输入：$6.00/1M Tokens, 输出：$31.50/1M Tokens', tags: ['Top 2', '稳定强', '综合推荐'], badge: 'K' },
  { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1', ownedBy: 'minimax', score: 82.2, rank: 3, price: '输入：$3.15/1M Tokens, 输出：$12.60/1M Tokens', tags: ['Top 3', '响应快', '高性价比'], badge: 'M' },
  { id: 'qwen3.5-plus-2026-02-15', name: 'qwen3.5-plus-2026-02-15', ownedBy: 'alibaba', score: 84.1, rank: 4, price: '输入：$1.20/1M Tokens, 输出：$7.20/1M Tokens', tags: ['超高性价比'], badge: 'Q' },
  { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', ownedBy: 'anthropic', score: 86.9, rank: 5, price: '输入：$18.00/1M Tokens, 输出：$90.00/1M Tokens', badge: 'C' },
  { id: 'glm-5', name: 'glm-5', ownedBy: 'z-ai', score: 84.1, rank: 6, price: '输入：$6.00/1M Tokens, 输出：$27.00/1M Tokens', badge: 'G' },
  { id: 'claude-opus-4-6', name: 'claude-opus-4-6', ownedBy: 'anthropic', score: 86.3, rank: 7, price: '输入：$30.00/1M Tokens, 输出：$150.00/1M Tokens', badge: 'C' },
  { id: 'claude-opus-4-5', name: 'claude-opus-4-5', ownedBy: 'anthropic', score: 85.4, rank: 8, price: '输入：$30.00/1M Tokens, 输出：$150.00/1M Tokens', badge: 'C' },
  { id: 'deepseek-v3.2', name: 'deepseek-v3.2', ownedBy: 'deepseek', score: 81.9, rank: 9, price: '输入：$0.14/1M Tokens, 输出：$0.28/1M Tokens', badge: 'D' },
  { id: 'gemini-3-pro-preview', name: 'gemini-3-pro-preview', ownedBy: 'google', score: 83.3, rank: 10, price: '输入：$3.00/1M Tokens, 输出：$18.00/1M Tokens', badge: 'G' },
  { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', ownedBy: 'google', score: 82.6, rank: 11, price: '输入：$0.75/1M Tokens, 输出：$4.50/1M Tokens', badge: 'G' },
];

function getLoginUrl(baseUrl: string): string {
  const normalizedInput = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const normalized = normalizedInput.endsWith('/v1')
    ? normalizedInput.slice(0, -3)
    : normalizedInput;
  return `${normalized}/login`;
}

function getProgressWidth(step: WizardStep): string {
  if (step === 2) return '25%';
  if (step === 3) return '50%';
  if (step === 4) return '75%';
  return '100%';
}

export function SwitchConfigWizardDialog({
  onClose,
  onConfigured,
}: {
  onClose: () => void;
  onConfigured: () => Promise<void> | void;
}) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const mountedRef = useRef(true);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);

  const [step, setStep] = useState<WizardStep>(2);
  const [selectedProvider, setSelectedProvider] = useState<ProviderChoice>('iterativecat');
  const [showPresetDialog, setShowPresetDialog] = useState<SwitchProviderPresetId | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginContextReady, setLoginContextReady] = useState(false);
  const [loginContextSince, setLoginContextSince] = useState<number | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [useManualSk, setUseManualSk] = useState(false);
  const [manualSk, setManualSk] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [supportedModelsExpanded, setSupportedModelsExpanded] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
  const [configSummary, setConfigSummary] = useState<Record<string, unknown> | null>(null);

  const baseUrl = DEFAULT_BASE_URL;
  const loginUrl = useMemo(() => getLoginUrl(baseUrl), [baseUrl]);
  const gatewayToken = String(
    (((configSummary?.rawConfig as Record<string, unknown> | undefined)?.gateway as Record<string, unknown> | undefined)?.auth as Record<string, unknown> | undefined)?.token || '',
  );

  const refreshConfigSummary = useCallback(async () => {
    const summary = await hostApiFetch<Record<string, unknown>>('/api/models/config-summary');
    setConfigSummary(summary);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 3) {
      return;
    }
    setLoginContextReady(false);
    setLoginContextSince(null);
    void hostApiFetch<{ success: boolean; resetAt?: number }>('/api/integrations/iterativecat/clear-login', {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then((result) => {
        if (!mountedRef.current || !result.success) {
          return;
        }
        setLoginContextSince(result.resetAt ?? Date.now());
        setLoginContextReady(true);
      })
      .catch(() => {
        if (!mountedRef.current) {
          return;
        }
        setLoginContextSince(Date.now());
        setLoginContextReady(true);
      });
    setLoginSuccess(false);
    setProfileReady(false);
    setApiKey('');
    setUseManualSk(false);
    setManualSk('');
    setAvailableModels([]);
    setSelectedModelId(DEFAULT_MODEL_ID);
  }, [step]);

  useEffect(() => {
    if (step !== 3) {
      return;
    }
    if (!loginContextReady) {
      return;
    }
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      const webContentsId = webview.getWebContentsId?.();
      if (!webContentsId) return;
      void hostApiFetch('/api/integrations/iterativecat/webview-ready', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'iterativecat',
          baseUrl,
          webContentsId,
        }),
      }).catch(() => undefined);
    };

    webview.addEventListener('dom-ready', handleDomReady as EventListener);
    return () => {
      webview.removeEventListener('dom-ready', handleDomReady as EventListener);
    };
  }, [baseUrl, loginContextReady, step]);

  const checkLoginStatus = useCallback(async (showToast = true) => {
    setLoading(true);
    try {
      const result = await hostApiFetch<{
        success: boolean;
        loggedIn?: boolean;
        profileReady?: boolean;
        error?: string;
      }>('/api/integrations/iterativecat/check-login', {
        method: 'POST',
        body: JSON.stringify({ provider: 'iterativecat', baseUrl, since: loginContextSince }),
      });
      if (!result.success || !result.loggedIn) {
        throw new Error(result.error || '暂未检测到登录成功，请先在页面中完成登录');
      }
      if (!mountedRef.current) return;
      setLoginSuccess(true);
      setProfileReady(Boolean(result.profileReady));
      if (showToast) {
        toast.success('已检测到迭代猫登录成功');
      }
    } catch (error) {
      if (showToast) {
        toast.error(String(error));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [baseUrl, loginContextSince]);

  useEffect(() => {
    if (step !== 3 || loginSuccess || !loginContextReady) {
      return;
    }
    const unsubscribe = subscribeHostEvent('integration:iterativecat-login-success', () => {
      void checkLoginStatus(false);
    });
    return () => {
      unsubscribe();
    };
  }, [checkLoginStatus, loginContextReady, loginSuccess, step]);

  useEffect(() => {
    if (step !== 3 || loginSuccess || !loginContextReady) return;
    const timer = window.setInterval(() => {
      void checkLoginStatus(false);
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [checkLoginStatus, loginContextReady, loginSuccess, step]);

  const fetchModelsWithKey = async (resolvedApiKey: string) => {
    setModelsLoading(true);
    try {
      const result = await hostApiFetch<{ success: boolean; models?: string[]; error?: string }>(
        '/api/integrations/iterativecat/models',
        {
          method: 'POST',
          body: JSON.stringify({
            provider: 'iterativecat',
            baseUrl,
            apiKey: resolvedApiKey,
          }),
        },
      );
      if (!result.success) {
        throw new Error(result.error || '获取模型列表失败');
      }
      const nextModels = Array.isArray(result.models) ? result.models : [];
      setAvailableModels(nextModels);
      if (!nextModels.includes(selectedModelId) && nextModels.length > 0) {
        const preferred = nextModels.includes(DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : nextModels[0];
        setSelectedModelId(preferred);
      }
      setStep(4);
    } finally {
      if (mountedRef.current) {
        setModelsLoading(false);
      }
    }
  };

  const handleOneClickConfigure = async () => {
    setLoading(true);
    try {
      const result = await hostApiFetch<{ success: boolean; apiKey?: string; error?: string }>(
        '/api/integrations/iterativecat/generate-key',
        {
          method: 'POST',
          body: JSON.stringify({ provider: 'iterativecat', baseUrl }),
        },
      );
      if (!result.success || !result.apiKey) {
        throw new Error(result.error || '自动获取 SK 失败');
      }
      setApiKey(result.apiKey);
      setUseManualSk(false);
      await fetchModelsWithKey(result.apiKey);
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleUseManualSk = async () => {
    const value = manualSk.trim();
    if (!value) {
      toast.error('请先输入已有的 SK');
      return;
    }
    setApiKey(value);
    setLoading(true);
    try {
      await fetchModelsWithKey(value);
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleFinishModelSelection = async () => {
    const resolvedApiKey = (useManualSk ? manualSk : apiKey).trim();
    if (!selectedModelId) {
      toast.error('请先选择一个主模型');
      return;
    }
    if (!resolvedApiKey) {
      toast.error('缺少可用 SK，请返回上一步重新配置');
      return;
    }
    setLoading(true);
    try {
      const result = await hostApiFetch<{ success: boolean; accountId?: string; error?: string }>(
        '/api/integrations/iterativecat/configure-recommended',
        {
          method: 'POST',
          body: JSON.stringify({
            provider: 'iterativecat',
            baseUrl,
            modelId: selectedModelId,
            apiKey: resolvedApiKey,
            label: '迭代猫 (推荐)',
          }),
        },
      );
      if (!result.success) {
        throw new Error(result.error || '完成配置失败');
      }
      await onConfigured();
      await refreshConfigSummary();
      toast.success(`配置成功主模型：${selectedModelId}`);
      setStep(5);
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleStepTwoNext = () => {
    if (selectedProvider === 'iterativecat') {
      setStep(3);
      return;
    }
    if (selectedProvider === 'aliyun-bailian') {
      setShowPresetDialog('aliyun-bailian');
      return;
    }
    if (selectedProvider === 'minimax-token-plan') {
      setShowPresetDialog('minimax-token-plan');
      return;
    }
    setShowPresetDialog('custom');
  };

  const supportedModels = availableModels.filter((item) => !recommendedModels.some((model) => model.id === item));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="flex h-full max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white p-0 shadow-2xl">
        <div className="border-b bg-white px-8 py-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900">
              <Settings2 className="h-6 w-6 text-blue-600" />
              OpenClaw 配置向导
            </h3>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="relative mx-auto flex w-full max-w-3xl items-center justify-between">
            <div className="absolute left-0 top-1/2 -z-10 h-1 w-full -translate-y-1/2 rounded-full bg-gray-100" />
            <div
              className="absolute left-0 top-1/2 -z-10 h-1 -translate-y-1/2 rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: getProgressWidth(step) }}
            />
            {[
              ['2', '服务商配置'],
              ['3', '账号登录'],
              ['4', '添加模型'],
              ['5', '网关配置'],
            ].map(([index, label], itemIndex) => {
              const current = itemIndex + 2;
              const done = step > current;
              const active = step >= current;
              return (
                <div key={label} className="flex flex-col items-center gap-2">
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white text-sm font-bold transition-all',
                    active ? 'border-blue-600 text-blue-600' : 'border-gray-300 text-gray-400',
                  )}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <span>{index}</span>}
                  </div>
                  <span className={cn('text-xs font-medium', active ? 'text-blue-600' : 'text-gray-400')}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {step === 2 && (
          <>
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mx-auto max-w-3xl space-y-8">
                <div className="space-y-2 text-center">
                  <h2 className="text-2xl font-bold">配置您的 AI 模型</h2>
                  <p className="text-muted-foreground">选择一个模型服务商以开始使用 OpenClaw</p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <ProviderChoiceCard
                    title="迭代猫聚合 API"
                    subtitle="一站式接入主流模型"
                    description="支持登录鉴权、自动获取 SK 和推荐模型配置"
                    selected={selectedProvider === 'iterativecat'}
                    onClick={() => setSelectedProvider('iterativecat')}
                    icon={(
                      <img
                        src="https://www.iterativecat.cn/logo.png"
                        alt="IterativeCat"
                        className="h-6 w-6 object-contain"
                      />
                    )}
                    iconClassName="border bg-white shadow-sm"
                  />
                  <ProviderChoiceCard
                    title="阿里云百炼"
                    subtitle="通义千问系列模型"
                    description="官方兼容接口接入"
                    selected={selectedProvider === 'aliyun-bailian'}
                    onClick={() => setSelectedProvider('aliyun-bailian')}
                    icon={<Server className="h-6 w-6" />}
                    iconClassName="bg-orange-50 text-orange-600"
                  />
                  <ProviderChoiceCard
                    title="MiniMax Token Plan"
                    subtitle="Anthropic Messages 接口"
                    description="预填 MiniMax Token Plan 的 Base URL 与 API 类型"
                    selected={selectedProvider === 'minimax-token-plan'}
                    onClick={() => setSelectedProvider('minimax-token-plan')}
                    icon={<img src={minimaxIcon} alt="MiniMax" className="h-6 w-6 object-contain" />}
                    iconClassName="border bg-white shadow-sm"
                  />
                  <ProviderChoiceCard
                    title="其他服务商"
                    subtitle="自定义 OpenAI 兼容接口"
                    description="手动配置兼容接口与模型"
                    selected={selectedProvider === 'other'}
                    onClick={() => setSelectedProvider('other')}
                    icon={<Plus className="h-6 w-6" />}
                    iconClassName="bg-gray-50 text-gray-600"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-between border-t bg-gray-50 px-6 py-5">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
                跳过配置
              </Button>
              <Button
                size="lg"
                className={cn(
                  'px-8 text-white shadow-md transition-all hover:scale-105',
                  selectedProvider === 'iterativecat'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-green-600 hover:bg-green-700',
                )}
                onClick={handleStepTwoNext}
              >
                {selectedProvider === 'iterativecat' ? <ChevronRight className="mr-2 h-5 w-5" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                {selectedProvider === 'iterativecat' ? '下一步' : '完成配置并开始使用'}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="flex flex-1 flex-col overflow-hidden bg-white">
            {!loginSuccess ? (
              <div className="relative flex h-full flex-1 flex-col">
                <div className="absolute right-4 top-2 z-10">
                  <Button variant="ghost" size="sm" className="bg-white/80 shadow-sm backdrop-blur hover:bg-white" onClick={() => setStep(2)}>
                    <X className="mr-1 h-4 w-4" /> 取消
                  </Button>
                </div>
                {loginContextReady ? (
                  <WebviewTag
                    ref={(node: WebviewElement | null) => {
                      webviewRef.current = node;
                    }}
                    src={`${loginUrl}${loginUrl.includes('?') ? '&' : '?'}t=${loginContextSince ?? Date.now()}`}
                    className="flex h-full w-full border-0"
                    style={{ display: 'flex', width: '100%', height: '100%' }}
                    partition="persist:iterativecat-login"
                    allowpopups="true"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white text-muted-foreground">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    正在初始化登录环境...
                  </div>
                )}
                <div className="absolute bottom-6 right-6 z-20">
                  <Button
                    onClick={() => void checkLoginStatus(true)}
                    disabled={loading || !loginContextReady}
                    className="bg-blue-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-blue-700"
                  >
                    {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    我已完成登录
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center space-y-8 p-8">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <h2 className="text-3xl font-bold text-gray-900">登录成功</h2>
                  <p className="max-w-md text-lg text-muted-foreground">已成功连接到迭代猫账号。现在您可以一键配置所有推荐模型。</p>
                </div>

                <Card className="w-full max-w-md border-blue-100 bg-blue-50/50 p-6">
                  <h3 className="mb-3 flex items-center gap-2 font-medium text-blue-800">
                    <CheckCircle2 className="h-4 w-4" />
                    将为您自动配置：
                  </h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /><span>自动获取并绑定 API Key</span></li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /><span>添加 GPT-5、Claude 等顶级模型</span></li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /><span>下一步可选择主模型</span></li>
                  </ul>
                </Card>

                <div className="w-full max-w-md space-y-4">
                  {useManualSk && (
                    <div className="rounded-xl border bg-card p-4">
                      <p className="mb-2 text-sm font-medium">已有 SK 秘钥</p>
                      <Input
                        value={manualSk}
                        onChange={(e) => setManualSk(e.target.value)}
                        placeholder="输入已有的迭代猫 SK"
                      />
                    </div>
                  )}

                  <div className="flex justify-center gap-4">
                    <Button variant="outline" size="lg" onClick={() => setUseManualSk((value) => !value)} disabled={loading}>
                      {useManualSk ? '取消手动输入' : '已有 SK 秘钥'}
                    </Button>
                    {useManualSk ? (
                      <Button size="lg" className="bg-blue-600 px-8 text-white hover:bg-blue-700" disabled={loading} onClick={handleUseManualSk}>
                        {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                        使用已有 SK
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="bg-blue-600 px-8 text-white shadow-lg transition-all hover:scale-105 hover:bg-blue-700"
                        disabled={loading || !profileReady}
                        onClick={handleOneClickConfigure}
                      >
                        {(loading || !profileReady) ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                        {loading ? '正在配置...' : (!profileReady ? '加载中，请稍后' : '一键配置并注册访问秘钥')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <>
            <div className="flex-1 overflow-y-auto bg-white p-8">
              <div className="mx-auto max-w-3xl space-y-8">
                <div className="space-y-2 text-center">
                  <h2 className="text-2xl font-bold">选择您的主模型</h2>
                  <p className="text-muted-foreground">根据推荐排行榜，选择一个最适合您的主模型</p>
                </div>

                <div className="space-y-3">
                  {recommendedModels.map((model, index) => (
                    <div
                      key={model.id}
                      className="group relative cursor-pointer transition-all duration-300"
                      onClick={() => setSelectedModelId(model.id)}
                    >
                      <div
                        className={cn(
                          'absolute inset-0 rounded-xl border-2 bg-white transition-all duration-200',
                          selectedModelId === model.id
                            ? 'border-blue-600 shadow-md ring-2 ring-blue-600/10'
                            : 'border-gray-200 group-hover:border-blue-300',
                        )}
                      />
                      {index === 0 && (
                        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-yellow-50/50 via-transparent to-transparent opacity-50" />
                      )}
                      <div className="relative flex items-center gap-4 p-4">
                        <div className="flex w-8 justify-center">
                          {index < 3 ? (
                            <div className={cn(
                              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow-sm',
                              index === 0 && 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200',
                              index === 1 && 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
                              index === 2 && 'bg-orange-50 text-orange-600 ring-1 ring-orange-100',
                            )}>
                              {index + 1}
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-gray-400">{index + 1}</span>
                          )}
                        </div>
                        <div className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-lg text-base font-semibold',
                          selectedModelId === model.id ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-500',
                        )}>
                          {MODEL_ICON_BY_OWNER[model.ownedBy] ? (
                            <img
                              src={MODEL_ICON_BY_OWNER[model.ownedBy]}
                              alt={model.ownedBy}
                              className="h-6 w-6 rounded object-contain"
                            />
                          ) : model.badge}
                        </div>
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="mb-1 flex items-center gap-2">
                              <h4 className="truncate text-base font-bold text-gray-900">{model.name}</h4>
                              <div className="flex items-center gap-1.5">
                                {model.tags?.map((tag) => (
                                  <span
                                    key={tag}
                                    className={cn(
                                      'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                                      tag.includes('Top')
                                        ? 'border-red-100 bg-red-50 text-red-600'
                                        : 'border-blue-100 bg-blue-50 text-blue-600',
                                    )}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-600">
                                {model.score}
                              </span>
                              <span className="font-mono text-gray-500">{model.price}</span>
                            </div>
                          </div>
                          <div className="pr-2">
                            {selectedModelId === model.id ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                                <CheckCircle2 className="h-4 w-4" />
                              </div>
                            ) : (
                              <div className="h-6 w-6 rounded-full border-2 border-gray-200 transition-colors group-hover:border-blue-300" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {availableModels.length > 0 && (
                  <div className="overflow-hidden rounded-xl border">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between bg-muted/30 px-4 py-3 text-left"
                      onClick={() => setSupportedModelsExpanded((value) => !value)}
                    >
                      <div>
                        <p className="font-medium text-foreground">支持模型列表</p>
                        <p className="text-xs text-muted-foreground">来自迭代猫 `/v1/models` 的实时可用模型</p>
                      </div>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', supportedModelsExpanded && 'rotate-180')} />
                    </button>
                    {supportedModelsExpanded && (
                      <div className="max-h-72 space-y-2 overflow-y-auto border-t bg-white p-3">
                        {(supportedModels.length > 0 ? supportedModels : availableModels).map((item) => (
                          <button
                            type="button"
                            key={item}
                            onClick={() => setSelectedModelId(item)}
                            className={cn(
                              'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                              selectedModelId === item ? 'border-blue-500 bg-blue-50 text-blue-700' : 'hover:bg-muted/40',
                            )}
                          >
                            <span className="font-mono">{item}</span>
                            {selectedModelId === item ? <CheckCircle2 className="h-4 w-4" /> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {modelsLoading && (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    正在读取可用模型...
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-center border-t bg-gray-50 p-6">
              <Button
                size="lg"
                className="bg-purple-600 px-8 text-white shadow-md transition-all hover:scale-105 hover:bg-purple-700"
                disabled={loading || !selectedModelId}
                onClick={handleFinishModelSelection}
              >
                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                {loading ? '正在完成配置...' : '完成配置'}
              </Button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mx-auto max-w-3xl space-y-8">
                <div className="space-y-2 text-center">
                  <h2 className="text-2xl font-bold">配置网关令牌</h2>
                  <p className="text-muted-foreground">已完成模型推荐接入，您可以确认当前网关状态并复制令牌。</p>
                </div>

                <Card className="space-y-6 border bg-white p-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Step 1</span>
                      <h3 className="font-bold text-gray-900">复制网关令牌</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 break-all rounded-md border bg-gray-50 px-3 py-2 font-mono text-sm">
                        {gatewayToken || '未找到 Token'}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!gatewayToken}
                        onClick={() => {
                          navigator.clipboard.writeText(gatewayToken);
                          toast.success('已复制网关令牌');
                        }}
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        复制
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Step 2</span>
                      <h3 className="font-bold text-gray-900">配置并连接</h3>
                    </div>
                    <p className="text-sm text-gray-500">点击下方按钮打开 OpenClaw，将令牌粘贴到输入框中并点击连接。</p>
                    <div className="overflow-hidden rounded-lg border bg-gray-50">
                      <img src={confTokenImg} className="h-auto w-full object-contain" alt="网关配置指引" />
                    </div>
                    <div className="rounded-lg border bg-gray-50 p-4">
                      <p className="text-sm text-gray-600">
                        当前网关状态：
                        <span className={cn('ml-2 font-medium', gatewayStatus.state === 'running' ? 'text-green-600' : 'text-muted-foreground')}>
                          {gatewayStatus.state === 'running' ? '运行中' : '未运行'}
                        </span>
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        配置向导已将推荐模型同步到当前 ClawX-Cat / OpenClaw 运行时，完成后即可直接开始使用。
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            <div className="flex flex-shrink-0 justify-center gap-4 border-t bg-gray-50 p-6">
              <Button
                size="lg"
                variant="outline"
                className="border-blue-200 px-8 text-blue-700 hover:bg-blue-50"
                disabled={gatewayStatus.state === 'running'}
                onClick={() => void startGateway()}
              >
                {gatewayStatus.state === 'running' ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <Loader2 className={cn('mr-2 h-5 w-5', gatewayStatus.state === 'starting' && 'animate-spin')} />}
                {gatewayStatus.state === 'running' ? '网关已运行' : '启动网关'}
              </Button>
              <Button size="lg" className="bg-green-600 px-8 text-white hover:bg-green-700" onClick={onClose}>
                <CheckCircle2 className="mr-2 h-5 w-5" />
                配置完毕
              </Button>
            </div>
          </>
        )}
      </Card>

      {showPresetDialog && (
        <SwitchAddProviderDialog
          initialPresetId={showPresetDialog}
          onClose={() => {
            setShowPresetDialog(null);
            onClose();
          }}
          onConfigured={async () => {
            await onConfigured();
            setShowPresetDialog(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function ProviderChoiceCard({
  title,
  subtitle,
  description,
  icon,
  iconClassName,
  selected,
  onClick,
}: {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  iconClassName: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-[168px] flex-col items-center justify-center gap-3 rounded-xl border bg-white p-5 text-center shadow-sm transition-all hover:border-blue-400 hover:shadow-md',
        selected && 'border-blue-500 ring-1 ring-blue-500',
      )}
    >
      <div className={cn('mb-1 rounded-full p-3', iconClassName)}>
        {icon}
      </div>
      <div className="space-y-1">
        <h4 className="font-bold">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <p className="text-xs leading-5 text-muted-foreground/90">{description}</p>
      </div>
    </button>
  );
}
