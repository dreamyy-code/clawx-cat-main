﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, Plus, RefreshCw, Settings2, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore, type ImportPackageMapping } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentCommunicationConfig, AgentSummary } from '@/types/agent';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
}

function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

function haveSameItems(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function ensureMainAgent(ids: string[], enabled?: boolean): string[] {
  const normalized = [...new Set(ids.filter(Boolean))];
  if ((enabled ?? true) && !normalized.includes('main')) {
    return ['main', ...normalized];
  }
  return normalized;
}

function getInstructionStatusClass(status: AgentSummary['instructionSyncStatus']): string {
  if (status === 'synced') {
    return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300';
  }
  if (status === 'outdated') {
    return 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300';
  }
  return 'bg-muted border-border/50 text-foreground/70';
}

function getCommunicationReadyStateClass(status: AgentCommunicationConfig['readyState']): string {
  if (status === 'ready') {
    return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300';
  }
  if (status === 'partial') {
    return 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300';
  }
  return 'bg-destructive/10 border-destructive/20 text-destructive';
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const {
    agents,
    loading,
    error,
    communication,
    fetchAgents,
    createAgent,
    inspectImportAgentPackage,
    importAgentPackage,
    updateCommunication,
    syncAgentInstructions,
    syncAllAgentInstructions,
    deleteAgent,
  } = useAgentsStore();
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(() => agents.length > 0);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [pendingImportZipPath, setPendingImportZipPath] = useState('');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [topologyAgentId, setTopologyAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const response = await hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[] }>('/api/channels/accounts');
      setChannelGroups(response.channels || []);
    } catch {
      // Keep the last rendered snapshot when channel account refresh fails.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchAgents(), fetchChannelAccounts(), refreshProviderSnapshot()]).finally(() => {
      if (mounted) {
        setHasCompletedInitialLoad(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [fetchAgents, fetchChannelAccounts, refreshProviderSnapshot]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchChannelAccounts();
    }
  }, [fetchChannelAccounts, gatewayStatus.state]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const editingAgent = useMemo(
    () => agents.find((agent) => agent.id === editingAgentId) ?? null,
    [editingAgentId, agents],
  );

  useEffect(() => {
    if (agents.length === 0) {
      if (activeAgentId !== null) {
        setActiveAgentId(null);
      }
      return;
    }
    if (!activeAgentId || !agents.some((agent) => agent.id === activeAgentId)) {
      setActiveAgentId(agents[0].id);
    }
  }, [activeAgentId, agents]);

  const visibleAgents = agents;
  const visibleChannelGroups = channelGroups;
  const isUsingStableValue = loading && hasCompletedInitialLoad;
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannelAccounts()]);
  };
  const openImportDialog = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        title: t('importDialog.pickTitle'),
        properties: ['openFile'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.[0]) return;
      setPendingImportZipPath(result.filePaths[0]);
      setShowImportDialog(true);
    } catch (error) {
      toast.error(t('toast.importPickFailed', { error: String(error) }));
    }
  }, [t]);

  if (loading && !hasCompletedInitialLoad) {
    return (
      <div className="flex flex-col -m-6 min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="agents-page" className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-5 py-6 md:px-6 md:py-8 space-y-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between mb-2 shrink-0 gap-4">
            <section className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">
                {t('title')}
              </h1>
              <p className="text-[14px] text-muted-foreground">
                {t('subtitle')}
              </p>
            </section>
          <div className="flex flex-wrap items-center gap-3 md:mt-2">
            <Button
              onClick={() => setShowAddDialog(true)}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('addAgent')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void openImportDialog()}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-primary/50 bg-primary/[0.04] hover:bg-primary/[0.08] shadow-none text-primary transition-colors"
            >
              <Upload className="h-3.5 w-3.5 mr-2" />
              {t('importAgent')}
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', isUsingStableValue && 'animate-spin')} />
              {t('refresh')}
            </Button>
          </div>
        </div>

          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          <div className="space-y-4 pb-6">
            <GlobalCommunicationCard
              agents={visibleAgents}
              communication={communication}
              onSave={updateCommunication}
              onSyncAgentInstructions={syncAgentInstructions}
              onSyncAllInstructions={syncAllAgentInstructions}
            />
            <Card className="app-panel rounded-3xl border overflow-hidden shadow-sm">
              <CardHeader className="pb-3 space-y-4">
                <div>
                  <CardTitle className="text-xl font-semibold tracking-tight">{t('layout.agentListTitle')}</CardTitle>
                  <CardDescription className="text-[14px] text-foreground/70">
                    {t('layout.agentListDescription')}
                  </CardDescription>
                </div>
                {activeAgent && (
                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                        {t('layout.selectedAgentLabel')}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold text-foreground">{activeAgent.name}</span>
                        {activeAgent.isDefault && (
                          <Badge
                            variant="secondary"
                            className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-background border border-border/50 shadow-none text-foreground/70"
                          >
                            <Check className="h-3 w-3" />
                            {t('defaultBadge')}
                          </Badge>
                        )}
                        {activeAgent.inCommunicationNetwork && (
                          <Badge
                            variant="secondary"
                            className="font-medium text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/15 shadow-none text-primary"
                          >
                            {t('communication.badges.inNetwork')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13px] text-foreground/60">
                        {t('layout.selectedAgentHint')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setTopologyAgentId(activeAgent.id)}
                        className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
                      >
                        {t('layout.viewTopology')}
                      </Button>
                      <Button
                        onClick={() => setEditingAgentId(activeAgent.id)}
                        className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
                      >
                        {t('layout.viewDetails')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                {visibleAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    channelGroups={visibleChannelGroups}
                    isActive={agent.id === activeAgentId}
                    onSelect={() => setActiveAgentId(agent.id)}
                    onOpenSettings={() => setEditingAgentId(agent.id)}
                    onDelete={() => setAgentToDelete(agent)}
                  isDeleting={deletingAgentId === agent.id}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name, options) => {
            await createAgent(name, options);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {showImportDialog && (
        <ImportAgentDialog
          initialZipPath={pendingImportZipPath}
          onClose={() => {
            setShowImportDialog(false);
            setPendingImportZipPath('');
          }}
          onImport={async (zipPath, mappings) => {
            const result = await importAgentPackage(zipPath, mappings);
            await Promise.all([fetchAgents(), fetchChannelAccounts()]);
            if (result.importedAgentIds.length > 0) {
              setActiveAgentId(result.importedAgentIds[result.importedAgentIds.length - 1]);
            }
            setShowImportDialog(false);
            setPendingImportZipPath('');
            toast.success(t('toast.agentImported'));
          }}
          onInspect={inspectImportAgentPackage}
        />
      )}

      {editingAgent && (
        <AgentSettingsModal
          agent={editingAgent}
          channelGroups={visibleChannelGroups}
          onClose={() => setEditingAgentId(null)}
        />
      )}

      <AgentTopologySummaryModal
        open={!!topologyAgentId}
        agentId={topologyAgentId}
        communication={communication}
        onSyncAgentInstructions={syncAgentInstructions}
        onOpenSettings={(agentId) => {
          setTopologyAgentId(null);
          setEditingAgentId(agentId);
        }}
        onClose={() => setTopologyAgentId(null)}
      />

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={deletingAgentId ? t('deleting') : t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          const targetId = agentToDelete.id;
          setDeletingAgentId(targetId);
          try {
            await deleteAgent(targetId);
            const deletedId = targetId;
            setAgentToDelete(null);
            if (activeAgentId === deletedId) {
              setActiveAgentId(null);
            }
            if (editingAgentId === deletedId) {
              setEditingAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (error) {
            toast.error(t('toast.agentDeleteFailed', { error: String(error) }));
          } finally {
            setDeletingAgentId(null);
          }
        }}
        onCancel={() => {
          if (deletingAgentId) return;
          setAgentToDelete(null);
        }}
      />
    </div>
  );
}

function AgentCard({
  agent,
  channelGroups,
  isActive,
  onSelect,
  onOpenSettings,
  onDelete,
  isDeleting,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  isActive: boolean;
  onSelect: () => void;
  onOpenSettings: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { t } = useTranslation('agents');
  const boundChannelAccounts = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => {
        const channelName = CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType;
        const accountLabel =
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId;
        return `${channelName} · ${accountLabel}`;
      }),
  );
  const channelsText = boundChannelAccounts.length > 0
    ? boundChannelAccounts.join(', ')
    : t('none');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden border-border/45 bg-card hover:bg-card cursor-pointer',
        agent.isDefault && 'bg-card border-border/70 shadow-sm',
        isActive && 'border-primary/35 bg-primary/[0.04] shadow-sm',
      )}
    >
      <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-primary bg-primary/10 rounded-full shadow-sm mb-3">
        <Bot className="h-[22px] w-[22px]" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground truncate max-w-full">{agent.name}</h2>
            {agent.isDefault && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-background border border-border/50 shadow-none text-foreground/70"
              >
                <Check className="h-3 w-3" />
                {t('defaultBadge')}
              </Badge>
            )}
            {agent.inCommunicationNetwork && (
              <Badge
                variant="secondary"
                className="font-medium text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/15 shadow-none text-primary"
              >
                {t('communication.badges.inNetwork')}
              </Badge>
            )}
            {agent.spawnTargets.length > 0 && (
              <Badge
                variant="secondary"
                className="font-medium text-[10px] px-2 py-0.5 rounded-full bg-background border border-border/50 shadow-none text-foreground/70"
              >
                {t('communication.badges.spawnCount', { count: agent.spawnTargets.length })}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-70 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                disabled={isDeleting}
                title={t('deleteAgent')}
              >
                {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-card transition-all',
                !agent.isDefault && 'opacity-70 group-hover:opacity-100',
              )}
              onClick={(event) => {
                event.stopPropagation();
                onOpenSettings();
              }}
              title={t('settings')}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('modelLine', {
            model: agent.modelDisplay,
            suffix: agent.inheritedModel ? ` (${t('inherited')})` : '',
          })}
        </p>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('channelsLine', { channels: channelsText })}
        </p>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('communication.cardLine', {
            status: agent.inCommunicationNetwork ? t('communication.enabledShort') : t('communication.disabledShort'),
            targets: agent.spawnTargets.length > 0 ? agent.spawnTargets.join(', ') : t('none'),
          })}
        </p>
      </div>
    </div>
  );
}

