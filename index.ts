import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_PROVIDER_PREFIX = "openai-compatible";
const CONFIG_VERSION = 2;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(EXTENSION_DIR, "..", "..");
const CONFIG_PATH = join(EXTENSION_DIR, "provider-config.json");
const AUTH_PATH = join(AGENT_DIR, "auth.json");
const AGENT_MODELS_PATH = join(AGENT_DIR, "models.json");
const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
const MODELS_PATH = join(EXTENSION_DIR, "provider-models.json");

type ModelRecord = {
  id: string;
  name?: string;
  [key: string]: any;
};

type ProviderProfile = {
  id: string;
  name: string;
  nameKey: string;
  baseUrl: string;
  apiKey: string;
  defaultModelId?: string;
  lastModelId?: string;
  previousProvider?: string;
  previousModel?: string;
  updatedAt?: string;
};

type StoredConfig = {
  version: number;
  activeProviderId?: string;
  providers: ProviderProfile[];
};

type AgentModelsRegistry = {
  providers: Record<string, any>;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function canonicalizeProviderName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function slugifyProviderName(value: string): string {
  return (
    canonicalizeProviderName(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider"
  );
}

export function getProviderId(name: string): string {
  return `${EXTENSION_PROVIDER_PREFIX}:${slugifyProviderName(name)}`;
}

function isExtensionProviderId(value: any): boolean {
  return (
    typeof value === "string" &&
    (value === EXTENSION_PROVIDER_PREFIX ||
      value.startsWith(`${EXTENSION_PROVIDER_PREFIX}:`))
  );
}

function getCandidateBaseUrls(value: string): string[] {
  const normalized = normalizeBaseUrl(value);
  const candidates = new Set<string>();

  candidates.add(normalized);

  if (normalized.endsWith("/models")) {
    candidates.add(normalizeBaseUrl(normalized.replace(/\/models$/i, "")));
  }

  if (normalized.endsWith("/chat/completions")) {
    candidates.add(
      normalizeBaseUrl(normalized.replace(/\/chat\/completions$/i, "")),
    );
  }

  if (!normalized.endsWith("/v1")) {
    candidates.add(`${normalized}/v1`);
  }

  return [...candidates].filter(Boolean);
}

function inferReasoning(modelId: string): boolean {
  return /(^o[0-9])|(reason)|(thinking)|(r1)/i.test(modelId);
}

function inferImageSupport(modelId: string): boolean {
  return /(vision)|(vl)|(^gpt-4o)|(^gpt-4\.1)|(^gemini)/i.test(modelId);
}

function getModelCost(modelId: string): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  if (/^gpt-5\.4$/i.test(modelId)) {
    return {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 0.25,
    };
  }

  if (/^gpt-5\.5$/i.test(modelId)) {
    return {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 0.5,
    };
  }

  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export function buildStoredConfig(input: any): ProviderProfile {
  const name = String(input?.name || "OpenAI Compatible").trim();
  const nameKey = canonicalizeProviderName(name);

  return Object.fromEntries(
    Object.entries({
      id: String(input?.id || getProviderId(name)),
      name,
      nameKey,
      baseUrl: normalizeBaseUrl(String(input?.baseUrl || "")),
      apiKey: String(input?.apiKey || "").trim(),
      defaultModelId: input?.defaultModelId
        ? String(input.defaultModelId)
        : undefined,
      lastModelId: input?.lastModelId ? String(input.lastModelId) : undefined,
      previousProvider: input?.previousProvider
        ? String(input.previousProvider)
        : undefined,
      previousModel: input?.previousModel
        ? String(input.previousModel)
        : undefined,
      updatedAt: input?.updatedAt || new Date().toISOString(),
    }).filter(([, value]) => value !== undefined),
  ) as ProviderProfile;
}

export function buildStoredConfigFromLegacy(input: any): StoredConfig {
  const provider = buildStoredConfig(input);
  return {
    version: CONFIG_VERSION,
    activeProviderId: provider.id,
    providers: [provider],
  };
}

export function ensureStoredConfig(input: any): StoredConfig {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    input.version === CONFIG_VERSION &&
    Array.isArray(input.providers)
  ) {
    return {
      version: CONFIG_VERSION,
      activeProviderId:
        typeof input.activeProviderId === "string"
          ? input.activeProviderId
          : undefined,
      providers: input.providers.map((provider: any) =>
        buildStoredConfig(provider),
      ),
    };
  }

  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
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

export function ensureAgentModelsRegistry(input: any): AgentModelsRegistry {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    input.providers &&
    typeof input.providers === "object" &&
    !Array.isArray(input.providers)
  ) {
    return {
      providers: { ...input.providers },
    };
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      providers: { ...input },
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

function getProviderById(
  config: StoredConfig,
  providerId?: string,
): ProviderProfile | null {
  if (!providerId) return null;
  return (
    config.providers.find((provider) => provider.id === providerId) || null
  );
}

function getProviderByName(
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
  provider: any,
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

export function getProviderCacheEntry(registry: any, providerId: string): any {
  const normalized = ensureAgentModelsRegistry(registry);
  return normalized.providers[providerId] || null;
}

async function loadJsonFile(path: string): Promise<any | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveJsonFile(path: string, value: any): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadConfig(): Promise<StoredConfig> {
  const raw = await loadJsonFile(CONFIG_PATH);
  return ensureStoredConfig(raw);
}

async function saveConfig(config: StoredConfig): Promise<void> {
  await saveJsonFile(CONFIG_PATH, ensureStoredConfig(config));
}

async function clearConfig(): Promise<void> {
  try {
    await rm(CONFIG_PATH);
  } catch {}
}

async function loadAuthStore(): Promise<any> {
  return (await loadJsonFile(AUTH_PATH)) || {};
}

async function loadSettingsStore(): Promise<any> {
  return (await loadJsonFile(SETTINGS_PATH)) || {};
}

export function buildPreviousSelection(authStore: any, settings: any): any {
  const authPreviousProvider =
    authStore.currentProvider || authStore.defaultProvider || undefined;
  const settingsPreviousProvider = settings.defaultProvider || undefined;
  const previousProvider =
    authPreviousProvider && !isExtensionProviderId(authPreviousProvider)
      ? authPreviousProvider
      : settingsPreviousProvider &&
          !isExtensionProviderId(settingsPreviousProvider)
        ? settingsPreviousProvider
        : undefined;

  const previousModel =
    settings.defaultModel && !isExtensionProviderId(settings.defaultProvider)
      ? settings.defaultModel
      : undefined;

  return Object.fromEntries(
    Object.entries({
      previousProvider,
      previousModel,
    }).filter(([, value]) => value !== undefined),
  );
}

export function applyCurrentSelection(settings: any, config: any): any {
  const nextSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...settings }
      : {};

  if (
    !config.previousProvider &&
    nextSettings.defaultProvider &&
    !isExtensionProviderId(nextSettings.defaultProvider)
  ) {
    config.previousProvider = String(nextSettings.defaultProvider);
  }

  if (
    !config.previousModel &&
    !isExtensionProviderId(nextSettings.defaultProvider) &&
    nextSettings.defaultModel
  ) {
    config.previousModel = String(nextSettings.defaultModel);
  }

  nextSettings.defaultProvider = String(config.id || EXTENSION_PROVIDER_PREFIX);
  if (config.defaultModelId) {
    nextSettings.defaultModel = String(config.defaultModelId);
  }

  return nextSettings;
}

export function buildRestoredSettings(settings: any, config: any): any {
  const nextSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...settings }
      : {};
  const wasUsingExtension = isExtensionProviderId(nextSettings.defaultProvider);

  if (wasUsingExtension) {
    if (config?.previousProvider) {
      nextSettings.defaultProvider = String(config.previousProvider);
    } else {
      nextSettings.defaultProvider = undefined;
    }
  }

  if (config?.previousModel) {
    nextSettings.defaultModel = String(config.previousModel);
  } else if (wasUsingExtension) {
    nextSettings.defaultModel = undefined;
  }

  return Object.fromEntries(
    Object.entries(nextSettings).filter(([, value]) => value !== undefined),
  );
}

export function mergeProviderModelsRegistry(
  registry: any,
  providerId: string,
  config: any,
  models: any[],
): AgentModelsRegistry {
  const nextRegistry = ensureAgentModelsRegistry(registry);

  nextRegistry.providers[providerId] = {
    provider: providerId,
    name: String(config.name || "OpenAI Compatible"),
    baseUrl: normalizeBaseUrl(String(config.baseUrl || "")),
    apiKey: String(config.apiKey || ""),
    api: "openai-completions",
    defaultModelId: config.defaultModelId
      ? String(config.defaultModelId)
      : undefined,
    updatedAt: new Date().toISOString(),
    models,
  };

  return nextRegistry;
}

export function removeProviderModelsRegistryEntry(
  registry: any,
  providerId: string,
): AgentModelsRegistry {
  const nextRegistry = ensureAgentModelsRegistry(registry);
  delete nextRegistry.providers[providerId];
  return nextRegistry;
}

async function loadModelsRegistry(): Promise<any> {
  return (await loadJsonFile(MODELS_PATH)) || {};
}

async function saveModelsRegistry(registry: any): Promise<void> {
  await saveJsonFile(MODELS_PATH, registry);
}

async function syncAgentModelsRegistry(
  providerId: string,
  config: ProviderProfile,
  models: any[],
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

async function clearAgentModelsRegistry(providerId: string): Promise<void> {
  const registry = ensureAgentModelsRegistry(
    await loadJsonFile(AGENT_MODELS_PATH),
  );
  const nextRegistry = removeProviderModelsRegistryEntry(registry, providerId);
  await saveJsonFile(AGENT_MODELS_PATH, nextRegistry);
}

function buildAuthRecord(providerId: string, config: ProviderProfile): any {
  const record = {
    provider: providerId,
    name: String(config.name || "OpenAI Compatible"),
    baseUrl: normalizeBaseUrl(String(config.baseUrl || "")),
    apiKey: String(config.apiKey || ""),
    api: "openai-completions",
    defaultModelId: config.defaultModelId
      ? String(config.defaultModelId)
      : undefined,
    previousProvider: config.previousProvider
      ? String(config.previousProvider)
      : undefined,
    previousModel: config.previousModel
      ? String(config.previousModel)
      : undefined,
    authenticated: Boolean(config.apiKey),
    updatedAt: new Date().toISOString(),
  };

  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

async function syncAuthStore(config: ProviderProfile): Promise<void> {
  const authStore = await loadAuthStore();
  const settings = await loadSettingsStore();
  const previousSelection = buildPreviousSelection(authStore, settings);
  const nextConfig = buildStoredConfig({
    ...config,
    previousProvider:
      config.previousProvider || previousSelection.previousProvider,
    previousModel: config.previousModel || previousSelection.previousModel,
  });
  const authRecord = buildAuthRecord(nextConfig.id, nextConfig);

  authStore.providers = {
    ...(authStore.providers && typeof authStore.providers === "object"
      ? authStore.providers
      : {}),
    [nextConfig.id]: {
      ...(authStore.providers?.[nextConfig.id] || {}),
      ...authRecord,
    },
  };

  authStore[nextConfig.id] = {
    ...(authStore[nextConfig.id] && typeof authStore[nextConfig.id] === "object"
      ? authStore[nextConfig.id]
      : {}),
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

async function clearAuthStore(providerId: string): Promise<void> {
  const authStore = await loadAuthStore();
  const providerRecord =
    authStore.providers?.[providerId] || authStore[providerId] || {};
  let changed = false;

  if (authStore.providers?.[providerId]) {
    delete authStore.providers[providerId];
    changed = true;
  }

  if (authStore[providerId]) {
    delete authStore[providerId];
    changed = true;
  }

  if (Array.isArray(authStore.authenticatedProviders)) {
    const filtered = authStore.authenticatedProviders.filter(
      (savedProviderId: any) => savedProviderId !== providerId,
    );
    if (filtered.length !== authStore.authenticatedProviders.length) {
      authStore.authenticatedProviders = filtered;
      changed = true;
    }
  }

  if (authStore.defaultProvider === providerId) {
    if (providerRecord.previousProvider) {
      authStore.defaultProvider = providerRecord.previousProvider;
    } else {
      authStore.defaultProvider = undefined;
    }
    changed = true;
  }

  if (authStore.currentProvider === providerId) {
    if (providerRecord.previousProvider) {
      authStore.currentProvider = providerRecord.previousProvider;
    } else {
      authStore.currentProvider = undefined;
    }
    changed = true;
  }

  if (changed) {
    await saveJsonFile(AUTH_PATH, authStore);
  }
}

async function syncSettings(config: ProviderProfile): Promise<void> {
  const settings = await loadSettingsStore();
  const nextSettings = applyCurrentSelection(settings, config);
  await saveJsonFile(SETTINGS_PATH, nextSettings);
}

async function restoreSettings(config?: ProviderProfile | null): Promise<void> {
  const settings = await loadSettingsStore();
  const nextSettings = buildRestoredSettings(settings, config || null);

  if (JSON.stringify(nextSettings) !== JSON.stringify(settings)) {
    await saveJsonFile(SETTINGS_PATH, nextSettings);
  }
}

function getModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

async function tryFetchModels(modelsUrl: string, apiKey: string): Promise<any> {
  const response = await fetch(modelsUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }

  return response.json();
}

async function fetchModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ models: any[]; resolvedBaseUrl: string }> {
  const candidateBaseUrls = getCandidateBaseUrls(baseUrl);
  let payload: any = null;
  let resolvedBaseUrl: string | null = null;
  const errors: string[] = [];

  for (const candidateBaseUrl of candidateBaseUrls) {
    const modelsUrl = getModelsUrl(candidateBaseUrl);
    try {
      payload = await tryFetchModels(modelsUrl, apiKey);
      resolvedBaseUrl = candidateBaseUrl;
      break;
    } catch (error: any) {
      errors.push(`${modelsUrl} -> ${error?.message || String(error)}`);
    }
  }

  if (!payload || !resolvedBaseUrl) {
    throw new Error(`Failed to fetch models. Tried: ${errors.join(" | ")}`);
  }

  const rawModels = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];

  if (rawModels.length === 0) {
    throw new Error(
      `No models returned by provider. Resolved base URL: ${resolvedBaseUrl}`,
    );
  }

  const models = rawModels
    .filter(
      (model: any) =>
        typeof model?.id === "string" && model.id.trim().length > 0,
    )
    .map((model: any) => {
      const id = String(model.id);
      const name = String(model.name || id);
      const reasoning = inferReasoning(id);
      const supportsImages = inferImageSupport(id);
      const contextWindow =
        Number(model.context_window) ||
        Number(model.contextWindow) ||
        Number(model.max_context_tokens) ||
        128000;
      const maxTokens =
        Number(model.max_tokens) ||
        Number(model.max_output_tokens) ||
        Number(model.max_completion_tokens) ||
        16384;

      return {
        id,
        name,
        reasoning,
        input: supportsImages ? ["text", "image"] : ["text"],
        cost: getModelCost(id),
        contextWindow,
        maxTokens,
        compat: {
          supportsDeveloperRole: true,
          supportsReasoningEffort: reasoning,
          maxTokensField: "max_tokens",
        },
      };
    })
    .sort((a: any, b: any) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  return { models, resolvedBaseUrl };
}

export function buildRegisteredProviderConfig(
  config: ProviderProfile,
  models: any[],
): any {
  const providerLabel = String(config.name || "OpenAI Compatible");
  return {
    baseUrl: normalizeBaseUrl(
      String(config.baseUrl || "https://diyproxy.fly.dev/v1"),
    ),
    apiKey: String(config.apiKey || ""),
    api: "openai-completions",
    models: models.map((model) => ({
      ...model,
      baseUrl: normalizeBaseUrl(
        String(config.baseUrl || "https://diyproxy.fly.dev/v1"),
      ),
      name: `${providerLabel} / ${
        String(model.name || model.id)
          .split(" / ")
          .slice(-1)[0]
      }`,
    })),
  };
}

async function registerProviderInstance(
  pi: any,
  config: ProviderProfile,
  models: any[],
): Promise<{ provider: any; models: any[] }> {
  const provider = buildRegisteredProviderConfig(config, models);
  pi.registerProvider(config.id, provider);
  await syncAuthStore(config);
  await syncAgentModelsRegistry(config.id, config, provider.models);
  await syncSettings(config);
  return { provider, models: provider.models };
}

async function promptForConfig(ctx: any, defaults?: any): Promise<any | null> {
  if (!ctx.hasUI) {
    throw new Error(
      "UI is not available. Run this command in interactive mode.",
    );
  }

  const name = await ctx.ui.input(
    "Provider name",
    defaults?.name || "OpenAI Compatible",
  );
  if (!name) return null;

  const baseUrl = await ctx.ui.input(
    "Base URL",
    defaults?.baseUrl || "https://diyproxy.fly.dev/v1",
  );
  if (!baseUrl) return null;

  const apiKey = await ctx.ui.input("API key", defaults?.apiKey || "");
  if (!apiKey) return null;

  return {
    name: String(name).trim(),
    baseUrl: normalizeBaseUrl(String(baseUrl)),
    apiKey: String(apiKey).trim(),
  };
}

async function activateProvider(
  pi: any,
  ctx: any,
  configState: StoredConfig,
  provider: ProviderProfile,
  models: any[],
  options?: { notify?: boolean },
): Promise<StoredConfig> {
  const previousActive = getProviderById(
    configState,
    configState.activeProviderId,
  );
  const currentModel = ctx.model;
  let nextConfig = configState;

  if (
    previousActive &&
    currentModel?.provider === previousActive.id &&
    currentModel?.id
  ) {
    nextConfig = updateProviderLastModel(
      nextConfig,
      previousActive.id,
      currentModel.id,
    );
  }

  if (previousActive && previousActive.id !== provider.id) {
    pi.unregisterProvider(previousActive.id);
  }

  const selectedModelId = getProviderSelectionModelId(provider, models);
  const activeProvider = buildStoredConfig({
    ...provider,
    defaultModelId: provider.defaultModelId || selectedModelId,
  });

  await registerProviderInstance(pi, activeProvider, models);

  nextConfig = putProviderProfile(nextConfig, activeProvider);
  nextConfig.activeProviderId = activeProvider.id;
  await saveConfig(nextConfig);

  if (selectedModelId) {
    const model = ctx.modelRegistry?.find?.(activeProvider.id, selectedModelId);
    if (model) {
      await pi.setModel(model);
      nextConfig = updateProviderLastModel(
        nextConfig,
        activeProvider.id,
        selectedModelId,
      );
      await saveConfig(nextConfig);
    }
  }

  if (options?.notify !== false) {
    ctx.ui.notify(`Active provider: ${activeProvider.name}`, "info");
  }

  return nextConfig;
}

function formatProviderSummary(
  provider: ProviderProfile,
  isActive: boolean,
): string {
  const marker = isActive ? "*" : "-";
  const model =
    provider.lastModelId || provider.defaultModelId || "no model selected";
  return `${marker} ${provider.name} — ${provider.baseUrl} — ${model}`;
}

export default async function (pi: any) {
  const initialConfig = await loadConfig();
  const initialProvider = getProviderById(
    initialConfig,
    initialConfig.activeProviderId,
  );
  if (initialProvider) {
    try {
      const modelsRegistry = await loadModelsRegistry();
      const entry = getProviderCacheEntry(modelsRegistry, initialProvider.id);
      if (entry?.models?.length) {
        await registerProviderInstance(pi, initialProvider, entry.models);
      }
    } catch (error) {
      console.error(
        "[openai-compatible] Failed to load saved provider:",
        error,
      );
    }
  }

  pi.on("session_start", async (event: any, ctx: any) => {
    try {
      const configState = await loadConfig();
      const activeProvider = getProviderById(
        configState,
        configState.activeProviderId,
      );
      const modelsRegistry = await loadModelsRegistry();
      const savedEntry = activeProvider
        ? getProviderCacheEntry(modelsRegistry, activeProvider.id)
        : null;

      if (
        !activeProvider &&
        ctx.hasUI &&
        (event?.reason === "startup" || event?.reason === "reload")
      ) {
        ctx.ui.notify(
          "Run /openai-compatible-login to configure OpenAI Compatible.",
          "info",
        );
        return;
      }

      if (!activeProvider || !savedEntry?.models?.length) return;

      const currentModel = ctx.model;
      if (currentModel && currentModel.provider === activeProvider.id) return;

      const preferredModelId = getProviderSelectionModelId(
        activeProvider,
        savedEntry.models,
      );
      if (!preferredModelId) return;

      const model = ctx.modelRegistry?.find?.(
        activeProvider.id,
        preferredModelId,
      );
      if (!model) return;

      const selected = await pi.setModel(model);
      if (selected) {
        ctx.ui.notify(
          `Selected default model: ${activeProvider.name} / ${model.id}`,
          "info",
        );
      }
    } catch (error) {
      console.error(
        "[openai-compatible] Failed to auto-select default model:",
        error,
      );
    }
  });

  pi.registerCommand("openai-compatible-login", {
    description:
      "Login to an OpenAI-compatible provider and auto-fetch its models",
    handler: async (_args: string, ctx: any) => {
      const configState = await loadConfig();
      const preselected = getProviderById(
        configState,
        configState.activeProviderId,
      );
      const initialDefaults = preselected || undefined;
      const draft = await promptForConfig(ctx, initialDefaults);
      if (!draft) {
        ctx.ui.notify("Setup cancelled", "warning");
        return;
      }

      const existing = getProviderByName(configState, draft.name);
      const providerDraft = buildStoredConfig({ ...existing, ...draft });

      try {
        const discovered = await fetchModels(
          providerDraft.baseUrl,
          providerDraft.apiKey,
        );
        providerDraft.baseUrl = discovered.resolvedBaseUrl;

        const modelOptions = discovered.models.map(
          (model: any, index: number) => `${index + 1}. ${model.name}`,
        );
        const selectedModelLabel = await ctx.ui.select(
          `Select default model (${discovered.models.length} models)`,
          modelOptions,
        );
        const selectedModelIndex = selectedModelLabel
          ? modelOptions.indexOf(selectedModelLabel)
          : -1;
        providerDraft.defaultModelId =
          selectedModelIndex >= 0
            ? discovered.models[selectedModelIndex]?.id
            : discovered.models[0]?.id;

        const nextConfig = putProviderProfile(configState, providerDraft);
        nextConfig.activeProviderId = providerDraft.id;
        await saveConfig(nextConfig);

        const modelsRegistry = await loadModelsRegistry();
        await saveModelsRegistry(
          mergeProviderModelsRegistry(
            modelsRegistry,
            providerDraft.id,
            providerDraft,
            discovered.models,
          ),
        );

        await activateProvider(
          pi,
          ctx,
          nextConfig,
          providerDraft,
          discovered.models,
          {
            notify: false,
          },
        );

        ctx.ui.notify(
          `Registered ${providerDraft.name} with ${discovered.models.length} model(s)`,
          "info",
        );
        if (providerDraft.defaultModelId) {
          ctx.ui.notify(
            `Default model set to ${providerDraft.defaultModelId}`,
            "info",
          );
        }
        ctx.ui.notify(
          "Setup complete. Use /model if you want to switch models.",
          "info",
        );
      } catch (error: any) {
        ctx.ui.notify(
          `Setup failed: ${error?.message || String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("openai-compatible-refresh", {
    description: "Refresh models from the active OpenAI-compatible provider",
    handler: async (_args: string, ctx: any) => {
      const configState = await loadConfig();
      const activeProvider = getProviderById(
        configState,
        configState.activeProviderId,
      );
      if (!activeProvider) {
        ctx.ui.notify(
          "No saved provider config. Run /openai-compatible-login first.",
          "warning",
        );
        return;
      }

      try {
        const discovered = await fetchModels(
          activeProvider.baseUrl,
          activeProvider.apiKey,
        );
        const refreshedProvider = buildStoredConfig({
          ...activeProvider,
          baseUrl: discovered.resolvedBaseUrl,
        });
        if (
          !refreshedProvider.defaultModelId ||
          !discovered.models.some(
            (model: any) => model.id === refreshedProvider.defaultModelId,
          )
        ) {
          refreshedProvider.defaultModelId = discovered.models[0]?.id;
        }

        const nextConfig = putProviderProfile(configState, refreshedProvider);
        nextConfig.activeProviderId = refreshedProvider.id;
        await saveConfig(nextConfig);

        const modelsRegistry = await loadModelsRegistry();
        await saveModelsRegistry(
          mergeProviderModelsRegistry(
            modelsRegistry,
            refreshedProvider.id,
            refreshedProvider,
            discovered.models,
          ),
        );

        pi.unregisterProvider(refreshedProvider.id);
        await activateProvider(
          pi,
          ctx,
          nextConfig,
          refreshedProvider,
          discovered.models,
          {
            notify: false,
          },
        );

        ctx.ui.notify(
          `Refreshed ${discovered.models.length} model(s) for ${refreshedProvider.name}`,
          "info",
        );
      } catch (error: any) {
        ctx.ui.notify(
          `Refresh failed: ${error?.message || String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("openai-compatible-list", {
    description: "List saved OpenAI-compatible providers",
    handler: async (_args: string, ctx: any) => {
      const configState = await loadConfig();
      if (configState.providers.length === 0) {
        ctx.ui.notify("No saved OpenAI-compatible providers.", "info");
        return;
      }

      for (const provider of configState.providers) {
        ctx.ui.notify(
          formatProviderSummary(
            provider,
            provider.id === configState.activeProviderId,
          ),
          "info",
        );
      }
    },
  });

  pi.registerCommand("openai-compatible-switch", {
    description: "Switch to another saved OpenAI-compatible provider",
    handler: async (_args: string, ctx: any) => {
      const configState = await loadConfig();
      if (configState.providers.length === 0) {
        ctx.ui.notify(
          "No saved providers. Run /openai-compatible-login first.",
          "warning",
        );
        return;
      }

      const options = configState.providers.map((provider) => provider.name);
      const selectedName = await ctx.ui.select("Select provider", options);
      if (!selectedName) {
        ctx.ui.notify("Switch cancelled", "warning");
        return;
      }

      const selectedProvider = getProviderByName(configState, selectedName);
      if (!selectedProvider) {
        ctx.ui.notify(`Provider not found: ${selectedName}`, "error");
        return;
      }

      const modelsRegistry = await loadModelsRegistry();
      const savedEntry = getProviderCacheEntry(
        modelsRegistry,
        selectedProvider.id,
      );
      if (!savedEntry?.models?.length) {
        ctx.ui.notify(
          `No cached models for ${selectedProvider.name}. Run /openai-compatible-refresh or login again.`,
          "warning",
        );
        return;
      }

      await activateProvider(
        pi,
        ctx,
        configState,
        selectedProvider,
        savedEntry.models,
      );
    },
  });

  pi.registerCommand("openai-compatible-clear", {
    description: "Remove one or all saved OpenAI-compatible provider configs",
    handler: async (_args: string, ctx: any) => {
      const configState = await loadConfig();
      if (configState.providers.length === 0) {
        ctx.ui.notify("No saved providers to remove.", "info");
        return;
      }

      const options =
        configState.providers.length === 1
          ? [configState.providers[0].name]
          : [
              ...configState.providers.map((provider) => provider.name),
              "all providers",
            ];
      const selected = await ctx.ui.select("Remove provider", options);
      if (!selected) {
        ctx.ui.notify("Clear cancelled", "warning");
        return;
      }

      if (selected === "all providers") {
        for (const provider of configState.providers) {
          pi.unregisterProvider(provider.id);
          await clearAuthStore(provider.id);
          await clearAgentModelsRegistry(provider.id);
        }
        const activeProvider = getProviderById(
          configState,
          configState.activeProviderId,
        );
        await restoreSettings(activeProvider);
        await saveModelsRegistry({});
        await clearConfig();
        ctx.ui.notify("All OpenAI-compatible providers removed", "info");
        return;
      }

      const provider = getProviderByName(configState, selected);
      if (!provider) {
        ctx.ui.notify(`Provider not found: ${selected}`, "error");
        return;
      }

      const wasActive = configState.activeProviderId === provider.id;
      if (wasActive) {
        pi.unregisterProvider(provider.id);
        await restoreSettings(provider);
      }

      await clearAuthStore(provider.id);
      await clearAgentModelsRegistry(provider.id);

      const modelsRegistry = await loadModelsRegistry();
      await saveModelsRegistry(
        removeProviderModelsRegistryEntry(modelsRegistry, provider.id),
      );

      const nextConfig = removeProviderProfile(configState, provider.id);
      if (nextConfig.providers.length === 0) {
        await clearConfig();
      } else {
        await saveConfig(nextConfig);
      }

      ctx.ui.notify(`Removed ${provider.name}`, "info");
    },
  });
}
