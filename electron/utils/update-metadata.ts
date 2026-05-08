export type ParsedUpdateMetadata = {
  version: string;
  path?: string;
  releaseDate?: string;
  sha512?: string;
};

function readScalar(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) {
    return undefined;
  }

  const rawValue = match[1].trim();
  if (
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
    || (rawValue.startsWith('"') && rawValue.endsWith('"'))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

export function resolveUpdateMetadataFileName(
  channel: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  const prefix = channel === 'latest' ? 'latest' : channel;
  if (platform === 'darwin') {
    return `${prefix}-mac.yml`;
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? `${prefix}-linux-arm64.yml` : `${prefix}-linux.yml`;
  }
  return `${prefix}.yml`;
}

export function parseUpdateMetadataYaml(source: string): ParsedUpdateMetadata {
  const version = readScalar(source, 'version');
  if (!version) {
    throw new Error('Update metadata is missing version');
  }

  return {
    version,
    path: readScalar(source, 'path'),
    releaseDate: readScalar(source, 'releaseDate'),
    sha512: readScalar(source, 'sha512'),
  };
}
