export type AgentInstructionSyncStatus = 'synced' | 'outdated' | 'missing';

export type CommunicationReadyState = 'ready' | 'partial' | 'conflict';

export type CommunicationDiagnosticCode =
  | 'disabledWithSpawnTargets'
  | 'mainMissing'
  | 'spawnTargetOutsideNetwork'
  | 'instructionsOutdated'
  | 'visibilityNotAll';

export interface CommunicationDiagnostic {
  code: CommunicationDiagnosticCode;
  severity: 'warning' | 'error';
  agentId?: string;
  targetAgentId?: string;
}

export interface CommunicationTopologyEntry {
  agentId: string;
  name: string;
  inNetwork: boolean;
  reachableAgents: string[];
  spawnTargets: string[];
  instructionSyncStatus: AgentInstructionSyncStatus;
}

export interface AgentCommunicationConfig {
  enabled: boolean;
  visibility: string;
  allowedAgents: string[];
  diagnostics: CommunicationDiagnostic[];
  topology: CommunicationTopologyEntry[];
  readyState: CommunicationReadyState;
  networkAgentCount: number;
  dispatchRelationCount: number;
  outdatedInstructionCount: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  inCommunicationNetwork: boolean;
  spawnTargets: string[];
  instructionPreview: string;
  instructionSyncStatus: AgentInstructionSyncStatus;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  communication: AgentCommunicationConfig;
}
