import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-switch-data-${suffix}`,
    testUserData: `/tmp/clawx-switch-data-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserData,
  },
}));

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}

describe('switch data helpers', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes both current and legacy files to avoid restoring stale iterativecat login state', async () => {
    const switchData = await import('@electron/utils/switch-data');
    const legacyPath = switchData.getLegacySwitchDataFilePath('session');
    const currentPath = switchData.getSwitchDataFilePath('session');
    const legacyPayload = { cookie: 'session=legacy-cookie' };

    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, JSON.stringify(legacyPayload, null, 2), 'utf8');

    expect(switchData.readSwitchJson('session', {})).toEqual(legacyPayload);
    expect(JSON.parse(await readFile(currentPath, 'utf8'))).toEqual(legacyPayload);

    switchData.removeSwitchDataFile('session');

    await expectMissing(currentPath);
    await expectMissing(legacyPath);
    expect(switchData.readSwitchJson('session', { cleared: true })).toEqual({ cleared: true });
  });
});
