import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  default: {
    exec: mockExec,
  },
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  importAgentPackage: vi.fn(),
  importAgentPackageIntoAgent: vi.fn(),
  inspectAgentPackage: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentName: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAgentModelOverrideToRuntime: vi.fn(),
  syncAllProviderAuthToRuntime: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('restartGatewayForAgentDeletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy on Windows when gateway pid is known', async () => {
    setPlatform('win32');
    const { restartGatewayForAgentDeletion } = await import('@electron/api/routes/agents');

    const restart = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn(() => ({ pid: 4321, port: 18789 }));

    await restartGatewayForAgentDeletion({
      gatewayManager: {
        getStatus,
        restart,
      },
    } as never);

    expect(mockExec).toHaveBeenCalledWith(
      'taskkill /F /PID 4321 /T',
      expect.any(Function),
    );
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('handleAgentRoutes import endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('imports an agent package and schedules gateway reload', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');
    const { parseJsonBody, sendJson } = await import('@electron/api/route-utils');
    const { importAgentPackage } = await import('@electron/utils/agent-config');
    const { syncAllProviderAuthToRuntime, syncAgentModelOverrideToRuntime } = await import('@electron/services/providers/provider-runtime-sync');

    vi.mocked(parseJsonBody).mockResolvedValue({
      name: 'mydemo',
      zipPath: 'C:\\demo.zip',
    });
    vi.mocked(importAgentPackage).mockResolvedValue({
      agentId: 'mydemo',
      snapshot: {
        agents: [],
        defaultAgentId: 'main',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
        communication: {
          enabled: false,
          visibility: 'all',
          allowedAgents: [],
          diagnostics: [],
          topology: [],
          readyState: 'ready',
          networkAgentCount: 0,
          dispatchRelationCount: 0,
          outdatedInstructionCount: 0,
        },
      },
    });
    vi.mocked(syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
    vi.mocked(syncAgentModelOverrideToRuntime).mockResolvedValue(undefined);

    const debouncedReload = vi.fn();
    const handled = await handleAgentRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents/import'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(importAgentPackage).toHaveBeenCalledWith('mydemo', 'C:\\demo.zip');
    expect(syncAgentModelOverrideToRuntime).toHaveBeenCalledWith('mydemo');
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true, importedAgentId: 'mydemo' }),
    );
  });
});
