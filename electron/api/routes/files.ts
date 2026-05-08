import type { IncomingMessage, ServerResponse } from 'http';
import { dialog, nativeImage, shell } from 'electron';
import crypto from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { readOpenClawConfig } from '../../utils/channel-config';
import { expandPath, getOpenClawConfigDir } from '../../utils/paths';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.env',
  '.xml',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.vue',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.gitignore',
  '.gitattributes',
]);

type WorkspaceAgentItem = {
  id: string;
  name: string;
  isDefault: boolean;
  workspacePath: string;
  workspaceName: string;
  exists: boolean;
};

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isTextFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  const ext = extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return true;
  }
  return !ext && /^(readme|license|dockerfile|makefile|agents|soul|user|tools|identity|heartbeat|bootstrap|boot)(\..*)?$/i.test(name);
}

function normalizeAgentWorkspacePath(agentId: string, configuredWorkspace?: string): string {
  if (agentId === 'main') {
    return expandPath((configuredWorkspace || DEFAULT_WORKSPACE_PATH).trim() || DEFAULT_WORKSPACE_PATH);
  }
  const fallbackPath = `~/.openclaw/workspace-${agentId}`;
  return expandPath((configuredWorkspace || fallbackPath).trim() || fallbackPath);
}

async function listWorkspaceAgents(): Promise<{
  configDir: string;
  configFilePath: string;
  configFileExists: boolean;
  defaultWorkspacePath: string;
  defaultWorkspaceExists: boolean;
  agents: WorkspaceAgentItem[];
}> {
  const configDir = getOpenClawConfigDir();
  const configFilePath = join(configDir, 'openclaw.json');
  const configFileExists = await pathExists(configFilePath);
  const config = await readOpenClawConfig().catch(() => ({} as Record<string, unknown>));
  const defaults = (config?.agents as { defaults?: { workspace?: string } } | undefined)?.defaults || {};
  const defaultWorkspacePath = normalizeAgentWorkspacePath('main', defaults.workspace);
  const snapshot = await listAgentsSnapshot().catch(() => ({
    defaultAgentId: 'main',
    agents: [{ id: 'main', name: 'main', isDefault: true }],
  }));
  const rawAgents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  const seen = new Set<string>();
  const agents: WorkspaceAgentItem[] = [];

  for (const item of rawAgents) {
    const agentId = String(item?.id || item?.agentId || item?.name || '').trim();
    if (!agentId || seen.has(agentId)) {
      continue;
    }
    seen.add(agentId);
    const workspacePath = normalizeAgentWorkspacePath(agentId, typeof item?.workspace === 'string' ? item.workspace : '');
    agents.push({
      id: agentId,
      name: String(item?.name || agentId),
      isDefault: agentId === 'main' || item?.isDefault === true,
      workspacePath,
      workspaceName: basename(workspacePath),
      exists: await pathExists(workspacePath),
    });
  }

  if (!seen.has('main')) {
    agents.unshift({
      id: 'main',
      name: 'main',
      isDefault: true,
      workspacePath: defaultWorkspacePath,
      workspaceName: basename(defaultWorkspacePath),
      exists: await pathExists(defaultWorkspacePath),
    });
  }

  agents.sort((a, b) => {
    if (a.id === 'main') return -1;
    if (b.id === 'main') return 1;
    return a.id.localeCompare(b.id);
  });

  return {
    configDir,
    configFilePath,
    configFileExists,
    defaultWorkspacePath,
    defaultWorkspaceExists: await pathExists(defaultWorkspacePath),
    agents,
  };
}

async function resolveWorkspaceRoot(agentId: string): Promise<WorkspaceAgentItem> {
  const summary = await listWorkspaceAgents();
  const normalizedAgentId = String(agentId || 'main').trim() || 'main';
  const selected = summary.agents.find((item) => item.id === normalizedAgentId) || summary.agents[0];
  if (!selected) {
    throw new Error('未找到可用工作空间');
  }
  const fsP = await import('node:fs/promises');
  await fsP.mkdir(selected.workspacePath, { recursive: true });
  return Object.assign({}, selected, { exists: true });
}

