import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { join, normalize } from 'path';
import { promisify } from 'util';
import { deleteAgentChannelAccounts, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { toUiChannelType } from './channel-alias';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main Agent';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];
const MANAGED_MULTI_AGENT_BEGIN = '<!-- CLAWX:BEGIN MULTI_AGENT -->';
const MANAGED_MULTI_AGENT_END = '<!-- CLAWX:END MULTI_AGENT -->';
const IMPORT_PACKAGE_SEARCH_DEPTH = 4;
const execFileAsync = promisify(execFile);
const IMPORT_PACKAGE_INVALID_ERROR = '成品包上传错误：请上传正确的成品包';

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
  subagents?: {
    allowAgents?: string[];
    [key: string]: unknown;
  };
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  tools?: {
    agentToAgent?: {
      enabled?: boolean;
      allow?: string[];
      [key: string]: unknown;
    };
    sessions?: {
      visibility?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

export interface AgentCommunicationConfig {
  enabled: boolean;
  visibility: string;
  allowedAgents: string[];
  diagnostics: Array<{
    code: 'disabledWithSpawnTargets' | 'mainMissing' | 'spawnTargetOutsideNetwork' | 'instructionsOutdated' | 'visibilityNotAll';
    severity: 'warning' | 'error';
    agentId?: string;
    targetAgentId?: string;
  }>;
  topology: Array<{
    agentId: string;
    name: string;
    inNetwork: boolean;
    reachableAgents: string[];
    spawnTargets: string[];
    instructionSyncStatus: 'synced' | 'outdated' | 'missing';
  }>;
  readyState: 'ready' | 'partial' | 'conflict';
  networkAgentCount: number;
  dispatchRelationCount: number;
  outdatedInstructionCount: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef: string | null;
  overrideModelRef: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  inCommunicationNetwork: boolean;
  spawnTargets: string[];
  instructionPreview: string;
  instructionSyncStatus: 'synced' | 'outdated' | 'missing';
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  communication: AgentCommunicationConfig;
}

interface ImportPackageSelection {
  sourceAgentDirName?: string;
  sourceWorkspaceDirName?: string;
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

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      return primary.trim();
    }
  }

  return null;
}

function formatModelLabel(model: unknown): string | null {
  const modelRef = resolveModelRef(model);
  if (modelRef) {
    const trimmed = modelRef;
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function ensureMainAgentInCommunicationConfig(config: AgentConfigDocument): boolean {
  if (config.tools?.agentToAgent?.enabled !== true) {
    return false;
  }

  const currentAllow = normalizeStringArray(config.tools?.agentToAgent?.allow)
    .map((agentId) => normalizeAgentIdForBinding(agentId))
    .filter(Boolean);

  if (currentAllow.includes(MAIN_AGENT_ID)) {
    return false;
  }

  const nextTools = (config.tools && typeof config.tools === 'object')
    ? { ...config.tools }
    : {};
  const nextAgentToAgent = (nextTools.agentToAgent && typeof nextTools.agentToAgent === 'object')
    ? { ...nextTools.agentToAgent }
    : {};

  nextAgentToAgent.allow = [MAIN_AGENT_ID, ...currentAllow];
  nextTools.agentToAgent = nextAgentToAgent;
  config.tools = nextTools;
  return true;
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized || /^\d+$/.test(normalized)) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function assertAgentPersisted(agentId: string): Promise<void> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  if (!entries.some((entry) => entry.id === agentId)) {
    throw new Error(`Agent "${agentId}" 未成功写入 openclaw.json`);
  }
}

async function copyDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  await ensureDir(targetDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await ensureDir(targetDir);
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function replaceDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await copyDirectoryContents(sourceDir, targetDir);
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function isWorkspaceDirName(name: string): boolean {
  return name.toLowerCase().includes('workspace');
}

async function extractZipArchive(zipPath: string, destinationDir: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('tar.exe', ['-xf', zipPath, '-C', destinationDir]);
      return;
    } catch {
      await execFileAsync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param($zip, $dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }',
        zipPath,
        destinationDir,
      ]);
    }
    return;
  }

  try {
    await execFileAsync('unzip', ['-oq', zipPath, '-d', destinationDir]);
  } catch {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destinationDir]);
  }
}

async function isImportPackageRoot(path: string): Promise<boolean> {
  const agentsDir = join(path, 'agents');
  if (!(await fileExists(agentsDir))) return false;
  const [agentDirs, rootDirs] = await Promise.all([
    listDirectories(agentsDir),
    listDirectories(path),
  ]);
  const workspaceDirs = rootDirs.filter(isWorkspaceDirName);
  return agentDirs.length > 0 && workspaceDirs.length > 0;
}

