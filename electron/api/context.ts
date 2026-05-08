import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from './event-bus';
import type { RuntimeFacade } from '../runtime/runtime-facade';

export interface BridgeDiscoveryStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  serviceName: string;
  addresses: string[];
  lastProbeAt?: number;
  lastAnnounceAt?: number;
}

export interface BridgeRelayStatus {
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
}

export interface HttpBridgeRuntimeStatus {
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
}

export interface BridgeRuntimeStatus {
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
  discovery?: BridgeDiscoveryStatus;
  relay?: BridgeRelayStatus;
  http?: HttpBridgeRuntimeStatus;
}

export interface BridgeAuditEntry {
  id: string;
  ts: number;
  level: 'info' | 'warning' | 'error';
  event: string;
  clientId?: string;
  remoteAddress?: string;
  requestId?: string;
  action?: string;
  details?: string;
}

export interface BridgeManagerApi {
  getStatus: () => Promise<BridgeRuntimeStatus>;
  getConfig: () => Promise<Record<string, unknown>>;
  start: () => Promise<BridgeRuntimeStatus>;
  stop: () => Promise<BridgeRuntimeStatus>;
  restart: () => Promise<BridgeRuntimeStatus>;
  updateConfig: (patch: Record<string, unknown>) => Promise<BridgeRuntimeStatus>;
  regenerateToken: () => Promise<{ token: string; status: BridgeRuntimeStatus }>;
  getAuditLog: () => Promise<BridgeAuditEntry[]>;
  clearAuditLog: () => Promise<{ success: true }>;
}

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
  runtimeFacade: RuntimeFacade;
  bridgeManager: BridgeManagerApi;
}
