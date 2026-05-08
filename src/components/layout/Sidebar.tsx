﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  FolderOpen,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  Trash2,
  Cpu,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import logoPng from '@/assets/logo.png';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed?: boolean;
  rail?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, collapsed, rail, label, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          rail
            ? 'app-soft-hover group relative flex h-10 w-10 items-center justify-center rounded-2xl text-foreground/80'
            : 'app-soft-hover flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] font-medium text-foreground/80',
          isActive ? 'app-segment-active text-foreground shadow-sm' : '',
          collapsed && !rail && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn("flex shrink-0 items-center justify-center", isActive ? "text-foreground" : "text-muted-foreground")}>
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
            </>
          )}
          {rail && (
            <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border/40 bg-popover px-2.5 py-1.5 text-[12px] font-medium text-popover-foreground opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
              {label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

const INITIAL_NOW_MS = Date.now();

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const setPresetTargetAgentId = useChatStore((s) => s.setPresetTargetAgentId);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sessionLabels[key] ?? label ?? displayName ?? key;

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [showAgentFilterMenu, setShowAgentFilterMenu] = useState(false);
  const [showNewSessionAgentDialog, setShowNewSessionAgentDialog] = useState(false);
  const [pendingNewSessionAgentId, setPendingNewSessionAgentId] = useState<string | null>(null);
  const agentFilterMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const agentFilterOptions = useMemo(() => {
    const ids = new Set<string>(['main']);
    for (const agent of agents ?? []) ids.add(agent.id);
    for (const session of sessions) ids.add(getAgentIdFromSessionKey(session.key));
    return Array.from(ids).map((id) => ({
      id,
      label: agentNameById[id] || id,
    }));
  }, [agentNameById, agents, sessions]);
  const newSessionAgentOptions = useMemo(
    () => ([
      {
        id: 'main',
        name: 'main',
        modelDisplay: defaultModelRef || '默认 Agent',
      },
      ...(agents ?? [])
        .filter((agent) => agent.id !== 'main')
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          modelDisplay: agent.modelDisplay,
        })),
    ]),
    [agents, defaultModelRef],
  );

  useEffect(() => {
    if (!showNewSessionAgentDialog) {
      return;
    }
    if (pendingNewSessionAgentId && newSessionAgentOptions.some((agent) => agent.id === pendingNewSessionAgentId)) {
      return;
    }
    const fallbackAgent = newSessionAgentOptions.find((agent) => agent.id === 'main')
      ?? newSessionAgentOptions.find((agent) => agent.id === defaultAgentId)
      ?? newSessionAgentOptions[0]
      ?? null;
    setPendingNewSessionAgentId(fallbackAgent?.id ?? null);
  }, [defaultAgentId, newSessionAgentOptions, pendingNewSessionAgentId, showNewSessionAgentDialog]);

  useEffect(() => {
    if (selectedAgentId !== 'all' && !agentFilterOptions.some((option) => option.id === selectedAgentId)) {
      setSelectedAgentId('all');
    }
  }, [agentFilterOptions, selectedAgentId]);

  useEffect(() => {
    if (!showAgentFilterMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!agentFilterMenuRef.current?.contains(event.target as Node)) {
        setShowAgentFilterMenu(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showAgentFilterMenu]);

  const selectedAgentLabel = selectedAgentId === 'all'
    ? t('sidebar.allAgents')
    : (agentFilterOptions.find((option) => option.id === selectedAgentId)?.label || selectedAgentId);

  const handleStartNewChat = () => {
    setShowNewSessionAgentDialog(true);
  };

  const handleConfirmNewChatAgent = () => {
    if (!pendingNewSessionAgentId) {
      return;
    }
    const { messages, currentSessionKey, sessionLastActivity, sessionLabels } = useChatStore.getState();
    const isReusableEmptyMainSession = getAgentIdFromSessionKey(currentSessionKey) === 'main'
      && currentSessionKey.endsWith(':main')
      && messages.length === 0
      && !sessionLastActivity[currentSessionKey]
      && !sessionLabels[currentSessionKey];
    setPresetTargetAgentId(pendingNewSessionAgentId === 'main' ? null : pendingNewSessionAgentId);
    if (!isReusableEmptyMainSession) {
      newSession('main');
    }
    setShowNewSessionAgentDialog(false);
    navigate('/');
  };

  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = [
    { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
    { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
    { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
    { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
    { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
    { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
  ];
  const sessionBucketMap = Object.fromEntries(sessionBuckets.map((bucket) => [bucket.key, bucket])) as Record<
    SessionBucketKey,
    (typeof sessionBuckets)[number]
  >;

  const visibleSessions = selectedAgentId === 'all'
    ? sessions
    : sessions.filter((session) => getAgentIdFromSessionKey(session.key) === selectedAgentId);

  for (const session of [...visibleSessions].sort((a, b) =>
    (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )) {
    const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const navItems = [
    { to: '/models', icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/agents', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: '/files', icon: <FolderOpen className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.files', { defaultValue: '文件管理' }), testId: 'sidebar-nav-files' },
    { to: '/channels', icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    { to: '/skills', icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'app-sidebar-surface flex min-h-0 shrink-0 overflow-hidden transition-all duration-300',
        sidebarCollapsed ? 'w-[72px]' : 'w-[328px]'
      )}
    >
      <div className="flex h-full min-h-0 w-16 flex-col items-center gap-2 border-r border-border/40 px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="group relative h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:bg-card"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border/40 bg-popover px-2.5 py-1.5 text-[12px] font-medium text-popover-foreground opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
            {sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          </span>
        </Button>

        <div className="flex flex-1 flex-col items-center gap-2 pt-2">
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              {...item}
              collapsed
              rail
            />
          ))}
        </div>

        <NavItem
          to="/settings"
          label={t('sidebar.settings')}
          icon={<SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />}
          collapsed
          rail
          testId="sidebar-nav-settings"
        />

        <Button
          data-testid="sidebar-open-dev-console"
          variant="ghost"
          className="app-soft-hover group relative flex h-10 w-10 items-center justify-center rounded-2xl text-foreground/80"
          onClick={openDevConsole}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <Terminal className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border/40 bg-popover px-2.5 py-1.5 text-[12px] font-medium text-popover-foreground opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
            {t('common:sidebar.openClawPage')}
          </span>
        </Button>
      </div>

      {!sidebarCollapsed && (
        <div className="flex min-h-0 flex-1 flex-col bg-background/50">
          <div className="border-b border-border/40 px-3 py-3">
            <div className="mb-3 flex items-center gap-2 overflow-hidden px-1">
              <img src={logoPng} alt="ClawX-Cat" className="h-5 w-auto shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground/90">ClawX-Cat</div>
                <div className="truncate text-[11px] text-muted-foreground">{t('sidebar.newChat')}</div>
              </div>
            </div>
            <button
              data-testid="sidebar-new-chat"
              onClick={handleStartNewChat}
              className="flex w-full items-center gap-2.5 rounded-full border border-border/70 bg-card px-3 py-2.5 text-[14px] font-medium text-foreground shadow-sm transition-colors hover:bg-card/90"
            >
              <div className="flex shrink-0 items-center justify-center text-foreground/80">
                <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>
            </button>
            <div className="mt-3 space-y-1 px-1">
              <div className="text-[11px] font-medium text-muted-foreground/70">{t('sidebar.agents')}</div>
              <div className="relative" ref={agentFilterMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAgentFilterMenu((value) => !value)}
                  className="flex h-9 w-full min-w-0 items-center justify-between rounded-xl border border-border/40 bg-card px-3 text-[13px] text-foreground shadow-sm transition-colors hover:bg-card/90"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{selectedAgentLabel}</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', showAgentFilterMenu && 'rotate-180')} />
                </button>
                {showAgentFilterMenu && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-2xl border border-border/40 bg-card p-2 shadow-lg">
                    <div className="space-y-1">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                        onClick={() => {
                          setSelectedAgentId('all');
                          setShowAgentFilterMenu(false);
                        }}
                      >
                        <span>{t('sidebar.allAgents')}</span>
                        {selectedAgentId === 'all' ? <span className="text-blue-600">{t('common:status.active')}</span> : null}
                      </button>
                      {agentFilterOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                          onClick={() => {
                            setSelectedAgentId(option.id);
                            setShowAgentFilterMenu(false);
                          }}
                        >
                          <span className="truncate">{option.label}</span>
                          {selectedAgentId === option.id ? <span className="text-blue-600">{t('common:status.active')}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-0.5">
            {visibleSessions.length > 0 ? (
              sessionBuckets.map((bucket) => (
                bucket.sessions.length > 0 ? (
                  <div key={bucket.key} className="pt-2">
                    <div className="px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/60 tracking-tight">
                      {bucket.label}
                    </div>
                    {bucket.sessions.map((s) => {
                      const agentId = getAgentIdFromSessionKey(s.key);
                      const agentName = agentNameById[agentId] || agentId;
                      return (
                        <div key={s.key} className="group relative flex items-center">
                          <button
                            onClick={() => { switchSession(s.key); navigate('/'); }}
                            className={cn(
                              'w-full min-w-0 overflow-hidden text-left rounded-xl px-2.5 py-1.5 text-[13px] transition-colors pr-7',
                              'hover:bg-card',
                              isOnChat && currentSessionKey === s.key
                                ? 'bg-card text-foreground font-medium shadow-sm'
                                : 'text-foreground/75',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[10px] font-medium text-foreground/70 shadow-sm">
                                {agentName}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {getSessionLabel(s.key, s.displayName, s.label)}
                              </span>
                            </div>
                          </button>
                          <button
                            aria-label="Delete session"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDelete({
                                key: s.key,
                                label: getSessionLabel(s.key, s.displayName, s.label),
                              });
                            }}
                            className={cn(
                              'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                              'opacity-0 group-hover:opacity-100',
                              'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                            )}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null
              ))
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
                {t('sidebar.newChat')}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />

      {showNewSessionAgentDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card shadow-2xl">
            <div className="border-b border-border/50 px-6 py-5">
              <h3 className="text-lg font-bold text-foreground">{t('chat:newSessionAgentDialog.title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('chat:newSessionAgentDialog.description')}</p>
            </div>
            <div className="space-y-3 px-5 py-5">
              {newSessionAgentOptions.map((agent) => {
                const active = pendingNewSessionAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setPendingNewSessionAgentId(agent.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all',
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/60 bg-white hover:border-primary/40 hover:bg-muted/20',
                    )}
                  >
                    <div className={cn(
                      'mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                      active ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                    )} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-foreground">{agent.name}</div>
                      <div className="truncate text-[12px] text-muted-foreground">{agent.modelDisplay}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-4">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowNewSessionAgentDialog(false);
                  setPendingNewSessionAgentId(null);
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button onClick={handleConfirmNewChatAgent} disabled={!pendingNewSessionAgentId}>
                {t('chat:newSessionAgentDialog.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
