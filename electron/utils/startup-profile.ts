export type GatewayStartupProfile = 'full' | 'server-lite';
export type GatewayStartupProfilePreference = 'auto' | GatewayStartupProfile;

function normalizeProfile(value: string | null | undefined): GatewayStartupProfile | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'full') return 'full';
  if (normalized === 'server-lite' || normalized === 'server_lite' || normalized === 'lite') {
    return 'server-lite';
  }
  return null;
}

function parseProfileFromArgv(argv: string[]): GatewayStartupProfile | null {
  for (const arg of argv) {
    if (!arg.startsWith('--clawx-startup-profile=')) continue;
    const value = arg.slice('--clawx-startup-profile='.length);
    const profile = normalizeProfile(value);
    if (profile) return profile;
  }
  return null;
}

function parseExtraArgsFromArgv(argv: string[]): string {
  for (const arg of argv) {
    if (!arg.startsWith('--clawx-gateway-args=')) continue;
    return arg.slice('--clawx-gateway-args='.length).trim();
  }
  return '';
}

export function resolveGatewayStartupProfile(input: {
  platform: NodeJS.Platform;
  preference?: GatewayStartupProfilePreference;
  envProfile?: string | null;
  argv?: string[];
}): GatewayStartupProfile {
  const fromEnv = normalizeProfile(input.envProfile);
  if (fromEnv) return fromEnv;

  const fromArgv = parseProfileFromArgv(input.argv || []);
  if (fromArgv) return fromArgv;

  const fromPreference = normalizeProfile(input.preference);
  if (fromPreference) return fromPreference;

  // Linux defaults to a lighter startup policy for server/box usage.
  return input.platform === 'linux' ? 'server-lite' : 'full';
}

export function resolveGatewayStartupExtraArgs(input: {
  storedArgs?: string;
  envArgs?: string | null;
  argv?: string[];
}): string {
  const envArgs = String(input.envArgs || '').trim();
  if (envArgs) return envArgs;
  const argvArgs = parseExtraArgsFromArgv(input.argv || []);
  if (argvArgs) return argvArgs;
  return String(input.storedArgs || '').trim();
}

export function splitGatewayExtraArgs(raw: string): string[] {
  const source = String(raw || '').trim();
  if (!source) return [];
  const tokens: string[] = [];
  const pattern = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}