async function findImportPackageRoot(path: string, depth = 0): Promise<string | null> {
  if (await isImportPackageRoot(path)) {
    return path;
  }
  if (depth >= IMPORT_PACKAGE_SEARCH_DEPTH) {
    return null;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await findImportPackageRoot(join(path, entry.name), depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getWorkspaceSuffix(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'workspace') return MAIN_AGENT_ID;
  if (lower.startsWith('workspace-')) return name.slice('workspace-'.length).toLowerCase();
  if (lower.startsWith('workspace_')) return name.slice('workspace_'.length).toLowerCase();
  return lower;
}

function randomAgentSuffix(length = 5): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function buildSuggestedImportAgentName(agent: string, sourceAgentCount: number): string {
  if (sourceAgentCount > 1 && agent.toLowerCase() === MAIN_AGENT_ID) {
    return `${MAIN_AGENT_ID}_${randomAgentSuffix()}`;
  }
  return agent;
}

function buildDefaultImportMappings(
  sourceAgents: string[],
  sourceWorkspaces: string[],
): Array<{ sourceAgentDirName: string; sourceWorkspaceDirName: string; suggestedName: string }> {
  const workspaceBySuffix = new Map<string, string>();
  for (const workspace of sourceWorkspaces) {
    const suffix = getWorkspaceSuffix(workspace);
    if (!workspaceBySuffix.has(suffix)) {
      workspaceBySuffix.set(suffix, workspace);
    }
  }

  const mappings: Array<{ sourceAgentDirName: string; sourceWorkspaceDirName: string; suggestedName: string }> = [];
  const sortedAgents = [...sourceAgents].sort((a, b) => a.localeCompare(b));
  const sortedWorkspaces = [...sourceWorkspaces].sort((a, b) => a.localeCompare(b));
  const usedWorkspaces = new Set<string>();

  for (const agent of sortedAgents) {
    const preferred = workspaceBySuffix.get(agent.toLowerCase());
    const workspace = preferred && !usedWorkspaces.has(preferred)
      ? preferred
      : sortedWorkspaces.find((name) => !usedWorkspaces.has(name));
    if (!workspace) {
      continue;
    }
    usedWorkspaces.add(workspace);
    mappings.push({
      sourceAgentDirName: agent,
      sourceWorkspaceDirName: workspace,
      suggestedName: buildSuggestedImportAgentName(agent, sortedAgents.length),
    });
  }

  return mappings;
}

async function inspectExtractedImportPackage(extractDir: string): Promise<{
  packageRoot: string;
  sourceAgents: string[];
  sourceWorkspaces: string[];
}> {
  const packageRoot = await findImportPackageRoot(extractDir);
  if (!packageRoot) {
    throw new Error(IMPORT_PACKAGE_INVALID_ERROR);
  }

  const [sourceAgents, rootDirs] = await Promise.all([
    listDirectories(join(packageRoot, 'agents')),
    listDirectories(packageRoot),
  ]);
  const sourceWorkspaces = rootDirs.filter(isWorkspaceDirName).sort((a, b) => a.localeCompare(b));
  const sortedAgents = [...sourceAgents].sort((a, b) => a.localeCompare(b));

  if (sortedAgents.length === 0 || sourceWorkspaces.length === 0 || sortedAgents.length !== sourceWorkspaces.length) {
    throw new Error(IMPORT_PACKAGE_INVALID_ERROR);
  }

  return {
    packageRoot,
    sourceAgents: sortedAgents,
    sourceWorkspaces,
  };
}

async function resolveSelectedImportSources(
  packageRoot: string,
  selection?: ImportPackageSelection,
): Promise<{ sourceWorkspaceDir: string; sourceRuntimeDir: string }> {
  const sourceAgentDirName = selection?.sourceAgentDirName?.trim() || MAIN_AGENT_ID;
  const sourceWorkspaceDirName = selection?.sourceWorkspaceDirName?.trim() || 'workspace';
  const sourceRuntimeDir = join(packageRoot, 'agents', sourceAgentDirName);
  const sourceWorkspaceDir = join(packageRoot, sourceWorkspaceDirName);

  if (!(await fileExists(sourceRuntimeDir)) || !(await fileExists(sourceWorkspaceDir))) {
    throw new Error(IMPORT_PACKAGE_INVALID_ERROR);
  }

  return { sourceWorkspaceDir, sourceRuntimeDir };
}

async function applyImportedAgentPackage(
  zipPath: string,
  agent: AgentListEntry,
  config: AgentConfigDocument,
  selection?: ImportPackageSelection,
): Promise<void> {
  const trimmedZipPath = zipPath.trim();
  if (!trimmedZipPath) {
    throw new Error('ZIP 路径不能为空');
  }
  if (!trimmedZipPath.toLowerCase().endsWith('.zip')) {
    throw new Error('只能导入 ZIP 成品包');
  }
  if (!(await fileExists(trimmedZipPath))) {
    throw new Error(`ZIP 文件不存在: ${trimmedZipPath}`);
  }

  const extractDir = await mkdtemp(join(tmpdir(), 'clawx-agent-import-'));
  try {
    await extractZipArchive(trimmedZipPath, extractDir);
    const { packageRoot } = await inspectExtractedImportPackage(extractDir);
    const { sourceWorkspaceDir, sourceRuntimeDir } = await resolveSelectedImportSources(packageRoot, selection);
    const targetWorkspaceDir = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
    const targetRuntimeRootDir = join(getOpenClawConfigDir(), 'agents', agent.id);
    const { entries } = normalizeAgentsConfig(config);
    const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
    const sourceMainAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
    const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));

    await replaceDirectoryContents(sourceWorkspaceDir, targetWorkspaceDir);
    await replaceDirectoryContents(sourceRuntimeDir, targetRuntimeRootDir);
    await ensureDir(join(targetRuntimeRootDir, 'sessions'));
    await copyRuntimeFiles(sourceMainAgentDir, targetAgentDir);
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

function resolveCreatedAgentId(before: AgentsSnapshot, after: AgentsSnapshot): string {
  const beforeIds = new Set(before.agents.map((agent) => agent.id));
  const addedAgents = after.agents.filter((agent) => !beforeIds.has(agent.id));
  if (addedAgents.length !== 1) {
    throw new Error('无法确认新创建的 Agent，请重试');
  }
  return addedAgents[0].id;
}

async function importPackageIntoExistingAgent(
  agentId: string,
  zipPath: string,
  selection?: ImportPackageSelection,
): Promise<void> {
  await withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    const entry = entries.find((candidate) => candidate.id === agentId);
    if (!entry) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    await applyImportedAgentPackage(zipPath, entry, config, selection);
    await assertAgentPersisted(agentId);
  });
}

