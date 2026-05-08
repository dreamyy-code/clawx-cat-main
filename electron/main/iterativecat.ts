import { app, BrowserWindow, nativeImage, session as electronSession, webContents } from 'electron';
import { join } from 'node:path';
import type { HostEventBus } from '../api/event-bus';
import {
  getSwitchDataSnapshot,
  readSwitchJson,
  readSwitchText,
  removeSwitchDataFile,
  writeSwitchJson,
  writeSwitchText,
} from '../utils/switch-data';
import { ITERATIVECAT_DEFAULT_BASE_URL } from '../utils/build-profile';

export const ITERATIVECAT_SERVICE_BASE_URLS = {
  iterativecat: ITERATIVECAT_DEFAULT_BASE_URL,
  xyit: 'https://xyit.iterativecat.cn',
} as const;

export type IterativeCatServiceProvider = keyof typeof ITERATIVECAT_SERVICE_BASE_URLS;

const ITERATIVECAT_LOGIN_PARTITION = 'persist:iterativecat-login';
const ITERATIVECAT_LEGACY_LOGIN_PARTITION = 'persist:iterativecat';
const monitoredIterativeCatWebContents = new Set<number>();

type IterativeCatSessionData = Record<string, unknown>;
type IterativeCatProfileData = Record<string, unknown>;

function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined;

  const iconsDir = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icons')
    : join(__dirname, '../../resources/icons');
  const iconPath = process.platform === 'win32'
    ? join(iconsDir, 'icon.ico')
    : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIterativeCatBaseUrl(raw?: string): string {
  const input = String(raw || '').trim();
  if (!input) {
    return ITERATIVECAT_SERVICE_BASE_URLS.iterativecat;
  }
  try {
    return new URL(input).origin;
  } catch {
    return ITERATIVECAT_SERVICE_BASE_URLS.iterativecat;
  }
}

function resolveBaseUrl(
  provider?: IterativeCatServiceProvider | string,
  baseUrl?: string,
): string {
  if (baseUrl) {
    return normalizeIterativeCatBaseUrl(baseUrl);
  }
  if (provider && provider in ITERATIVECAT_SERVICE_BASE_URLS) {
    return ITERATIVECAT_SERVICE_BASE_URLS[provider as IterativeCatServiceProvider];
  }
  return ITERATIVECAT_SERVICE_BASE_URLS.iterativecat;
}

function normalizeProvider(
  provider?: IterativeCatServiceProvider | string,
  baseUrl?: string,
): IterativeCatServiceProvider {
  const normalized = normalizeIterativeCatBaseUrl(baseUrl);
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    if (host === 'xyit.iterativecat.cn') {
      return 'xyit';
    }
    if (host === 'api.iterativecat.cn' || host.endsWith('.iterativecat.cn')) {
      return 'iterativecat';
    }
  } catch {
    // Ignore baseUrl parse failures and fallback to iterativecat.
  }
  if (provider === 'xyit' || provider === 'iterativecat') {
    return provider;
  }
  return 'iterativecat';
}

