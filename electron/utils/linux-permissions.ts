import { app } from 'electron';
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';

let ensured = false;

function chmodExecutableIfNeeded(filePath: string): void {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return;
    const currentMode = stats.mode & 0o777;
    const targetMode = currentMode | 0o111;
    if (targetMode === currentMode) return;
    chmodSync(filePath, targetMode);
    logger.info(`[linux-perms] Added execute bit: ${filePath}`);
  } catch (error) {
    logger.warn(`[linux-perms] Failed to chmod executable for ${filePath}:`, error);
  }
}

function applyExecutableBitsRecursively(dirPath: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dirPath);
  } catch (error) {
    logger.warn(`[linux-perms] Failed to read directory ${dirPath}:`, error);
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      applyExecutableBitsRecursively(fullPath);
      continue;
    }
    chmodExecutableIfNeeded(fullPath);
  }
}

/**
 * Best-effort Linux packaged self-heal:
 * users may run the generic extracted app directly without running installer scripts.
 * In that case bundled helper binaries can miss executable bits and fail with EACCES.
 */
export function ensurePackagedLinuxHelperExecutables(): void {
  if (ensured) return;
  if (process.platform !== 'linux' || !app.isPackaged) return;
  ensured = true;

  const binDir = join(process.resourcesPath, 'bin');
  const cliDir = join(process.resourcesPath, 'cli');

  if (existsSync(binDir)) {
    applyExecutableBitsRecursively(binDir);
  } else {
    logger.warn(`[linux-perms] Bundled bin directory not found: ${binDir}`);
  }

  if (existsSync(cliDir)) {
    applyExecutableBitsRecursively(cliDir);
  } else {
    logger.warn(`[linux-perms] Bundled cli directory not found: ${cliDir}`);
  }
}