function GlobalCommunicationCard({
  agents,
  communication,
  onSave,
  onSyncAgentInstructions,
  onSyncAllInstructions,
}: {
  agents: AgentSummary[];
  communication: AgentCommunicationConfig;
  onSave: (options: { enabled: boolean; allowedAgents: string[] }) => Promise<void>;
  onSyncAgentInstructions: (agentId: string) => Promise<void>;
  onSyncAllInstructions: () => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [enabled, setEnabled] = useState(communication.enabled);
  const [allowedAgents, setAllowedAgents] = useState<string[]>(communication.allowedAgents);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const networkAgents = useMemo(() => {
    const options = [...agents];
    if (!options.some((agent) => agent.id === 'main')) {
      options.unshift({
        id: 'main',
        name: t('communication.mainAgentName'),
        isDefault: true,
        modelDisplay: '-',
        modelRef: null,
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '',
        agentDir: '',
        mainSessionKey: '',
        channelTypes: [],
        inCommunicationNetwork: true,
        spawnTargets: [],
        instructionPreview: '',
        instructionSyncStatus: 'synced',
      });
    }
    return options;
  }, [agents, t]);
  const normalizedAllowedAgents = ensureMainAgent(allowedAgents, enabled);
  const normalizedPersistedAllowedAgents = ensureMainAgent(communication.allowedAgents, communication.enabled);

  useEffect(() => {
    setEnabled(communication.enabled);
    setAllowedAgents(ensureMainAgent(communication.allowedAgents, communication.enabled));
  }, [communication.allowedAgents, communication.enabled]);

  const hasChanges = enabled !== communication.enabled || !haveSameItems(normalizedAllowedAgents, normalizedPersistedAllowedAgents);

  const toggleAllowedAgent = (agentId: string) => {
    if (agentId === 'main') return;
    setAllowedAgents((current) => (
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ enabled, allowedAgents: normalizedAllowedAgents });
      toast.success(t('toast.communicationUpdated'));
    } catch (saveError) {
      toast.error(t('toast.communicationUpdateFailed', { error: String(saveError) }));
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string, failureMessage: string) => {
    setActionKey(key);
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error(failureMessage.replace('{{error}}', String(error)));
    } finally {
      setActionKey(null);
    }
  };

  const handleDiagnosticAction = async (diagnostic: AgentCommunicationConfig['diagnostics'][number]) => {
    const currentAllowedAgents = [...communication.allowedAgents];

    if (diagnostic.code === 'disabledWithSpawnTargets') {
      await runAction(
        'diagnostic-disabledWithSpawnTargets',
        () => onSave({ enabled: true, allowedAgents: ensureMainAgent(currentAllowedAgents, true) }),
        t('toast.communicationUpdated'),
        t('toast.communicationUpdateFailed', { error: '{{error}}' }),
      );
      return;
    }

    if (diagnostic.code === 'mainMissing') {
      await runAction(
        'diagnostic-mainMissing',
        () => onSave({ enabled: true, allowedAgents: ensureMainAgent(currentAllowedAgents, true) }),
        t('toast.communicationUpdated'),
        t('toast.communicationUpdateFailed', { error: '{{error}}' }),
      );
      return;
    }

    if (diagnostic.code === 'spawnTargetOutsideNetwork' && diagnostic.targetAgentId) {
      await runAction(
        `diagnostic-spawnTargetOutsideNetwork-${diagnostic.targetAgentId}`,
        () => onSave({
          enabled: true,
          allowedAgents: ensureMainAgent([...currentAllowedAgents, diagnostic.targetAgentId!], true),
        }),
        t('toast.communicationUpdated'),
        t('toast.communicationUpdateFailed', { error: '{{error}}' }),
      );
      return;
    }

    if (diagnostic.code === 'instructionsOutdated' && diagnostic.agentId) {
      await runAction(
        `diagnostic-instructionsOutdated-${diagnostic.agentId}`,
        () => onSyncAgentInstructions(diagnostic.agentId!),
        t('toast.instructionsSynced'),
        t('toast.instructionsSyncFailed', { error: '{{error}}' }),
      );
      return;
    }

    if (diagnostic.code === 'visibilityNotAll') {
      await runAction(
        'diagnostic-visibilityNotAll',
        () => onSave({ enabled: communication.enabled, allowedAgents: ensureMainAgent(currentAllowedAgents, communication.enabled) }),
        t('toast.communicationUpdated'),
        t('toast.communicationUpdateFailed', { error: '{{error}}' }),
      );
    }
  };

  const getDiagnosticActionLabel = (diagnostic: AgentCommunicationConfig['diagnostics'][number]) => {
    if (diagnostic.code === 'disabledWithSpawnTargets') return t('communication.actions.enableCommunication');
    if (diagnostic.code === 'mainMissing') return t('communication.actions.addMain');
    if (diagnostic.code === 'spawnTargetOutsideNetwork') return t('communication.actions.addTargetToNetwork');
    if (diagnostic.code === 'instructionsOutdated') return t('communication.actions.syncInstructions');
    if (diagnostic.code === 'visibilityNotAll') return t('communication.actions.normalizeVisibility');
    return null;
  };

  const getDiagnosticActionKey = (diagnostic: AgentCommunicationConfig['diagnostics'][number]) => {
    if (diagnostic.code === 'spawnTargetOutsideNetwork' && diagnostic.targetAgentId) {
      return `diagnostic-spawnTargetOutsideNetwork-${diagnostic.targetAgentId}`;
    }
    if (diagnostic.code === 'instructionsOutdated' && diagnostic.agentId) {
      return `diagnostic-instructionsOutdated-${diagnostic.agentId}`;
    }
    return `diagnostic-${diagnostic.code}`;
  };

  return (
    <Card data-testid="agents-communication-card" className="app-panel rounded-3xl border overflow-hidden shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-xl font-semibold tracking-tight">{t('communication.title')}</CardTitle>
            <CardDescription className="text-[14px] text-foreground/70 mt-1">
              {t('communication.description')}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => void runAction(
              'sync-all-instructions',
              () => onSyncAllInstructions(),
              t('toast.allInstructionsSynced'),
              t('toast.allInstructionsSyncFailed', { error: '{{error}}' }),
            )}
            disabled={actionKey === 'sync-all-instructions'}
            className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
          >
            {actionKey === 'sync-all-instructions' ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t('common:status.saving')}
              </>
            ) : (
              t('communication.syncAllInstructions')
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.summary.status')}
            </p>
            <div className="mt-2">
              <Badge
                variant="secondary"
                className={cn(
                  'font-medium text-[11px] px-2.5 py-1 rounded-full border shadow-none',
                  getCommunicationReadyStateClass(communication.readyState),
                )}
              >
                {t(`communication.readyState.${communication.readyState}`)}
              </Badge>
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.summary.networkAgents')}
            </p>
            <p className="mt-1 text-[18px] font-semibold text-foreground">
              {communication.networkAgentCount}
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.summary.dispatchRelations')}
            </p>
            <p className="mt-1 text-[18px] font-semibold text-foreground">
              {communication.dispatchRelationCount}
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.summary.instructions')}
            </p>
            <p className="mt-1 text-[18px] font-semibold text-foreground">
              {communication.outdatedInstructionCount}
            </p>
            <p className="mt-1 text-[12px] text-foreground/60">
              {t('communication.summary.instructionsHint')}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <Label htmlFor="agents-communication-enabled" className={labelClasses}>
              {t('communication.enableLabel')}
            </Label>
            <p className="text-[13px] text-foreground/60">
              {t('communication.enableDescription')}
            </p>
          </div>
          <Switch
            id="agents-communication-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={saving}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.visibilityLabel')}
            </p>
            <p className="mt-1 text-[13px] font-mono text-foreground">
              {communication.visibility || 'all'}
            </p>
            <p className="mt-1 text-[12px] text-foreground/60">
              {t('communication.visibilityHint')}
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
              {t('communication.allowedAgentsLabel')}
            </p>
            <p className="mt-1 text-[13px] text-foreground">
              {normalizedAllowedAgents.length > 0 ? normalizedAllowedAgents.join(', ') : t('none')}
            </p>
            <p className="mt-1 text-[12px] text-foreground/60">
              {t('communication.allowedAgentsHint')}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <Label className={labelClasses}>{t('communication.networkMembersLabel')}</Label>
          <div className="flex flex-wrap gap-2">
            {networkAgents.map((agent) => {
              const selected = normalizedAllowedAgents.includes(agent.id);
              const locked = agent.id === 'main';
              return (
                <Button
                  key={agent.id}
                  type="button"
                  variant="outline"
                  onClick={() => toggleAllowedAgent(agent.id)}
                  disabled={saving || locked}
                  className={cn(
                    'h-9 rounded-full px-4 text-[13px] shadow-none border-border/70 bg-card hover:bg-card',
                    selected && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10',
                    locked && 'opacity-100',
                  )}
                >
                  {agent.name}
                </Button>
              );
            })}
          </div>
          <p className="text-[12px] text-foreground/60">
            {t('communication.networkMembersHint')}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !hasChanges}
            className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t('common:status.saving')}
              </>
            ) : (
              t('common:actions.save')
            )}
          </Button>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label className={labelClasses}>{t('communication.diagnosticsTitle')}</Label>
            <Badge
              variant="secondary"
              className="font-medium text-[10px] px-2 py-0.5 rounded-full bg-background border border-border/50 shadow-none text-foreground/70"
            >
              {communication.diagnostics.length}
            </Badge>
          </div>
          {communication.diagnostics.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-4 text-[13.5px] text-foreground/70 shadow-sm">
              {t('communication.noDiagnostics')}
            </div>
          ) : (
            <div className="space-y-2">
              {communication.diagnostics.map((diagnostic, index) => (
                <div
                  key={`${diagnostic.code}-${diagnostic.agentId || 'global'}-${diagnostic.targetAgentId || 'none'}-${index}`}
                  className={cn(
                    'rounded-2xl border p-4 text-[13.5px] shadow-sm flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
                    diagnostic.severity === 'error'
                      ? 'border-destructive/30 bg-destructive/5 text-destructive'
                      : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                  )}
                >
                  <span>
                    {t(`communication.diagnostics.${diagnostic.code}`, {
                      agentId: diagnostic.agentId || '-',
                      targetAgentId: diagnostic.targetAgentId || '-',
                    })}
                  </span>
                  {getDiagnosticActionLabel(diagnostic) && (
                    <Button
                      variant="outline"
                      onClick={() => void handleDiagnosticAction(diagnostic)}
                      disabled={actionKey === getDiagnosticActionKey(diagnostic)}
                      className="h-8 shrink-0 text-[12px] font-medium rounded-full px-3 border-current/20 bg-background/80 hover:bg-background shadow-none text-current"
                    >
                      {actionKey === getDiagnosticActionKey(diagnostic) ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        getDiagnosticActionLabel(diagnostic)
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentTopologySummaryModal({
  open,
  agentId,
  communication,
  onSyncAgentInstructions,
  onOpenSettings,
  onClose,
}: {
  open: boolean;
  agentId: string | null;
  communication: AgentCommunicationConfig;
  onSyncAgentInstructions: (agentId: string) => Promise<void>;
  onOpenSettings: (agentId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const [syncingAgentId, setSyncingAgentId] = useState<string | null>(null);
  const entry = communication.topology.find((item) => item.agentId === agentId);

  const handleSync = async (agentId: string) => {
    setSyncingAgentId(agentId);
    try {
      await onSyncAgentInstructions(agentId);
      toast.success(t('toast.instructionsSynced'));
    } catch (error) {
      toast.error(t('toast.instructionsSyncFailed', { error: String(error) }));
    } finally {
      setSyncingAgentId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border/60">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{t('communication.topologyTitle')}</h3>
            <p className="text-[14px] text-foreground/70 mt-1">{t('communication.topologyDescription')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-card"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-6">
          {!entry ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
              {t('communication.noTopology')}
            </div>
          ) : (
            <div data-testid="agent-topology-modal" className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[18px] font-semibold text-foreground">{entry.name}</p>
                  <p className="text-[12px] font-mono text-foreground/60 mt-1">{entry.agentId}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      'font-medium text-[10px] px-2 py-0.5 rounded-full border shadow-none',
                      entry.inNetwork
                        ? 'bg-primary/10 border-primary/15 text-primary'
                        : 'bg-background border-border/50 text-foreground/70',
                    )}
                  >
                    {entry.inNetwork ? t('communication.badges.inNetwork') : t('communication.disabledShort')}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'font-medium text-[10px] px-2 py-0.5 rounded-full border shadow-none',
                      getInstructionStatusClass(entry.instructionSyncStatus),
                    )}
                  >
                    {t(`instructions.status.${entry.instructionSyncStatus}`)}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                    {t('communication.topologyReachable')}
                  </p>
                  <p className="mt-2 text-[13px] text-foreground">
                    {entry.reachableAgents.length > 0 ? entry.reachableAgents.join(', ') : t('none')}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                    {t('communication.topologySpawnTargets')}
                  </p>
                  <p className="mt-2 text-[13px] text-foreground">
                    {entry.spawnTargets.length > 0 ? entry.spawnTargets.join(', ') : t('none')}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {entry.instructionSyncStatus !== 'synced' && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSync(entry.agentId)}
                    disabled={syncingAgentId === entry.agentId}
                    className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
                  >
                    {syncingAgentId === entry.agentId ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      t('communication.actions.syncInstructions')
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => onOpenSettings(entry.agentId)}
                  className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
                >
                  {t('communication.openAgentSettings')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputClasses = 'app-field h-[44px] rounded-xl font-mono text-[13px] border focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'app-field h-[44px] w-full rounded-xl font-mono text-[13px] border focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground px-3';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function isImportAgentNameValid(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && /^[\x20-\x7E]+$/.test(trimmed);
}

const IMPORT_PACKAGE_INVALID_ERROR_MESSAGE = '成品包上传错误：请上传正确的成品包';

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[20px] h-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[20px] h-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[20px] h-[20px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[20px] h-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[20px] h-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[20px] h-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[20px] h-[20px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[20px] h-[20px] dark:invert" />;
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function AddAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, options: { inheritWorkspace: boolean }) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), { inheritWorkspace });
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50  flex items-center justify-center p-4">
      <Card className="app-panel w-full max-w-md rounded-3xl border overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-serif font-normal tracking-tight">
            {t('createDialog.title')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('createDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 p-6">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="inherit-workspace" className={labelClasses}>{t('createDialog.inheritWorkspaceLabel')}</Label>
              <p className="text-[13px] text-foreground/60">{t('createDialog.inheritWorkspaceDescription')}</p>
            </div>
            <Switch
              id="inherit-workspace"
              checked={inheritWorkspace}
              onCheckedChange={setInheritWorkspace}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim()}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ImportAgentDialog({
  initialZipPath,
  onClose,
  onInspect,
  onImport,
}: {
  initialZipPath: string;
  onClose: () => void;
  onInspect: (zipPath: string) => Promise<{
    sourceAgents: string[];
    sourceWorkspaces: string[];
    defaultMappings: Array<{
      sourceAgentDirName: string;
      sourceWorkspaceDirName: string;
      suggestedName: string;
    }>;
  }>;
  onImport: (zipPath: string, mappings: ImportPackageMapping[]) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [zipPath, setZipPath] = useState(initialZipPath);
  const [sourceAgents, setSourceAgents] = useState<string[]>([]);
  const [sourceWorkspaces, setSourceWorkspaces] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ImportPackageMapping[]>([]);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);

  const validateMappings = useCallback((items: ImportPackageMapping[]): string | null => {
    if (items.length === 0) {
      return t('toast.agentImportFailed', { error: IMPORT_PACKAGE_INVALID_ERROR_MESSAGE });
    }
    const names = new Set<string>();
    const sourceAgentsUsed = new Set<string>();
    const sourceWorkspacesUsed = new Set<string>();
    for (const item of items) {
      if (!isImportAgentNameValid(item.name)) {
        return t('importDialog.invalidName');
      }
      if (!sourceAgents.includes(item.sourceAgentDirName) || !sourceWorkspaces.includes(item.sourceWorkspaceDirName)) {
        return t('toast.agentImportFailed', { error: IMPORT_PACKAGE_INVALID_ERROR_MESSAGE });
      }
      const normalizedName = item.name.trim().toLowerCase();
      if (names.has(normalizedName)) {
        return t('importDialog.duplicateName');
      }
      if (sourceAgentsUsed.has(item.sourceAgentDirName) || sourceWorkspacesUsed.has(item.sourceWorkspaceDirName)) {
        return t('importDialog.duplicateSource');
      }
      names.add(normalizedName);
      sourceAgentsUsed.add(item.sourceAgentDirName);
      sourceWorkspacesUsed.add(item.sourceWorkspaceDirName);
    }
    return null;
  }, [sourceAgents, sourceWorkspaces, t]);

  const inspectZip = useCallback(async (nextZipPath: string) => {
    setInspectError(null);
    setInspecting(true);
    try {
      const inspected = await onInspect(nextZipPath);
      setSourceAgents(inspected.sourceAgents ?? []);
      setSourceWorkspaces(inspected.sourceWorkspaces ?? []);
      setMappings(
        (inspected.defaultMappings ?? []).map((item) => ({
          name: item.suggestedName || item.sourceAgentDirName,
          sourceAgentDirName: item.sourceAgentDirName,
          sourceWorkspaceDirName: item.sourceWorkspaceDirName,
        })),
      );
    } catch (error) {
      setSourceAgents([]);
      setSourceWorkspaces([]);
      setMappings([]);
      const message = String(error);
      setInspectError(message);
      toast.error(t('toast.agentImportFailed', { error: message }));
    } finally {
      setInspecting(false);
    }
  }, [onInspect, t]);

  useEffect(() => {
    if (zipPath.trim()) {
      void inspectZip(zipPath.trim());
    }
  }, [inspectZip, zipPath]);

  const handleBrowse = async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        title: t('importDialog.pickTitle'),
        properties: ['openFile'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.[0]) return;
      setZipPath(result.filePaths[0]);
    } catch (error) {
      toast.error(t('toast.importPickFailed', { error: String(error) }));
    }
  };

  const updateMapping = (index: number, patch: Partial<ImportPackageMapping>) => {
    setMappings((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async () => {
    if (!zipPath.trim()) return;
    const errorMessage = validateMappings(mappings);
    if (errorMessage) {
      toast.error(errorMessage);
      return;
    }
    setSaving(true);
    try {
      await onImport(zipPath.trim(), mappings.map((item) => ({
        name: item.name.trim(),
        sourceAgentDirName: item.sourceAgentDirName,
        sourceWorkspaceDirName: item.sourceWorkspaceDirName,
      })));
    } catch (error) {
      toast.error(t('toast.agentImportFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="app-panel w-full max-w-3xl rounded-3xl border overflow-hidden flex flex-col h-[80vh] max-h-[760px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-serif font-normal tracking-tight">
            {t('importDialog.title')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('importDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-4 space-y-6">
            <div className="space-y-2.5">
              <Label htmlFor="agent-import-zip" className={labelClasses}>{t('importDialog.packageLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-import-zip"
                  value={zipPath}
                  readOnly
                  placeholder={t('importDialog.packagePlaceholder')}
                  className={inputClasses}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleBrowse()}
                  disabled={saving}
                  className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
                >
                  {t('importDialog.browse')}
                </Button>
              </div>
            </div>
            {inspecting ? (
              <div className="rounded-2xl border border-border/60 bg-card p-4 text-[13px] text-foreground/70 shadow-sm">
                <RefreshCw className="h-4 w-4 inline-block mr-2 animate-spin" />
                {t('importDialog.inspecting')}
              </div>
            ) : inspectError ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive shadow-sm">
                {inspectError}
              </div>
            ) : (
              <div className="space-y-3">
                <Label className={labelClasses}>{t('importDialog.mappingTitle')}</Label>
                {mappings.map((mapping, index) => (
                  <div key={`${mapping.sourceAgentDirName}-${index}`} className="rounded-2xl border border-border/60 bg-card p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[12px] text-foreground/70">{t('importDialog.sourceAgentLabel')}</Label>
                        <select
                          className={selectClasses}
                          value={mapping.sourceAgentDirName}
                          onChange={(event) => updateMapping(index, { sourceAgentDirName: event.target.value })}
                          disabled={saving}
                        >
                          {sourceAgents.map((sourceAgent) => (
                            <option key={sourceAgent} value={sourceAgent}>
                              {sourceAgent}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[12px] text-foreground/70">{t('importDialog.sourceWorkspaceLabel')}</Label>
                        <select
                          className={selectClasses}
                          value={mapping.sourceWorkspaceDirName}
                          onChange={(event) => updateMapping(index, { sourceWorkspaceDirName: event.target.value })}
                          disabled={saving}
                        >
                          {sourceWorkspaces.map((sourceWorkspace) => (
                            <option key={sourceWorkspace} value={sourceWorkspace}>
                              {sourceWorkspace}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[12px] text-foreground/70">{t('importDialog.nameLabel')}</Label>
                      <Input
                        value={mapping.name}
                        onChange={(event) => updateMapping(index, { name: event.target.value })}
                        placeholder={t('importDialog.namePlaceholder')}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[12px] text-foreground/60">{t('importDialog.nameHint')}</p>
              </div>
            )}
            <div className="rounded-2xl border border-border/60 bg-card p-4 text-[13px] text-foreground/70 shadow-sm">
              {t('importDialog.replaceHint')}
            </div>
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/50 bg-background/95">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={saving || inspecting || !zipPath.trim() || mappings.length === 0 || !!inspectError}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('importing')}
                </>
              ) : (
                t('importDialog.confirm')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channelGroups,
  onClose,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { agents, communication, updateAgent, updateAgentCommunication, syncAgentInstructions, defaultModelRef } = useAgentsStore();
  const [name, setName] = useState(agent.name);
  const [spawnTargets, setSpawnTargets] = useState<string[]>(agent.spawnTargets);
  const [savingName, setSavingName] = useState(false);
  const [savingCommunication, setSavingCommunication] = useState(false);
  const [syncingInstructions, setSyncingInstructions] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  useEffect(() => {
    setSpawnTargets(agent.spawnTargets);
  }, [agent.spawnTargets]);

  const hasNameChanges = name.trim() !== agent.name;
  const hasCommunicationChanges = !haveSameItems(spawnTargets, agent.spawnTargets);
  const inCommunicationNetwork = communication.allowedAgents.includes(agent.id);
  const availableSpawnTargets = agents.filter((candidate) => (
    candidate.id !== agent.id
    && communication.allowedAgents.includes(candidate.id)
  ));

  const handleRequestClose = () => {
    if (savingName || savingCommunication || syncingInstructions || hasNameChanges || hasCommunicationChanges) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveCommunication = async () => {
    setSavingCommunication(true);
    try {
      await updateAgentCommunication(agent.id, { spawnTargets });
      toast.success(t('toast.agentCommunicationUpdated'));
    } catch (error) {
      toast.error(t('toast.agentCommunicationUpdateFailed', { error: String(error) }));
    } finally {
      setSavingCommunication(false);
    }
  };

  const handleSyncInstructions = async () => {
    setSyncingInstructions(true);
    try {
      await syncAgentInstructions(agent.id);
      toast.success(t('toast.instructionsSynced'));
    } catch (error) {
      toast.error(t('toast.instructionsSyncFailed', { error: String(error) }));
    } finally {
      setSyncingInstructions(false);
    }
  };

  const toggleSpawnTarget = (targetId: string) => {
    setSpawnTargets((current) => (
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId]
    ));
  };

  const assignedChannels = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => ({
        channelType: group.channelType as ChannelType,
        accountId: account.accountId,
        name:
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId,
        error: account.lastError,
      })),
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50  flex items-center justify-center p-4">
      <Card className="app-panel w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.title', { name: agent.name })}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.description')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-card"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={agent.isDefault}
                  className={inputClasses}
                />
                {!agent.isDefault && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === agent.name}
                    className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
                  >
                    {savingName ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      t('common:actions.save')
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-2xl bg-card border border-border/60 p-4 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModelModal(true)}
                className="space-y-1 rounded-2xl bg-card border border-border/60 p-4 text-left hover:bg-card transition-colors shadow-sm"
              >
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.modelLabel')}
                </p>
                <p className="text-[13.5px] text-foreground">
                  {agent.modelDisplay}
                  {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                </p>
                <p className="font-mono text-[12px] text-foreground/70 break-all">
                  {agent.modelRef || defaultModelRef || '-'}
                </p>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                  {t('instructions.title')}
                </h3>
                <p className="text-[14px] text-foreground/70 mt-1">{t('instructions.description')}</p>
              </div>
              <Badge
                variant="secondary"
                className={cn(
                  'font-medium text-[11px] px-2.5 py-1 rounded-full border shadow-none',
                  getInstructionStatusClass(agent.instructionSyncStatus),
                )}
              >
                {t(`instructions.status.${agent.instructionSyncStatus}`)}
              </Badge>
            </div>

            <div className="rounded-2xl bg-card border border-border/60 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-foreground/70">
                  {t('instructions.previewLabel')}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void handleSyncInstructions()}
                  disabled={syncingInstructions}
                  className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
                >
                  {syncingInstructions ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      {t('common:status.saving')}
                    </>
                  ) : (
                    t('instructions.syncAction')
                  )}
                </Button>
              </div>
              <Textarea
                readOnly
                value={agent.instructionPreview}
                className="min-h-[260px] resize-none rounded-2xl border-border/60 bg-background font-mono text-[12px] leading-5"
              />
              <p className="text-[12px] text-foreground/60">
                {t('instructions.hint')}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                  {t('communication.agentSectionTitle')}
                </h3>
                <p className="text-[14px] text-foreground/70 mt-1">{t('communication.agentSectionDescription')}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-2xl bg-card border border-border/60 p-4 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('communication.agentNetworkLabel')}
                </p>
                <p className="text-[13.5px] text-foreground">
                  {inCommunicationNetwork ? t('communication.enabledShort') : t('communication.disabledShort')}
                </p>
                <p className="text-[12px] text-foreground/60">
                  {inCommunicationNetwork ? t('communication.agentNetworkEnabledHint') : t('communication.agentNetworkDisabledHint')}
                </p>
              </div>
              <div className="space-y-1 rounded-2xl bg-card border border-border/60 p-4 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('communication.visibilityLabel')}
                </p>
                <p className="font-mono text-[13px] text-foreground">{communication.visibility || 'all'}</p>
                <p className="text-[12px] text-foreground/60">{t('communication.visibilityHint')}</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <Label className={labelClasses}>{t('communication.spawnTargetsLabel')}</Label>
              {!communication.enabled ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
                  {t('communication.enableFirstHint')}
                </div>
              ) : !inCommunicationNetwork ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
                  {t('communication.joinNetworkFirstHint')}
                </div>
              ) : availableSpawnTargets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
                  {t('communication.noEligibleTargets')}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableSpawnTargets.map((target) => {
                    const selected = spawnTargets.includes(target.id);
                    return (
                      <Button
                        key={target.id}
                        type="button"
                        variant="outline"
                        onClick={() => toggleSpawnTarget(target.id)}
                        disabled={savingCommunication}
                        className={cn(
                          'h-9 rounded-full px-4 text-[13px] shadow-none border-border/70 bg-card hover:bg-card',
                          selected && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10',
                        )}
                      >
                        {target.name}
                      </Button>
                    );
                  })}
                </div>
              )}
              <p className="text-[12px] text-foreground/60">
                {t('communication.spawnTargetsHint')}
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => void handleSaveCommunication()}
                disabled={savingCommunication || !hasCommunicationChanges || !communication.enabled || !inCommunicationNetwork}
                className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
              >
                {savingCommunication ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  t('communication.saveSpawnTargets')
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                  {t('settingsDialog.channelsTitle')}
                </h3>
                <p className="text-[14px] text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
              </div>
            </div>

            {assignedChannels.length === 0 && agent.channelTypes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div key={`${channel.channelType}-${channel.accountId}`} className="flex items-center justify-between rounded-2xl bg-card border border-border/60 p-4 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-background border border-border/60 rounded-full shadow-sm">
                        <ChannelLogo type={channel.channelType} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-foreground">{channel.name}</p>
                        <p className="text-[13.5px] text-muted-foreground">
                          {CHANNEL_NAMES[channel.channelType]} · {channel.accountId === 'default' ? t('settingsDialog.mainAccount') : channel.accountId}
                        </p>
                        {channel.error && (
                          <p className="text-xs text-destructive mt-1">{channel.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0" />
                  </div>
                ))}
                {assignedChannels.length === 0 && agent.channelTypes.length > 0 && (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4 text-[13.5px] text-muted-foreground shadow-sm">
                    {t('settingsDialog.channelsManagedInChannels')}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {showModelModal && (
        <AgentModelModal
          agent={agent}
          onClose={() => setShowModelModal(false)}
        />
      )}
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          setName(agent.name);
          setSpawnTargets(agent.spawnTargets);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

function AgentModelModal({
  agent,
  onClose,
}: {
  agent: AgentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const { updateAgentModel, defaultModelRef } = useAgentsStore();
  const [selectedRuntimeProviderKey, setSelectedRuntimeProviderKey] = useState('');
  const [modelIdInput, setModelIdInput] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const runtimeProviderOptions = useMemo<RuntimeProviderOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
    const entries = providerAccounts
      .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
      .sort((left, right) => {
        if (left.id === providerDefaultAccountId) return -1;
        if (right.id === providerDefaultAccountId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const deduped = new Map<string, RuntimeProviderOption>();
    for (const account of entries) {
      const runtimeProviderKey = resolveRuntimeProviderKey(account);
      if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const label = `${account.label} (${vendor?.name || account.vendorId})`;
      const configuredModelId = account.model
        ? (account.model.startsWith(`${runtimeProviderKey}/`)
          ? account.model.slice(runtimeProviderKey.length + 1)
          : account.model)
        : undefined;

      deduped.set(runtimeProviderKey, {
        runtimeProviderKey,
        accountId: account.id,
        label,
        modelIdPlaceholder: vendor?.modelIdPlaceholder,
        configuredModelId,
      });
    }

    return [...deduped.values()];
  }, [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors]);

  useEffect(() => {
    const override = splitModelRef(agent.overrideModelRef);
    if (override) {
      setSelectedRuntimeProviderKey(override.providerKey);
      setModelIdInput(override.modelId);
      return;
    }

    const effective = splitModelRef(agent.modelRef || defaultModelRef);
    if (effective) {
      setSelectedRuntimeProviderKey(effective.providerKey);
      setModelIdInput(effective.modelId);
      return;
    }

    setSelectedRuntimeProviderKey(runtimeProviderOptions[0]?.runtimeProviderKey || '');
    setModelIdInput('');
  }, [agent.modelRef, agent.overrideModelRef, defaultModelRef, runtimeProviderOptions]);

  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === selectedRuntimeProviderKey) || null;
  const trimmedModelId = modelIdInput.trim();
  const nextModelRef = selectedRuntimeProviderKey && trimmedModelId
    ? `${selectedRuntimeProviderKey}/${trimmedModelId}`
    : '';
  const normalizedDefaultModelRef = (defaultModelRef || '').trim();
  const isUsingDefaultModelInForm = Boolean(normalizedDefaultModelRef) && nextModelRef === normalizedDefaultModelRef;
  const currentOverrideModelRef = (agent.overrideModelRef || '').trim();
  const desiredOverrideModelRef = nextModelRef && nextModelRef !== normalizedDefaultModelRef
    ? nextModelRef
    : null;
  const modelChanged = (desiredOverrideModelRef || '') !== currentOverrideModelRef;

  const handleRequestClose = () => {
    if (savingModel || modelChanged) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = async () => {
    if (!selectedRuntimeProviderKey) {
      toast.error(t('toast.agentModelProviderRequired'));
      return;
    }
    if (!trimmedModelId) {
      toast.error(t('toast.agentModelIdRequired'));
      return;
    }
    if (!modelChanged) return;
    if (!nextModelRef.includes('/')) {
      toast.error(t('toast.agentModelInvalid'));
      return;
    }

    setSavingModel(true);
    try {
      await updateAgentModel(agent.id, desiredOverrideModelRef);
      toast.success(desiredOverrideModelRef ? t('toast.agentModelUpdated') : t('toast.agentModelReset'));
      onClose();
    } catch (error) {
      toast.error(t('toast.agentModelUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };

  const handleUseDefaultModel = () => {
    const parsedDefault = splitModelRef(normalizedDefaultModelRef);
    if (!parsedDefault) {
      setSelectedRuntimeProviderKey('');
      setModelIdInput('');
      return;
    }
    setSelectedRuntimeProviderKey(parsedDefault.providerKey);
    setModelIdInput(parsedDefault.modelId);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50  flex items-center justify-center p-4">
      <Card className="app-panel w-full max-w-xl rounded-3xl border overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.modelLabel')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.modelOverrideDescription', { defaultModel: defaultModelRef || '-' })}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-card"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="agent-model-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
            <select
              id="agent-model-provider"
              value={selectedRuntimeProviderKey}
              onChange={(event) => {
                const nextProvider = event.target.value;
                setSelectedRuntimeProviderKey(nextProvider);
                if (!modelIdInput.trim()) {
                  const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                  setModelIdInput(option?.configuredModelId || '');
                }
              }}
              className={selectClasses}
            >
              <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
              {runtimeProviderOptions.map((option) => (
                <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model-id" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
            <Input
              id="agent-model-id"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              placeholder={selectedProvider?.modelIdPlaceholder || selectedProvider?.configuredModelId || t('settingsDialog.modelIdPlaceholder')}
              className={inputClasses}
            />
          </div>
          {!!nextModelRef && (
            <p className="text-[12px] font-mono text-foreground/70 break-all">
              {t('settingsDialog.modelPreview')}: {nextModelRef}
            </p>
          )}
          {runtimeProviderOptions.length === 0 && (
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              {t('settingsDialog.modelProviderEmpty')}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleUseDefaultModel}
              disabled={savingModel || !normalizedDefaultModelRef || isUsingDefaultModelInForm}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('settingsDialog.useDefaultModel')}
            </Button>
            <Button
              variant="outline"
              onClick={handleRequestClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-border/70 bg-card hover:bg-card shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSaveModel()}
              disabled={savingModel || !selectedRuntimeProviderKey || !trimmedModelId || !modelChanged}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {savingModel ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

export default Agents;
