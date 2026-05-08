import { describe, expect, it } from 'vitest';
import { compareSemver, normalizeVersion, parseSemver } from '@electron/utils/semver';

describe('normalizeVersion', () => {
  it('strips leading v prefix', () => {
    expect(normalizeVersion('v1.0.0')).toBe('1.0.0');
    expect(normalizeVersion(' V2.3.4 ')).toBe('2.3.4');
  });
});

describe('parseSemver', () => {
  it('parses stable versions', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it('parses prerelease identifiers', () => {
    expect(parseSemver('1.2.3-beta.2')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', 2],
    });
  });
});

describe('compareSemver', () => {
  it('compares multi-digit versions numerically', () => {
    expect(compareSemver('1.0.0', '0.3.9')).toBeGreaterThan(0);
    expect(compareSemver('0.3.10', '0.3.9')).toBeGreaterThan(0);
  });

  it('treats leading v prefix as equal', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  it('treats stable versions as newer than prerelease', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
  });

  it('orders prerelease identifiers correctly', () => {
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-beta.1')).toBeLessThan(0);
  });
});
