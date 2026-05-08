import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Server } from 'node:http';
import { GatewayManager } from '../gateway/manager';
import { ClawHubService } from '../gateway/clawhub';
import { HostEventBus } from '../api/event-bus';
import { getHostApiToken, startHostApiServer } from '../api/server';
import type { BridgeManagerApi, BridgeRuntimeStatus, HostApiContext } from '../api/context';
import { logger } from '../utils/logger';
import { ensureClawXContext, repairClawXOnlyBootstrapFiles } from '../utils/openclaw-workspace';
import { autoInstallCliIfNeeded, generateCompletionCache, installCompletionToProfile } from '../utils/openclaw-cli';
import { getSetting } from '../utils/store';
import { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled } from '../utils/skill-config';
import { ensureAllBundledPluginsInstalled } from '../utils/plugin-install';
import { deviceOAuthManager } from '../utils/device-oauth';
import { browserOAuthManager } from '../utils/browser-oauth';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { syncAllProviderAuthToRuntime } from '../services/providers/provider-runtime-sync';
import { deleteSessionTranscript } from './session-ops';
import { getPort } from '../utils/config';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { getOpenClawConfigDir } from '../utils/paths';
import { join, parse } from 'node:path';
import { resolveGatewayStartupProfile } from '../utils/startup-profile';

type StartupCallbacks = {
  onGatewayAutoStartError?: (message: string) => void;
  onCliInstalled?: (installedPath: string) => void;
};

export type RuntimeChatSendParams = {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey?: string;
};

export type RuntimeRpcParams = {
  method: string;
  params?: unknown;
  timeoutMs?: number;
};

export type RuntimeHostApiRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type RuntimeStagedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
};

export type RuntimeMediaItem = {
  filePath: string;
  mimeType: string;
  fileName: string;
};

export type RuntimeFileReadParams = {
  filePath: string;
  mode?: 'base64' | 'text';
  maxBytes?: number;
};

export type RuntimeFileReadResult = {
  filePath: string;
  mode: 'base64' | 'text';
  mimeType?: string;
  fileSize: number;
  base64?: string;
  text?: string;
};

export type RuntimeGatewayHttpRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export type RuntimeSessionSummary = {
  key: string;
  label?: string;
  displayName?: string;
  updatedAt?: number;
  file?: string;
  agentId: string;
  sessionId: string;
};

export type RuntimeCapabilities = {
  modeFeatures: string[];
  remoteActions: string[];
};

export class RuntimeFacade {
  readonly gatewayManager = new GatewayManager();
  readonly clawHubService = new ClawHubService();
  readonly hostEventBus = new HostEventBus();

  private hostApiServer: Server | null = null;
  private mainWindow: BrowserWindow | null = null;
  private readonly isE2EMode: boolean;
  private bridgeManager: BridgeManagerApi | null = null;
  private bridgeStatus: BridgeRuntimeStatus = {
    enabled: false,
    running: false,
    mode: 'gui',
    host: '127.0.0.1',
    port: 18989,
    allowRemote: false,
    hasToken: false,
  };

  constructor(options: { isE2EMode: boolean }) {
    this.isE2EMode = options.isE2EMode;
    this.attachHostEventBridges();
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;

    if (window && !window.isDestroyed()) {
      deviceOAuthManager.setWindow(window);
      browserOAuthManager.setWindow(window);
    }
  }

  setBridgeManager(manager: BridgeManagerApi): void {
    this.bridgeManager = manager;
  }

  setBridgeStatus(status: BridgeRuntimeStatus): void {
    this.bridgeStatus = status;
  }

  getBridgeStatus(): BridgeRuntimeStatus {
    return this.bridgeStatus;
  }

  startHostApiServer(): void {
    if (this.hostApiServer) {
      return;
    }

    const self = this;
    const ctx = {
      gatewayManager: this.gatewayManager,
      clawHubService: this.clawHubService,
      eventBus: this.hostEventBus,
      runtimeFacade: this,
      bridgeManager: this.bridgeManager!,
      get mainWindow() {
        return self.mainWindow;
      },
    } as HostApiContext;

    this.hostApiServer = startHostApiServer(ctx);
  }

