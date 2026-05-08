import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-agent-config-${suffix}`,
    testUserData: `/tmp/clawx-agent-config-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('exposes effective and override model refs in the snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.5',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultModelRef).toBe('moonshot/kimi-k2.5');
    expect(main).toMatchObject({
      modelRef: 'moonshot/kimi-k2.5',
      overrideModelRef: null,
      inheritedModel: true,
      modelDisplay: 'kimi-k2.5',
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
      modelDisplay: 'ark-code-latest',
    });
  });

  it('updates and clears per-agent model overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.5',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentModel } = await import('@electron/utils/agent-config');

    await updateAgentModel('coder', 'ark/ark-code-latest');
    let config = await readOpenClawJson();
    let coder = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model?.primary).toBe('ark/ark-code-latest');

    let snapshot = await listAgentsSnapshot();
    let snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
    });

    await updateAgentModel('coder', null);
    config = await readOpenClawJson();
    coder = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model).toBeUndefined();

    snapshot = await listAgentsSnapshot();
    snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'moonshot/kimi-k2.5',
      overrideModelRef: null,
      inheritedModel: true,
    });
  });

  it('rejects invalid model ref formats when updating agent model', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');

    await expect(updateAgentModel('main', 'invalid-model-ref')).rejects.toThrow(
      'modelRef must be in "provider/model" format',
    );
  });

  it('includes multi-agent communication state in the snapshot', async () => {
    await writeOpenClawJson({
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['main', 'coding', 'review'],
        },
        sessions: {
          visibility: 'all',
        },
      },
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            subagents: {
              allowAgents: ['main', 'coding', 'review'],
            },
          },
          {
            id: 'coding',
            name: 'Coding',
          },
          {
            id: 'review',
            name: 'Review',
            subagents: {
              allowAgents: ['review', 'main'],
            },
          },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();

    expect(snapshot.communication).toMatchObject({
      enabled: true,
      visibility: 'all',
      allowedAgents: ['main', 'coding', 'review'],
      readyState: 'partial',
      networkAgentCount: 3,
      dispatchRelationCount: 3,
    });
    expect(snapshot.communication.topology).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'main',
          reachableAgents: ['coding', 'review'],
          spawnTargets: ['coding', 'review'],
        }),
      ]),
    );
    expect(snapshot.communication.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'instructionsOutdated',
          severity: 'warning',
          agentId: 'main',
        }),
      ]),
    );
    expect(snapshot.agents.find((agent) => agent.id === 'main')).toMatchObject({
      inCommunicationNetwork: true,
      spawnTargets: ['coding', 'review'],
    });
    expect(snapshot.agents.find((agent) => agent.id === 'coding')).toMatchObject({
      inCommunicationNetwork: true,
      spawnTargets: [],
    });
    expect(snapshot.agents.find((agent) => agent.id === 'review')).toMatchObject({
      inCommunicationNetwork: true,
      spawnTargets: ['main'],
    });
  });

  it('updates the global multi-agent communication config', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coding', name: 'Coding' },
          { id: 'review', name: 'Review' },
        ],
      },
    });

    const { updateCommunicationConfig } = await import('@electron/utils/agent-config');
    await updateCommunicationConfig({
      enabled: true,
      allowedAgents: ['coding', 'review'],
    });

    const config = await readOpenClawJson();
    expect(config.tools).toMatchObject({
      agentToAgent: {
        enabled: true,
        allow: ['main', 'coding', 'review'],
      },
      sessions: {
        visibility: 'all',
      },
    });
  });

  it('auto-heals the communication allow list by adding main during snapshot loading', async () => {
    await writeOpenClawJson({
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['coding'],
        },
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coding', name: 'Coding' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();

    expect(snapshot.communication.allowedAgents).toEqual(['main', 'coding']);
    expect((config.tools as { agentToAgent?: { allow?: string[] } }).agentToAgent?.allow).toEqual(['main', 'coding']);
    expect(snapshot.communication.diagnostics.find((item) => item.code === 'mainMissing')).toBeUndefined();
  });

  it('updates per-agent spawn targets using subagents.allowAgents', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coding', name: 'Coding' },
          { id: 'review', name: 'Review' },
        ],
      },
    });

    const { updateAgentCommunication } = await import('@electron/utils/agent-config');
    await updateAgentCommunication('main', {
      spawnTargets: ['coding', 'review'],
    });

    let config = await readOpenClawJson();
    let main = ((config.agents as { list: Array<{ id: string; subagents?: { allowAgents?: string[] } }> }).list)
      .find((agent) => agent.id === 'main');
    expect(main?.subagents?.allowAgents).toEqual(['main', 'coding', 'review']);

    await updateAgentCommunication('main', {
      spawnTargets: [],
    });

    config = await readOpenClawJson();
    main = ((config.agents as { list: Array<{ id: string; subagents?: { allowAgents?: string[] } }> }).list)
      .find((agent) => agent.id === 'main');
    expect(main?.subagents?.allowAgents).toBeUndefined();
  });

  it('syncs managed multi-agent instructions into the agent workspace AGENTS.md', async () => {
    await writeOpenClawJson({
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['main', 'coding'],
        },
        sessions: {
          visibility: 'all',
        },
      },
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            subagents: {
              allowAgents: ['main', 'coding'],
            },
          },
          {
            id: 'coding',
            name: 'Coding',
            workspace: '~/.openclaw/workspace-coding',
          },
        ],
      },
    });

    const mainWorkspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(mainWorkspaceDir, { recursive: true });
    await writeFile(join(mainWorkspaceDir, 'AGENTS.md'), '# Existing Header\n', 'utf8');

    const { listAgentsSnapshot, syncAgentInstructions } = await import('@electron/utils/agent-config');

    let snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.instructionSyncStatus).toBe('missing');

    snapshot = await syncAgentInstructions('main');
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.instructionSyncStatus).toBe('synced');

    const content = await readFile(join(mainWorkspaceDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('# Existing Header');
    expect(content).toContain('<!-- CLAWX:BEGIN MULTI_AGENT -->');
    expect(content).toContain('## 多 Agent 协作');
    expect(content).toContain('`coding`');
    expect(content).toContain('<!-- CLAWX:END MULTI_AGENT -->');
  });

  it('syncs managed instructions for all relevant agents in one call', async () => {
    await writeOpenClawJson({
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['main', 'coding'],
        },
        sessions: {
          visibility: 'all',
        },
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, workspace: '~/.openclaw/workspace' },
          { id: 'coding', name: 'Coding', workspace: '~/.openclaw/workspace-coding' },
          { id: 'review', name: 'Review', workspace: '~/.openclaw/workspace-review' },
        ],
      },
    });

    const mainWorkspaceDir = join(testHome, '.openclaw', 'workspace');
    const codingWorkspaceDir = join(testHome, '.openclaw', 'workspace-coding');
    const reviewWorkspaceDir = join(testHome, '.openclaw', 'workspace-review');
    await mkdir(mainWorkspaceDir, { recursive: true });
    await mkdir(codingWorkspaceDir, { recursive: true });
    await mkdir(reviewWorkspaceDir, { recursive: true });

    const { syncAllAgentInstructions } = await import('@electron/utils/agent-config');
    await syncAllAgentInstructions();

    const mainContent = await readFile(join(mainWorkspaceDir, 'AGENTS.md'), 'utf8');
    const codingContent = await readFile(join(codingWorkspaceDir, 'AGENTS.md'), 'utf8');
    expect(mainContent).toContain('<!-- CLAWX:BEGIN MULTI_AGENT -->');
    expect(codingContent).toContain('<!-- CLAWX:BEGIN MULTI_AGENT -->');
    await expect(access(join(reviewWorkspaceDir, 'AGENTS.md'))).rejects.toThrow();
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.7',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    const { snapshot } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBe('main');

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // Workspace deletion is intentionally deferred by `deleteAgentConfig` to avoid
    // ENOENT errors during Gateway restart, so it should still exist here.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    infoSpy.mockRestore();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'feishu',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const feishu = (config.channels as Record<string, unknown>).feishu as {
      accounts?: Record<string, unknown>;
    };
    expect(feishu.accounts?.test2).toBeDefined();
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('replaces previous account binding for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'feishu', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('main');
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('test2', 'feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('avoids numeric-only ids when creating agents from CJK names', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await createAgent('测试2');
    await createAgent('测试1');

    const snapshot = await listAgentsSnapshot();
    const agentIds = snapshot.agents.map((agent) => agent.id);

    expect(agentIds).toContain('agent');
    expect(agentIds).toContain('agent-2');
    expect(agentIds).not.toContain('2');
    expect(agentIds).not.toContain('1');
  });
});