function ensureWorkspaceChildPath(rootPath: string, childPath: string): string {
  const absoluteRoot = resolve(rootPath);
  const targetPath = resolve(absoluteRoot, childPath || '.');
  const rootCompare = process.platform === 'win32' ? absoluteRoot.toLowerCase() : absoluteRoot;
  const targetCompare = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  const rootWithSep = rootCompare.endsWith('\\') || rootCompare.endsWith('/')
    ? rootCompare
    : `${rootCompare}${process.platform === 'win32' ? '\\' : '/'}`;
  if (targetCompare !== rootCompare && !targetCompare.startsWith(rootWithSep)) {
    throw new Error('非法路径：超出工作空间范围');
  }
  return targetPath;
}

function normalizeRelativePath(rootPath: string, targetPath: string): string {
  const rel = relative(rootPath, targetPath);
  if (!rel || rel === '.') {
    return '';
  }
  return rel.split('\\').join('/');
}

function buildWorkspaceBreadcrumb(relativePathValue: string): Array<{ name: string; path: string }> {
  const value = String(relativePathValue || '').trim().replace(/^\/+|\/+$/g, '');
  if (!value) {
    return [{ name: '/', path: '' }];
  }
  const segments = value.split('/').filter(Boolean);
  const items = [{ name: '/', path: '' }];
  for (let i = 0; i < segments.length; i += 1) {
    items.push({
      name: segments[i],
      path: segments.slice(0, i + 1).join('/'),
    });
  }
  return items;
}

