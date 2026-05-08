/**
 * Settings Page
 * Application configuration
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Check,
  RefreshCw,
  ExternalLink,
  Copy,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { useUpdateStore } from '@/stores/update';
import { ProxySettings } from '@/components/settings/ProxySettings';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import {
  getGatewayWsDiagnosticEnabled,
  invokeIpc,
  setGatewayWsDiagnosticEnabled,
  toUserMessage,
} from '@/lib/api-client';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import wechatQr from '@/assets/community/wechat.png';
type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
};

type BridgeStatus = {
  enabled: boolean;
  running: boolean;
  mode: 'gui' | 'headless';
  host: string;
  port: number;
  allowRemote: boolean;
  hasToken: boolean;
  clientCount?: number;
  recentClients?: Array<{
    id: string;
    remoteAddress: string;
    userAgent?: string;
    authenticated: boolean;
    connectedAt: number;
    lastSeenAt: number;
  }>;
  discovery?: {
    enabled: boolean;
    running: boolean;
    port: number;
    serviceName: string;
    addresses: string[];
    lastProbeAt?: number;
    lastAnnounceAt?: number;
  } | null;
  relay?: {
    enabled: boolean;
    running: boolean;
    connected: boolean;
    url?: string;
    deviceId?: string;
    deviceName?: string;
    connectedAt?: number;
    lastHeartbeatAt?: number;
    reconnectAttempts?: number;
    lastError?: string;
  } | null;
  http?: {
    enabled: boolean;
    running: boolean;
    host: string;
    port: number;
    hasToken: boolean;
    clientCount?: number;
    recentClients?: Array<{
      id: string;
      remoteAddress: string;
      userAgent?: string;
      authenticated: boolean;
      connectedAt: number;
      lastSeenAt: number;
    }>;
  } | null;
};

type BridgeConfig = {
  enabled: boolean;
  port: number;
  allowRemote: boolean;
  token: string;
  httpEnabled: boolean;
  httpPort: number;
  httpToken: string;
  discoveryEnabled: boolean;
  discoveryPort: number;
  discoveryName: string;
  relayEnabled: boolean;
  relayUrl: string;
  relayToken: string;
  effectiveHost: string;
  effectivePort: number;
  effectiveEnabled: boolean;
  discovery?: BridgeStatus['discovery'];
  relay?: BridgeStatus['relay'];
};

type BridgeAuditEntry = {
  id: string;
  ts: number;
  level: 'info' | 'warning' | 'error';
  event: string;
  clientId?: string;
  remoteAddress?: string;
  requestId?: string;
  action?: string;
  details?: string;
};

const communityGroupQrUrl = 'https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/wechat_qun.jpg';
const buildNoCacheImageUrl = (url: string) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_ts=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;
};

export function Settings() {
  const { t } = useTranslation('settings');
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    launchAtStartup,
    setLaunchAtStartup,
    closeToTrayOnClose,
    setCloseToTrayOnClose,
    showCloseToTrayTip,
    setShowCloseToTrayTip,
    gatewayAutoStart,
    setGatewayAutoStart,
    gatewayStartupProfile,
    setGatewayStartupProfile,
    gatewayStartupExtraArgs,
    setGatewayStartupExtraArgs,
    bridgeEnabled,
    setBridgeEnabled,
    bridgePort,
    setBridgePort,
    bridgeAllowRemote,
    setBridgeAllowRemote,
    autoCheckUpdate,
    setAutoCheckUpdate,
    autoDownloadUpdate,
    setAutoDownloadUpdate,
    devModeUnlocked,
    setDevModeUnlocked,
    telemetryEnabled,
    setTelemetryEnabled,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const updateSetAutoDownload = useUpdateStore((state) => state.setAutoDownload);
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [wsDiagnosticEnabled, setWsDiagnosticEnabled] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [communityGroupQrSrc, setCommunityGroupQrSrc] = useState(() => buildNoCacheImageUrl(communityGroupQrUrl));
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [bridgeToken, setBridgeToken] = useState('');
  const [bridgePortInput, setBridgePortInput] = useState(String(bridgePort || 18989));
  const [bridgeHttpEnabled, setBridgeHttpEnabled] = useState(false);
  const [bridgeHttpToken, setBridgeHttpToken] = useState('');
  const [bridgeHttpPortInput, setBridgeHttpPortInput] = useState('18991');
  const [bridgeDiscoveryEnabled, setBridgeDiscoveryEnabled] = useState(true);
  const [bridgeDiscoveryPortInput, setBridgeDiscoveryPortInput] = useState('18990');
  const [bridgeDiscoveryName, setBridgeDiscoveryName] = useState('ClawX-Cat');
  const [bridgeRelayEnabled, setBridgeRelayEnabled] = useState(false);
  const [bridgeRelayUrl, setBridgeRelayUrl] = useState('');
  const [bridgeRelayToken, setBridgeRelayToken] = useState('');
  const [bridgeExpanded, setBridgeExpanded] = useState(true);
  const [startupExpanded, setStartupExpanded] = useState(false);
  const [startupProfileMenuOpen, setStartupProfileMenuOpen] = useState(false);
  const [startupArgsInput, setStartupArgsInput] = useState(gatewayStartupExtraArgs || '');
  const startupProfileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCommunityGroupQrSrc(buildNoCacheImageUrl(communityGroupQrUrl));
  }, []);

  const refreshCommunityGroupQr = () => {
    const nextUrl = buildNoCacheImageUrl(communityGroupQrUrl);
    setCommunityGroupQrSrc(nextUrl);
    return nextUrl;
  };
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeAudit, setBridgeAudit] = useState<BridgeAuditEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const isLinux = window.electron.platform === 'linux';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [doctorRunningMode, setDoctorRunningMode] = useState<'diagnose' | 'fix' | null>(null);
  const [doctorResult, setDoctorResult] = useState<{
    mode: 'diagnose' | 'fix';
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    command: string;
    cwd: string;
    durationMs: number;
    timedOut?: boolean;
    error?: string;
  } | null>(null);

  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) {
        await invokeIpc('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  const refreshBridgeInfo = async () => {
    try {
      const [status, config] = await Promise.all([
        hostApiFetch<BridgeStatus>('/api/bridge/status'),
        hostApiFetch<BridgeConfig>('/api/bridge/config'),
      ]);
      setBridgeStatus(status);
      setBridgeToken(config.token || '');
      setBridgePortInput(String(config.port || 18989));
      setBridgeHttpEnabled(config.httpEnabled === true);
      setBridgeHttpToken(config.httpToken || '');
      setBridgeHttpPortInput(String(config.httpPort || 18991));
      setBridgeDiscoveryEnabled(config.discoveryEnabled !== false);
      setBridgeDiscoveryPortInput(String(config.discoveryPort || 18990));
      setBridgeDiscoveryName(config.discoveryName || 'ClawX-Cat');
      setBridgeRelayEnabled(config.relayEnabled === true);
      setBridgeRelayUrl(config.relayUrl || '');
      setBridgeRelayToken(config.relayToken || '');
      const audit = await hostApiFetch<{ entries: BridgeAuditEntry[] }>('/api/bridge/audit');
      setBridgeAudit(audit.entries || []);
    } catch {
      // ignore bridge refresh errors
    }
  };

  const handleClearBridgeAudit = async () => {
    setBridgeBusy(true);
    try {
      await hostApiFetch('/api/bridge/audit', {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      setBridgeAudit([]);
      toast.success(t('gateway.bridge.auditCleared'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleCopyBridgeToken = async () => {
    if (!bridgeToken) return;
    try {
      await navigator.clipboard.writeText(bridgeToken);
      toast.success(t('gateway.bridge.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  const handleRegenerateBridgeToken = async () => {
    setBridgeBusy(true);
    try {
      const result = await hostApiFetch<{ token: string; status: BridgeStatus }>('/api/bridge/token/regenerate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setBridgeToken(result.token);
      setBridgeStatus(result.status);
      toast.success(t('gateway.bridge.tokenRegenerated'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleCopyBridgeHttpToken = async () => {
    if (!bridgeHttpToken) return;
    try {
      await navigator.clipboard.writeText(bridgeHttpToken);
      toast.success(t('gateway.bridge.httpTokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  const handleRegenerateBridgeHttpToken = async () => {
    setBridgeBusy(true);
    try {
      const result = await hostApiFetch<{ token: string; status: BridgeStatus }>('/api/bridge/http/token/regenerate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setBridgeHttpToken(result.token);
      setBridgeStatus(result.status);
      toast.success(t('gateway.bridge.httpTokenRegenerated'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleRestartBridge = async () => {
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/restart', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.restarted'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeEnabledChange = async (checked: boolean) => {
    setBridgeEnabled(checked);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeEnabled: checked }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeAllowRemoteChange = async (checked: boolean) => {
    setBridgeAllowRemote(checked);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeAllowRemote: checked }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeHttpEnabledChange = async (checked: boolean) => {
    setBridgeHttpEnabled(checked);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeHttpEnabled: checked }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleSaveBridgePort = async () => {
    const nextPort = Number(bridgePortInput);
    if (!Number.isFinite(nextPort) || nextPort <= 0) {
      toast.error(t('gateway.bridge.invalidPort'));
      return;
    }
    setBridgePort(nextPort);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgePort: nextPort }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleSaveBridgeHttpPort = async () => {
    const nextPort = Number(bridgeHttpPortInput);
    if (!Number.isFinite(nextPort) || nextPort <= 0) {
      toast.error(t('gateway.bridge.invalidPort'));
      return;
    }
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeHttpPort: nextPort }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeDiscoveryEnabledChange = async (checked: boolean) => {
    setBridgeDiscoveryEnabled(checked);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeDiscoveryEnabled: checked }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleSaveBridgeDiscovery = async () => {
    const nextPort = Number(bridgeDiscoveryPortInput);
    if (!Number.isFinite(nextPort) || nextPort <= 0) {
      toast.error(t('gateway.bridge.invalidPort'));
      return;
    }
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({
          bridgeDiscoveryPort: nextPort,
          bridgeDiscoveryName,
        }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeRelayEnabledChange = async (checked: boolean) => {
    setBridgeRelayEnabled(checked);
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({ bridgeRelayEnabled: checked }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleSaveBridgeRelay = async () => {
    setBridgeBusy(true);
    try {
      const status = await hostApiFetch<BridgeStatus>('/api/bridge/config', {
        method: 'PUT',
        body: JSON.stringify({
          bridgeRelayUrl,
          bridgeRelayToken,
        }),
      });
      setBridgeStatus(status);
      toast.success(t('gateway.bridge.saved'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleRunOpenClawDoctor = async (mode: 'diagnose' | 'fix') => {
    setDoctorRunningMode(mode);
    try {
      const result = await hostApiFetch<{
        mode: 'diagnose' | 'fix';
        success: boolean;
        exitCode: number | null;
        stdout: string;
        stderr: string;
        command: string;
        cwd: string;
        durationMs: number;
        timedOut?: boolean;
        error?: string;
      }>('/api/app/openclaw-doctor', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      setDoctorResult(result);
      if (result.success) {
        toast.success(mode === 'fix' ? t('developer.doctorFixSucceeded') : t('developer.doctorSucceeded'));
      } else {
        toast.error(result.error || (mode === 'fix' ? t('developer.doctorFixFailed') : t('developer.doctorFailed')));
      }
    } catch (error) {
      const message = toUserMessage(error) || (mode === 'fix' ? t('developer.doctorFixRunFailed') : t('developer.doctorRunFailed'));
      toast.error(message);
      setDoctorResult({
        mode,
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command: 'openclaw doctor',
        cwd: '',
        durationMs: 0,
        error: message,
      });
    } finally {
      setDoctorRunningMode(null);
    }
  };

  const handleCopyDoctorOutput = async () => {
    if (!doctorResult) return;
    const payload = [
      `command: ${doctorResult.command}`,
      `cwd: ${doctorResult.cwd}`,
      `exitCode: ${doctorResult.exitCode ?? 'null'}`,
      `durationMs: ${doctorResult.durationMs}`,
      '',
      '[stdout]',
      doctorResult.stdout.trim() || '(empty)',
      '',
      '[stderr]',
      doctorResult.stderr.trim() || '(empty)',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(payload);
      toast.success(t('developer.doctorCopied'));
    } catch (error) {
      toast.error(`Failed to copy doctor output: ${String(error)}`);
    }
  };



  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
      }>('/api/gateway/control-ui');
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await invokeIpc<{
          success: boolean;
          command?: string;
          error?: string;
        }>('openclaw:getCliCommand');
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => { cancelled = true; };
  }, [devModeUnlocked, showCliTools]);

  useEffect(() => {
    void refreshBridgeInfo();
  }, []);

  useEffect(() => {
    setStartupArgsInput(gatewayStartupExtraArgs || '');
  }, [gatewayStartupExtraArgs]);

  useEffect(() => {
    if (!startupProfileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!startupProfileMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && startupProfileMenuRef.current.contains(target)) return;
      setStartupProfileMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [startupProfileMenuOpen]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  const handleSaveStartupArgs = () => {
    setGatewayStartupExtraArgs(startupArgsInput.trim());
    toast.success(t('gateway.startup.saved'));
  };

  const startupProfileOptions: Array<{
    value: 'auto' | 'full' | 'server-lite';
    label: string;
  }> = [
    { value: 'auto', label: t('gateway.startup.options.auto') },
    { value: 'full', label: t('gateway.startup.options.full') },
    { value: 'server-lite', label: t('gateway.startup.options.serverLite') },
  ];
  const startupProfileLabel =
    startupProfileOptions.find((item) => item.value === gatewayStartupProfile)?.label
    || t('gateway.startup.options.auto');

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      'openclaw:cli-installed',
      (...args: unknown[]) => {
        const installedPath = typeof args[0] === 'string' ? args[0] : '';
        toast.success(`openclaw CLI installed at ${installedPath}`);
      },
    );
    return () => { unsubscribe?.(); };
  }, []);

  useEffect(() => {
    setWsDiagnosticEnabled(getGatewayWsDiagnosticEnabled());
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsubscribe = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
    return unsubscribe;
  }, [devModeUnlocked]);

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;
    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<string, {
      event: string;
      count: number;
      errorCount: number;
      slowCount: number;
      totalDuration: number;
      timedCount: number;
      lastTs: string;
    }>();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
        lastTs: entry.ts,
      };

      current.count += 1;
      current.lastTs = entry.ts;

      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [telemetryEntries]);

  const handleCopyTelemetry = async () => {
    try {
      const serialized = telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n');
      await navigator.clipboard.writeText(serialized);
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(`${t('common:status.error')}: ${String(error)}`);
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleWsDiagnosticToggle = (enabled: boolean) => {
    setGatewayWsDiagnosticEnabled(enabled);
    setWsDiagnosticEnabled(enabled);
    toast.success(
      enabled
        ? t('developer.wsDiagnosticEnabled')
        : t('developer.wsDiagnosticDisabled'),
    );
  };

  return (
    <div data-testid="settings-page" className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-5 py-6 md:px-6 md:py-8 space-y-5">
          <section className="space-y-2 mb-2">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {t('title')}
            </h1>
            <p className="text-[14px] text-muted-foreground">
              {t('subtitle')}
            </p>
          </section>

          {/* Appearance */}
          <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <h2 className="text-[16px] font-bold text-foreground mb-5">
              {t('appearance.title')}
            </h2>
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-[15px] font-medium text-foreground/80">{t('appearance.theme')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={theme === 'light' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-border/70", theme === 'light' ? "bg-card text-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-card")}
                    onClick={() => setTheme('light')}
                  >
                    <Sun className="h-4 w-4 mr-2" />
                    {t('appearance.light')}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-border/70", theme === 'dark' ? "bg-card text-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-card")}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon className="h-4 w-4 mr-2" />
                    {t('appearance.dark')}
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-border/70", theme === 'system' ? "bg-card text-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-card")}
                    onClick={() => setTheme('system')}
                  >
                    <Monitor className="h-4 w-4 mr-2" />
                    {t('appearance.system')}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-[15px] font-medium text-foreground/80">{t('appearance.language')}</Label>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <Button
                      key={lang.code}
                      variant={language === lang.code ? 'secondary' : 'outline'}
                      className={cn("rounded-full px-5 h-10 border-border/70", language === lang.code ? "bg-card text-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-card")}
                      onClick={() => setLanguage(lang.code)}
                    >
                      {lang.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground/80">{t('appearance.launchAtStartup')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('appearance.launchAtStartupDesc')}
                  </p>
                </div>
                <Switch
                  checked={launchAtStartup}
                  onCheckedChange={setLaunchAtStartup}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground/80">{t('appearance.closeToTrayOnClose')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('appearance.closeToTrayOnCloseDesc')}
                  </p>
                </div>
                <Switch
                  checked={closeToTrayOnClose}
                  onCheckedChange={setCloseToTrayOnClose}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground/80">{t('appearance.showCloseToTrayTip')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('appearance.showCloseToTrayTipDesc')}
                  </p>
                </div>
                <Switch
                  checked={showCloseToTrayTip}
                  onCheckedChange={setShowCloseToTrayTip}
                  disabled={!closeToTrayOnClose}
                />
              </div>
            </div>
          </section>

          {/* Gateway */}
          <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <h2 className="text-[16px] font-bold text-foreground mb-5">
              {t('gateway.title')}
            </h2>
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('gateway.status')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('gateway.port')}: {gatewayStatus.port}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border",
                    gatewayStatus.state === 'running' ? "bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20" :
                      gatewayStatus.state === 'error' ? "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20" :
                        "bg-card text-muted-foreground border-border/50"
                  )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full",
                      gatewayStatus.state === 'running' ? "bg-green-500" :
                        gatewayStatus.state === 'error' ? "bg-red-500" : "bg-muted-foreground"
                    )} />
                    {gatewayStatus.state}
                  </div>
                  <Button variant="outline" size="sm" onClick={restartGateway} className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card">
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    {t('common:actions.restart')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleShowLogs} className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {t('gateway.logs')}
                  </Button>
                </div>
              </div>

              {showLogs && (
                <div className="p-4 rounded-2xl bg-card border border-border/60 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-[14px]">{t('gateway.appLogs')}</p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-[12px] rounded-full hover:bg-card" onClick={handleOpenLogDir}>
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        {t('gateway.openFolder')}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-[12px] rounded-full hover:bg-card" onClick={() => setShowLogs(false)}>
                        {t('common:actions.close')}
                      </Button>
                    </div>
                  </div>
                  <pre className="text-[12px] text-muted-foreground bg-background p-4 rounded-xl max-h-60 overflow-auto whitespace-pre-wrap font-mono border border-border/60 shadow-inner">
                    {logContent || t('chat:noLogs')}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('gateway.autoStart')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('gateway.autoStartDesc')}
                  </p>
                </div>
                <Switch
                  checked={gatewayAutoStart}
                  onCheckedChange={setGatewayAutoStart}
                />
              </div>

              <div className="rounded-2xl border border-border/60 bg-background p-5 shadow-sm space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.startup.title')}</Label>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {t('gateway.startup.desc')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setStartupExpanded((value) => !value)}
                    className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card"
                  >
                    <ChevronDown className={cn('h-3.5 w-3.5 mr-1.5 transition-transform', startupExpanded && 'rotate-180')} />
                    {startupExpanded ? t('gateway.startup.collapse') : t('gateway.startup.expand')}
                  </Button>
                </div>
                {startupExpanded && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.startup.strategy')}</Label>
                      <div className="relative max-w-[320px]" ref={startupProfileMenuRef}>
                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={startupProfileMenuOpen}
                          onClick={() => setStartupProfileMenuOpen((value) => !value)}
                          className={cn(
                            'flex h-10 w-full items-center justify-between rounded-2xl border px-3 text-sm shadow-sm transition',
                            'bg-card border-border/40 hover:border-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                          )}
                        >
                          <span className="truncate text-foreground">{startupProfileLabel}</span>
                          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', startupProfileMenuOpen && 'rotate-180')} />
                        </button>
                        {startupProfileMenuOpen && (
                          <div
                            role="listbox"
                            className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-2xl border border-border/60 bg-card p-1.5 shadow-lg"
                          >
                            {startupProfileOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={gatewayStartupProfile === option.value}
                                onClick={() => {
                                  setGatewayStartupProfile(option.value);
                                  setStartupProfileMenuOpen(false);
                                }}
                                className={cn(
                                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition',
                                  gatewayStartupProfile === option.value
                                    ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                    : 'text-foreground hover:bg-muted/40',
                                )}
                              >
                                <span className="truncate">{option.label}</span>
                                {gatewayStartupProfile === option.value && <Check className="h-4 w-4" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {isLinux ? t('gateway.startup.linuxDefault') : t('gateway.startup.nonLinuxDefault')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.startup.extraArgs')}</Label>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          value={startupArgsInput}
                          onChange={(event) => setStartupArgsInput(event.target.value)}
                          className="h-10 rounded-2xl bg-card border-border/40 flex-1 min-w-[260px] shadow-sm"
                          placeholder={t('gateway.startup.extraArgsPlaceholder')}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleSaveStartupArgs}
                          className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                        >
                          {t('common:actions.save')}
                        </Button>
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {t('gateway.startup.extraArgsHelp')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border/60 bg-background p-5 shadow-sm space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.title')}</Label>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {t('gateway.bridge.desc')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border",
                      bridgeStatus?.running
                        ? "bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20"
                        : "bg-card text-muted-foreground border-border/50"
                    )}>
                      <div className={cn("w-1.5 h-1.5 rounded-full", bridgeStatus?.running ? "bg-green-500" : "bg-muted-foreground")} />
                      {bridgeStatus?.running ? t('gateway.bridge.running') : t('gateway.bridge.stopped')}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void refreshBridgeInfo()} className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card">
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      {t('common:actions.refresh')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleRestartBridge} disabled={bridgeBusy} className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card">
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      {t('common:actions.restart')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setBridgeExpanded((value) => !value)}
                      className="rounded-full h-8 px-4 border-border/70 bg-card hover:bg-card"
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 mr-1.5 transition-transform', bridgeExpanded && 'rotate-180')} />
                      {bridgeExpanded ? '收起' : '展开'}
                    </Button>
                  </div>
                </div>

                {bridgeExpanded && (
                  <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.enabled')}</Label>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {t('gateway.bridge.enabledDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={bridgeEnabled}
                    onCheckedChange={handleBridgeEnabledChange}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.allowRemote')}</Label>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {t('gateway.bridge.allowRemoteDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={bridgeAllowRemote}
                    onCheckedChange={handleBridgeAllowRemoteChange}
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.port')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={bridgePortInput}
                      onChange={(event) => setBridgePortInput(event.target.value)}
                      className="h-10 rounded-2xl bg-card border-border/40 max-w-[220px] shadow-sm"
                    />
                    <Button type="button" variant="outline" onClick={handleSaveBridgePort} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm">
                      {t('common:actions.save')}
                    </Button>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {t('gateway.bridge.effective')}: `{bridgeStatus?.host || '127.0.0.1'}:{bridgeStatus?.port || bridgePort}`
                  </p>
                </div>

                <div className="space-y-3">
                  <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.token')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      readOnly
                      value={bridgeToken}
                      placeholder={t('gateway.bridge.tokenUnavailable')}
                      className="font-mono text-[13px] h-10 rounded-2xl bg-card border-border/40 flex-1 min-w-[200px] shadow-sm"
                    />
                    <Button type="button" variant="outline" onClick={handleCopyBridgeToken} disabled={!bridgeToken} className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm">
                      <Copy className="h-4 w-4 mr-2" />
                      {t('common:actions.copy')}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleRegenerateBridgeToken} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('gateway.bridge.regenerateToken')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.httpTitle')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.httpDesc')}
                      </p>
                    </div>
                    <div className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      bridgeStatus?.http?.running
                        ? "bg-green-500/10 text-green-600 border-green-500/20"
                        : "bg-card text-muted-foreground border-border/50"
                    )}>
                      {bridgeStatus?.http?.running ? t('gateway.bridge.running') : t('gateway.bridge.stopped')}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.httpEnabled')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.httpEnabledDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={bridgeHttpEnabled}
                      onCheckedChange={handleBridgeHttpEnabledChange}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.httpPort')}</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={bridgeHttpPortInput}
                        onChange={(event) => setBridgeHttpPortInput(event.target.value)}
                        className="h-10 rounded-2xl bg-background border-border/40 max-w-[220px] shadow-sm"
                      />
                      <Button type="button" variant="outline" onClick={handleSaveBridgeHttpPort} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-background border-border/40 hover:bg-background shadow-sm">
                        {t('common:actions.save')}
                      </Button>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {t('gateway.bridge.httpEffective')}: `{bridgeStatus?.http?.host || bridgeStatus?.host || '127.0.0.1'}:{bridgeStatus?.http?.port || bridgeHttpPortInput}`
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.httpToken')}</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        readOnly
                        value={bridgeHttpToken}
                        placeholder={t('gateway.bridge.tokenUnavailable')}
                        className="font-mono text-[13px] h-10 rounded-2xl bg-background border-border/40 flex-1 min-w-[200px] shadow-sm"
                      />
                      <Button type="button" variant="outline" onClick={handleCopyBridgeHttpToken} disabled={!bridgeHttpToken} className="rounded-full h-10 px-4 bg-background border-border/40 hover:bg-background shadow-sm">
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                      <Button type="button" variant="outline" onClick={handleRegenerateBridgeHttpToken} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-background border-border/40 hover:bg-background shadow-sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('gateway.bridge.regenerateToken')}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.discoveryTitle')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.discoveryDesc')}
                      </p>
                    </div>
                    <div className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      bridgeStatus?.discovery?.running
                        ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                        : "bg-card text-muted-foreground border-border/50"
                    )}>
                      {bridgeStatus?.discovery?.running ? t('gateway.bridge.discoveryRunning') : t('gateway.bridge.discoveryStopped')}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.discoveryEnabled')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.discoveryEnabledDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={bridgeDiscoveryEnabled}
                      onCheckedChange={handleBridgeDiscoveryEnabledChange}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.bridge.discoveryName')}</Label>
                      <Input
                        value={bridgeDiscoveryName}
                        onChange={(event) => setBridgeDiscoveryName(event.target.value)}
                        className="h-10 rounded-2xl bg-background border-border/40 shadow-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.bridge.discoveryPort')}</Label>
                      <Input
                        value={bridgeDiscoveryPortInput}
                        onChange={(event) => setBridgeDiscoveryPortInput(event.target.value)}
                        className="h-10 rounded-2xl bg-background border-border/40 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={handleSaveBridgeDiscovery} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-background border-border/40 hover:bg-background shadow-sm">
                      {t('common:actions.save')}
                    </Button>
                    <p className="text-[12px] text-muted-foreground">
                      {t('gateway.bridge.discoveryAddresses')}: {bridgeStatus?.discovery?.addresses?.join(', ') || '-'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.relayTitle')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.relayDesc')}
                      </p>
                    </div>
                    <div className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      bridgeStatus?.relay?.connected
                        ? "bg-green-500/10 text-green-600 border-green-500/20"
                        : bridgeStatus?.relay?.running
                          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                          : "bg-card text-muted-foreground border-border/50"
                    )}>
                      {bridgeStatus?.relay?.connected
                        ? t('gateway.bridge.relayConnected')
                        : bridgeStatus?.relay?.running
                          ? t('gateway.bridge.relayConnecting')
                          : t('gateway.bridge.relayStopped')}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.relayEnabled')}</Label>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t('gateway.bridge.relayEnabledDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={bridgeRelayEnabled}
                      onCheckedChange={handleBridgeRelayEnabledChange}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.bridge.relayUrl')}</Label>
                      <Input
                        value={bridgeRelayUrl}
                        onChange={(event) => setBridgeRelayUrl(event.target.value)}
                        className="h-10 rounded-2xl bg-background border-border/40 shadow-sm"
                        placeholder="wss://relay.example.com/ws/device"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-[14px] font-medium text-foreground">{t('gateway.bridge.relayToken')}</Label>
                      <Input
                        value={bridgeRelayToken}
                        onChange={(event) => setBridgeRelayToken(event.target.value)}
                        className="h-10 rounded-2xl bg-background border-border/40 shadow-sm font-mono text-[13px]"
                        placeholder={t('gateway.bridge.tokenUnavailable')}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={handleSaveBridgeRelay} disabled={bridgeBusy} className="rounded-full h-10 px-4 bg-background border-border/40 hover:bg-background shadow-sm">
                      {t('common:actions.save')}
                    </Button>
                    {bridgeStatus?.relay?.deviceId && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('gateway.bridge.relayDeviceId')}: {bridgeStatus.relay.deviceId}
                      </p>
                    )}
                  </div>
                  {bridgeStatus?.relay?.lastError && (
                    <p className="text-[12px] text-red-600 break-all">{bridgeStatus.relay.lastError}</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.connections')}</Label>
                    <span className="rounded-full border border-border/50 bg-card px-3 py-1 text-[12px] text-muted-foreground">
                      {bridgeStatus?.clientCount || 0}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {bridgeStatus?.recentClients && bridgeStatus.recentClients.length > 0 ? (
                      bridgeStatus.recentClients.slice(0, 5).map((client) => (
                        <div key={client.id} className="rounded-2xl border border-border/50 bg-card px-4 py-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[13px] font-medium text-foreground">{client.remoteAddress}</div>
                            <div className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] border",
                              client.authenticated
                                ? "bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20"
                                : "bg-card text-muted-foreground border-border/50"
                            )}>
                              {client.authenticated ? t('gateway.bridge.authenticated') : t('gateway.bridge.unauthenticated')}
                            </div>
                          </div>
                          {client.userAgent && (
                            <p className="mt-1 text-[12px] text-muted-foreground break-all">{client.userAgent}</p>
                          )}
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Last seen: {new Date(client.lastSeenAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-[12px] text-muted-foreground">{t('gateway.bridge.noClients')}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[15px] font-medium text-foreground">{t('gateway.bridge.audit')}</Label>
                    <Button type="button" variant="outline" size="sm" onClick={handleClearBridgeAudit} disabled={bridgeBusy} className="rounded-full h-8 px-4 bg-card border-border/40 hover:bg-card shadow-sm">
                      {t('gateway.bridge.clearAudit')}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {bridgeAudit.length > 0 ? (
                      bridgeAudit.slice(0, 8).map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-border/50 bg-card px-4 py-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[13px] font-medium text-foreground">
                              {entry.action ? `${entry.event} · ${entry.action}` : entry.event}
                            </div>
                            <div className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] border",
                              entry.level === 'error'
                                ? "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20"
                                : entry.level === 'warning'
                                  ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/20"
                                  : "bg-card text-muted-foreground border-border/50"
                            )}>
                              {entry.level}
                            </div>
                          </div>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {entry.remoteAddress || 'unknown'} · {new Date(entry.ts).toLocaleString()}
                          </p>
                          {entry.details && (
                            <p className="mt-1 text-[12px] text-muted-foreground break-all">{entry.details}</p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-[12px] text-muted-foreground">{t('gateway.bridge.noAudit')}</p>
                    )}
                  </div>
                </div>
                  </>
                )}
              </div>


              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('advanced.devMode')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('advanced.devModeDesc')}
                  </p>
                </div>
                <Switch
                  checked={devModeUnlocked}
                  onCheckedChange={setDevModeUnlocked}
                  data-testid="settings-dev-mode-switch"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('advanced.telemetry')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('advanced.telemetryDesc')}
                  </p>
                </div>
                <Switch
                  checked={telemetryEnabled}
                  onCheckedChange={setTelemetryEnabled}
                />
              </div>

            </div>
          </section>


          {/* Developer */}
          {devModeUnlocked && (
              <section data-testid="settings-developer-section" className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
                <h2 data-testid="settings-developer-title" className="text-[16px] font-bold text-foreground mb-5">
                  {t('developer.title')}
                </h2>
                <div className="space-y-8">
                  {/* Gateway Proxy */}
                  <ProxySettings />
                  <div className="space-y-4 pt-4">
                    <Label className="text-[14px] font-medium text-foreground/80">{t('developer.gatewayToken')}</Label>
                    <p className="text-[13px] text-muted-foreground">
                      {t('developer.gatewayTokenDesc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        data-testid="settings-developer-gateway-token"
                        readOnly
                        value={controlUiInfo?.token || ''}
                        placeholder={t('developer.tokenUnavailable')}
                        className="font-mono text-[13px] h-10 rounded-2xl bg-card border-border/40 flex-1 min-w-[200px] shadow-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshControlUiInfo}
                        disabled={!devModeUnlocked}
                        className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('common:actions.load')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCopyGatewayToken}
                        disabled={!controlUiInfo?.token}
                        className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>

                  {showCliTools && (
                    <div className="space-y-3">
                      <Label className="text-[15px] font-medium text-foreground">{t('developer.cli')}</Label>
                      <p className="text-[13px] text-muted-foreground">
                        {t('developer.cliDesc')}
                      </p>
                      {isWindows && (
                        <p className="text-[12px] text-muted-foreground">
                          {t('developer.cliPowershell')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Input
                          readOnly
                          value={openclawCliCommand}
                          placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="font-mono text-[13px] h-10 rounded-2xl bg-card border-border/40 flex-1 min-w-[200px] shadow-sm"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyCliCommand}
                          disabled={!openclawCliCommand}
                          className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-[14px] font-medium text-foreground">{t('developer.doctor')}</Label>
                        <p className="text-[13px] text-muted-foreground mt-1">
                          {t('developer.doctorDesc')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('diagnose')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'diagnose' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'diagnose' ? t('common:status.running') : t('developer.runDoctor')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('fix')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'fix' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'fix' ? t('common:status.running') : t('developer.runDoctorFix')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyDoctorOutput}
                          disabled={!doctorResult}
                          className="rounded-full h-10 px-4 bg-card border-border/40 hover:bg-card shadow-sm"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>

                    {doctorResult && (
                      <div className="space-y-3 rounded-2xl border border-border/70 p-5 bg-card shadow-sm">
                        <div className="flex flex-wrap gap-2 text-[12px]">
                          <Badge variant={doctorResult.success ? 'secondary' : 'destructive'} className="rounded-full px-3 py-1">
                            {doctorResult.mode === 'fix'
                              ? (doctorResult.success ? t('developer.doctorFixOk') : t('developer.doctorFixIssue'))
                              : (doctorResult.success ? t('developer.doctorOk') : t('developer.doctorIssue'))}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorExitCode')}: {doctorResult.exitCode ?? 'null'}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorDuration')}: {Math.round(doctorResult.durationMs)}ms
                          </Badge>
                        </div>
                        <div className="space-y-1 text-[12px] text-muted-foreground font-mono break-all">
                          <p>{t('developer.doctorCommand')}: {doctorResult.command}</p>
                          <p>{t('developer.doctorWorkingDir')}: {doctorResult.cwd || '-'}</p>
                          {doctorResult.error && <p>{t('developer.doctorError')}: {doctorResult.error}</p>}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-[12px] font-semibold text-foreground/80">{t('developer.doctorStdout')}</p>
                            <pre className="max-h-72 overflow-auto rounded-2xl border border-border/40 bg-background p-3 text-[11px] font-mono whitespace-pre-wrap break-words shadow-inner">
                              {doctorResult.stdout.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[12px] font-semibold text-foreground/80">{t('developer.doctorStderr')}</p>
                            <pre className="max-h-72 overflow-auto rounded-2xl border border-border/40 bg-background p-3 text-[11px] font-mono whitespace-pre-wrap break-words shadow-inner">
                              {doctorResult.stderr.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-2xl border border-border/70 p-5 bg-card shadow-sm">
                      <div>
                        <Label className="text-[14px] font-medium text-foreground">{t('developer.wsDiagnostic')}</Label>
                        <p className="text-[13px] text-muted-foreground mt-1">
                          {t('developer.wsDiagnosticDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={wsDiagnosticEnabled}
                        onCheckedChange={handleWsDiagnosticToggle}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-[14px] font-medium text-foreground">{t('developer.telemetryViewer')}</Label>
                        <p className="text-[13px] text-muted-foreground mt-1">
                          {t('developer.telemetryViewerDesc')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTelemetryViewer((prev) => !prev)}
                        className="rounded-full px-5 h-9 bg-card border-border/70 hover:bg-card"
                      >
                        {showTelemetryViewer
                          ? t('common:actions.hide')
                          : t('common:actions.show')}
                      </Button>
                    </div>

                    {showTelemetryViewer && (
                      <div className="space-y-4 rounded-2xl border border-border/40 p-5 bg-background shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="rounded-full px-3 py-1 bg-background border border-border/60">{t('developer.telemetryTotal')}: {telemetryStats.total}</Badge>
                          <Badge variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'} className={cn("rounded-full px-3 py-1", telemetryStats.errorCount === 0 && "bg-background border border-border/60")}>
                            {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                          </Badge>
                          <Badge variant={telemetryStats.slowCount > 0 ? 'secondary' : 'outline'} className={cn("rounded-full px-3 py-1", telemetryStats.slowCount === 0 && "bg-background border border-border/60")}>
                            {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                          </Badge>
                          <div className="ml-auto flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={handleCopyTelemetry} className="rounded-full h-8 px-4 bg-background border-border/60 hover:bg-card">
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              {t('common:actions.copy')}
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={handleClearTelemetry} className="rounded-full h-8 px-4 bg-background border-border/60 hover:bg-card">
                              {t('common:actions.clear')}
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-80 overflow-auto rounded-2xl border border-border/40 bg-background shadow-inner">
                          {telemetryByEvent.length > 0 && (
                            <div className="border-b border-border/60 bg-card p-3">
                              <p className="mb-3 text-[12px] font-semibold text-muted-foreground">
                                {t('developer.telemetryAggregated')}
                              </p>
                              <div className="space-y-1.5 text-[12px]">
                                {telemetryByEvent.map((item) => (
                                  <div
                                    key={item.event}
                                    className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded-xl border border-border/40 bg-card px-3 py-2 shadow-sm"
                                  >
                                    <span className="truncate font-medium" title={item.event}>{item.event}</span>
                                    <span className="text-muted-foreground">n={item.count}</span>
                                    <span className="text-muted-foreground">
                                      avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms
                                    </span>
                                    <span className="text-muted-foreground">slow={item.slowCount}</span>
                                    <span className="text-muted-foreground">err={item.errorCount}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2 p-3 font-mono text-[12px]">
                            {telemetryEntries.length === 0 ? (
                              <div className="text-muted-foreground text-center py-4">{t('developer.telemetryEmpty')}</div>
                            ) : (
                              telemetryEntries
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <div key={entry.id} className="rounded-xl border border-border/40 bg-card p-3 shadow-sm">
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <span className="font-semibold text-foreground">{entry.event}</span>
                                      <span className="text-muted-foreground text-[11px]">{entry.ts}</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground overflow-x-auto">
                                      {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                                    </pre>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
          )}

          {/* Updates */}
          <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <h2 className="text-[16px] font-bold text-foreground mb-5">
              {t('updates.title')}
            </h2>
            <div className="space-y-6">
              <UpdateSettings />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('updates.autoCheck')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('updates.autoCheckDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoCheckUpdate}
                  onCheckedChange={setAutoCheckUpdate}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[15px] font-medium text-foreground">{t('updates.autoDownload')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('updates.autoDownloadDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoDownloadUpdate}
                  onCheckedChange={(value) => {
                    setAutoDownloadUpdate(value);
                    updateSetAutoDownload(value);
                  }}
                />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <h2 className="text-[16px] font-bold text-foreground mb-5">
              {t('about.contactTitle')}
            </h2>
            <div className="space-y-5 text-[14px] text-muted-foreground">
              <p>{t('about.contactDesc')}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPreviewImage(refreshCommunityGroupQr())}
                  className="group rounded-2xl border border-border/40 bg-background p-4 text-left shadow-sm transition hover:border-blue-400/60 hover:shadow-md"
                >
                  <div className="mb-4 overflow-hidden rounded-2xl bg-card shadow-sm">
                    <img src={communityGroupQrSrc} alt={t('about.contactWecomTitle')} className="w-full object-contain" />
                  </div>
                  <h4 className="text-[15px] font-semibold text-foreground">{t('about.contactWecomTitle')}</h4>
                  <p className="mt-2 text-[13px] text-muted-foreground">{t('about.contactWecomDesc')}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImage(wechatQr)}
                  className="group rounded-2xl border border-border/40 bg-background p-4 text-left shadow-sm transition hover:border-blue-400/60 hover:shadow-md"
                >
                  <div className="mb-4 overflow-hidden rounded-2xl bg-card shadow-sm">
                    <img src={wechatQr} alt={t('about.contactFeishuTitle')} className="w-full object-contain" />
                  </div>
                  <h4 className="text-[15px] font-semibold text-foreground">{t('about.contactFeishuTitle')}</h4>
                  <p className="mt-2 text-[13px] text-muted-foreground">{t('about.contactFeishuDesc')}</p>
                </button>
              </div>
            </div>
          </section>

          {previewImage && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm"
              onClick={() => setPreviewImage(null)}
            >
              <div className="max-h-[90vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
                <img
                  src={previewImage}
                  alt={t('about.contactTitle')}
                  className="max-h-[85vh] max-w-full rounded-2xl bg-white shadow-2xl"
                />
                <p className="mt-4 text-center text-sm text-white/85">{t('common:actions.close')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
