import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Save,
  ArrowUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

type WorkspaceAgent = {
  id: string;
  name: string;
  isDefault: boolean;
  workspacePath: string;
  workspaceName: string;
  exists: boolean;
};

type WorkspaceSummary = {
  success: boolean;
  configDir: string;
  configFilePath: string;
  configFileExists: boolean;
  defaultWorkspacePath: string;
  defaultWorkspaceExists: boolean;
  agents: WorkspaceAgent[];
};

type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  isDirectory: boolean;
  size: number;
  updatedAt: number;
  ext: string;
  editable: boolean;
};

type WorkspaceTreeResponse = {
  success: boolean;
  agentId: string;
  workspacePath: string;
  workspaceName: string;
  currentPath: string;
  parentPath: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: WorkspaceEntry[];
};

type WorkspaceFileResponse = {
  success: boolean;
  agentId: string;
  workspacePath: string;
  path: string;
  fileName: string;
  ext: string;
  editable: boolean;
  fileSize: number;
  updatedAt: number;
  content: string;
};

function formatFileSize(size: number): string {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: number): string {
  if (!value) return '--';
  return new Date(value).toLocaleString();
}

function buildParentPath(relativePathValue: string): string {
  const normalized = String(relativePathValue || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/');
}

export function Files() {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('main');
  const [workspacePath, setWorkspacePath] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ name: string; path: string }>>([]);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [selectedFileEditable, setSelectedFileEditable] = useState(false);
  const [selectedFileSize, setSelectedFileSize] = useState(0);
  const [selectedFileUpdatedAt, setSelectedFileUpdatedAt] = useState(0);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = useMemo(() => {
    return summary?.agents.find((item) => item.id === selectedAgentId) || summary?.agents[0] || null;
  }, [summary, selectedAgentId]);

  const resetEditor = useCallback(() => {
    setSelectedFilePath('');
    setSelectedFileName('');
    setSelectedFileContent('');
    setSelectedFileEditable(false);
    setSelectedFileSize(0);
    setSelectedFileUpdatedAt(0);
    setDirty(false);
  }, []);

  const loadWorkspaceTree = useCallback(async (agentId: string, dir = '') => {
    setLoadingTree(true);
    try {
      const data = await hostApiFetch<WorkspaceTreeResponse>(
        `/api/files/workspace/tree?agentId=${encodeURIComponent(agentId)}&dir=${encodeURIComponent(dir)}`
      );
      setSelectedAgentId(data.agentId || agentId);
      setWorkspacePath(data.workspacePath || '');
      setCurrentPath(data.currentPath || '');
      setBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (error) {
      toast.error(`读取目录失败: ${String(error)}`);
    } finally {
      setLoadingTree(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const data = await hostApiFetch<WorkspaceSummary>('/api/files/workspaces');
      setSummary(data);
      const nextAgentId = data.agents.some((item) => item.id === selectedAgentId)
        ? selectedAgentId
        : (data.agents[0]?.id || 'main');
      setSelectedAgentId(nextAgentId);
      await loadWorkspaceTree(nextAgentId, '');
    } catch (error) {
      toast.error(`读取工作空间失败: ${String(error)}`);
    } finally {
      setLoadingSummary(false);
    }
  }, [loadWorkspaceTree, selectedAgentId]);

  const openWorkspaceFile = useCallback(async (agentId: string, filePath: string) => {
    setLoadingFile(true);
    try {
      const data = await hostApiFetch<WorkspaceFileResponse>(
        `/api/files/workspace/file?agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(filePath)}`
      );
      setSelectedFilePath(data.path || filePath);
      setSelectedFileName(data.fileName || '');
      setSelectedFileContent(data.content || '');
      setSelectedFileEditable(data.editable !== false);
      setSelectedFileSize(data.fileSize || 0);
      setSelectedFileUpdatedAt(data.updatedAt || 0);
      setDirty(false);
      if (data.editable === false) {
        toast.info('当前文件只读预览');
      }
    } catch (error) {
      toast.error(`打开文件失败: ${String(error)}`);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!showAgentMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showAgentMenu]);

  const handleSelectAgent = async (agentId: string) => {
    setSelectedAgentId(agentId);
    setShowAgentMenu(false);
    resetEditor();
    await loadWorkspaceTree(agentId, '');
  };

  const handleOpenEntry = async (entry: WorkspaceEntry) => {
    if (entry.isDirectory) {
      resetEditor();
      await loadWorkspaceTree(selectedAgentId, entry.path);
      return;
    }
    await openWorkspaceFile(selectedAgentId, entry.path);
  };

  const handleGoUp = async () => {
    resetEditor();
    await loadWorkspaceTree(selectedAgentId, buildParentPath(currentPath));
  };

  const handleOpenSystemPath = async (path?: string) => {
    try {
      await hostApiFetch<{ success: boolean; openedPath: string }>('/api/files/workspace/open-path', {
        method: 'POST',
        body: JSON.stringify({
          agentId: selectedAgentId,
          path: path || undefined,
        }),
      });
    } catch (error) {
      toast.error(`打开路径失败: ${String(error)}`);
    }
  };

  const handleSave = async () => {
    if (!selectedFilePath || !selectedFileEditable || savingFile) {
      return;
    }
    setSavingFile(true);
    try {
      const result = await hostApiFetch<{ success: boolean; updatedAt: number }>('/api/files/workspace/file', {
        method: 'PUT',
        body: JSON.stringify({
          agentId: selectedAgentId,
          path: selectedFilePath,
          content: selectedFileContent,
        }),
      });
      setSelectedFileUpdatedAt(result.updatedAt || Date.now());
      setDirty(false);
      toast.success('已保存');
      await loadWorkspaceTree(selectedAgentId, currentPath);
    } catch (error) {
      toast.error(`保存失败: ${String(error)}`);
    } finally {
      setSavingFile(false);
    }
  };

  if (loadingSummary && !summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-5">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FolderOpen className="h-5 w-5" />
            文件管理
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-xs text-muted-foreground">配置文件</div>
            <div className="mt-1 break-all text-sm text-foreground">{summary?.configFilePath || '--'}</div>
            <div className="mt-2">
              <Badge variant={summary?.configFileExists ? 'secondary' : 'outline'}>
                {summary?.configFileExists ? 'openclaw.json 已发现' : '尚未发现 openclaw.json'}
              </Badge>
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-xs text-muted-foreground">当前 Agent</div>
            <div className="mt-1 text-sm font-medium text-foreground">{selectedAgent?.name || selectedAgentId}</div>
            <div className="mt-2 text-xs text-muted-foreground">{selectedAgent?.id || '--'}</div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-xs text-muted-foreground">工作空间目录</div>
            <div className="mt-1 break-all text-sm text-foreground">{workspacePath || selectedAgent?.workspacePath || '--'}</div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void handleOpenSystemPath()}>
                所在目录
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadSummary()}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                刷新
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CardTitle className="shrink-0 whitespace-nowrap text-base">工作空间</CardTitle>
                <Badge variant="outline">{selectedAgentId === 'main' ? '默认' : '多 Agent'}</Badge>
              </div>
              <div className="relative" ref={agentMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAgentMenu((value) => !value)}
                  className="flex h-10 w-full min-w-0 items-center justify-between rounded-xl border border-border bg-background px-3 text-sm shadow-sm transition-colors hover:bg-muted/30"
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {selectedAgentId === 'main'
                      ? 'main (默认)'
                      : `${selectedAgent?.name || selectedAgentId} (${selectedAgentId})`}
                  </span>
                  <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showAgentMenu ? 'rotate-180' : ''}`} />
                </button>
                {showAgentMenu && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-border/40 bg-card p-2 shadow-lg">
                    <div className="space-y-1">
                      {(summary?.agents || []).map((item) => {
                        const label = item.id === 'main' ? 'main (默认)' : `${item.name} (${item.id})`;
                        const active = selectedAgentId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                            onClick={() => void handleSelectAgent(item.id)}
                          >
                            <span className="truncate">{label}</span>
                            {active ? <span className="text-blue-600">当前</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={() => void handleGoUp()} disabled={!currentPath}>
                <ArrowUp className="mr-1 h-3.5 w-3.5" />
                返回上级
              </Button>
              {(breadcrumbs || []).map((item) => (
                <button
                  key={item.path || 'root'}
                  className="inline-flex items-center rounded-lg px-1.5 py-0.5 hover:bg-muted"
                  onClick={() => {
                    resetEditor();
                    void loadWorkspaceTree(selectedAgentId, item.path);
                  }}
                >
                  <span>{item.name}</span>
                  <ChevronRight className="ml-1 h-3 w-3" />
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto pb-4">
            {loadingTree ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : entries.length ? (
              <div className="space-y-2">
                {entries.map((item) => (
                  <button
                    key={item.path || item.name}
                    onClick={() => void handleOpenEntry(item)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border/50 bg-card/50 px-3 py-3 text-left transition hover:border-border hover:bg-muted/60"
                  >
                    <div className="shrink-0 text-muted-foreground">
                      {item.isDirectory ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.isDirectory ? '文件夹' : `${formatFileSize(item.size)} · ${formatTime(item.updatedAt)}`}
                      </div>
                    </div>
                    {!item.isDirectory && item.editable && (
                      <Badge variant="outline">可编辑</Badge>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                当前目录为空
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="min-w-0 truncate text-base">
                {selectedFileName || '选择一个文件开始编辑'}
              </CardTitle>
              <div className="flex items-center gap-2">
                {selectedFilePath ? (
                  <Button variant="outline" size="sm" onClick={() => void handleOpenSystemPath(selectedFilePath)}>
                    打开文件
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void handleSave()} disabled={!selectedFilePath || !selectedFileEditable || savingFile || !dirty}>
                  <Save className="mr-1.5 h-4 w-4" />
                  保存
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{selectedFilePath || currentPath || '/'}</span>
              {selectedFilePath ? <span>大小: {formatFileSize(selectedFileSize)}</span> : null}
              {selectedFilePath ? <span>更新时间: {formatTime(selectedFileUpdatedAt)}</span> : null}
              {dirty ? <Badge variant="secondary">未保存</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden">
            {loadingFile ? (
              <div className="flex h-[420px] items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : selectedFilePath ? (
              selectedFileEditable ? (
                <Textarea
                  value={selectedFileContent}
                  onChange={(event) => {
                    setSelectedFileContent(event.target.value);
                    setDirty(true);
                  }}
                  className="h-full min-h-[420px] resize-none font-mono text-sm"
                  placeholder="文件内容"
                />
              ) : (
                <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
                  当前文件不是文本文件，暂不支持直接编辑。
                </div>
              )
            ) : (
              <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
                从左侧选择一个文件后，这里会显示内容。
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