export async function handleFileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/files/workspaces' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        ...(await listWorkspaceAgents()),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/workspace/tree' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId') || 'main';
      const dir = url.searchParams.get('dir') || '';
      const workspace = await resolveWorkspaceRoot(agentId);
      const targetDir = ensureWorkspaceChildPath(workspace.workspacePath, dir);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(targetDir, { recursive: true });
      const entries = await fsP.readdir(targetDir, { withFileTypes: true });
      const result = await Promise.all(entries.map(async (entry) => {
        const absolutePath = join(targetDir, entry.name);
        const stat = await fsP.stat(absolutePath);
        const relativePathValue = normalizeRelativePath(workspace.workspacePath, absolutePath);
        return {
          name: entry.name,
          path: relativePathValue,
          type: entry.isDirectory() ? 'directory' : 'file',
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stat.size,
          updatedAt: stat.mtimeMs,
          ext: entry.isDirectory() ? '' : extname(entry.name).toLowerCase(),
          editable: entry.isDirectory() ? false : isTextFile(entry.name),
        };
      }));
      result.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      sendJson(res, 200, {
        success: true,
        agentId: workspace.id,
        workspacePath: workspace.workspacePath,
        workspaceName: workspace.workspaceName,
        currentPath: normalizeRelativePath(workspace.workspacePath, targetDir),
        parentPath: targetDir === resolve(workspace.workspacePath)
          ? ''
          : normalizeRelativePath(workspace.workspacePath, dirname(targetDir)),
        breadcrumbs: buildWorkspaceBreadcrumb(normalizeRelativePath(workspace.workspacePath, targetDir)),
        entries: result,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/workspace/file' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId') || 'main';
      const relativePathValue = url.searchParams.get('path') || '';
      if (!relativePathValue) {
        sendJson(res, 400, { success: false, error: '缺少文件路径' });
        return true;
      }
      const workspace = await resolveWorkspaceRoot(agentId);
      const filePath = ensureWorkspaceChildPath(workspace.workspacePath, relativePathValue);
      const fsP = await import('node:fs/promises');
      const stat = await fsP.stat(filePath);
      if (stat.isDirectory()) {
        sendJson(res, 400, { success: false, error: '当前路径是目录，不能直接读取' });
        return true;
      }
      const editable = isTextFile(filePath);
      const content = editable ? await fsP.readFile(filePath, 'utf-8') : '';
      sendJson(res, 200, {
        success: true,
        agentId: workspace.id,
        workspacePath: workspace.workspacePath,
        path: normalizeRelativePath(workspace.workspacePath, filePath),
        fileName: basename(filePath),
        ext: extname(filePath).toLowerCase(),
        editable,
        fileSize: stat.size,
        updatedAt: stat.mtimeMs,
        content,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/workspace/blob' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId') || 'main';
      const relativePathValue = url.searchParams.get('path') || '';
      if (!relativePathValue) {
        sendJson(res, 400, { success: false, error: '缺少文件路径' });
        return true;
      }
      const workspace = await resolveWorkspaceRoot(agentId);
      const filePath = ensureWorkspaceChildPath(workspace.workspacePath, relativePathValue);
      const fsP = await import('node:fs/promises');
      const stat = await fsP.stat(filePath);
      if (stat.isDirectory()) {
        sendJson(res, 400, { success: false, error: '当前路径是目录，不能直接下载' });
        return true;
      }
      const ext = extname(filePath).toLowerCase();
      const mimeType = getMimeType(ext);
      const buffer = await fsP.readFile(filePath);
      sendJson(res, 200, {
        success: true,
        agentId: workspace.id,
        workspacePath: workspace.workspacePath,
        path: normalizeRelativePath(workspace.workspacePath, filePath),
        fileName: basename(filePath),
        ext,
        mimeType,
        fileSize: stat.size,
        updatedAt: stat.mtimeMs,
        base64: buffer.toString('base64'),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/workspace/file' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ agentId?: string; path?: string; content?: string }>(req);
      const agentId = body.agentId || 'main';
      const relativePathValue = String(body.path || '').trim();
      if (!relativePathValue) {
        sendJson(res, 400, { success: false, error: '缺少文件路径' });
        return true;
      }
      const workspace = await resolveWorkspaceRoot(agentId);
      const filePath = ensureWorkspaceChildPath(workspace.workspacePath, relativePathValue);
      if (!isTextFile(filePath)) {
        sendJson(res, 400, { success: false, error: '当前文件不是可编辑文本' });
        return true;
      }
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(dirname(filePath), { recursive: true });
      await fsP.writeFile(filePath, String(body.content || ''), 'utf-8');
      const stat = await fsP.stat(filePath);
      sendJson(res, 200, {
        success: true,
        savedPath: normalizeRelativePath(workspace.workspacePath, filePath),
        updatedAt: stat.mtimeMs,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/workspace/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ agentId?: string; path?: string }>(req);
      const workspace = await resolveWorkspaceRoot(body.agentId || 'main');
      const targetPath = body.path
        ? ensureWorkspaceChildPath(workspace.workspacePath, body.path)
        : workspace.workspacePath;
      const result = await shell.openPath(targetPath);
      if (result) {
        throw new Error(result);
      }
      sendJson(res, 200, { success: true, openedPath: targetPath });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/stage-paths' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePaths: string[] }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const results = [];
      for (const filePath of body.filePaths) {
        const id = crypto.randomUUID();
        const ext = extname(filePath);
        const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
        await fsP.copyFile(filePath, stagedPath);
        const s = await fsP.stat(stagedPath);
        const mimeType = getMimeType(ext);
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        const preview = mimeType.startsWith('image/')
          ? await generateImagePreview(stagedPath, mimeType)
          : null;
        results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/stage-buffer' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ base64: string; fileName: string; mimeType: string }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const id = crypto.randomUUID();
      const ext = extname(body.fileName) || mimeToExt(body.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(body.base64, 'base64');
      await fsP.writeFile(stagedPath, buffer);
      const mimeType = body.mimeType || getMimeType(ext);
      const preview = mimeType.startsWith('image/')
        ? await generateImagePreview(stagedPath, mimeType)
        : null;
      sendJson(res, 200, {
        id,
        fileName: body.fileName,
        mimeType,
        fileSize: buffer.length,
        stagedPath,
        preview,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/thumbnails' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ paths: Array<{ filePath: string; mimeType: string }> }>(req);
      const fsP = await import('node:fs/promises');
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of body.paths) {
        try {
          const s = await fsP.stat(filePath);
          const preview = mimeType.startsWith('image/')
            ? await generateImagePreview(filePath, mimeType)
            : null;
          results[filePath] = { preview, fileSize: s.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/save-image' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        base64?: string;
        mimeType?: string;
        filePath?: string;
        defaultFileName: string;
      }>(req);
      const ext = body.defaultFileName.includes('.')
        ? body.defaultFileName.split('.').pop()!
        : (body.mimeType?.split('/')[1] || 'png');
      const result = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Downloads', body.defaultFileName),
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        sendJson(res, 200, { success: false });
        return true;
      }
      const fsP = await import('node:fs/promises');
      if (body.filePath) {
        await fsP.copyFile(body.filePath, result.filePath);
      } else if (body.base64) {
        await fsP.writeFile(result.filePath, Buffer.from(body.base64, 'base64'));
      } else {
        sendJson(res, 400, { success: false, error: 'No image data provided' });
        return true;
      }
      sendJson(res, 200, { success: true, savedPath: result.filePath });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
