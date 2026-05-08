export type ParsedProviderConfig = {
  name: string;
  providerJson: {
    baseUrl: string;
    api: string;
    apiKey?: string;
    models: Array<{ id: string; name: string }>;
  };
};

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^`+|`+$/g, '').trim();
}

export function parseProviderJson(input: string): ParsedProviderConfig {
  const parsed = JSON.parse(input) as Record<string, unknown>;
  const providerName = normalizeText(parsed.name || parsed.provider || parsed.providerName);
  const provider = (parsed.providerJson ?? parsed.config ?? parsed.value ?? parsed) as Record<string, unknown>;

  const baseUrl = normalizeText(provider.baseUrl ?? provider.baseURL);
  const api = normalizeText(provider.api);
  const apiKey = normalizeText(provider.apiKey);
  const models = Array.isArray(provider.models)
    ? provider.models
      .map((item) => {
        if (typeof item === 'string') {
          const model = normalizeText(item);
          return model ? { id: model, name: model } : null;
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const id = normalizeText(record.id ?? record.name);
          const name = normalizeText(record.name ?? record.id);
          return id ? { id, name: name || id } : null;
        }
        return null;
      })
      .filter((item): item is { id: string; name: string } => Boolean(item))
    : [];

  if (!providerName) {
    throw new Error('未找到服务商名称');
  }
  if (!baseUrl) {
    throw new Error('未找到 Base URL');
  }
  if (!api) {
    throw new Error('未找到 API 类型');
  }

  return {
    name: providerName,
    providerJson: {
      baseUrl,
      api,
      ...(apiKey ? { apiKey } : {}),
      models,
    },
  };
}
