import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import type { BridgeDiscoveryStatus } from '../api/context';
import { logger } from '../utils/logger';

type LanDiscoveryOptions = {
  enabled: boolean;
  port: number;
  serviceName: string;
  getAnnouncement: () => Record<string, unknown>;
  onStatusChange?: (status: BridgeDiscoveryStatus) => void;
  announceIntervalMs?: number;
};

function getLocalIpv4Addresses(): string[] {
  const values = Object.values(networkInterfaces());
  const result = new Set<string>();

  for (const entries of values) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        result.add(entry.address);
      }
    }
  }

  return Array.from(result).sort();
}

function parseProbeMessage(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === 'clawx.discovery.probe') {
    return true;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed.type === 'clawx.discovery.probe';
  } catch {
    return false;
  }
}

export class LanDiscoveryService {
  private readonly options: LanDiscoveryOptions;
  private socket: Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private status: BridgeDiscoveryStatus;

  constructor(options: LanDiscoveryOptions) {
    this.options = options;
    this.status = {
      enabled: options.enabled,
      running: false,
      port: options.port,
      serviceName: options.serviceName,
      addresses: getLocalIpv4Addresses(),
    };
  }

  getStatus(): BridgeDiscoveryStatus {
    return {
      ...this.status,
      addresses: [...this.status.addresses],
    };
  }

  start(): void {
    if (!this.options.enabled || this.socket) {
      return;
    }

    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('error', (error) => {
      logger.warn(`LAN discovery socket error: ${String(error)}`);
      this.status = {
        ...this.status,
        running: false,
      };
      this.emitStatus();
    });

    socket.on('listening', () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // Ignore environments that do not allow broadcast mode.
      }
      this.status = {
        ...this.status,
        running: true,
        addresses: getLocalIpv4Addresses(),
      };
      this.emitStatus();
      void this.broadcastAnnouncement();
      this.announceTimer = setInterval(() => {
        void this.broadcastAnnouncement();
      }, this.options.announceIntervalMs ?? 15_000);
      this.announceTimer.unref();
    });

    socket.on('message', (buffer, remote) => {
      void this.handleMessage(buffer.toString('utf8'), remote);
    });

    socket.bind(this.options.port, '0.0.0.0');
  }

  close(): void {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close failures.
      }
      this.socket = null;
    }

    this.status = {
      ...this.status,
      running: false,
      addresses: getLocalIpv4Addresses(),
    };
    this.emitStatus();
  }

  private async handleMessage(raw: string, remote: RemoteInfo): Promise<void> {
    if (!parseProbeMessage(raw) || !this.socket) {
      return;
    }

    this.status = {
      ...this.status,
      lastProbeAt: Date.now(),
      addresses: getLocalIpv4Addresses(),
    };
    this.emitStatus();

    const payload = Buffer.from(JSON.stringify({
      type: 'clawx.discovery.announcement',
      ts: Date.now(),
      serviceName: this.options.serviceName,
      transport: 'ws',
      addresses: getLocalIpv4Addresses(),
      ...this.options.getAnnouncement(),
    }));

    try {
      this.socket.send(payload, remote.port, remote.address);
    } catch (error) {
      logger.warn(`Failed to respond to LAN discovery probe from ${remote.address}: ${String(error)}`);
    }
  }

  private async broadcastAnnouncement(): Promise<void> {
    if (!this.socket || !this.status.running) {
      return;
    }

    const payload = Buffer.from(JSON.stringify({
      type: 'clawx.discovery.announcement',
      ts: Date.now(),
      serviceName: this.options.serviceName,
      transport: 'ws',
      addresses: getLocalIpv4Addresses(),
      ...this.options.getAnnouncement(),
    }));

    try {
      this.socket.send(payload, this.options.port, '255.255.255.255');
      this.status = {
        ...this.status,
        lastAnnounceAt: Date.now(),
        addresses: getLocalIpv4Addresses(),
      };
      this.emitStatus();
    } catch (error) {
      logger.warn(`Failed to broadcast LAN discovery announcement: ${String(error)}`);
    }
  }

  private emitStatus(): void {
    this.options.onStatusChange?.(this.getStatus());
  }
}
