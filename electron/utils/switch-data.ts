import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SWITCH_DATA_DIR_SEGMENTS = ['integrations', 'iterativecat', 'data'] as const;

export const SWITCH_DATA_FILES = {
  session: 'iterativecat-session.json',
  profile: 'iterativecat-profile.json',
  proxy: 'proxy.json',
  version: 'version.json',
  userId: 'user_id.json',
} as const;

export type SwitchDataFileKey = keyof typeof SWITCH_DATA_FILES;

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function getSwitchDataDir(): string {
  return ensureDir(join(app.getPath('userData'), ...SWITCH_DATA_DIR_SEGMENTS));
}

export function getLegacySwitchDataDir(): string {
  return join(homedir(), '.openclaw', 'iterativecat-openclaw-switch', 'data');
}

export function getSwitchDataFilePath(key: SwitchDataFileKey): string {
  return join(getSwitchDataDir(), SWITCH_DATA_FILES[key]);
}

export function getLegacySwitchDataFilePath(key: SwitchDataFileKey): string {
  return join(getLegacySwitchDataDir(), SWITCH_DATA_FILES[key]);
}

export function ensureSwitchDataMigrated(key: SwitchDataFileKey): string {
  const currentPath = getSwitchDataFilePath(key);
  const legacyPath = getLegacySwitchDataFilePath(key);
  if (!existsSync(currentPath) && existsSync(legacyPath)) {
    mkdirSync(dirname(currentPath), { recursive: true });
    writeFileSync(currentPath, readFileSync(legacyPath));
  }
  return currentPath;
}

export function readSwitchJson<T>(key: SwitchDataFileKey, fallback: T): T {
  const filePath = ensureSwitchDataMigrated(key);
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeSwitchJson(key: SwitchDataFileKey, payload: unknown): string {
  const filePath = getSwitchDataFilePath(key);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

export function writeSwitchText(key: SwitchDataFileKey, content: string): string {
  const filePath = getSwitchDataFilePath(key);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function readSwitchText(key: SwitchDataFileKey): string | null {
  const filePath = ensureSwitchDataMigrated(key);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function removeSwitchDataFile(key: SwitchDataFileKey): void {
  const currentPath = getSwitchDataFilePath(key);
  const legacyPath = getLegacySwitchDataFilePath(key);
  if (existsSync(currentPath)) {
    rmSync(currentPath, { force: true });
  }
  if (existsSync(legacyPath)) {
    rmSync(legacyPath, { force: true });
  }
}

export function getSwitchDataSnapshot(): {
  dataDir: string;
  legacyDataDir: string;
  files: Record<SwitchDataFileKey, { path: string; exists: boolean }>;
} {
  const dataDir = getSwitchDataDir();
  const legacyDataDir = getLegacySwitchDataDir();
  return {
    dataDir,
    legacyDataDir,
    files: {
      session: { path: getSwitchDataFilePath('session'), exists: existsSync(ensureSwitchDataMigrated('session')) },
      profile: { path: getSwitchDataFilePath('profile'), exists: existsSync(ensureSwitchDataMigrated('profile')) },
      proxy: { path: getSwitchDataFilePath('proxy'), exists: existsSync(ensureSwitchDataMigrated('proxy')) },
      version: { path: getSwitchDataFilePath('version'), exists: existsSync(ensureSwitchDataMigrated('version')) },
      userId: { path: getSwitchDataFilePath('userId'), exists: existsSync(ensureSwitchDataMigrated('userId')) },
    },
  };
}
