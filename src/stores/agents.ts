import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { ChannelType } from '@/types/channel';
import type { AgentCommunicationConfig, AgentSummary, AgentsSnapshot } from '@/types/agent';

export interface ImportPackageMapping {
  name: string;
  sourceAgentDirName: string;
  sourceWorkspaceDirName: string;
}

export interface ImportPackageInspection {
  sourceAgents: string[];
  sourceWorkspaces: string[];
  defaultMappings: Array<{
    sourceAgentDirName: string;
    sourceWorkspaceDirName: string;
    suggestedName: string;
  }>;
}

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  communication: AgentCommunicationConfig;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string, options?: { inheritWorkspace?: boolean }) => Promise<void>;
  inspectImportAgentPackage: (zipPath: string) => Promise<ImportPackageInspection>;
  importAgentPackage: (zipPath: string, mappings: ImportPackageMapping[]) => Promise<{ importedAgentIds: string[] }>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  updateAgentModel: (agentId: string, modelRef: string | null) => Promise<void>;
  updateCommunication: (options: { enabled: boolean; allowedAgents: string[] }) => Promise<void>;
  updateAgentCommunication: (agentId: string, options: { spawnTargets: string[] }) => Promise<void>;
  syncAgentInstructions: (agentId: string) => Promise<void>;
  syncAllAgentInstructions: () => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: snapshot.agents ?? [],
    defaultAgentId: snapshot.defaultAgentId ?? 'main',
    defaultModelRef: snapshot.defaultModelRef ?? null,
    configuredChannelTypes: snapshot.configuredChannelTypes ?? [],
    channelOwners: snapshot.channelOwners ?? {},
    channelAccountOwners: snapshot.channelAccountOwners ?? {},
    communication: snapshot.communication ?? {
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
  } : {};
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  defaultAgentId: 'main',
  defaultModelRef: null,
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
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string, options?: { inheritWorkspace?: boolean }) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name, inheritWorkspace: options?.inheritWorkspace }),
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  inspectImportAgentPackage: async (zipPath: string) => {
    const result = await hostApiFetch<ImportPackageInspection & { success?: boolean }>(
      '/api/agents/import/inspect',
      {
        method: 'POST',
        body: JSON.stringify({ zipPath }),
      },
    );
    return {
      sourceAgents: result.sourceAgents ?? [],
      sourceWorkspaces: result.sourceWorkspaces ?? [],
      defaultMappings: result.defaultMappings ?? [],
    };
  },

  importAgentPackage: async (zipPath: string, mappings: ImportPackageMapping[]) => {
    set({ error: null });
    const importedAgentIds: string[] = [];
    try {
      for (const mapping of mappings) {
        const beforeIds = new Set(get().agents.map((agent) => agent.id));
        await get().createAgent(mapping.name, { inheritWorkspace: false });
        const createdAgent = get().agents.find((agent) => !beforeIds.has(agent.id));
        if (!createdAgent) {
          throw new Error(`Agent "${mapping.name}" 创建未完成，请重试`);
        }
        importedAgentIds.push(createdAgent.id);

        const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean; importedAgentId?: string }>(
          `/api/agents/${encodeURIComponent(createdAgent.id)}/import-package`,
          {
            method: 'POST',
            body: JSON.stringify({
              zipPath,
              sourceAgentDirName: mapping.sourceAgentDirName,
              sourceWorkspaceDirName: mapping.sourceWorkspaceDirName,
            }),
          },
        );
        set(applySnapshot(snapshot));
      }
      return { importedAgentIds };
    } catch (error) {
      for (const agentId of [...importedAgentIds].reverse()) {
        try {
          await get().deleteAgent(agentId);
        } catch (rollbackError) {
          console.warn('[agents] Failed to rollback partially imported agent:', agentId, rollbackError);
        }
      }
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentModel: async (agentId: string, modelRef: string | null) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/model`,
        {
          method: 'PUT',
          body: JSON.stringify({ modelRef }),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateCommunication: async (options: { enabled: boolean; allowedAgents: string[] }) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        '/api/agents/communication',
        {
          method: 'PUT',
          body: JSON.stringify(options),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentCommunication: async (agentId: string, options: { spawnTargets: string[] }) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/communication`,
        {
          method: 'PUT',
          body: JSON.stringify(options),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  syncAgentInstructions: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/instructions`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  syncAllAgentInstructions: async () => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        '/api/agents/instructions/sync-all',
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'PUT' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