function buildIterativeCatUrl(baseUrl: string, pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizeIterativeCatBaseUrl(baseUrl)}${normalizedPath}`;
}

function readSessionData(): IterativeCatSessionData {
  return readSwitchJson<IterativeCatSessionData>('session', {});
}

function readProfileData(): IterativeCatProfileData | null {
  return readSwitchJson<IterativeCatProfileData | null>('profile', null);
}

function mergeSessionData(patch: Record<string, unknown>): IterativeCatSessionData {
  const current = readSessionData();
  const next = {
    ...current,
    ...patch,
    timestamp: Date.now(),
  };
  writeSwitchJson('session', next);
  return next;
}

function getCookieStringFromSession(sessionData: IterativeCatSessionData): string {
  const direct = sessionData.cookie;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const cookies = sessionData.cookies;
  if (Array.isArray(cookies)) {
    return cookies
      .map((item) => String(item || '').split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  return '';
}

function normalizeCookieString(input: string): string {
  const map = new Map<string, string>();
  for (const part of String(input || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const name = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!name) continue;
    map.set(name, value);
  }
  return Array.from(map.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function mergeCookieStrings(...values: Array<string | undefined>): string {
  return normalizeCookieString(values.filter(Boolean).join('; '));
}

function parseLoginPayload(raw: string): { raw: string; json: Record<string, unknown> | null } {
  if (!raw.trim()) {
    return { raw: '', json: null };
  }
  try {
    return { raw, json: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { raw, json: null };
  }
}

function readUploadDataAsText(uploadData: Array<{ bytes?: string | Buffer | ArrayBuffer }> | undefined): string {
  if (!Array.isArray(uploadData)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of uploadData) {
    const bytes = item?.bytes;
    if (!bytes) continue;
    if (typeof bytes === 'string') {
      parts.push(Buffer.from(bytes, 'base64').toString('utf8'));
      continue;
    }
    if (Buffer.isBuffer(bytes)) {
      parts.push(bytes.toString('utf8'));
      continue;
    }
    if (bytes instanceof ArrayBuffer) {
      parts.push(Buffer.from(bytes).toString('utf8'));
    }
  }
  return parts.join('');
}

function hasIterativeCatProfileId(payload: unknown): boolean {
  const data = payload as Record<string, unknown> | null;
  const nested = data?.data as Record<string, unknown> | undefined;
  return Boolean(
    nested?.id
    || data?.id
    || nested?.id === 0
    || data?.id === 0,
  );
}

function persistProfileIfValid(content: string, source: string): boolean {
  if (!content.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!hasIterativeCatProfileId(parsed)) {
      return false;
    }
    writeSwitchText('profile', content);
    mergeSessionData({
      user_profile_raw: content,
      login_response_raw: content,
      user_profile: parsed,
      login_response: parsed,
      last_login: Date.now(),
      last_profile_source: source,
    });
    return true;
  } catch {
    return false;
  }
}

async function captureLoginResponseWithRetry(target: Electron.WebContents, requestId: string, source: string): Promise<boolean> {
  const waitPlan = [0, 120, 260, 420];
  for (const waitMs of waitPlan) {
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    try {
      const response = await target.debugger.sendCommand('Network.getResponseBody', { requestId }) as {
        body: string;
        base64Encoded?: boolean;
      };
      const content = response.base64Encoded
        ? Buffer.from(response.body, 'base64').toString('utf8')
        : response.body;
      if (persistProfileIfValid(content, source)) {
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('No data found') || message.includes('Network.getResponseBody')) {
        continue;
      }
    }
  }
  return false;
}

async function captureCookiesFromWebContents(target: Electron.WebContents, baseUrl: string): Promise<boolean> {
  try {
    const cookies = await target.session.cookies.get({
      url: normalizeIterativeCatBaseUrl(baseUrl),
    });
    const cookieString = normalizeCookieString(
      cookies
        .map((item) => `${item.name}=${item.value}`)
        .join('; '),
    );
    if (!cookieString) {
      return false;
    }
    mergeSessionData({
      cookie: cookieString,
      cookies: cookies.map((item) => `${item.name}=${item.value}`),
      last_set_cookie_at: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

function setupIterativeCatLoginMonitor(
  target: Electron.WebContents,
  baseUrl: string,
  eventBus?: HostEventBus | null,
): void {
  if (monitoredIterativeCatWebContents.has(target.id)) {
    return;
  }
  monitoredIterativeCatWebContents.add(target.id);

  const pendingLoginRequestIds = new Set<string>();

  target.on('destroyed', () => {
    monitoredIterativeCatWebContents.delete(target.id);
  });

  try {
    if (!target.debugger.isAttached()) {
      target.debugger.attach('1.3');
    }
    void target.debugger.sendCommand('Network.enable');
    target.debugger.on('message', async (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const requestUrl = params?.request?.url;
        if (typeof requestUrl === 'string' && requestUrl.startsWith(buildIterativeCatUrl(baseUrl, '/api/user/login'))) {
          pendingLoginRequestIds.add(String(params.requestId));
        }
      }

      if (method === 'Network.loadingFinished') {
        const requestId = String(params?.requestId || '');
        if (!pendingLoginRequestIds.has(requestId)) {
          return;
        }
        pendingLoginRequestIds.delete(requestId);

        await captureCookiesFromWebContents(target, baseUrl);
        const ok = await captureLoginResponseWithRetry(target, requestId, 'embedded:webview-login');
        if (ok) {
          emitLoginSuccess(eventBus);
          return;
        }

        const fetched = await fetchProfileFromMain(baseUrl);
        if (fetched) {
          emitLoginSuccess(eventBus);
        }
      }
    });
  } catch {
    // Best-effort monitor; user can still click force-check-login to refresh status.
  }
}

function readIterativeCatAccessToken(sessionData: IterativeCatSessionData): string {
  const profile = sessionData.user_profile as Record<string, unknown> | undefined;
  const profileData = profile?.data as Record<string, unknown> | undefined;
  const loginResponse = sessionData.login_response as Record<string, unknown> | undefined;
  const loginResponseData = loginResponse?.data as Record<string, unknown> | undefined;

  const candidates = [
    sessionData.access_token,
    sessionData.token,
    profileData?.access_token,
    loginResponseData?.access_token,
    profile?.access_token,
    loginResponse?.access_token,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim();
    }
  }
  return '';
}

async function getRuntimeIterativeCatCookie(baseUrl: string): Promise<string> {
  try {
    const cookies = await electronSession.fromPartition(ITERATIVECAT_LOGIN_PARTITION).cookies.get({
      url: normalizeIterativeCatBaseUrl(baseUrl),
    });
    return normalizeCookieString(
      cookies
        .map((item) => `${item.name}=${item.value}`)
        .join('; '),
    );
  } catch {
    return '';
  }
}

function pickIterativeCatUserId(
  profile: IterativeCatProfileData | null,
  sessionData: IterativeCatSessionData,
): string {
  const profileData = (profile?.data ?? null) as Record<string, unknown> | null;
  const sessionProfile = (sessionData.user_profile ?? null) as Record<string, unknown> | null;
  const sessionProfileData = (sessionProfile?.data ?? null) as Record<string, unknown> | null;
  const loginResponse = (sessionData.login_response ?? null) as Record<string, unknown> | null;
  const loginResponseData = (loginResponse?.data ?? null) as Record<string, unknown> | null;

  const candidates = [
    profileData?.id,
    profile?.id,
    sessionProfileData?.id,
    loginResponseData?.id,
    sessionProfile?.id,
    loginResponse?.id,
    sessionData.user_id,
  ];
  for (const item of candidates) {
    if (item === 0) return '0';
    if (item) return String(item);
  }
  return '';
}

function hasFreshIterativeCatLoginState(
  sessionData: IterativeCatSessionData,
  since?: number,
): boolean {
  if (!since || !Number.isFinite(since) || since <= 0) {
    return true;
  }
  const candidates = [
    sessionData.timestamp,
    sessionData.last_set_cookie_at,
    sessionData.last_login_api_request_at,
    sessionData.last_profile_fetch_at,
    sessionData.last_login,
  ];
  return candidates.some((value) => typeof value === 'number' && Number.isFinite(value) && value >= since);
}

async function fetchProfileFromMain(baseUrl: string): Promise<boolean> {
  const sessionData = readSessionData();
  const fileCookie = getCookieStringFromSession(sessionData);
  const runtimeCookie = await getRuntimeIterativeCatCookie(baseUrl);
  const cookie = mergeCookieStrings(fileCookie, runtimeCookie);
  if (!cookie) {
    return false;
  }

  if (cookie !== fileCookie) {
    mergeSessionData({
      cookie,
      cookies: cookie
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean),
      last_set_cookie_at: Date.now(),
      last_cookie_source: runtimeCookie ? 'runtime:partition' : 'session:file',
    });
  }

  const possibleUserId = String(
    sessionData.new_api_user
    || sessionData.newApiUser
    || sessionData['new-api-user']
    || '',
  ).trim();

  const endpoints = [
    buildIterativeCatUrl(baseUrl, '/api/user/profile'),
    buildIterativeCatUrl(baseUrl, '/api/user/self'),
    buildIterativeCatUrl(baseUrl, '/api/user/status'),
  ];

  for (const url of endpoints) {
    try {
      const headers: Record<string, string> = {
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ClawX/1.0',
        Referer: `${normalizeIterativeCatBaseUrl(baseUrl)}/`,
      };
      if (possibleUserId) {
        headers['new-api-user'] = possibleUserId;
        headers['New-Api-User'] = possibleUserId;
      }

      const response = await fetch(url, { method: 'GET', headers });
      const text = await response.text();
      if (response.ok && persistProfileIfValid(text, 'main:fetch-profile')) {
        mergeSessionData({
          last_profile_fetch_url: url,
          last_profile_fetch_status: response.status,
          last_profile_fetch_at: Date.now(),
        });
        return true;
      }
    } catch {
      // Ignore endpoint-level failures and try the next one.
    }
  }

  return false;
}

function emitLoginSuccess(eventBus?: HostEventBus | null): void {
  eventBus?.emit('integration:iterativecat-login-success', { success: true, at: Date.now() });
}

export async function clearIterativeCatLoginState(): Promise<{ resetAt: number }> {
  const resetAt = Date.now();
  removeSwitchDataFile('session');
  removeSwitchDataFile('profile');
  removeSwitchDataFile('userId');
  const partitions = [ITERATIVECAT_LOGIN_PARTITION, ITERATIVECAT_LEGACY_LOGIN_PARTITION];
  await Promise.all(partitions.map(async (partition) => {
    const targetSession = electronSession.fromPartition(partition);
    await targetSession.clearStorageData();
    await targetSession.clearCache();
  }));
  return { resetAt };
}

export async function openIterativeCatLoginWindow(options?: {
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
  eventBus?: HostEventBus | null;
}): Promise<{ success: boolean; profileReady: boolean }> {
  const baseUrl = resolveBaseUrl(options?.provider, options?.baseUrl);
  await clearIterativeCatLoginState();

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1080,
      height: 820,
      title: '迭代猫登录',
      autoHideMenuBar: true,
      icon: getAppIcon(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: ITERATIVECAT_LOGIN_PARTITION,
      },
    });

    let settled = false;
    let foundSession = false;
    let foundProfile = false;
    const pendingLoginRequestIds = new Set<string>();
    const loginFilter = { urls: [buildIterativeCatUrl(baseUrl, '/api/user/login*')] };

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ success, profileReady: foundProfile });
    };

    const maybeFinish = () => {
      if (foundSession && foundProfile) {
        emitLoginSuccess(options?.eventBus);
        if (!win.isDestroyed()) {
          win.close();
        }
        finish(true);
      }
    };

    win.on('closed', () => {
      finish(foundSession || foundProfile);
    });

    win.webContents.session.webRequest.onBeforeRequest(loginFilter, (details, callback) => {
      try {
        if (String(details.method || '').toUpperCase() === 'POST') {
          const bodyText = readUploadDataAsText(details.uploadData);
          if (bodyText) {
            const parsed = parseLoginPayload(bodyText);
            const json = parsed.json ?? undefined;
            mergeSessionData({
              login_request_raw: parsed.raw,
              login_request: json,
              last_login_api_request_url: details.url,
              last_login_api_request_at: Date.now(),
            });
          }
        }
      } catch {
        // Ignore capture failures.
      }
      callback({});
    });

    win.webContents.session.webRequest.onHeadersReceived(loginFilter, (details, callback) => {
      try {
        const responseHeaders = details.responseHeaders ?? {};
        const setCookie = responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'];
        const setCookieList = Array.isArray(setCookie) ? setCookie : [];
        if (setCookieList.length > 0) {
          const cookieString = setCookieList
            .map((item) => String(item || '').split(';')[0].trim())
            .filter(Boolean)
            .join('; ');
          if (cookieString) {
            foundSession = true;
            mergeSessionData({
              cookie: cookieString,
              cookies: setCookieList,
              last_response_url: details.url,
              last_response_status: details.statusCode,
              last_set_cookie_at: Date.now(),
            });
            maybeFinish();
          }
        }
      } catch {
        // Ignore cookie capture failures.
      }
      callback({ responseHeaders: details.responseHeaders });
    });

    try {
      if (!win.webContents.debugger.isAttached()) {
        win.webContents.debugger.attach('1.3');
      }
      void win.webContents.debugger.sendCommand('Network.enable');
      win.webContents.debugger.on('message', async (_event, method, params) => {
        if (method === 'Network.requestWillBeSent') {
          const requestUrl = params?.request?.url;
          if (typeof requestUrl === 'string' && requestUrl.startsWith(buildIterativeCatUrl(baseUrl, '/api/user/login'))) {
            pendingLoginRequestIds.add(String(params.requestId));
          }
        }

        if (method === 'Network.loadingFinished') {
          const requestId = String(params?.requestId || '');
          if (!pendingLoginRequestIds.has(requestId)) {
            return;
          }
          pendingLoginRequestIds.delete(requestId);
          const ok = await captureLoginResponseWithRetry(win.webContents, requestId, 'standalone:login-api');
          if (ok) {
            foundProfile = true;
            maybeFinish();
          }
        }
      });
    } catch {
      // The debugger is best-effort; cookies alone may still allow follow-up fetches.
    }

    void win.webContents.session.clearStorageData()
      .catch(() => undefined)
      .finally(() => {
        void win.loadURL(buildIterativeCatUrl(baseUrl, '/login'));
      });
  });
}

export async function generateIterativeCatKey(options?: {
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
}): Promise<string> {
  const baseUrl = resolveBaseUrl(options?.provider, options?.baseUrl);
  const sessionData = readSessionData();
  if (Object.keys(sessionData).length === 0) {
    throw new Error('未找到登录会话，请先完成迭代猫登录');
  }

  let profile = readProfileData();
  if (!profile) {
    await fetchProfileFromMain(baseUrl);
    profile = readProfileData();
  }

  let userId = pickIterativeCatUserId(profile, sessionData);
  const fileCookie = getCookieStringFromSession(sessionData);
  const runtimeCookie = await getRuntimeIterativeCatCookie(baseUrl);
  const cookie = mergeCookieStrings(fileCookie, runtimeCookie);
  const accessToken = readIterativeCatAccessToken(sessionData);

  if (!userId) {
    throw new Error('未找到用户 ID，请重新登录迭代猫');
  }
  if (!cookie && !accessToken) {
    throw new Error('未找到有效登录会话(Cookie/Token)，请重新登录');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ClawX/1.0',
    Origin: normalizeIterativeCatBaseUrl(baseUrl),
    Referer: `${normalizeIterativeCatBaseUrl(baseUrl)}/api/token/`,
    'new-api-user': userId,
  };
  if (cookie) {
    headers.Cookie = cookie;
  } else if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const probeResponse = await fetch(`${normalizeIterativeCatBaseUrl(baseUrl)}/api/user/self`, {
      method: 'GET',
      headers,
    });
    const probeText = await probeResponse.text();
    if (probeResponse.ok) {
      try {
        const probeJson = JSON.parse(probeText) as Record<string, unknown>;
        const probeData = probeJson.data as Record<string, unknown> | undefined;
        const serverId = probeData?.id ?? probeJson.id;
        if (serverId || serverId === 0) {
          userId = String(serverId);
          headers['new-api-user'] = userId;
        }
      } catch {
        // Ignore probe parse failures.
      }
    }
  } catch {
    // Ignore probe failures and continue with the captured session.
  }

  const requestBody = JSON.stringify({
    remain_quota: 50_000_000,
    expired_time: -1,
    unlimited_quota: false,
    model_limits_enabled: false,
    model_limits: '',
    group: 'auto',
    mj_image_mode: 'default',
    mj_custom_proxy: '',
    selected_groups: ['auto'],
    name: 'ClawX 访问秘钥',
    allow_ips: '',
  });

  const response = await fetch(`${normalizeIterativeCatBaseUrl(baseUrl)}/api/token/`, {
    method: 'POST',
    headers,
    body: requestBody,
  });
  const text = await response.text();

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`创建访问秘钥失败，响应不是有效 JSON: ${text.slice(0, 120)}`);
  }

  const data = json.data as Record<string, unknown> | string | undefined;
  const token = typeof data === 'string'
    ? data.trim()
    : (typeof data?.key === 'string' ? data.key.trim() : '');

  if (!response.ok || !token) {
    throw new Error(String(json.message || '创建访问秘钥失败'));
  }

  mergeSessionData({
    generated_api_key_masked: `${token.slice(0, 6)}...${token.slice(-4)}`,
    generated_api_key_at: Date.now(),
    service_base_url: normalizeIterativeCatBaseUrl(baseUrl),
    new_api_user: userId,
  });

  return token;
}

export async function fetchIterativeCatModels(options: {
  apiKey: string;
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
}): Promise<string[]> {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('缺少 API Key');
  }
  const baseUrl = resolveBaseUrl(options.provider, options.baseUrl);
  const normalizedBase = normalizeIterativeCatBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBase}/v1/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`获取模型列表失败: ${response.status} ${text.slice(0, 120)}`);
  }
  const json = JSON.parse(text) as { data?: Array<{ id?: string }> };
  return Array.isArray(json.data)
    ? json.data.map((item) => item?.id).filter((id): id is string => Boolean(id))
    : [];
}

export function getIterativeCatStatus(options?: {
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
  since?: number;
}) {
  const baseUrl = resolveBaseUrl(options?.provider, options?.baseUrl);
  const sessionData = readSessionData();
  const profile = readProfileData();
  const cookie = getCookieStringFromSession(sessionData);
  const accessToken = readIterativeCatAccessToken(sessionData);
  const userId = pickIterativeCatUserId(profile, sessionData);
  const freshLogin = hasFreshIterativeCatLoginState(sessionData, options?.since);

  return {
    serviceBaseUrl: baseUrl,
    provider: options?.provider || 'iterativecat',
    data: getSwitchDataSnapshot(),
    hasSession: Object.keys(sessionData).length > 0,
    hasProfile: Boolean(profile),
    hasCookie: Boolean(cookie),
    hasAccessToken: Boolean(accessToken),
    hasUserId: Boolean(userId),
    profileReady: Boolean(profile && userId && freshLogin),
    loggedIn: Boolean((cookie || accessToken) && profile && userId && freshLogin),
    freshLogin,
    sessionData,
    profile,
  };
}

export function readIterativeCatDataFiles() {
  return {
    ...getSwitchDataSnapshot(),
    session: readSessionData(),
    profile: readProfileData(),
    proxy: readSwitchJson<Record<string, unknown> | null>('proxy', null),
    version: readSwitchJson<Record<string, unknown> | null>('version', null),
    profileRaw: readSwitchText('profile'),
  };
}

export function readIterativeCatStoredRawProfile(): string | null {
  return readSwitchText('profile');
}

export async function syncIterativeCatProfile(options?: {
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
}): Promise<boolean> {
  return fetchProfileFromMain(resolveBaseUrl(options?.provider, options?.baseUrl));
}

export async function registerIterativeCatLoginWebview(options: {
  webContentsId: number;
  baseUrl?: string;
  provider?: IterativeCatServiceProvider | string;
  eventBus?: HostEventBus | null;
}): Promise<{ success: boolean }> {
  const target = webContents.fromId(options.webContentsId);
  if (!target) {
    throw new Error(`未找到 webContents: ${options.webContentsId}`);
  }
  const baseUrl = resolveBaseUrl(options.provider, options.baseUrl);
  setupIterativeCatLoginMonitor(target, baseUrl, options.eventBus);
  return { success: true };
}
