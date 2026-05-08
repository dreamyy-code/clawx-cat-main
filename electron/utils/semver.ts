type SemverIdentifier = number | string;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: SemverIdentifier[];
};

function parseIdentifier(value: string): SemverIdentifier {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^[=vV\s]+/, '');
}

export function parseSemver(version: string): ParsedSemver | null {
  const normalized = normalizeVersion(version);
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );

  if (!match) {
    return null;
  }

  const prerelease = match[4]
    ? match[4]
        .split('.')
        .filter(Boolean)
        .map(parseIdentifier)
    : [];

  return {
    major: Number(match[1] ?? 0),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease,
  };
}

function compareIdentifiers(a: SemverIdentifier, b: SemverIdentifier): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a > b ? 1 : -1;
  }
  if (typeof a === 'number') {
    return -1;
  }
  if (typeof b === 'number') {
    return 1;
  }
  return a.localeCompare(b);
}

function comparePrerelease(a: SemverIdentifier[], b: SemverIdentifier[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const diff = compareIdentifiers(left, right);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function compareSemver(leftVersion: string, rightVersion: string): number {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  if (!left || !right) {
    return normalizeVersion(leftVersion).localeCompare(normalizeVersion(rightVersion), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;

  return comparePrerelease(left.prerelease, right.prerelease);
}
