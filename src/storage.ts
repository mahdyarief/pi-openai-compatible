import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ensureAgentModelsRegistry, ensureStoredConfig } from "./config.ts";
import {
  buildWritableProviderCacheEntry,
  mergeProviderModelsRegistry,
  removeProviderModelsRegistryEntry,
} from "./models.ts";
import {
  applyCurrentSelection,
  buildPreviousSelection,
  buildRestoredSettings,
} from "./settings.ts";
import {
  AGENT_MODELS_PATH,
  AUTH_PATH,
  CONFIG_PATH,
  MODELS_PATH,
  SETTINGS_PATH,
  isRecord,
  toOptionalString,
} from "./shared.ts";
import type {
  AgentModelsRegistry,
  AuthRecord,
  AuthStore,
  JsonObject,
  ModelRecord,
  ProviderProfile,
  SettingsStore,
  StoredConfig,
} from "./types.ts";

async function loadJsonFile(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function saveJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadConfig(): Promise<StoredConfig> {
  const raw = await loadJsonFile(CONFIG_PATH);
  return ensureStoredConfig(raw);
}

export async function saveConfig(config: StoredConfig): Promise<void> {
  await saveJsonFile(CONFIG_PATH, ensureStoredConfig(config));
}

export async function clearConfig(): Promise<void> {
  try {
    await rm(CONFIG_PATH);
  } catch {
    // ignore missing file
  }
}

async function loadAuthStore(): Promise<AuthStore> {
  const raw = await loadJsonFile(AUTH_PATH);
  return isRecord(raw) ? (raw as AuthStore) : {};
}

async function loadSettingsStore(): Promise<SettingsStore> {
  const raw = await loadJsonFile(SETTINGS_PATH);
  return isRecord(raw) ? (raw as SettingsStore) : {};
}

export async function loadModelsRegistry(): Promise<AgentModelsRegistry> {
  return ensureAgentModelsRegistry(await loadJsonFile(MODELS_PATH));
}

export async function saveModelsRegistry(registry: unknown): Promise<void> {
  const normalized = ensureAgentModelsRegistry(registry);
  const sanitized = {
    providers: Object.fromEntries(
      Object.entries(normalized.providers).map(([providerId, entry]) => {
        const source = isRecord(entry) ? entry : {};
        return [
          providerId,
          buildWritableProviderCacheEntry(
            providerId,
            {
              name: String(source.name || "OpenAI Compatible"),
              baseUrl: String(source.baseUrl || ""),
              defaultModelId: toOptionalString(source.defaultModelId),
            },
            Array.isArray(source.models)
              ? (source.models as ModelRecord[])
              : [],
          ),
        ];
      }),
    ),
  };
  await saveJsonFile(MODELS_PATH, sanitized);
}

export async function syncAgentModelsRegistry(
  providerId: string,
  config: ProviderProfile,
  models: ModelRecord[],
): Promise<void> {
  const registry = ensureAgentModelsRegistry(
    await loadJsonFile(AGENT_MODELS_PATH),
  );
  const nextRegistry = mergeProviderModelsRegistry(
    registry,
    providerId,
    config,
    models,
  );
  await saveJsonFile(AGENT_MODELS_PATH, nextRegistry);
}

export async function clearAgentModelsRegistry(
  providerId: string,
): Promise<void> {
  const registry = ensureAgentModelsRegistry(
    await loadJsonFile(AGENT_MODELS_PATH),
  );
  const nextRegistry = removeProviderModelsRegistryEntry(registry, providerId);
  await saveJsonFile(AGENT_MODELS_PATH, nextRegistry);
}

function buildAuthRecord(
  providerId: string,
  config: ProviderProfile,
): AuthRecord {
  return Object.fromEntries(
    Object.entries({
      provider: providerId,
      name: String(config.name || "OpenAI Compatible"),
      baseUrl: config.baseUrl,
      apiKey: String(config.apiKey || ""),
      api: "openai-completions",
      defaultModelId: toOptionalString(config.defaultModelId),
      previousProvider: toOptionalString(config.previousProvider),
      previousModel: toOptionalString(config.previousModel),
      authenticated: Boolean(config.apiKey),
      updatedAt: new Date().toISOString(),
    }).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as AuthRecord;
}

export async function syncAuthStore(config: ProviderProfile): Promise<void> {
  const authStore = await loadAuthStore();
  const settings = await loadSettingsStore();
  const previousSelection = buildPreviousSelection(authStore, settings);
  const nextConfig = {
    ...config,
    previousProvider:
      config.previousProvider || previousSelection.previousProvider,
    previousModel: config.previousModel || previousSelection.previousModel,
  };
  const authRecord = buildAuthRecord(nextConfig.id, nextConfig);
  const providerEntries = isRecord(authStore.providers)
    ? authStore.providers
    : {};

  const currentProviderEntry: JsonObject = isRecord(
    providerEntries[nextConfig.id],
  )
    ? (providerEntries[nextConfig.id] as JsonObject)
    : {};
  const currentTopLevelEntry: JsonObject = isRecord(authStore[nextConfig.id])
    ? (authStore[nextConfig.id] as JsonObject)
    : {};

  authStore.providers = {
    ...providerEntries,
    [nextConfig.id]: {
      ...currentProviderEntry,
      ...authRecord,
    },
  };

  authStore[nextConfig.id] = {
    ...currentTopLevelEntry,
    ...authRecord,
  };

  authStore.defaultProvider = nextConfig.id;
  authStore.currentProvider = nextConfig.id;
  authStore.authenticatedProviders = Array.from(
    new Set([
      ...(Array.isArray(authStore.authenticatedProviders)
        ? authStore.authenticatedProviders
        : []),
      nextConfig.id,
    ]),
  );

  await saveJsonFile(AUTH_PATH, authStore);
}

export async function clearAuthStore(providerId: string): Promise<void> {
  const authStore = await loadAuthStore();
  const providerRecord =
    (isRecord(authStore.providers?.[providerId])
      ? authStore.providers?.[providerId]
      : undefined) ||
    (isRecord(authStore[providerId]) ? authStore[providerId] : undefined) ||
    {};
  let changed = false;

  if (isRecord(authStore.providers) && providerId in authStore.providers) {
    delete authStore.providers[providerId];
    changed = true;
  }

  if (providerId in authStore) {
    delete authStore[providerId];
    changed = true;
  }

  if (Array.isArray(authStore.authenticatedProviders)) {
    const filtered = authStore.authenticatedProviders.filter(
      (savedProviderId) => savedProviderId !== providerId,
    );
    if (filtered.length !== authStore.authenticatedProviders.length) {
      authStore.authenticatedProviders = filtered;
      changed = true;
    }
  }

  if (authStore.defaultProvider === providerId) {
    authStore.defaultProvider = toOptionalString(
      providerRecord.previousProvider,
    );
    changed = true;
  }

  if (authStore.currentProvider === providerId) {
    authStore.currentProvider = toOptionalString(
      providerRecord.previousProvider,
    );
    changed = true;
  }

  if (changed) {
    await saveJsonFile(AUTH_PATH, authStore);
  }
}

export async function syncSettings(config: ProviderProfile): Promise<void> {
  const settings = await loadSettingsStore();
  const previousSelection = buildPreviousSelection(
    await loadAuthStore(),
    settings,
  );
  const nextSettings = applyCurrentSelection(settings, {
    ...config,
    previousProvider:
      config.previousProvider || previousSelection.previousProvider,
    previousModel: config.previousModel || previousSelection.previousModel,
  });
  await saveJsonFile(SETTINGS_PATH, nextSettings);
}

export async function restoreSettings(
  config?: ProviderProfile | null,
): Promise<void> {
  const settings = await loadSettingsStore();
  const nextSettings = buildRestoredSettings(settings, config || null);

  if (JSON.stringify(nextSettings) !== JSON.stringify(settings)) {
    await saveJsonFile(SETTINGS_PATH, nextSettings);
  }
}