  closeHostApiServer(): void {
    this.hostApiServer?.close();
    this.hostApiServer = null;
  }

  closeEventBus(): void {
    this.hostEventBus.closeAll();
  }

  getGatewayStatus(): ReturnType<GatewayManager['getStatus']> {
    return this.gatewayManager.getStatus();
  }

  private async runOptionalStartupStep(
    label: string,
    task: () => Promise<void> | void,
    timeoutMs = 12_000,
  ): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        Promise.resolve().then(task),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      logger.warn(`[startup] ${label} skipped:`, error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async startGatewayWithRetry(options?: {
    maxAttempts?: number;
    firstDelayMs?: number;
    onError?: (error: unknown, attempt: number) => void;
  }): Promise<void> {
    const maxAttempts = Math.max(1, options?.maxAttempts || 1);
    const firstDelayMs = Math.max(0, options?.firstDelayMs || 0);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1 && firstDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstDelayMs));
      }
      try {
        await this.gatewayManager.start();
        return;
      } catch (error) {
        lastError = error;
        options?.onError?.(error, attempt);
      }
    }

    throw (lastError || new Error('Gateway start failed'));
  }

  async ensureGatewayRunning(): Promise<void> {
    if (this.gatewayManager.isConnected() || this.gatewayManager.getStatus().state === 'running') {
      return;
    }

    await this.runOptionalStartupStep(
      'provider auth sync before gateway start',
      async () => {
        await syncAllProviderAuthToRuntime();
      },
      10_000,
    );
    await this.gatewayManager.start();
  }

  async startGateway(): Promise<void> {
    await this.ensureGatewayRunning();
  }

  async stopGateway(): Promise<void> {
    await this.gatewayManager.stop();
  }

  async restartGateway(): Promise<void> {
    await this.gatewayManager.restart();
  }

  async reloadGateway(): Promise<void> {
    await this.gatewayManager.reload();
  }

  async checkGatewayHealth(): Promise<{ ok: boolean; error?: string; uptime?: number }> {
    return await this.gatewayManager.checkHealth();
  }

  async rpc<T = unknown>(params: RuntimeRpcParams): Promise<T> {
    if (!params.method || !params.method.trim()) {
      throw new Error('RPC method is required');
    }
    await this.ensureGatewayRunning();
    return await this.gatewayManager.rpc<T>(params.method.trim(), params.params, params.timeoutMs);
  }

  async gatewayHttpFetch(request: RuntimeGatewayHttpRequest): Promise<{
    status: number;
    ok: boolean;
    json?: unknown;
    text?: string;
  }> {
    const status = this.gatewayManager.getStatus();
    const port = status.port || 18789;
    const path = request.path?.startsWith('/') ? request.path : '/';
    const method = (request.method || 'GET').toUpperCase();
    const timeoutMs =
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? request.timeoutMs
        : 15000;

    const token = await getSetting('gatewayToken');
    const headers: Record<string, string> = {
      ...(request.headers || {}),
    };
    if (!headers.Authorization && !headers.authorization && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let body: string | undefined;
    if (request.body !== undefined && request.body !== null) {
      body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await (async () => {
      try {
        return await proxyAwareFetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    })();

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return {
        status: response.status,
        ok: response.ok,
        json: await response.json().catch(() => undefined),
      };
    }

    return {
      status: response.status,
      ok: response.ok,
      text: await response.text().catch(() => ''),
    };
  }

  async getControlUiInfo(): Promise<{ url: string; token: string; port: number }> {
    const status = this.gatewayManager.getStatus();
    const token = await getSetting('gatewayToken');
    const port = status.port || 18789;
    return {
      url: buildOpenClawControlUiUrl(port, token),
      token,
      port,
    };
  }

  getCapabilities(): RuntimeCapabilities {
    return {
      modeFeatures: [
        'gui-host',
        'headless-host',
        'host-api',
        'bridge-websocket',
        'lan-discovery',
        'cloud-relay-client',
      ],
      remoteActions: [
        'bridge.info',
        'bridge.status.get',
        'hostapi.fetch',
        'gateway.rpc',
        'agents.list',
        'agents.create',
        'agent.update',
        'agent.delete',
        'agents.import.inspect',
        'agent.import.package',
        'agents.communication.update',
        'agent.communication.update',
        'agent.model.update',
        'agent.instructions.sync',
        'agents.instructions.syncAll',
        'models.config.get',
        'models.primary.set',
        'models.fallback.add',
        'models.fallback.remove',
        'models.providerModel.add',
        'models.providerModel.remove',
        'file.stageBuffer',
        'file.stagePaths',
        'file.read',
        'gateway.http',
        'gateway.controlUi.get',
        'gateway.status.get',
        'gateway.health.get',
        'gateway.start',
        'gateway.stop',
        'gateway.restart',
        'gateway.reload',
        'gateway.rpc',
        'chat.send',
        'chat.sendWithMedia',
        'chat.abort',
        'session.subscribe',
        'session.delete',
        'session.listLocal',
        'session.transcript.get',
        'logs.get',
        'logs.files.get',
        'logs.dir.get',
        'runtime.capabilities.get',
      ],
    };
  }

  async deleteSession(sessionKey: string): Promise<{ success: boolean; error?: string }> {
    return await deleteSessionTranscript(sessionKey);
  }

  async hostApiFetch(request: RuntimeHostApiRequest): Promise<{
    status: number;
    ok: boolean;
    json?: unknown;
    text?: string;
  }> {
    const path = typeof request.path === 'string' ? request.path : '';
    if (!path || !path.startsWith('/')) {
      throw new Error(`Invalid host API path: ${String(request.path)}`);
    }

    const method = (request.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { ...(request.headers || {}) };
    headers.Authorization = `Bearer ${getHostApiToken()}`;

    let body: string | undefined;
    if (request.body !== undefined && request.body !== null) {
      body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await proxyAwareFetch(`http://127.0.0.1:${getPort('CLAWX_HOST_API')}${path}`, {
      method,
      headers,
      body,
    });

    const result: {
      status: number;
      ok: boolean;
      json?: unknown;
      text?: string;
    } = {
      status: response.status,
      ok: response.ok,
    };

    if (response.status !== 204) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        result.json = await response.json().catch(() => undefined);
      } else {
        result.text = await response.text().catch(() => '');
      }
    }

    return result;
  }

  async stageFileBuffer(params: {
    base64: string;
    fileName: string;
    mimeType: string;
  }): Promise<RuntimeStagedFile> {
    const response = await this.hostApiFetch({
      path: '/api/files/stage-buffer',
      method: 'POST',
      body: params,
    });

    if (!response.ok || !response.json || typeof response.json !== 'object') {
      throw new Error(`Failed to stage file buffer: ${response.text || response.status}`);
    }

    return response.json as RuntimeStagedFile;
  }

  async stageFilePaths(filePaths: string[]): Promise<RuntimeStagedFile[]> {
    const response = await this.hostApiFetch({
      path: '/api/files/stage-paths',
      method: 'POST',
      body: { filePaths },
    });

    if (!response.ok || !Array.isArray(response.json)) {
      throw new Error(`Failed to stage file paths: ${response.text || response.status}`);
    }

    return response.json as RuntimeStagedFile[];
  }

  async readFile(params: RuntimeFileReadParams): Promise<RuntimeFileReadResult> {
    const filePath = params.filePath?.trim();
    if (!filePath) {
      throw new Error('filePath is required');
    }

    const mode = params.mode === 'text' ? 'text' : 'base64';
    const fsP = await import('node:fs/promises');
    const stat = await fsP.stat(filePath);
    const maxBytes = typeof params.maxBytes === 'number' && params.maxBytes > 0 ? params.maxBytes : 10 * 1024 * 1024;
    if (stat.size > maxBytes) {
      throw new Error(`File too large (${stat.size} bytes > ${maxBytes} bytes)`);
    }

    const buffer = await fsP.readFile(filePath);
    const result: RuntimeFileReadResult = {
      filePath,
      mode,
      fileSize: buffer.length,
    };

    if (mode === 'text') {
      result.text = buffer.toString('utf8');
    } else {
      result.base64 = buffer.toString('base64');
      const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : '';
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
      };
      result.mimeType = mimeMap[ext] || 'application/octet-stream';
    }

    return result;
  }

  async getSessionTranscript(agentId: string, sessionId: string): Promise<unknown> {
    const response = await this.hostApiFetch({
      path: `/api/sessions/transcript?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`,
    });

    if (!response.ok) {
      throw new Error(`Failed to load transcript: ${response.text || response.status}`);
    }

    return response.json;
  }

  async listLocalSessions(): Promise<{ sessions: RuntimeSessionSummary[] }> {
    const root = join(getOpenClawConfigDir(), 'agents');
    const fsP = await import('node:fs/promises');
    const sessions: RuntimeSessionSummary[] = [];

    let agentEntries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      agentEntries = await fsP.readdir(root, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    } catch {
      return { sessions: [] };
    }

    for (const agentEntry of agentEntries) {
      if (!agentEntry.isDirectory()) continue;
      const agentId = agentEntry.name;
      const sessionsJsonPath = join(root, agentId, 'sessions', 'sessions.json');

      try {
        const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        let list: Array<Record<string, unknown>> = [];

        if (Array.isArray(parsed.sessions)) {
          list = parsed.sessions as Array<Record<string, unknown>>;
        } else {
          for (const [sessionKey, entry] of Object.entries(parsed)) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              continue;
            }
            list.push({
              key: sessionKey,
              sessionKey,
              ...(entry as Record<string, unknown>),
            });
          }
        }

        for (const entry of list) {
          const key = typeof entry.key === 'string'
            ? entry.key
            : (typeof entry.sessionKey === 'string' ? entry.sessionKey : '');
          if (!key) continue;

          const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;
          const label = typeof entry.label === 'string' ? entry.label : undefined;
          const updatedAt = typeof entry.updatedAt === 'number'
            ? entry.updatedAt
            : (typeof entry.updatedAt === 'string' ? Date.parse(entry.updatedAt) : undefined);
          const file = typeof entry.sessionFile === 'string'
            ? entry.sessionFile
            : (typeof entry.file === 'string'
              ? entry.file
              : (typeof entry.fileName === 'string' ? entry.fileName : undefined));
          const transcriptSessionId = typeof entry.sessionId === 'string'
            ? entry.sessionId
            : (typeof entry.id === 'string' ? entry.id : undefined);
          const fileSessionId = file ? parse(file).name : undefined;
          const parts = key.split(':');
          const fallbackSessionId = parts.length >= 3 ? parts.slice(2).join(':') : key;
          const sessionId = transcriptSessionId || fileSessionId || fallbackSessionId;

          sessions.push({
            key,
            label,
            displayName,
            updatedAt: Number.isFinite(updatedAt as number) ? updatedAt as number : undefined,
            file,
            agentId,
            sessionId,
          });
        }
      } catch {
        // ignore malformed or missing session index for one agent
      }
    }

    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { sessions };
  }

  async getLogs(tailLines = 200): Promise<unknown> {
    const response = await this.hostApiFetch({
      path: `/api/logs?tailLines=${encodeURIComponent(String(tailLines))}`,
    });
    if (!response.ok) {
      throw new Error(`Failed to read logs: ${response.text || response.status}`);
    }
    return response.json;
  }

  async getLogFiles(): Promise<unknown> {
    const response = await this.hostApiFetch({
      path: '/api/logs/files',
    });
    if (!response.ok) {
      throw new Error(`Failed to list log files: ${response.text || response.status}`);
    }
    return response.json;
  }

  async getLogDir(): Promise<unknown> {
    const response = await this.hostApiFetch({
      path: '/api/logs/dir',
    });
    if (!response.ok) {
      throw new Error(`Failed to get log dir: ${response.text || response.status}`);
    }
    return response.json;
  }

  async sendChatMessage(params: RuntimeChatSendParams): Promise<{ runId?: string }> {
    const payload = {
      sessionKey: params.sessionKey,
      message: params.message,
      deliver: params.deliver ?? false,
      idempotencyKey: params.idempotencyKey || randomUUID(),
    };

    await this.ensureGatewayRunning();
    return await this.gatewayManager.rpc<{ runId?: string }>('chat.send', payload, 120_000);
  }

  async sendChatMessageWithMedia(params: RuntimeChatSendParams & {
    media: RuntimeMediaItem[];
  }): Promise<{ runId?: string }> {
    await this.ensureGatewayRunning();

    let message = params.message;
    const imageAttachments: Array<Record<string, unknown>> = [];
    const fileReferences: string[] = [];
    const visionMimeTypes = new Set([
      'image/png', 'image/jpeg', 'image/bmp', 'image/webp',
    ]);

    if (params.media.length > 0) {
      const fsP = await import('node:fs/promises');
      for (const media of params.media) {
        fileReferences.push(
          `[media attached: ${media.filePath} (${media.mimeType}) | ${media.filePath}]`,
        );

        if (visionMimeTypes.has(media.mimeType)) {
          const fileBuffer = await fsP.readFile(media.filePath);
          imageAttachments.push({
            content: fileBuffer.toString('base64'),
            mimeType: media.mimeType,
            fileName: media.fileName,
          });
        }
      }
    }

    if (fileReferences.length > 0) {
      const refs = fileReferences.join('\n');
      message = message ? `${message}\n\n${refs}` : refs;
    }

    const rpcParams: Record<string, unknown> = {
      sessionKey: params.sessionKey,
      message,
      deliver: params.deliver ?? false,
      idempotencyKey: params.idempotencyKey || randomUUID(),
    };

    if (imageAttachments.length > 0) {
      rpcParams.attachments = imageAttachments;
    }

    return await this.gatewayManager.rpc<{ runId?: string }>('chat.send', rpcParams, 120_000);
  }

  async abortChat(sessionKey: string): Promise<unknown> {
    await this.ensureGatewayRunning();
    return await this.gatewayManager.rpc('chat.abort', { sessionKey });
  }

  async runBackgroundStartupTasks(callbacks: StartupCallbacks = {}): Promise<void> {
    const { onGatewayAutoStartError, onCliInstalled } = callbacks;
    let startupProfile = resolveGatewayStartupProfile({
      platform: process.platform,
      preference: undefined,
      envProfile: process.env.CLAWX_STARTUP_PROFILE,
      argv: process.argv,
    });
    try {
      startupProfile = resolveGatewayStartupProfile({
        platform: process.platform,
        preference: await getSetting('gatewayStartupProfile'),
        envProfile: process.env.CLAWX_STARTUP_PROFILE,
        argv: process.argv,
      });
    } catch (error) {
      logger.warn('[startup] Failed to read gatewayStartupProfile from settings, fallback to default policy:', error);
    }
    const isServerLite = startupProfile === 'server-lite';
    logger.info(`Startup profile resolved: ${startupProfile}`);

    if (!this.isE2EMode && !isServerLite) {
      void repairClawXOnlyBootstrapFiles().catch((error) => {
        logger.warn('Failed to repair bootstrap files:', error);
      });
      void ensureBuiltinSkillsInstalled().catch((error) => {
        logger.warn('Failed to install built-in skills:', error);
      });
      void ensurePreinstalledSkillsInstalled().catch((error) => {
        logger.warn('Failed to install preinstalled skills:', error);
      });
      void ensureAllBundledPluginsInstalled().catch((error) => {
        logger.warn('Failed to install/upgrade bundled plugins:', error);
      });
    } else if (isServerLite) {
      logger.info('Server-lite startup: skipping skills/plugins/bootstrap prewarm tasks');
    }

    let gatewayAutoStart = true;
    try {
      gatewayAutoStart = Boolean(await getSetting('gatewayAutoStart'));
    } catch (error) {
      logger.warn('[startup] Failed to read gatewayAutoStart from settings, fallback to enabled:', error);
    }
    const shouldForceGatewayOnLinux = process.platform === 'linux';
    const shouldAutoStartGateway = shouldForceGatewayOnLinux || gatewayAutoStart;

    if (!this.isE2EMode && shouldAutoStartGateway) {
      try {
        await this.runOptionalStartupStep(
          'provider auth sync before gateway auto-start',
          async () => {
            await syncAllProviderAuthToRuntime();
          },
          10_000,
        );
        logger.debug('Auto-starting Gateway...');
        await this.startGatewayWithRetry({
          maxAttempts: shouldForceGatewayOnLinux ? 2 : 1,
          firstDelayMs: 1200,
          onError: (error, attempt) => {
            logger.warn(`[startup] Gateway auto-start attempt ${attempt} failed:`, error);
          },
        });
        logger.info('Gateway auto-start succeeded');
      } catch (error) {
        logger.error('Gateway auto-start failed:', error);
        onGatewayAutoStartError?.(String(error));
      }
    } else if (this.isE2EMode) {
      logger.info('Gateway auto-start skipped in E2E mode');
    } else {
      logger.info('Gateway auto-start disabled in settings');
    }

    if (!this.isE2EMode && !isServerLite) {
      void ensureClawXContext().catch((error) => {
        logger.warn('Failed to merge ClawX context into workspace:', error);
      });
      void autoInstallCliIfNeeded((installedPath) => {
        onCliInstalled?.(installedPath);
      }).then(() => {
        generateCompletionCache();
        installCompletionToProfile();
      }).catch((error) => {
        logger.warn('CLI auto-install failed:', error);
      });
    } else if (isServerLite) {
      logger.info('Server-lite startup: skipping context merge and CLI auto-install');
    }
  }

  private attachHostEventBridges(): void {
    this.gatewayManager.on('status', (status: { state: string }) => {
      this.hostEventBus.emit('gateway:status', status);
      if (status.state === 'running' && !this.isE2EMode) {
        void ensureClawXContext().catch((error) => {
          logger.warn('Failed to re-merge ClawX context after gateway reconnect:', error);
        });
      }
    });

    this.gatewayManager.on('error', (error) => {
      this.hostEventBus.emit('gateway:error', { message: error.message });
    });

    this.gatewayManager.on('notification', (notification) => {
      this.hostEventBus.emit('gateway:notification', notification);
    });

    this.gatewayManager.on('chat:message', (data) => {
      this.hostEventBus.emit('gateway:chat-message', data);
    });

    this.gatewayManager.on('channel:status', (data) => {
      this.hostEventBus.emit('gateway:channel-status', data);
    });

    this.gatewayManager.on('exit', (code) => {
      this.hostEventBus.emit('gateway:exit', { code });
    });

    deviceOAuthManager.on('oauth:code', (payload) => {
      this.hostEventBus.emit('oauth:code', payload);
    });

    deviceOAuthManager.on('oauth:start', (payload) => {
      this.hostEventBus.emit('oauth:start', payload);
    });

    deviceOAuthManager.on('oauth:success', (payload) => {
      this.hostEventBus.emit('oauth:success', { ...payload, success: true });
    });

    deviceOAuthManager.on('oauth:error', (error) => {
      this.hostEventBus.emit('oauth:error', error);
    });

    browserOAuthManager.on('oauth:start', (payload) => {
      this.hostEventBus.emit('oauth:start', payload);
    });

    browserOAuthManager.on('oauth:code', (payload) => {
      this.hostEventBus.emit('oauth:code', payload);
    });

    browserOAuthManager.on('oauth:success', (payload) => {
      this.hostEventBus.emit('oauth:success', { ...payload, success: true });
    });

    browserOAuthManager.on('oauth:error', (error) => {
      this.hostEventBus.emit('oauth:error', error);
    });

    whatsAppLoginManager.on('qr', (data) => {
      this.hostEventBus.emit('channel:whatsapp-qr', data);
    });

    whatsAppLoginManager.on('success', (data) => {
      this.hostEventBus.emit('channel:whatsapp-success', data);
    });

    whatsAppLoginManager.on('error', (error) => {
      this.hostEventBus.emit('channel:whatsapp-error', error);
    });
  }
}
