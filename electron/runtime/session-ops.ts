import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';

export async function deleteSessionTranscript(sessionKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!sessionKey || !sessionKey.startsWith('agent:')) {
      return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
    }

    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return { success: false, error: `sessionKey has too few parts: ${sessionKey}` };
    }

    const agentId = parts[1];
    const openclawConfigDir = getOpenClawConfigDir();
    const sessionsDir = join(openclawConfigDir, 'agents', agentId, 'sessions');
    const sessionsJsonPath = join(sessionsDir, 'sessions.json');

    logger.info(`[runtime session delete] key=${sessionKey} agentId=${agentId}`);
    const fsP = await import('node:fs/promises');

    let sessionsJson: Record<string, unknown> = {};
    try {
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      sessionsJson = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      logger.warn(`[runtime session delete] Could not read sessions.json: ${String(e)}`);
      return { success: false, error: `Could not read sessions.json: ${String(e)}` };
    }

    let uuidFileName: string | undefined;
    let resolvedSrcPath: string | undefined;

    if (Array.isArray(sessionsJson.sessions)) {
      const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
        .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
      if (entry) {
        uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
        if (!uuidFileName && typeof entry.id === 'string') {
          uuidFileName = `${entry.id}.jsonl`;
        }
      }
    }

    if (!uuidFileName && sessionsJson[sessionKey] != null) {
      const val = sessionsJson[sessionKey];
      if (typeof val === 'string') {
        uuidFileName = val;
      } else if (typeof val === 'object' && val !== null) {
        const entry = val as Record<string, unknown>;
        const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
        if (absFile) {
          if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
            resolvedSrcPath = absFile;
          } else {
            uuidFileName = absFile;
          }
        } else {
          const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
          if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
        }
      }
    }

    if (!uuidFileName && !resolvedSrcPath) {
      return { success: false, error: `Cannot resolve file for session: ${sessionKey}` };
    }

    if (!resolvedSrcPath) {
      if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
      resolvedSrcPath = join(sessionsDir, uuidFileName!);
    }

    const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');

    try {
      await fsP.access(resolvedSrcPath);
      await fsP.rename(resolvedSrcPath, dstPath);
    } catch (e) {
      logger.warn(`[runtime session delete] Could not rename file: ${String(e)}`);
    }

    try {
      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;

      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }

      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
    } catch (e) {
      logger.warn(`[runtime session delete] Could not update sessions.json: ${String(e)}`);
    }

    return { success: true };
  } catch (error) {
    logger.error(`[runtime session delete] Unexpected error for ${sessionKey}:`, error);
    return { success: false, error: String(error) };
  }
}
