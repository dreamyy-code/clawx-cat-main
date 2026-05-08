﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Puzzle,
  Lock,
  Package,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  RefreshCw,
  FolderOpen,
  FileCode,
  Globe,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { toast } from 'sonner';
import type { Skill, MarketplaceSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const INSTALL_ERROR_CODES = new Set(['installTimeoutError', 'installRateLimitError']);
const FETCH_ERROR_CODES = new Set(['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError']);
const SEARCH_ERROR_CODES = new Set(['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError']);



// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string) => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Extra dirs' });
  if (source === 'agents-skills-personal') return t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  return source;
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize config from skill
  useEffect(() => {
    if (!skill) return;

    // API Key
    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    // Env Vars
    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
  }, [skill]);

  const handleOpenSkillHub = async () => {
    if (!skill?.slug) return;
    await invokeIpc('shell:openExternal', 'https://skillhub.tencent.com/');
  };

  const handleOpenEditor = async () => {
    if (!skill?.id) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-readme', {
        method: 'POST',
        body: JSON.stringify({ skillKey: skill.id, slug: skill.slug, baseDir: skill.baseDir }),
      });
      if (result.success) {
        toast.success(t('toast.openedEditor'));
      } else {
        toast.error(result.error || t('toast.failedEditor'));
      }
    } catch (err) {
      toast.error(t('toast.failedEditor') + ': ' + String(err));
    }
  };

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Use direct file access instead of Gateway RPC for reliability
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        'skill:updateConfig',
        {
          skillKey: skill.id,
          apiKey: apiKey || '', // Empty string will delete the key
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills();

      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-border/70 bg-background shadow-[0_0_40px_rgba(0,0,0,0.2)] "
        side="right"
      >
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-card border border-border/60 shrink-0 mb-4 relative shadow-sm">
              <span className="text-3xl">{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-1 shadow-sm border border-border/60">
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
            <h2 className="text-[28px] font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {skill.name}
            </h2>
            <div className="flex items-center justify-center gap-2.5 mb-6 opacity-80">
              <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-background hover:bg-card border border-border/50 shadow-none text-foreground/70 transition-colors">
                v{skill.version}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-background hover:bg-card border border-border/50 shadow-none text-foreground/70 transition-colors">
                {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
              </Badge>
            </div>

            {skill.description && (
              <p className="text-[14px] text-foreground/70 font-medium leading-[1.6] text-center px-4">
                {skill.description}
              </p>
            )}
          </div>

          <div className="space-y-7 px-1">
            <div className="space-y-2">
              <h3 className="text-[13px] font-bold text-foreground/80">{t('detail.source')}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-background border border-border/50 shadow-none text-foreground/70">
                  {resolveSkillSourceLabel(skill, t)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="app-field h-[38px] font-mono text-[12px] border rounded-xl text-foreground/70"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-border/70 bg-card hover:bg-card"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-border/70 bg-card hover:bg-card"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* API Key Section */}
            {!skill.isCore && (
              <div className="space-y-2">
                <h3 className="text-[13px] font-bold flex items-center gap-2 text-foreground/80">
                  <Key className="h-3.5 w-3.5 text-blue-500" />
                  {t('detail.apiKey')}
                </h3>
                <Input
                  placeholder={t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  className="app-field h-[44px] font-mono text-[13px] border rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
                <p className="text-[12px] text-foreground/50 mt-2 font-medium">
                  {t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                </p>
              </div>
            )}

            {/* Environment Variables Section */}
            {!skill.isCore && (
              <div className="space-y-3">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-bold text-foreground/80">
                      {t('detail.envVars')}
                      {envVars.length > 0 && (
                        <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px] h-5 bg-background border border-border/50 text-foreground">
                          {envVars.length}
                        </Badge>
                      )}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[12px] font-semibold text-foreground/80 gap-1.5 px-2.5 hover:bg-card"
                    onClick={handleAddEnv}
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} />
                    {t('detail.addVariable', 'Add Variable')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {envVars.length === 0 && (
                    <div className="text-[13px] text-foreground/50 font-medium italic flex items-center bg-card border border-border/60 rounded-xl px-4 py-3 shadow-sm">
                      {t('detail.noEnvVars', 'No environment variables configured.')}
                    </div>
                  )}

                  {envVars.map((env, index) => (
                    <div className="flex items-center gap-3" key={index}>
                      <Input
                        value={env.key}
                        onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                        className="app-field flex-1 h-[40px] font-mono text-[13px] border rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm text-foreground"
                        placeholder={t('detail.keyPlaceholder', 'Key')}
                      />
                      <Input
                        value={env.value}
                        onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                        className="app-field flex-1 h-[40px] font-mono text-[13px] border rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm text-foreground"
                        placeholder={t('detail.valuePlaceholder', 'Value')}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-xl transition-colors"
                        onClick={() => handleRemoveEnv(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* External Links */}
            {skill.slug && !skill.isBundled && !skill.isCore && (
              <div className="flex gap-2 justify-center pt-8">
                <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-border/70 bg-card hover:bg-card shadow-none text-foreground/70" onClick={handleOpenSkillHub}>
                  <Globe className="h-[12px] w-[12px]" />
                  SkillHub
                </Button>
                <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-border/70 bg-card hover:bg-card shadow-none text-foreground/70" onClick={handleOpenEditor}>
                  <FileCode className="h-[12px] w-[12px]" />
                  {t('detail.openManual')}
                </Button>
              </div>
            )}
          </div>

          {/* Centered Footer Buttons */}
          <div className="pt-8 pb-4 flex items-center justify-center gap-4 w-full px-2 max-w-[340px] mx-auto">
            {!skill.isCore && (
              <Button
                onClick={handleSaveConfig}
                className={cn(
                  "flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm border border-transparent transition-all",
                  "bg-[#0a84ff] hover:bg-[#007aff] text-white"
                )}
                disabled={isSaving}
              >
                {isSaving ? t('detail.saving') : t('detail.saveConfig')}
              </Button>
            )}

            {!skill.isCore && (
              <Button
                variant="outline"
                className="flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm bg-card border-border/70 hover:bg-card transition-colors text-foreground/80 hover:text-foreground"
                onClick={() => {
                  if (!skill.isBundled && onUninstall && skill.slug) {
                    onUninstall(skill.slug);
                    onClose();
                  } else {
                    onToggle(!skill.enabled);
                  }
                }}
              >
                {!skill.isBundled && onUninstall
                  ? t('detail.uninstall')
                  : (skill.enabled ? t('detail.disable') : t('detail.enable'))}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const agents = useAgentsStore((state) => state.agents);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const [searchQuery, setSearchQuery] = useState('');
  const [installQuery, setInstallQuery] = useState('');
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');
  const [installTargetMode, setInstallTargetMode] = useState<'global' | 'agent'>('global');
  const [installAgentId, setInstallAgentId] = useState('main');
  const [pendingInstallSkill, setPendingInstallSkill] = useState<MarketplaceSkill | null>(null);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  const safeSkills = Array.isArray(skills) ? skills : [];
  const filteredSkills = safeSkills.filter((skill) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      q.length === 0 ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.id.toLowerCase().includes(q) ||
      (skill.slug || '').toLowerCase().includes(q) ||
      (skill.author || '').toLowerCase().includes(q);

    let matchesSource = true;
    if (selectedSource === 'built-in') {
      matchesSource = !!skill.isBundled;
    } else if (selectedSource === 'marketplace') {
      matchesSource = !skill.isBundled;
    }

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  });

  const sourceStats = {
    all: safeSkills.length,
    builtIn: safeSkills.filter(s => s.isBundled).length,
    marketplace: safeSkills.filter(s => !s.isBundled).length,
  };

  const bulkToggleVisible = useCallback(async (enable: boolean) => {
    const candidates = filteredSkills.filter((skill) => !skill.isCore && skill.enabled !== enable);
    if (candidates.length === 0) {
      toast.info(enable ? t('toast.noBatchEnableTargets') : t('toast.noBatchDisableTargets'));
      return;
    }

    let succeeded = 0;
    for (const skill of candidates) {
      try {
        if (enable) {
          await enableSkill(skill.id);
        } else {
          await disableSkill(skill.id);
        }
        succeeded += 1;
      } catch {
        // Continue to next skill and report final summary.
      }
    }

    trackUiEvent('skills.batch_toggle', { enable, total: candidates.length, succeeded });
    if (succeeded === candidates.length) {
      toast.success(enable ? t('toast.batchEnabled', { count: succeeded }) : t('toast.batchDisabled', { count: succeeded }));
      return;
    }
    toast.warning(t('toast.batchPartial', { success: succeeded, total: candidates.length }));
  }, [disableSkill, enableSkill, filteredSkills, t]);

  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill, t]);

  const hasInstalledSkills = safeSkills.some(s => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await invokeIpc<string>('openclaw:getSkillsDir');
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await invokeIpc<string>('shell:openPath', skillsDir);
      if (result) {
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(async (skill: Skill) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-path', {
        method: 'POST',
        body: JSON.stringify({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to open folder');
      }
    } catch (err) {
      toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
    }
  }, [t]);

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    invokeIpc<string>('openclaw:getSkillsDir')
      .then((dir) => setSkillsDirPath(dir as string))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!installSheetOpen) {
      return;
    }
    void fetchAgents().catch(() => {});

    const query = installQuery.trim();
    if (query.length === 0) {
      searchSkills('');
      return;
    }

    const timer = setTimeout(() => {
      searchSkills(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchAgents, installQuery, installSheetOpen, searchSkills]);

  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug, undefined, {
        targetMode: installTargetMode,
        agentId: installTargetMode === 'agent' ? installAgentId : undefined,
      });
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (INSTALL_ERROR_CODES.has(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [enableSkill, installAgentId, installSkill, installTargetMode, t, skillsDirPath]);

  const getInstallTargetPath = useCallback(() => {
    if (installTargetMode === 'agent') {
      return installAgentId === 'main'
        ? '~/.openclaw/workspace/skills'
        : `~/.openclaw/workspace-${installAgentId}/skills`;
    }
    return '~/.openclaw/skills';
  }, [installAgentId, installTargetMode]);

  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, t]);

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="skills-page" className="flex flex-col h-full overflow-hidden bg-background">
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

          <div className="flex items-center gap-3 md:mt-2">
            <button
              onClick={() => {
                setInstallQuery('');
                setInstallSheetOpen(true);
              }}
              className="hover:bg-card transition-colors shrink-0 text-[13px] font-medium px-4 h-8 rounded-full border border-border/70 bg-card flex items-center justify-center text-foreground/80 hover:text-foreground"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('actions.downloadSkill')}
            </button>
            {hasInstalledSkills && (
              <button
                onClick={handleOpenSkillsFolder}
                className="hover:bg-card transition-colors shrink-0 text-[13px] font-medium px-4 h-8 rounded-full border border-border/70 bg-card flex items-center justify-center text-foreground/80 hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('openFolder')}
              </button>
            )}
          </div>
        </div>

        {/* Gateway Warning */}
        {showGatewayWarning && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {/* Sub Navigation and Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-border/70 pb-4 mb-4 shrink-0 gap-4">
          <div className="flex items-center flex-wrap gap-4 text-[14px]">
            <div className="relative group flex items-center bg-card rounded-full px-3 py-1.5 focus-within:bg-card transition-colors border border-border/60 mr-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-[13px] text-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setSelectedSource('all')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'all' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.all', { count: sourceStats.all })}
              </button>
              <button
                onClick={() => setSelectedSource('built-in')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'built-in' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.builtIn', { count: sourceStats.builtIn })}
              </button>
              <button
                onClick={() => setSelectedSource('marketplace')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'marketplace' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.marketplace', { count: sourceStats.marketplace })}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkToggleVisible(true)}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-border/70 bg-card hover:bg-card shadow-none"
            >
              {t('actions.enableVisible')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkToggleVisible(false)}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-border/70 bg-card hover:bg-card shadow-none"
            >
              {t('actions.disableVisible')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchSkills}
              disabled={!isGatewayRunning}
              className="h-8 w-8 ml-1 rounded-md border-border/70 bg-card hover:bg-card shadow-none text-muted-foreground hover:text-foreground"
              title={t('refresh')}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {FETCH_ERROR_CODES.has(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1 rounded-2xl border border-border/40 bg-card shadow-sm p-2">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-border/40 last:border-0"
                  onClick={() => setSelectedSkill(skill)}
                >
                  <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                    <div className="h-10 w-10 shrink-0 flex items-center justify-center text-2xl bg-background border border-border/60 rounded-xl overflow-hidden">
                      {skill.icon || '🧩'}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                        {skill.isCore ? (
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        ) : skill.isBundled ? (
                          <Puzzle className="h-3 w-3 text-blue-500/70" />
                        ) : null}
                        {skill.slug && skill.slug !== skill.name ? (
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
                            {skill.slug}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                        {skill.description}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/55">
                        <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-medium bg-background border border-border/50 shadow-none">
                          {resolveSkillSourceLabel(skill, t)}
                        </Badge>
                        <span className="truncate font-mono">
                          {skill.baseDir || t('detail.pathUnavailable')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0" onClick={e => e.stopPropagation()}>
                    {skill.version && (
                      <span className="text-[13px] font-mono text-muted-foreground">
                        v{skill.version}
                      </span>
                    )}
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                      disabled={skill.isCore}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>

      <Sheet open={installSheetOpen} onOpenChange={setInstallSheetOpen}>
        <SheetContent
          className="w-full sm:max-w-[560px] p-0 flex flex-col border-l border-border/40 bg-card shadow-[0_0_40px_rgba(0,0,0,0.2)] "
          side="right"
        >
          <div className="px-7 py-6 border-b border-border/70">
            <h2 className="text-[24px] font-serif text-foreground font-normal tracking-tight">{t('marketplace.installDialogTitle')}</h2>
            <p className="mt-1 text-[13px] text-foreground/70">{t('marketplace.installDialogSubtitle')}</p>
            <div className="mt-4 flex flex-col md:flex-row gap-2">
              <div className="relative flex items-center bg-card rounded-xl px-3 py-2 border border-border/60 flex-1">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  placeholder={t('searchMarketplace')}
                  value={installQuery}
                  onChange={(e) => setInstallQuery(e.target.value)}
                  className="ml-2 h-auto border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px]"
                />
                {installQuery && (
                  <button
                    type="button"
                    onClick={() => setInstallQuery('')}
                    className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                variant="outline"
                disabled
                className="h-10 rounded-xl border-border/70 bg-card text-muted-foreground"
              >
                {t('marketplace.sourceLabel')}: {t('marketplace.sourceSkillHub', { defaultValue: 'SkillHub Tencent' })}
              </Button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="rounded-xl border border-border/60 bg-background p-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setInstallTargetMode('global')}
                  className={cn(
                    'flex-1 h-9 rounded-lg text-[13px] font-medium transition-colors',
                    installTargetMode === 'global'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground/70 hover:text-foreground',
                  )}
                >
                  {t('marketplace.installGlobal', { defaultValue: '全局安装' })}
                </button>
                <button
                  type="button"
                  onClick={() => setInstallTargetMode('agent')}
                  className={cn(
                    'flex-1 h-9 rounded-lg text-[13px] font-medium transition-colors',
                    installTargetMode === 'agent'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground/70 hover:text-foreground',
                  )}
                >
                  {t('marketplace.installAgent', { defaultValue: '单 Agent 安装' })}
                </button>
              </div>
              {installTargetMode === 'agent' ? (
                <div className="rounded-xl">
                  <Select
                    value={installAgentId}
                    onChange={(e) => setInstallAgentId(e.target.value)}
                    className="h-10 rounded-xl border-border/60 bg-background text-[13px] text-foreground shadow-none"
                  >
                    <option value="main">main</option>
                    {agents
                      .filter((agent) => agent.id !== 'main')
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.id})
                        </option>
                      ))}
                  </Select>
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-background px-3 flex items-center text-[13px] text-foreground/65">
                  {t('marketplace.installGlobalHint', { defaultValue: '安装到 ~/.openclaw/skills' })}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {searchError && (
              <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>
                  {SEARCH_ERROR_CODES.has(searchError.replace('Error: ', ''))
                    ? t(`toast.${searchError.replace('Error: ', '')}`, { path: skillsDirPath })
                    : t('marketplace.searchError')}
                </span>
              </div>
            )}

            {searching && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="flex flex-col gap-1">
                {searchResults.map((skill) => {
                  const isInstalled = safeSkills.some(s => s.id === skill.slug || s.name === skill.name);
                  const isInstallLoading = !!installing[skill.slug];

                  return (
                    <div
                      key={skill.slug}
                      className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-card transition-colors border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl bg-background border border-border/60 rounded-xl overflow-hidden">
                          📦
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                            {skill.author && (
                              <span className="text-xs text-muted-foreground">• {skill.author}</span>
                            )}
                          </div>
                          <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                            {skill.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0" onClick={e => e.stopPropagation()}>
                        {skill.version && (
                          <span className="text-[13px] font-mono text-muted-foreground mr-2">
                            v{skill.version}
                          </span>
                        )}
                        {isInstalled ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleUninstall(skill.slug)}
                            disabled={isInstallLoading}
                            className="h-8 shadow-none"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setPendingInstallSkill(skill)}
                            disabled={isInstallLoading}
                            className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : t('marketplace.install', 'Install')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!searching && searchResults.length === 0 && !searchError && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Package className="h-10 w-10 mb-4 opacity-50" />
                <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
              </div>
            )}
          </div>

          {pendingInstallSkill && (
            <div className="border-t border-border/60 px-6 py-5 bg-background/80 backdrop-blur-sm">
              <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold text-foreground">
                      {t('marketplace.confirmTitle', { defaultValue: '确认安装技能' })}
                    </p>
                    <p className="mt-1 text-[13px] text-foreground/70">
                      {t('marketplace.confirmSubtitle', { defaultValue: '请确认技能来源与安装位置，然后再继续安装。' })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPendingInstallSkill(null)}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-background"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/60 bg-background p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                      {t('detail.description')}
                    </p>
                    <p className="mt-2 text-[14px] font-semibold text-foreground">{pendingInstallSkill.name}</p>
                    <p className="mt-1 text-[12px] text-foreground/65 line-clamp-2">
                      {pendingInstallSkill.description || pendingInstallSkill.slug}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                      {t('marketplace.installTarget', { defaultValue: '安装位置' })}
                    </p>
                    <p className="mt-2 text-[14px] font-semibold text-foreground">
                      {installTargetMode === 'global'
                        ? t('marketplace.installGlobal', { defaultValue: '全局安装' })
                        : t('marketplace.installAgent', { defaultValue: '单 Agent 安装' })}
                    </p>
                    <p className="mt-1 font-mono text-[12px] text-foreground/65 break-all">
                      {getInstallTargetPath()}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPendingInstallSkill(null)}
                    className="h-9 rounded-full px-4 border-border/70 bg-background hover:bg-card shadow-none"
                  >
                    {t('common:actions.cancel')}
                  </Button>
                  <Button
                    onClick={async () => {
                      const skill = pendingInstallSkill;
                      if (!skill) return;
                      await handleInstall(skill.slug);
                      setPendingInstallSkill(null);
                    }}
                    disabled={!!installing[pendingInstallSkill.slug]}
                    className="h-9 rounded-full px-4 shadow-none"
                  >
                    {installing[pendingInstallSkill.slug] ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      t('marketplace.confirmInstall', { defaultValue: '确认安装' })
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onUninstall={handleUninstall}
        onOpenFolder={handleOpenSkillFolder}
      />
    </div>
  );
}

export default Skills;
