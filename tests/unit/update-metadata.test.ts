import { describe, expect, it } from 'vitest';
import { parseUpdateMetadataYaml, resolveUpdateMetadataFileName } from '@electron/utils/update-metadata';

describe('resolveUpdateMetadataFileName', () => {
  it('resolves Windows metadata names', () => {
    expect(resolveUpdateMetadataFileName('latest', 'win32', 'x64')).toBe('latest.yml');
    expect(resolveUpdateMetadataFileName('beta', 'win32', 'x64')).toBe('beta.yml');
  });

  it('resolves macOS metadata names', () => {
    expect(resolveUpdateMetadataFileName('latest', 'darwin', 'arm64')).toBe('latest-mac.yml');
  });

  it('resolves Linux metadata names', () => {
    expect(resolveUpdateMetadataFileName('latest', 'linux', 'x64')).toBe('latest-linux.yml');
    expect(resolveUpdateMetadataFileName('alpha', 'linux', 'arm64')).toBe('alpha-linux-arm64.yml');
  });
});

describe('parseUpdateMetadataYaml', () => {
  it('parses basic latest.yml content', () => {
    const parsed = parseUpdateMetadataYaml(`
version: 1.0.0
files:
  - url: ClawX-Cat-win-x64.exe
    sha512: abc123
path: ClawX-Cat-win-x64.exe
sha512: abc123
releaseDate: '2026-04-16T13:22:49.634Z'
    `.trim());

    expect(parsed).toEqual({
      version: '1.0.0',
      path: 'ClawX-Cat-win-x64.exe',
      sha512: 'abc123',
      releaseDate: '2026-04-16T13:22:49.634Z',
    });
  });

  it('throws when version is missing', () => {
    expect(() => parseUpdateMetadataYaml('path: ClawX-Cat-win-x64.exe')).toThrow(
      'Update metadata is missing version',
    );
  });
});
