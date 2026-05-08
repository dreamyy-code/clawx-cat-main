/**
 * SkillHub Tencent mirror service
 * Keeps the existing IPC surface but sources marketplace data from the
 * domestic SkillHub mirror used by OpenClawSwitch.
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, shell } from 'electron';
import { promisify } from 'util';
import { getOpenClawConfigDir, ensureDir, expandPath } from '../utils/paths';

const execFileAsync = promisify(execFile);
const SKILLHUB_MARKET_URL = 'https://lightmake.site/api/skills';
const SKILLHUB_DOWNLOAD_TEMPLATE = 'https://lightmake.site/api/v1/download?slug={slug}';
const SKILLHUB_ORIGIN = 'https://skillhub.tencent.com';
const SKILLHUB_USER_AGENT = 'clawx-skillhub/1.0';

export interface ClawHubSearchParams {
    query: string;
    limit?: number;
}

export interface ClawHubInstallParams {
    slug: string;
    version?: string;
    force?: boolean;
    targetMode?: 'global' | 'agent';
    agentId?: string;
}

export interface ClawHubUninstallParams {
    slug: string;
}

export interface ClawHubSkillResult {
    slug: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    downloads?: number;
    stars?: number;
}

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
}

export class ClawHubService {
    private workDir: string;
    private ansiRegex: RegExp;

    constructor() {
        this.workDir = getOpenClawConfigDir();
        ensureDir(this.workDir);
        const esc = String.fromCharCode(27);
        const csi = String.fromCharCode(155);
        const pattern = `(?:${esc}|${csi})[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`;
        this.ansiRegex = new RegExp(pattern, 'g');
    }

    private stripAnsi(line: string): string {
        return line.replace(this.ansiRegex, '').trim();
    }

    private extractFrontmatterName(skillManifestPath: string): string | null {
        try {
            const raw = fs.readFileSync(skillManifestPath, 'utf8');
            // Match the first frontmatter block and read `name: ...`
            const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) return null;
            const body = frontmatterMatch[1];
            const nameMatch = body.match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
            if (!nameMatch) return null;
            const name = nameMatch[1].trim();
            return name || null;
        } catch {
            return null;
        }
    }

    private resolveSkillDirByManifestName(candidates: string[]): string | null {
        const skillsRoot = path.join(this.workDir, 'skills');
        if (!fs.existsSync(skillsRoot)) return null;

        const wanted = new Set(
            candidates
                .map((v) => v.trim().toLowerCase())
                .filter((v) => v.length > 0),
        );
        if (wanted.size === 0) return null;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(skillsRoot, entry.name);
            const skillManifestPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillManifestPath)) continue;

            const frontmatterName = this.extractFrontmatterName(skillManifestPath);
            if (!frontmatterName) continue;
            if (wanted.has(frontmatterName.toLowerCase())) {
                return skillDir;
            }
        }
        return null;
    }

    private buildDownloadUrl(slug: string): string {
        return SKILLHUB_DOWNLOAD_TEMPLATE.replace('{slug}', encodeURIComponent(slug));
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'Origin': SKILLHUB_ORIGIN,
                'Referer': `${SKILLHUB_ORIGIN}/`,
                'User-Agent': SKILLHUB_USER_AGENT,
            },
        });

        if (!response.ok) {
            const tail = await response.text().catch(() => '');
            throw new Error(`SkillHub request failed: HTTP ${response.status} ${tail.slice(0, 240)}`);
        }

        return await response.json() as T;
    }

    private resolveInstallRoot(targetMode?: 'global' | 'agent', agentId?: string): string {
        if (targetMode === 'agent' && agentId && agentId.trim()) {
            const normalized = agentId.trim();
            const workspace = normalized === 'main'
                ? path.join(this.workDir, 'workspace')
                : path.join(this.workDir, `workspace-${normalized}`);
            return path.join(workspace, 'skills');
        }
        return path.join(this.workDir, 'skills');
    }

    private resolveSkillTargetDir(slug: string, targetMode?: 'global' | 'agent', agentId?: string): string {
        return path.join(this.resolveInstallRoot(targetMode, agentId), slug);
    }

    private sha256File(filePath: string): string {
        const hash = crypto.createHash('sha256');
        const data = fs.readFileSync(filePath);
        hash.update(data);
        return hash.digest('hex').toLowerCase();
    }

    private async downloadHttpToFile(url: string, destPath: string, timeoutMs = 30000): Promise<void> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 30000));
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': SKILLHUB_USER_AGENT,
                    'Accept': 'application/zip,application/octet-stream,*/*',
                    'Origin': SKILLHUB_ORIGIN,
                    'Referer': `${SKILLHUB_ORIGIN}/`,
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                const tail = await response.text().catch(() => '');
                throw new Error(`下载失败: HTTP ${response.status} ${tail.slice(0, 240)}`);
            }
            const buf = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(destPath, buf);
        } finally {
            clearTimeout(timer);
        }
    }

    private async extractZip(zipPath: string, outDir: string): Promise<void> {
        if (process.platform === 'win32') {
            const escapedZip = String(zipPath).replace(/'/g, "''");
            const escapedOut = String(outDir).replace(/'/g, "''");
            await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command',
                `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedOut}' -Force`,
            ]);
            return;
        }
        await execFileAsync('tar', ['-xf', zipPath, '-C', outDir]);
    }

    private async installFromSkillHub(params: ClawHubInstallParams): Promise<void> {
        const slug = String(params.slug || '').trim();
        if (!slug) throw new Error('技能 slug 不能为空');
        const targetDir = this.resolveSkillTargetDir(slug, params.targetMode, params.agentId);
        const force = !!params.force;
        const downloadUrl = this.buildDownloadUrl(slug);

        if (fs.existsSync(targetDir) && !force) {
            throw new Error(`目标目录已存在: ${targetDir}`);
        }

        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawx-skillhub-'));
        const zipPath = path.join(tempRoot, `${slug}.zip`);
        const stageDir = path.join(tempRoot, 'stage');
        fs.mkdirSync(stageDir, { recursive: true });

        try {
            await this.downloadHttpToFile(downloadUrl, zipPath, 30000);
            this.sha256File(zipPath);
            await this.extractZip(zipPath, stageDir);

            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
            fs.mkdirSync(path.dirname(targetDir), { recursive: true });

            const stageEntries = fs.readdirSync(stageDir);
            const singleDir = stageEntries.length === 1
                ? path.join(stageDir, stageEntries[0])
                : stageDir;
            const sourceDir = fs.statSync(singleDir).isDirectory() ? singleDir : stageDir;
            fs.renameSync(sourceDir, targetDir);
        } finally {
            try {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            } catch {}
        }
    }

    private listSkillRoots(): Array<{ root: string; source: string }> {
        const roots: Array<{ root: string; source: string }> = [];
        const globalRoot = path.join(this.workDir, 'skills');
        roots.push({ root: globalRoot, source: 'global' });

        try {
            const entries = fs.readdirSync(this.workDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (!entry.name.startsWith('workspace')) continue;
                const skillsDir = path.join(this.workDir, entry.name, 'skills');
                roots.push({ root: skillsDir, source: entry.name === 'workspace' ? 'agent:main' : `agent:${entry.name.replace(/^workspace-/, '')}` });
            }
        } catch {}

        return roots;
    }

    /**
     * Search for skills
     */
    async search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
        try {
            const keyword = String(params.query || '').trim();
            const url = new URL(SKILLHUB_MARKET_URL);
            url.searchParams.set('page', '1');
            url.searchParams.set('pageSize', String(params.limit || 20));
            if (keyword) {
                url.searchParams.set('keyword', keyword);
            }

            const result = await this.fetchJson<{ data?: { skills?: Array<Record<string, unknown>> } }>(url.toString());
            const items = result.data?.skills || [];
            return items.map((item) => ({
                slug: String(item.slug || item.package_name || ''),
                name: String(item.name || item.slug || item.package_name || ''),
                description: String(item.description || item.desc || ''),
                version: String(item.version || 'latest'),
                author: typeof item.author === 'string' ? item.author : undefined,
                downloads: typeof item.downloads === 'number' ? item.downloads : undefined,
                stars: typeof item.stars === 'number' ? item.stars : undefined,
            })).filter((item) => item.slug);
        } catch (error) {
            console.error('SkillHub search error:', error);
            throw error;
        }
    }

    /**
     * Explore trending skills
     */
    async explore(params: { limit?: number } = {}): Promise<ClawHubSkillResult[]> {
        return this.search({ query: '', limit: params.limit });
    }

    /**
     * Install a skill
     */
    async install(params: ClawHubInstallParams): Promise<void> {
        await this.installFromSkillHub(params);
    }

    /**
     * Uninstall a skill
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        const fsPromises = fs.promises;
        for (const { root } of this.listSkillRoots()) {
            const skillDir = path.join(root, params.slug);
            if (fs.existsSync(skillDir)) {
                await fsPromises.rm(skillDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * List installed skills
     */
    async listInstalled(): Promise<ClawHubInstalledSkillResult[]> {
        try {
            const results: ClawHubInstalledSkillResult[] = [];
            for (const { root, source } of this.listSkillRoots()) {
                if (!fs.existsSync(root)) continue;
                const entries = fs.readdirSync(root, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const baseDir = path.join(root, entry.name);
                    results.push({
                        slug: entry.name,
                        version: 'latest',
                        source,
                        baseDir,
                    });
                }
            }
            return results;
        } catch (error) {
            console.error('SkillHub list error:', error);
            return [];
        }
    }

    private resolveSkillDir(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): string | null {
        const candidates = [skillKeyOrSlug, fallbackSlug]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map(v => v.trim());
        const uniqueCandidates = [...new Set(candidates)];
        if (preferredBaseDir && preferredBaseDir.trim() && fs.existsSync(preferredBaseDir.trim())) {
            return preferredBaseDir.trim();
        }
        const directSkillDir = uniqueCandidates
            .map((id) => path.join(this.workDir, 'skills', id))
            .find((dir) => fs.existsSync(dir));
        return directSkillDir || this.resolveSkillDirByManifestName(uniqueCandidates);
    }

    /**
     * Open skill README/manual in default editor
     */
    async openSkillReadme(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);

        // Try to find documentation file
        const possibleFiles = ['SKILL.md', 'README.md', 'skill.md', 'readme.md'];
        let targetFile = '';

        if (skillDir) {
            for (const file of possibleFiles) {
                const filePath = path.join(skillDir, file);
                if (fs.existsSync(filePath)) {
                    targetFile = filePath;
                    break;
                }
            }
        }

        if (!targetFile) {
            // If no md file, just open the directory
            if (skillDir) {
                targetFile = skillDir;
            } else {
                throw new Error('Skill directory not found');
            }
        }

        try {
            // Open file with default application
            await shell.openPath(targetFile);
            return true;
        } catch (error) {
            console.error('Failed to open skill readme:', error);
            throw error;
        }
    }

    /**
     * Open skill path in file explorer
     */
    async openSkillPath(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);
        if (!skillDir) {
            throw new Error('Skill directory not found');
        }
        const openResult = await shell.openPath(skillDir);
        if (openResult) {
            throw new Error(openResult);
        }
        return true;
    }
}
