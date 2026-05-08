import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentModelMock = vi.fn();
const updateCommunicationMock = vi.fn();
const updateAgentCommunicationMock = vi.fn();
const syncAgentInstructionsMock = vi.fn();
const syncAllAgentInstructionsMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();
const importAgentPackageMock = vi.fn();
const inspectImportAgentPackageMock = vi.fn();

const { gatewayState, agentsState, providersState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    communication: {
      enabled: false,
      visibility: 'all',
      allowedAgents: [] as string[],
      diagnostics: [] as Array<Record<string, unknown>>,
      topology: [] as Array<Record<string, unknown>>,
      readyState: 'ready',
      networkAgentCount: 0,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 0,
    },
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    updateAgent: typeof updateAgentMock;
    updateAgentModel: typeof updateAgentModelMock;
    updateCommunication: typeof updateCommunicationMock;
    updateAgentCommunication: typeof updateAgentCommunicationMock;
    syncAgentInstructions: typeof syncAgentInstructionsMock;
    syncAllAgentInstructions: typeof syncAllAgentInstructionsMock;
    inspectImportAgentPackage: typeof inspectImportAgentPackageMock;
    importAgentPackage: typeof importAgentPackageMock;
    createAgent: ReturnType<typeof vi.fn>;
    deleteAgent: ReturnType<typeof vi.fn>;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      updateAgent: updateAgentMock,
      updateAgentModel: updateAgentModelMock,
      updateCommunication: updateCommunicationMock,
      updateAgentCommunication: updateAgentCommunicationMock,
      syncAgentInstructions: syncAgentInstructionsMock,
      syncAllAgentInstructions: syncAllAgentInstructionsMock,
      inspectImportAgentPackage: inspectImportAgentPackageMock,
      importAgentPackage: importAgentPackageMock,
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.communication = {
      enabled: false,
      visibility: 'all',
      allowedAgents: [],
      diagnostics: [],
      topology: [],
      readyState: 'ready',
      networkAgentCount: 0,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 0,
    };
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    fetchAgentsMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    updateCommunicationMock.mockResolvedValue(undefined);
    updateAgentCommunicationMock.mockResolvedValue(undefined);
    syncAgentInstructionsMock.mockResolvedValue(undefined);
    syncAllAgentInstructionsMock.mockResolvedValue(undefined);
    inspectImportAgentPackageMock.mockResolvedValue({
      sourceAgents: ['main'],
      sourceWorkspaces: ['workspace'],
      defaultMappings: [{ sourceAgentDirName: 'main', sourceWorkspaceDirName: 'workspace', suggestedName: 'main' }],
    });
    importAgentPackageMock.mockResolvedValue({ importedAgentIds: ['imported-agent'] });
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    hostApiFetchMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Agents />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('uses "Use default model" as form fill only and disables it when already default', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
        inCommunicationNetwork: false,
        spawnTargets: [],
        instructionPreview: 'preview',
        instructionSyncStatus: 'missing',
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      { id: 'openrouter', name: 'OpenRouter', modelIdPlaceholder: 'anthropic/claude-opus-4.6' },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByTitle('settings')[0]);
    fireEvent.click(screen.getAllByText('settingsDialog.modelLabel').at(-1)?.closest('button') as HTMLButtonElement);

    const useDefaultButton = await screen.findByRole('button', { name: 'settingsDialog.useDefaultModel' });
    const modelIdInput = screen.getByLabelText('settingsDialog.modelIdLabel');
    const saveButton = screen.getAllByRole('button', { name: 'common:actions.save' }).at(-1) as HTMLButtonElement;

    expect(useDefaultButton).toBeDisabled();

    fireEvent.change(modelIdInput, { target: { value: 'anthropic/claude-sonnet-4.5' } });
    expect(useDefaultButton).toBeEnabled();
    expect(saveButton).toBeEnabled();

    fireEvent.click(useDefaultButton);

    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect((modelIdInput as HTMLInputElement).value).toBe('anthropic/claude-opus-4.6');
    expect(useDefaultButton).toBeDisabled();
  });

  it('keeps the last agent snapshot visible while a refresh is in flight', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        inCommunicationNetwork: false,
        spawnTargets: [],
        instructionPreview: 'preview',
        instructionSyncStatus: 'missing',
      },
    ];

    const { rerender } = render(<Agents />);

    expect((await screen.findAllByRole('heading', { name: 'Main' }))[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'layout.viewDetails' })).toBeInTheDocument();

    agentsState.loading = true;
    await act(async () => {
      rerender(<Agents />);
    });

    expect(screen.getAllByRole('heading', { name: 'Main' })[0]).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows selected agent summary and view-details action in the list card', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'preview',
        instructionSyncStatus: 'synced',
      },
      {
        id: 'coding',
        name: 'Coding',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-coding',
        agentDir: '~/.openclaw/agents/coding/agent',
        mainSessionKey: 'agent:coding:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'coding-preview',
        instructionSyncStatus: 'synced',
      },
    ];
    agentsState.communication = {
      enabled: true,
      visibility: 'all',
      allowedAgents: ['main', 'coding'],
      diagnostics: [],
      topology: [
        {
          agentId: 'main',
          name: 'Main',
          inNetwork: true,
          reachableAgents: ['coding'],
          spawnTargets: [],
          instructionSyncStatus: 'synced',
        },
        {
          agentId: 'coding',
          name: 'Coding',
          inNetwork: true,
          reachableAgents: ['main'],
          spawnTargets: [],
          instructionSyncStatus: 'synced',
        },
      ],
      readyState: 'ready',
      networkAgentCount: 2,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 0,
    };

    render(<Agents />);

    expect(await screen.findByText('layout.selectedAgentLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'layout.viewDetails' })).toBeInTheDocument();
  });

  it('injects main into network member choices even when the agent list does not include main', async () => {
    agentsState.agents = [
      {
        id: 'douyin-monitor',
        name: 'douyin-monitor',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-douyin-monitor',
        agentDir: '~/.openclaw/agents/douyin-monitor/agent',
        mainSessionKey: 'agent:douyin-monitor:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'preview',
        instructionSyncStatus: 'missing',
      },
    ];
    agentsState.communication = {
      enabled: true,
      visibility: 'all',
      allowedAgents: ['douyin-monitor'],
      diagnostics: [],
      topology: [
        {
          agentId: 'douyin-monitor',
          name: 'douyin-monitor',
          inNetwork: true,
          reachableAgents: [],
          spawnTargets: [],
          instructionSyncStatus: 'missing',
        },
      ],
      readyState: 'partial',
      networkAgentCount: 1,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 1,
    };

    render(<Agents />);

    expect(await screen.findByRole('button', { name: 'communication.mainAgentName' })).toBeInTheDocument();
  });

  it('shows instruction preview and sync action in agent settings', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: ['coding'],
        instructionPreview: 'managed-preview',
        instructionSyncStatus: 'outdated',
      },
      {
        id: 'coding',
        name: 'Coding',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-coding',
        agentDir: '~/.openclaw/agents/coding/agent',
        mainSessionKey: 'agent:coding:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'coding-preview',
        instructionSyncStatus: 'missing',
      },
    ];
    agentsState.communication = {
      enabled: true,
      visibility: 'all',
      allowedAgents: ['main', 'coding'],
      diagnostics: [
        { code: 'instructionsOutdated', severity: 'warning', agentId: 'main' },
      ],
      topology: [
        {
          agentId: 'main',
          name: 'Main',
          inNetwork: true,
          reachableAgents: ['coding'],
          spawnTargets: ['coding'],
          instructionSyncStatus: 'outdated',
        },
        {
          agentId: 'coding',
          name: 'Coding',
          inNetwork: true,
          reachableAgents: ['main'],
          spawnTargets: [],
          instructionSyncStatus: 'missing',
        },
      ],
      readyState: 'partial',
      networkAgentCount: 2,
      dispatchRelationCount: 1,
      outdatedInstructionCount: 2,
    };

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByTitle('settings')[0]);

    expect((await screen.findAllByDisplayValue('managed-preview'))[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'instructions.syncAction' })).toBeInTheDocument();
    expect(screen.getAllByText('instructions.status.outdated')[0]).toBeInTheDocument();
    expect(screen.getByText('communication.diagnostics.instructionsOutdated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'communication.syncAllInstructions' })).toBeInTheDocument();
  });

  it('opens the topology summary modal from the selected agent action', async () => {
    agentsState.agents = [
      {
        id: 'douyin-monitor',
        name: 'douyin-monitor',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-douyin-monitor',
        agentDir: '~/.openclaw/agents/douyin-monitor/agent',
        mainSessionKey: 'agent:douyin-monitor:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'douyin-preview',
        instructionSyncStatus: 'missing',
      },
    ];
    agentsState.communication = {
      enabled: true,
      visibility: 'all',
      allowedAgents: ['main', 'douyin-monitor'],
      diagnostics: [],
      topology: [
        {
          agentId: 'douyin-monitor',
          name: 'douyin-monitor',
          inNetwork: true,
          reachableAgents: ['main'],
          spawnTargets: [],
          instructionSyncStatus: 'missing',
        },
      ],
      readyState: 'partial',
      networkAgentCount: 1,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 1,
    };

    render(<Agents />);

    fireEvent.click(await screen.findByRole('button', { name: 'layout.viewTopology' }));
    expect(await screen.findByTestId('agent-topology-modal')).toBeInTheDocument();
  });

  it('opens the agent settings dialog from the topology summary modal action', async () => {
    agentsState.agents = [
      {
        id: 'douyin-monitor',
        name: 'douyin-monitor',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-douyin-monitor',
        agentDir: '~/.openclaw/agents/douyin-monitor/agent',
        mainSessionKey: 'agent:douyin-monitor:main',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: 'douyin-preview',
        instructionSyncStatus: 'missing',
      },
    ];
    agentsState.communication = {
      enabled: true,
      visibility: 'all',
      allowedAgents: ['main', 'douyin-monitor'],
      diagnostics: [],
      topology: [
        {
          agentId: 'douyin-monitor',
          name: 'douyin-monitor',
          inNetwork: true,
          reachableAgents: ['main'],
          spawnTargets: [],
          instructionSyncStatus: 'missing',
        },
      ],
      readyState: 'partial',
      networkAgentCount: 1,
      dispatchRelationCount: 0,
      outdatedInstructionCount: 1,
    };

    render(<Agents />);

    fireEvent.click(await screen.findByRole('button', { name: 'layout.viewTopology' }));
    fireEvent.click(await screen.findByRole('button', { name: 'communication.openAgentSettings' }));
    expect(await screen.findByDisplayValue('douyin-preview')).toBeInTheDocument();
  });

  it('keeps the blocking spinner during the initial load before any stable snapshot exists', async () => {
    agentsState.loading = true;
    fetchAgentsMock.mockImplementation(() => new Promise(() => {}));
    refreshProviderSnapshotMock.mockImplementation(() => new Promise(() => {}));
    hostApiFetchMock.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<Agents />);

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.queryByText('title')).not.toBeInTheDocument();
  });
});
