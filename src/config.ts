import {
  CONFIG_PATH,
  CONFIG_VERSION,
  canonicalizeProviderName,
  getProviderId,
  isRecord,
  normalizeBaseUrl,
  toOptionalString,
} from "./shared.ts";
import type {
  AgentModelsRegistry,
  AgentProviderEntry,
  ModelRecord,
  ProviderProfile,
  StoredConfig,
} from "./types.ts";

export function buildStoredConfig(input: unknown): ProviderProfile {
  const source = isRecord(input) ? input : {};
  const name = String(source.name || "OpenAI Compatible").trim();
  const nameKey = canonicalizeProviderName(name);

  return Object.fromEntries(
    Object.entries({
      id: String(source.id || getProviderId(name)),
      name,
      nameKey,
      baseUrl: normalizeBaseUrl(String(source.baseUrl || "")),
      apiKey: String(source.apiKey || "").trim(),
      defaultModelId: toOptionalString(source.defaultModelId),
      lastModelId: toOptionalString(source.lastModelId),
      previousProvider: toOptionalString(source.previousProvider),
      previousModel: toOptionalString(source.previousModel),
      updatedAt:
        typeof source.updatedAt === "string"
          ? source.updatedAt
          : new Date().toISOString(),
    }).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as ProviderProfile;
}

export function buildStoredConfigFromLegacy(input: unknown): StoredConfig {
  const provider = buildStoredConfig(input);
  return {
    version: CONFIG_VERSION,
    activeProviderId: provider.id,
    providers: [provider],
  };
}

export function ensureStoredConfig(input: unknown): StoredConfig {
  if (
    isRecord(input) &&
    input.version === CONFIG_VERSION &&
    Array.isArray(input.providers)
  ) {
    return {
      version: CONFIG_VERSION,
      activeProviderId:
        typeof input.activeProviderId === "string"
          ? input.activeProviderId
          : undefined,
      providers: input.providers.map((provider) => buildStoredConfig(provider)),
    };
  }

  if (
    isRecord(input) &&
    (input.name || input.baseUrl || input.apiKey || input.defaultModelId)
  ) {
    return buildStoredConfigFromLegacy(input);
  }

  return {
    version: CONFIG_VERSION,
    activeProviderId: undefined,
    providers: [],
  };
}

function toAgentProviderEntries(
  input: Record<string, unknown>,
): Record<string, Partial<AgentProviderEntry>> {
  const entries: Record<string, Partial<AgentProviderEntry>> = {};

  for (const [providerId, value] of Object.entries(input)) {
    if (isRecord(value)) {
      entries[providerId] = value as Partial<AgentProviderEntry>;
    }
  }

  return entries;
}

export function ensureAgentModelsRegistry(input: unknown): AgentModelsRegistry {
  if (isRecord(input) && isRecord(input.providers)) {
    return {
      providers: toAgentProviderEntries(input.providers),
    };
  }

  if (isRecord(input)) {
    return {
      providers: toAgentProviderEntries(input),
    };
  }

  return {
    providers: {},
  };
}

export function putProviderProfile(
  config: StoredConfig,
  profile: ProviderProfile,
): StoredConfig {
  const nextProfile = buildStoredConfig(profile);
  const nextProviders = config.providers.filter(
    (provider) => provider.nameKey !== nextProfile.nameKey,
  );
  nextProviders.push(nextProfile);

  return {
    version: CONFIG_VERSION,
    activeProviderId: config.activeProviderId,
    providers: nextProviders,
  };
}

export function removeProviderProfile(
  config: StoredConfig,
  providerId: string,
): StoredConfig {
  const providers = config.providers.filter(
    (provider) => provider.id !== providerId,
  );
  return {
    version: CONFIG_VERSION,
    activeProviderId:
      config.activeProviderId === providerId
        ? undefined
        : config.activeProviderId,
    providers,
  };
}

export function getProviderById(
  config: StoredConfig,
  providerId?: string,
): ProviderProfile | null {
  if (!providerId) return null;
  return (
    config.providers.find((provider) => provider.id === providerId) || null
  );
}

export function getProviderByName(
  config: StoredConfig,
  name: string,
): ProviderProfile | null {
  const nameKey = canonicalizeProviderName(name);
  return (
    config.providers.find((provider) => provider.nameKey === nameKey) || null
  );
}

export function updateProviderLastModel(
  config: StoredConfig,
  providerId: string,
  modelId?: string,
): StoredConfig {
  return {
    ...config,
    providers: config.providers.map((provider) =>
      provider.id === providerId
        ? buildStoredConfig({
            ...provider,
            lastModelId: modelId || provider.lastModelId,
          })
        : provider,
    ),
  };
}

export function getProviderSelectionModelId(
  provider: Partial<ProviderProfile> | null | undefined,
  models: ModelRecord[],
): string | undefined {
  const modelIds = new Set(models.map((model) => model.id));
  if (provider?.lastModelId && modelIds.has(String(provider.lastModelId))) {
    return String(provider.lastModelId);
  }
  if (
    provider?.defaultModelId &&
    modelIds.has(String(provider.defaultModelId))
  ) {
    return String(provider.defaultModelId);
  }
  return models[0]?.id;
}

export function getProviderCacheEntry(
  registry: unknown,
  providerId: string,
): Partial<AgentProviderEntry> | null {
  const normalized = ensureAgentModelsRegistry(registry);
  return normalized.providers[providerId] || null;
}
