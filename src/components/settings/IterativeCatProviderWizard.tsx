import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import anthropicIcon from '@/assets/providers/anthropic.svg';
import openaiIcon from '@/assets/providers/openai.svg';
import googleIcon from '@/assets/providers/google.svg';
import moonshotIcon from '@/assets/providers/moonshot.svg';
import minimaxIcon from '@/assets/providers/minimax.svg';
import qwenIcon from '@/assets/providers/qwen.svg';
import customIcon from '@/assets/providers/custom.svg';
import { ITERATIVECAT_DEFAULT_BASE_URL } from '@/config/build-profile';
import { toast } from 'sonner';

type WizardStep = 'login' | 'login-success' | 'model-selection';

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

type IterativeCatProviderWizardProps = {
  baseUrl: string;
  modelId: string;
  providerLabel?: string;
  onBaseUrlChange: (value: string) => void;
  onModelIdChange: (value: string) => void;
  onBack: () => void;
  onClose: () => void;
  onConfigured: (providerId: string) => Promise<void> | void;
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

function getLoginUrl(baseUrl: string): string {
  const normalizedInput = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const normalized = normalizedInput.endsWith('/v1')
    ? normalizedInput.slice(0, -3)
    : normalizedInput;
  return `${normalized}/login`;
}

export function IterativeCatProviderWizard({
  baseUrl,
  modelId,
  providerLabel = '服务商',
  onBaseUrlChange,
  onModelIdChange,
  onBack,
  onClose,
  onConfigured,
}: IterativeCatProviderWizardProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const mountedRef = useRef(true);
  const [step, setStep] = useState<WizardStep>('login');
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
  const [selectedModelId, setSelectedModelId] = useState(modelId || DEFAULT_MODEL_ID);
  const [showRechargePrompt, setShowRechargePrompt] = useState(false);

  const loginUrl = useMemo(() => getLoginUrl(baseUrl), [baseUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onBaseUrlChange(baseUrl || DEFAULT_BASE_URL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onModelIdChange(selectedModelId);
  }, [onModelIdChange, selectedModelId]);

  useEffect(() => {
    setStep('login');
    setLoginSuccess(false);
    setProfileReady(false);
    setApiKey('');
    setUseManualSk(false);
    setManualSk('');
    setAvailableModels([]);
    setSelectedModelId(modelId || DEFAULT_MODEL_ID);
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
  }, [baseUrl, modelId]);

  useEffect(() => {
    if (!loginContextReady) {
      return;
    }
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleDomReady = () => {
      const webContentsId = webview.getWebContentsId?.();
      if (!webContentsId) {
        return;
      }
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
  }, [baseUrl, loginContextReady]);

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
      if (!mountedRef.current) {
        return;
      }
      setLoginSuccess(true);
      setProfileReady(Boolean(result.profileReady));
      setStep('login-success');
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

  const handleForceCheckLogin = async () => {
    await checkLoginStatus(true);
  };

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('integration:iterativecat-login-success', () => {
      if (step !== 'login' || !loginContextReady) {
        return;
      }
      void checkLoginStatus(false);
    });
    return () => {
      unsubscribe();
    };
  }, [checkLoginStatus, loginContextReady, step]);

  useEffect(() => {
    if (step !== 'login' || !loginContextReady) return;
    const timer = window.setInterval(() => {
      void checkLoginStatus(false);
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [checkLoginStatus, loginContextReady, step]);

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
      setStep('model-selection');
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

  const handleFinish = async () => {
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
      await onConfigured(result.accountId || 'iterativecat');
      toast.success(`配置成功主模型：${selectedModelId}`);
      setShowRechargePrompt(true);
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const supportedModels = availableModels.filter((item) => !recommendedModels.some((model) => model.id === item));

  return (
    <>
      {step === 'login' && (
        <Card className="m-4 flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden border bg-white p-0 shadow-xl animate-in zoom-in-95 duration-200">
          <div className="z-10 flex items-center justify-between border-b bg-white px-6 py-4">
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                <img src="https://www.iterativecat.cn/logo.png" alt="logo" className="h-5 w-5 object-contain" />
              </div>
              {providerLabel}账号配置
            </h3>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="relative flex flex-1 flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b bg-muted/20 px-6 py-3">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack}>更换服务商</Button>
                <span className="text-sm text-muted-foreground">服务商渠道</span>
              </div>
              <div className="w-full max-w-sm">
                <Input value={baseUrl} readOnly className="h-9 cursor-not-allowed bg-muted/40 text-muted-foreground" />
              </div>
            </div>

            <div className="relative flex-1 bg-white">
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
                  onClick={handleForceCheckLogin}
                  disabled={loading || !loginContextReady}
                  className="bg-blue-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-blue-700"
                >
                  {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  我已完成登录
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {step === 'login-success' && (
        <Card className="m-4 flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden border bg-white p-0 shadow-xl animate-in zoom-in-95 duration-200">
          <div className="z-10 flex items-center justify-between border-b bg-white px-6 py-4">
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                <img src="https://www.iterativecat.cn/logo.png" alt="logo" className="h-5 w-5 object-contain" />
              </div>
              {providerLabel}账号配置
            </h3>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center space-y-8 bg-white p-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900">登录成功</h2>
              <p className="max-w-md text-lg text-muted-foreground">已成功连接到迭代猫账号。</p>
            </div>

            <Card className="w-full max-w-md border-blue-100 bg-blue-50/50 p-6">
              <h3 className="mb-3 flex items-center gap-2 font-medium text-blue-800">
                <Brain className="h-4 w-4" />
                将为您自动配置：
              </h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>自动获取并绑定 API Key</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>添加 GPT-5, Claude 等顶级模型</span>
                </li>
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
                  {useManualSk ? '取消手动输入' : '已有SK秘钥'}
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
                    disabled={loading || !profileReady || !loginSuccess}
                    onClick={handleOneClickConfigure}
                  >
                    {(loading || !profileReady) ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                    {loading ? '正在配置...' : (!profileReady ? '加载中，请稍后' : '一键配置并注册访问秘钥')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {step === 'model-selection' && (
        <Card className="m-4 flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden border bg-white p-0 shadow-xl animate-in zoom-in-95 duration-200">
          <div className="z-10 flex items-center justify-between border-b bg-white px-6 py-4">
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                <img src="https://www.iterativecat.cn/logo.png" alt="logo" className="h-5 w-5 object-contain" />
              </div>
              选择主力模型
            </h3>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white p-8">
            <div className="mx-auto max-w-3xl space-y-8">
              <div className="space-y-2 text-center">
                <h2 className="text-2xl font-bold">选择您的主力模型</h2>
                <p className="text-muted-foreground">这将作为 OpenClaw 的默认对话模型，您稍后可以随时更改</p>
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

          <div className="flex flex-shrink-0 items-center justify-end border-t bg-gray-50 p-6">
            <Button size="lg" className="bg-blue-600 px-8 text-white shadow-md transition-all hover:scale-105 hover:bg-blue-700" disabled={loading || !selectedModelId} onClick={handleFinish}>
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
              完成配置
            </Button>
          </div>
        </Card>
      )}
      {showRechargePrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md space-y-4 border bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold">建议先充值</h3>
            <p className="text-sm text-muted-foreground">
              新注册账号余额较低，建议先完成充值，避免模型调用失败。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRechargePrompt(false)}>稍后再说</Button>
              <Button
                onClick={async () => {
                  const normalized = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
                  const rechargeUrl = `${normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized}/console`;
                  await invokeIpc('shell:openExternal', rechargeUrl);
                  setShowRechargePrompt(false);
                }}
              >
                去充值
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