export async function inspectAgentPackage(zipPath: string): Promise<ImportPackageInspection> {
  const trimmedZipPath = zipPath.trim();
  if (!trimmedZipPath || !trimmedZipPath.toLowerCase().endsWith('.zip') || !(await fileExists(trimmedZipPath))) {
    throw new Error(IMPORT_PACKAGE_INVALID_ERROR);
  }

  const extractDir = await mkdtemp(join(tmpdir(), 'clawx-agent-inspect-'));
  try {
    await extractZipArchive(trimmedZipPath, extractDir);
    const { sourceAgents, sourceWorkspaces } = await inspectExtractedImportPackage(extractDir);
    return {
      sourceAgents,
      sourceWorkspaces,
      defaultMappings: buildDefaultImportMappings(sourceAgents, sourceWorkspaces),
    };
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

export async function importAgentPackageIntoAgent(
  agentId: string,
  zipPath: string,
  selection?: ImportPackageSelection,
): Promise<AgentsSnapshot> {
  await importPackageIntoExistingAgent(agentId, zipPath, selection);
  logger.info('Imported agent package into existing agent', { agentId, zipPath });
  return listAgentsSnapshot();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  // Accept bindings with just {channel} or {channel, accountId}
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

function getAgentWorkspacePath(config: AgentConfigDocument, entry: AgentListEntry): string {
  return entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`);
}

function getAgentName(entry: AgentListEntry): string {
  return entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id);
}

function buildInstructionPreviewForAgent(params: {
  agent: AgentListEntry;
  entries: AgentListEntry[];
  communicationAllowedSet: Set<string>;
  entryIdMap: Map<string, string>;
}): string {
  const agentIdNorm = normalizeAgentIdForBinding(params.agent.id);
  const rawSpawnTargets = normalizeStringArray(params.agent.subagents?.allowAgents)
    .map((agentId) => normalizeAgentIdForBinding(agentId))
    .filter((agentId) => agentId !== agentIdNorm);
  const spawnTargets = rawSpawnTargets
    .map((agentId) => params.entries.find((entry) => normalizeAgentIdForBinding(entry.id) === agentId))
    .filter((entry): entry is AgentListEntry => Boolean(entry));
  const availableTargets = spawnTargets.length > 0
    ? spawnTargets
    : params.entries.filter((entry) => (
      normalizeAgentIdForBinding(entry.id) !== agentIdNorm
      && params.communicationAllowedSet.has(normalizeAgentIdForBinding(entry.id))
    ));

  const lines: string[] = [
    MANAGED_MULTI_AGENT_BEGIN,
    '## 多 Agent 协作',
    '',
    '你不是一个人在战斗！你可以找其他 Agent 帮忙。',
    '',
    '### 可用的 Agent',
    '',
  ];

  if (availableTargets.length === 0) {
    lines.push('- 当前还没有配置可协作的其他 Agent。');
  } else {
    lines.push('| Agent ID | 名字 | 擅长什么 |');
    lines.push('| --- | --- | --- |');
    for (const target of availableTargets) {
      lines.push(`| \`${target.id}\` | ${getAgentName(target)} | 处理与 ${getAgentName(target)} 相关的专门任务 |`);
    }
  }

  lines.push(
    '',
    '### 怎么找它们',
    '',
    '根据任务复杂度选择方式：',
    '',
    '快速问答（几秒能回） -> 用 `sessions_send`',
    '- `sessionKey` 填 `agent:<agentId>:main`',
    '- `timeoutSeconds` 建议设 60',
    '',
    '耗时任务（超过 30 秒） -> 用 `sessions_spawn`',
    '- `agentId` 填目标 Agent 的 id',
    '- `task` 填具体任务描述',
    '- 对方干完会自动汇报结果回来',
    '',
    '### 当前派发建议',
    '',
  );

  if (spawnTargets.length === 0) {
    lines.push('- 当前未配置明确的后台派发目标；如需稳定派发，请在 ClawX 的 Agents 页面中设置。');
  } else {
    lines.push(`- 当前优先可派发给：${spawnTargets.map((target) => `\`${params.entryIdMap.get(normalizeAgentIdForBinding(target.id)) || target.id}\``).join('、')}`);
  }

  lines.push(
    '- 简单问题用 `sessions_send`，复杂任务用 `sessions_spawn`',
    '- 收到结果后，总结给主人，不要原封不动转发',
    '- 不要同时找多个 Agent 做同一件事',
    MANAGED_MULTI_AGENT_END,
  );

  return lines.join('\n');
}

function extractManagedInstructionBlock(content: string): string | null {
  const start = content.indexOf(MANAGED_MULTI_AGENT_BEGIN);
  const end = content.indexOf(MANAGED_MULTI_AGENT_END);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return content.slice(start, end + MANAGED_MULTI_AGENT_END.length).trim();
}

function upsertManagedInstructionBlock(content: string, block: string): string {
  const trimmedBlock = block.trim();
  const existingBlock = extractManagedInstructionBlock(content);
  if (existingBlock) {
    return content.replace(existingBlock, trimmedBlock);
  }
  const trimmedContent = content.trimEnd();
  if (!trimmedContent) {
    return `${trimmedBlock}\n`;
  }
  return `${trimmedContent}\n\n${trimmedBlock}\n`;
}

async function getInstructionStateForAgent(params: {
  agent: AgentListEntry;
  config: AgentConfigDocument;
  entries: AgentListEntry[];
  communicationAllowedSet: Set<string>;
  entryIdMap: Map<string, string>;
}): Promise<Pick<AgentSummary, 'instructionPreview' | 'instructionSyncStatus'>> {
  const preview = buildInstructionPreviewForAgent({
    agent: params.agent,
    entries: params.entries,
    communicationAllowedSet: params.communicationAllowedSet,
    entryIdMap: params.entryIdMap,
  });
  const workspacePath = expandPath(getAgentWorkspacePath(params.config, params.agent));
  const agentsFilePath = join(workspacePath, 'AGENTS.md');

  try {
    const content = await readFile(agentsFilePath, 'utf8');
    const existingBlock = extractManagedInstructionBlock(content);
    if (!existingBlock) {
      return {
        instructionPreview: preview,
        instructionSyncStatus: 'missing',
      };
    }
    return {
      instructionPreview: preview,
      instructionSyncStatus: existingBlock.trim() === preview.trim() ? 'synced' : 'outdated',
    };
  } catch {
    return {
      instructionPreview: preview,
      instructionSyncStatus: 'missing',
    };
  }
}

/**
 * Returns a map of channelType -> agentId from bindings.
 * Account-scoped bindings are preferred; channel-wide bindings serve as fallback.
 * Multiple agents can own the same channel type (different accounts).
 */
function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const normalizedAgentId = agentId ? normalizeAgentIdForBinding(agentId) : '';
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;
      // Keep a single account binding per (agent, channelType). Rebinding to
      // another account should replace the previous one.
      if (normalizedAgentId && normalizeAgentIdForBinding(binding.agentId || '') === normalizedAgentId) {
        return false;
      }
      // Only remove binding that matches the exact accountId scope
      if (accountId) {
        return binding.match?.accountId !== accountId;
      }
      // No accountId: remove channel-wide binding (legacy)
      return Boolean(binding.match?.accountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (accountId) {
      match.accountId = accountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

export async function removeAgentWorkspaceDirectory(agent: { id: string; workspace?: string }): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent as AgentListEntry);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { inheritWorkspace?: boolean },
): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  // When inheritWorkspace is true, copy the main agent's workspace bootstrap
  // files (SOUL.md, AGENTS.md, etc.) so the new agent inherits the same
  // personality / instructions. When false (default), leave the workspace
  // empty and let OpenClaw Gateway seed the default bootstrap files on startup.
  if (options?.inheritWorkspace && targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(config: AgentConfigDocument, preloadedChannels?: string[]): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = preloadedChannels ?? await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const entryIdMap = new Map(entries.map((entry) => [normalizeAgentIdForBinding(entry.id), entry.id]));
  const communicationAllow = normalizeStringArray(config.tools?.agentToAgent?.allow)
    .map((agentId) => normalizeAgentIdForBinding(agentId))
    .filter((agentId, index, array) => Boolean(agentId) && array.indexOf(agentId) === index);
  const communicationAllowResolved = communicationAllow
    .map((agentId) => entryIdMap.get(agentId) || agentId)
    .filter(Boolean);
  const communicationAllowedSet = new Set(communicationAllow);
  const communication: AgentCommunicationConfig = {
    enabled: config.tools?.agentToAgent?.enabled === true,
    visibility: typeof config.tools?.sessions?.visibility === 'string' && config.tools.sessions.visibility.trim()
      ? config.tools.sessions.visibility.trim()
      : 'all',
    allowedAgents: communicationAllowResolved,
    diagnostics: [],
    topology: [],
    readyState: 'ready',
    networkAgentCount: 0,
    dispatchRelationCount: 0,
    outdatedInstructionCount: 0,
  };
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  // Build per-agent channel lists from account-scoped bindings
  const agentChannelSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;
    const hasExplicitAccountBindingForChannel = accountIds.some((accountId) =>
      accountToAgent.has(`${channelType}:${accountId}`),
    );

    for (const accountId of accountIds) {
      const owner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (
          accountId === DEFAULT_ACCOUNT_ID && !hasExplicitAccountBindingForChannel
            ? channelToAgent.get(channelType)
            : undefined
        );

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.model;
  const defaultModelLabel = formatModelLabel(defaultModelConfig);
  const defaultModelRef = resolveModelRef(defaultModelConfig);
  const agents: AgentSummary[] = await Promise.all(entries.map(async (entry) => {
    const explicitModelRef = resolveModelRef(entry.model);
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !explicitModelRef && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    const rawSpawnTargets = normalizeStringArray(entry.subagents?.allowAgents)
      .map((agentId) => normalizeAgentIdForBinding(agentId))
      .filter(Boolean);
    const spawnTargets = rawSpawnTargets
      .filter((agentId) => agentId !== entryIdNorm)
      .map((agentId) => entryIdMap.get(agentId) || agentId)
      .filter(Boolean);
    const instructionState = await getInstructionStateForAgent({
      agent: entry,
      config,
      entries,
      communicationAllowedSet,
      entryIdMap,
    });
    return {
      id: entry.id,
      name: getAgentName(entry),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      modelRef: explicitModelRef || defaultModelRef || null,
      overrideModelRef: explicitModelRef,
      inheritedModel,
      workspace: getAgentWorkspacePath(config, entry),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels
        .filter((ct) => ownedChannels.has(ct))
        .map((channelType) => toUiChannelType(channelType)),
      inCommunicationNetwork: communicationAllowedSet.has(entryIdNorm),
      spawnTargets,
      instructionPreview: instructionState.instructionPreview,
      instructionSyncStatus: instructionState.instructionSyncStatus,
    };
  }));

  const diagnostics: AgentCommunicationConfig['diagnostics'] = [];
  const networkAgents = agents.filter((agent) => agent.inCommunicationNetwork);
  const dispatchRelationCount = agents.reduce((sum, agent) => sum + agent.spawnTargets.length, 0);
  const outdatedInstructionCount = networkAgents.filter((agent) => agent.instructionSyncStatus !== 'synced').length;
  const allowedAgentIdSet = new Set(communication.allowedAgents.map((agentId) => normalizeAgentIdForBinding(agentId)));

  if (!communication.enabled && dispatchRelationCount > 0) {
    diagnostics.push({
      code: 'disabledWithSpawnTargets',
      severity: 'error',
    });
  }

  if (communication.visibility !== 'all') {
    diagnostics.push({
      code: 'visibilityNotAll',
      severity: 'error',
    });
  }

  for (const agent of agents) {
    for (const targetId of agent.spawnTargets) {
      if (!allowedAgentIdSet.has(normalizeAgentIdForBinding(targetId))) {
        diagnostics.push({
          code: 'spawnTargetOutsideNetwork',
          severity: 'error',
          agentId: agent.id,
          targetAgentId: targetId,
        });
      }
    }

    if (agent.inCommunicationNetwork && agent.instructionSyncStatus !== 'synced') {
      diagnostics.push({
        code: 'instructionsOutdated',
        severity: 'warning',
        agentId: agent.id,
      });
    }
  }

  communication.diagnostics = diagnostics;
  communication.topology = agents.map((agent) => ({
    agentId: agent.id,
    name: agent.name,
    inNetwork: agent.inCommunicationNetwork,
    reachableAgents: communication.enabled && agent.inCommunicationNetwork
      ? communication.allowedAgents.filter((targetId) => normalizeAgentIdForBinding(targetId) !== normalizeAgentIdForBinding(agent.id))
      : [],
    spawnTargets: agent.spawnTargets,
    instructionSyncStatus: agent.instructionSyncStatus,
  }));
  communication.readyState = diagnostics.some((item) => item.severity === 'error')
    ? 'conflict'
    : diagnostics.length > 0
      ? 'partial'
      : 'ready';
  communication.networkAgentCount = networkAgents.length;
  communication.dispatchRelationCount = dispatchRelationCount;
  communication.outdatedInstructionCount = outdatedInstructionCount;

  return {
    agents,
    defaultAgentId,
    defaultModelRef,
    configuredChannelTypes: configuredChannels.map((channelType) => toUiChannelType(channelType)),
    channelOwners,
    channelAccountOwners,
    communication,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  if (ensureMainAgentInCommunicationConfig(config)) {
    await writeOpenClawConfig(config);
    logger.info('Auto-added main agent to communication allow list');
  }
  return buildSnapshotFromConfig(config);
}

export async function listAgentsSnapshotFromConfig(config: OpenClawConfig, configuredChannels?: string[]): Promise<AgentsSnapshot> {
  return buildSnapshotFromConfig(config as AgentConfigDocument, configuredChannels);
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

export async function createAgent(
  name: string,
  options?: { inheritWorkspace?: boolean },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    let nextId = slugifyAgentId(normalizedName);
    let suffix = 2;

    while (existingIds.has(nextId) || diskIds.has(nextId)) {
      nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
      suffix += 1;
    }

    const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
    const newAgent: AgentListEntry = {
      id: nextId,
      name: normalizedName,
      workspace: `~/.openclaw/workspace-${nextId}`,
      agentDir: getDefaultAgentDirPath(nextId),
    };

    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };

    await provisionAgentFilesystem(config, newAgent, { inheritWorkspace: options?.inheritWorkspace });
    await writeOpenClawConfig(config);
    await assertAgentPersisted(nextId);
    logger.info('Created agent config entry', { agentId: nextId, inheritWorkspace: !!options?.inheritWorkspace });
    return buildSnapshotFromConfig(config);
  });
}

export async function importAgentPackage(
  name: string,
  zipPath: string,
): Promise<{ snapshot: AgentsSnapshot; agentId: string }> {
  const inspection = await inspectAgentPackage(zipPath);
  if (inspection.defaultMappings.length !== 1) {
    throw new Error('该成品包包含多个 Agent，请使用多 Agent 导入映射流程');
  }
  const beforeSnapshot = await listAgentsSnapshot();
  const createdSnapshot = await createAgent(name, { inheritWorkspace: false });
  const agentId = resolveCreatedAgentId(beforeSnapshot, createdSnapshot);
  try {
    const mapping = inspection.defaultMappings[0];
    await importPackageIntoExistingAgent(agentId, zipPath, {
      sourceAgentDirName: mapping.sourceAgentDirName,
      sourceWorkspaceDirName: mapping.sourceWorkspaceDirName,
    });
  } catch (error) {
    try {
      const { removedEntry } = await deleteAgentConfig(agentId);
      await removeAgentWorkspaceDirectory(removedEntry);
    } catch (cleanupError) {
      logger.warn('Failed to rollback imported agent after package import error', {
        agentId,
        error: String(cleanupError),
      });
    }
    throw error;
  }
  logger.info('Imported agent package', { agentId, zipPath });
  return {
    snapshot: await listAgentsSnapshot(),
    agentId,
  };
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    entries[index] = {
      ...entries[index],
      name: normalizedName,
    };

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent name', { agentId, name: normalizedName });
    return buildSnapshotFromConfig(config);
  });
}

function isValidModelRef(modelRef: string): boolean {
  const firstSlash = modelRef.indexOf('/');
  return firstSlash > 0 && firstSlash < modelRef.length - 1;
}

export async function updateAgentModel(agentId: string, modelRef: string | null): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';
    const nextEntry: AgentListEntry = { ...entries[index] };

    if (!normalizedModelRef) {
      delete nextEntry.model;
    } else {
      if (!isValidModelRef(normalizedModelRef)) {
        throw new Error('modelRef must be in "provider/model" format');
      }
      nextEntry.model = { primary: normalizedModelRef };
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent model', { agentId, modelRef: normalizedModelRef || null });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateCommunicationConfig(
  options: { enabled: boolean; allowedAgents: string[] },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    const validAgentIds = new Set(entries.map((entry) => normalizeAgentIdForBinding(entry.id)));
    const normalizedAllowedAgents = normalizeStringArray(options.allowedAgents)
      .map((agentId) => normalizeAgentIdForBinding(agentId))
      .filter((agentId, index, array) => validAgentIds.has(agentId) && array.indexOf(agentId) === index);

    if (options.enabled && validAgentIds.has(MAIN_AGENT_ID) && !normalizedAllowedAgents.includes(MAIN_AGENT_ID)) {
      normalizedAllowedAgents.unshift(MAIN_AGENT_ID);
    }

    const nextTools = (config.tools && typeof config.tools === 'object')
      ? { ...config.tools }
      : {};
    const nextAgentToAgent = (nextTools.agentToAgent && typeof nextTools.agentToAgent === 'object')
      ? { ...nextTools.agentToAgent }
      : {};
    const nextSessions = (nextTools.sessions && typeof nextTools.sessions === 'object')
      ? { ...nextTools.sessions }
      : {};

    nextAgentToAgent.enabled = options.enabled;
    nextAgentToAgent.allow = normalizedAllowedAgents;
    nextSessions.visibility = 'all';
    nextTools.agentToAgent = nextAgentToAgent;
    nextTools.sessions = nextSessions;
    config.tools = nextTools;

    await writeOpenClawConfig(config);
    logger.info('Updated multi-agent communication config', {
      enabled: options.enabled,
      allowedAgents: normalizedAllowedAgents,
    });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentCommunication(
  agentId: string,
  options: { spawnTargets: string[] },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const currentAgentIdNorm = normalizeAgentIdForBinding(agentId);
    const validAgentIds = new Set(entries.map((entry) => normalizeAgentIdForBinding(entry.id)));
    const normalizedTargets = normalizeStringArray(options.spawnTargets)
      .map((targetId) => normalizeAgentIdForBinding(targetId))
      .filter((targetId, targetIndex, array) => (
        targetId !== currentAgentIdNorm
        && validAgentIds.has(targetId)
        && array.indexOf(targetId) === targetIndex
      ));

    const nextEntry: AgentListEntry = { ...entries[index] };
    if (normalizedTargets.length === 0) {
      if (nextEntry.subagents && typeof nextEntry.subagents === 'object') {
        const nextSubagents = { ...nextEntry.subagents };
        delete nextSubagents.allowAgents;
        nextEntry.subagents = Object.keys(nextSubagents).length > 0 ? nextSubagents : undefined;
      }
    } else {
      nextEntry.subagents = {
        ...(nextEntry.subagents && typeof nextEntry.subagents === 'object' ? nextEntry.subagents : {}),
        allowAgents: [currentAgentIdNorm, ...normalizedTargets],
      };
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent communication targets', {
      agentId,
      spawnTargets: normalizedTargets,
    });
    return buildSnapshotFromConfig(config);
  });
}

export async function syncAgentInstructions(agentId: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    const entry = entries.find((candidate) => candidate.id === agentId);
    if (!entry) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const entryIdMap = new Map(entries.map((candidate) => [normalizeAgentIdForBinding(candidate.id), candidate.id]));
    const communicationAllowedSet = new Set(
      normalizeStringArray(config.tools?.agentToAgent?.allow).map((candidate) => normalizeAgentIdForBinding(candidate)),
    );
    const preview = buildInstructionPreviewForAgent({
      agent: entry,
      entries,
      communicationAllowedSet,
      entryIdMap,
    });

    const workspacePath = expandPath(getAgentWorkspacePath(config, entry));
    const agentsFilePath = join(workspacePath, 'AGENTS.md');
    await ensureDir(workspacePath);

    let currentContent = '';
    try {
      currentContent = await readFile(agentsFilePath, 'utf8');
    } catch {
      currentContent = '';
    }

    const nextContent = upsertManagedInstructionBlock(currentContent, preview);
    await writeFile(agentsFilePath, nextContent, 'utf8');
    logger.info('Synced managed multi-agent instructions', { agentId, agentsFilePath });

    return buildSnapshotFromConfig(config);
  });
}

export async function syncAllAgentInstructions(): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    const allowedAgentIds = new Set(
      normalizeStringArray(config.tools?.agentToAgent?.allow).map((candidate) => normalizeAgentIdForBinding(candidate)),
    );
    const entryIdMap = new Map(entries.map((candidate) => [normalizeAgentIdForBinding(candidate.id), candidate.id]));
    const syncTargets = entries.filter((entry) => {
      const normalizedId = normalizeAgentIdForBinding(entry.id);
      return normalizedId === MAIN_AGENT_ID || allowedAgentIds.has(normalizedId);
    });

    for (const entry of syncTargets) {
      const preview = buildInstructionPreviewForAgent({
        agent: entry,
        entries,
        communicationAllowedSet: allowedAgentIds,
        entryIdMap,
      });
      const workspacePath = expandPath(getAgentWorkspacePath(config, entry));
      const agentsFilePath = join(workspacePath, 'AGENTS.md');
      await ensureDir(workspacePath);

      let currentContent = '';
      try {
        currentContent = await readFile(agentsFilePath, 'utf8');
      } catch {
        currentContent = '';
      }

      const nextContent = upsertManagedInstructionBlock(currentContent, preview);
      await writeFile(agentsFilePath, nextContent, 'utf8');
    }

    logger.info('Synced managed multi-agent instructions for all relevant agents', {
      targets: syncTargets.map((entry) => entry.id),
    });
    return buildSnapshotFromConfig(config);
  });
}

export async function deleteAgentConfig(agentId: string): Promise<{ snapshot: AgentsSnapshot; removedEntry: AgentListEntry }> {
  return withConfigLock(async () => {
    if (agentId === MAIN_AGENT_ID) {
      throw new Error('The main agent cannot be deleted');
    }

    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    const snapshotBeforeDeletion = await buildSnapshotFromConfig(config);
    const removedEntry = entries.find((entry) => entry.id === agentId);
    const nextEntries = entries.filter((entry) => entry.id !== agentId);
    if (!removedEntry || nextEntries.length === entries.length) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    config.bindings = Array.isArray(config.bindings)
      ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
      : undefined;

    if (defaultAgentId === agentId && nextEntries.length > 0) {
      nextEntries[0] = {
        ...nextEntries[0],
        default: true,
      };
    }

    const normalizedAgentId = normalizeAgentIdForBinding(agentId);
    const legacyAccountId = resolveAccountIdForAgent(agentId);
    const ownedLegacyAccounts = new Set(
      Object.entries(snapshotBeforeDeletion.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== normalizedAgentId) return false;
          const accountId = channelAccountKey.slice(channelAccountKey.indexOf(':') + 1);
          return accountId === legacyAccountId;
        })
        .map(([channelAccountKey]) => channelAccountKey),
    );

    await writeOpenClawConfig(config);
    await deleteAgentChannelAccounts(agentId, ownedLegacyAccounts);
    await removeAgentRuntimeDirectory(agentId);
    // NOTE: workspace directory is NOT deleted here intentionally.
    // The caller (route handler) defers workspace removal until after
    // the Gateway process has fully restarted, so that any in-flight
    // process.chdir(workspace) calls complete before the directory
    // disappears (otherwise process.cwd() throws ENOENT for the rest
    // of the Gateway's lifetime).
    logger.info('Deleted agent config entry', { agentId });
    return { snapshot: await buildSnapshotFromConfig(config), removedEntry };
  });
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const accountId = resolveAccountIdForAgent(agentId);
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
    await writeOpenClawConfig(config);
    logger.info('Assigned channel to agent', { agentId, channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (!accountId.trim()) {
      throw new Error('accountId is required');
    }

    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId.trim());
    await writeOpenClawConfig(config);
    logger.info('Assigned channel account to agent', { agentId, channelType, accountId: accountId.trim() });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
    await writeOpenClawConfig(config);
    logger.info('Cleared channel binding', { channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    if (!Array.isArray(config.bindings)) return;

    const nextBindings = config.bindings.filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      return binding.match?.channel !== channelType;
    });

    config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
    await writeOpenClawConfig(config);
    logger.info('Cleared all bindings for channel', { channelType });
  });
}
