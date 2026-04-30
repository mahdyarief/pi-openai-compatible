import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTENSION_PROVIDER_PREFIX,
  applyCurrentSelection,
  buildPreviousSelection,
  buildRegisteredProviderConfig,
  buildRestoredSettings,
  buildStoredConfig,
  buildStoredConfigFromLegacy,
  buildWritableProviderCacheEntry,
  canonicalizeProviderName,
  ensureAgentModelsRegistry,
  ensureStoredConfig,
  getCandidateBaseUrls,
  getProviderCacheEntry,
  getProviderId,
  getProviderSelectionModelId,
  mergeProviderModelsRegistry,
  normalizeBaseUrl,
  putProviderProfile,
  removeProviderModelsRegistryEntry,
  removeProviderProfile,
  updateProviderLastModel,
} from "./index.ts";
import registerExtension, {
  createExtension,
  type ExtensionDependencies,
} from "./src/extension.ts";
import type {
  AgentModelsRegistry,
  CommandContext,
  ModelRecord,
  PiCommandDefinition,
  PiInstance,
  PiModel,
  StoredConfig,
} from "./src/types.ts";

test("normalizeBaseUrl trims trailing slashes", () => {
  assert.equal(
    normalizeBaseUrl(" https://example.com/v1/// "),
    "https://example.com/v1",
  );
});

test("getCandidateBaseUrls handles base paths and endpoint-like inputs", () => {
  assert.deepEqual(getCandidateBaseUrls("https://example.com/v1"), [
    "https://example.com/v1",
  ]);

  assert.deepEqual(getCandidateBaseUrls("https://example.com"), [
    "https://example.com",
    "https://example.com/v1",
  ]);

  assert.deepEqual(
    getCandidateBaseUrls("https://example.com/v1/chat/completions"),
    ["https://example.com/v1/chat/completions", "https://example.com/v1"],
  );
});

test("canonicalizeProviderName trims and lowercases provider names", () => {
  assert.equal(canonicalizeProviderName("  DiYProxy  "), "diyproxy");
});

test("getProviderId generates stable provider ids", () => {
  assert.equal(
    getProviderId("  DiYProxy  "),
    `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
  );
  assert.equal(
    getProviderId("Acme API"),
    `${EXTENSION_PROVIDER_PREFIX}:acme-api`,
  );
});

test("buildStoredConfigFromLegacy migrates single-provider config to version 2", () => {
  const migrated = buildStoredConfigFromLegacy({
    name: "diyproxy",
    baseUrl: "https://diyproxy.fly.dev/v1",
    apiKey: "secret",
    defaultModelId: "gpt-5.5",
    previousProvider: "anthropic",
    previousModel: "claude-sonnet-4-5",
  });

  assert.equal(migrated.version, 2);
  assert.equal(
    migrated.activeProviderId,
    `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
  );
  assert.equal(migrated.providers.length, 1);
  assert.equal(migrated.providers[0].nameKey, "diyproxy");
  assert.equal(migrated.providers[0].defaultModelId, "gpt-5.5");
  assert.equal(migrated.providers[0].previousProvider, "anthropic");
});

test("ensureStoredConfig returns empty version 2 config for invalid input", () => {
  assert.deepEqual(ensureStoredConfig(null), {
    version: 2,
    activeProviderId: undefined,
    providers: [],
  });
});

test("ensureAgentModelsRegistry migrates flat legacy registry into providers wrapper", () => {
  assert.deepEqual(
    ensureAgentModelsRegistry({
      [`${EXTENSION_PROVIDER_PREFIX}:diyproxy`]: {
        models: [{ id: "gpt-5.4" }],
      },
    }),
    {
      providers: {
        [`${EXTENSION_PROVIDER_PREFIX}:diyproxy`]: {
          models: [{ id: "gpt-5.4" }],
        },
      },
    },
  );
});

test("putProviderProfile upserts provider by canonical name", () => {
  const first = putProviderProfile(
    ensureStoredConfig(null),
    buildStoredConfig({
      name: "DIYProxy",
      baseUrl: "https://first.example/v1",
      apiKey: "a",
    }),
  );
  const second = putProviderProfile(
    first,
    buildStoredConfig({
      name: "  diyproxy ",
      baseUrl: "https://second.example/v1",
      apiKey: "b",
      defaultModelId: "gpt-5.5",
    }),
  );

  assert.equal(second.providers.length, 1);
  assert.equal(second.providers[0].id, `${EXTENSION_PROVIDER_PREFIX}:diyproxy`);
  assert.equal(second.providers[0].baseUrl, "https://second.example/v1");
  assert.equal(second.providers[0].apiKey, "b");
  assert.equal(second.providers[0].defaultModelId, "gpt-5.5");
});

test("removeProviderProfile deletes only the targeted profile and clears activeProviderId", () => {
  const config = {
    version: 2,
    activeProviderId: `${EXTENSION_PROVIDER_PREFIX}:b`,
    providers: [
      buildStoredConfig({ name: "a", baseUrl: "https://a/v1", apiKey: "a" }),
      buildStoredConfig({ name: "b", baseUrl: "https://b/v1", apiKey: "b" }),
    ],
  };

  const next = removeProviderProfile(config, `${EXTENSION_PROVIDER_PREFIX}:b`);

  assert.equal(next.activeProviderId, undefined);
  assert.deepEqual(
    next.providers.map((provider) => provider.id),
    [`${EXTENSION_PROVIDER_PREFIX}:a`],
  );
});

test("getProviderSelectionModelId prefers lastModelId over defaultModelId", () => {
  assert.equal(
    getProviderSelectionModelId(
      {
        lastModelId: "gpt-5.5",
        defaultModelId: "gpt-4.1",
      },
      [{ id: "gpt-4.1" }, { id: "gpt-5.5" }],
    ),
    "gpt-5.5",
  );
});

test("getProviderSelectionModelId falls back to defaultModelId then first model", () => {
  assert.equal(
    getProviderSelectionModelId(
      {
        lastModelId: "missing",
        defaultModelId: "gpt-4.1",
      },
      [{ id: "gpt-4.1" }, { id: "gpt-5.5" }],
    ),
    "gpt-4.1",
  );

  assert.equal(
    getProviderSelectionModelId(
      {
        lastModelId: "missing",
        defaultModelId: "also-missing",
      },
      [{ id: "gpt-5.5" }],
    ),
    "gpt-5.5",
  );
});

test("updateProviderLastModel stores the last selected model for the targeted provider", () => {
  const updated = updateProviderLastModel(
    {
      version: 2,
      activeProviderId: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
      providers: [
        buildStoredConfig({
          name: "diyproxy",
          baseUrl: "https://diyproxy.fly.dev/v1",
          apiKey: "secret",
          defaultModelId: "gpt-5.4",
        }),
      ],
    },
    `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    "claude-sonnet-4-6",
  );

  assert.equal(updated.providers[0].lastModelId, "claude-sonnet-4-6");
});

test("buildRegisteredProviderConfig prefixes model names with provider name", () => {
  const provider = buildRegisteredProviderConfig(
    buildStoredConfig({
      name: "diyproxy",
      baseUrl: "https://diyproxy.fly.dev/v1",
      apiKey: "secret",
    }),
    [{ id: "gpt-5.5", name: "gpt-5.5" }],
  );

  assert.equal(provider.baseUrl, "https://diyproxy.fly.dev/v1");
  assert.equal(provider.models[0].name, "diyproxy / gpt-5.5");
});

test("buildWritableProviderCacheEntry strips secrets from cached model metadata", () => {
  const entry = buildWritableProviderCacheEntry(
    `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    buildStoredConfig({
      name: "diyproxy",
      baseUrl: "https://diyproxy.fly.dev/v1",
      apiKey: "secret",
      defaultModelId: "gpt-5.5",
    }),
    [{ id: "gpt-5.5", name: "diyproxy / gpt-5.5" }],
  );

  assert.equal(entry.provider, `${EXTENSION_PROVIDER_PREFIX}:diyproxy`);
  assert.equal("apiKey" in entry, false);
});

test("getProviderCacheEntry returns the provider-specific models entry", () => {
  const entry = getProviderCacheEntry(
    {
      providers: {
        [`${EXTENSION_PROVIDER_PREFIX}:a`]: { models: [{ id: "a-1" }] },
        [`${EXTENSION_PROVIDER_PREFIX}:b`]: { models: [{ id: "b-1" }] },
      },
    },
    `${EXTENSION_PROVIDER_PREFIX}:b`,
  );

  assert.deepEqual(entry, { models: [{ id: "b-1" }] });
});

test("mergeProviderModelsRegistry stores provider request config required by Pi", () => {
  const merged = mergeProviderModelsRegistry(
    {
      providers: {
        "other-provider": {
          models: [{ id: "shared-model", name: "Other / shared-model" }],
        },
      },
    },
    `${EXTENSION_PROVIDER_PREFIX}:kvcman`,
    {
      name: "kvcman",
      baseUrl: "https://kvcman.fly.dev/v1",
      apiKey: "secret",
      defaultModelId: "gpt-5.4",
    },
    [{ id: "gpt-5.4", name: "kvcman / gpt-5.4" }],
  );

  assert.deepEqual(merged.providers["other-provider"], {
    models: [{ id: "shared-model", name: "Other / shared-model" }],
  });
  assert.equal(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].name,
    "kvcman",
  );
  assert.equal(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].baseUrl,
    "https://kvcman.fly.dev/v1",
  );
  assert.equal(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].apiKey,
    "secret",
  );
  assert.equal(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].api,
    "openai-completions",
  );
  assert.equal(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].defaultModelId,
    "gpt-5.4",
  );
  assert.deepEqual(
    merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].models,
    [{ id: "gpt-5.4", name: "kvcman / gpt-5.4" }],
  );
  assert.equal(
    typeof merged.providers[`${EXTENSION_PROVIDER_PREFIX}:kvcman`].updatedAt,
    "string",
  );
});

test("removeProviderModelsRegistryEntry deletes only the targeted provider key", () => {
  const cleaned = removeProviderModelsRegistryEntry(
    {
      providers: {
        "other-provider": {
          models: [{ id: "shared-model", name: "Other / shared-model" }],
        },
        [`${EXTENSION_PROVIDER_PREFIX}:kvcman`]: {
          models: [{ id: "gpt-5.4", name: "kvcman / gpt-5.4" }],
        },
      },
    },
    `${EXTENSION_PROVIDER_PREFIX}:kvcman`,
  );

  assert.deepEqual(cleaned, {
    providers: {
      "other-provider": {
        models: [{ id: "shared-model", name: "Other / shared-model" }],
      },
    },
  });
});

test("buildPreviousSelection prefers non-extension provider and model", () => {
  const selection = buildPreviousSelection(
    {
      currentProvider: "anthropic",
      defaultProvider: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    },
    {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4",
    },
  );

  assert.deepEqual(selection, {
    previousProvider: "anthropic",
    previousModel: "claude-sonnet-4",
  });
});

test("applyCurrentSelection does not mutate the input config", () => {
  const config = {
    id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    defaultModelId: "gpt-5.4",
  };

  applyCurrentSelection(
    {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4",
      theme: "dark",
    },
    config,
  );

  assert.deepEqual(config, {
    id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    defaultModelId: "gpt-5.4",
  });
});

test("applyCurrentSelection captures previous selection and switches to concrete provider", () => {
  const nextSettings = applyCurrentSelection(
    {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4",
      theme: "dark",
    },
    {
      id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
      defaultModelId: "gpt-5.4",
    },
  );

  assert.deepEqual(nextSettings, {
    defaultProvider: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    defaultModel: "gpt-5.4",
    theme: "dark",
  });
});

test("buildRestoredSettings restores previous provider and model", () => {
  const restored = buildRestoredSettings(
    {
      defaultProvider: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
      defaultModel: "gpt-5.4",
      theme: "dark",
    },
    {
      id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
      previousProvider: "anthropic",
      previousModel: "claude-sonnet-4",
    },
  );

  assert.deepEqual(restored, {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4",
    theme: "dark",
  });
});

test("buildRestoredSettings clears extension model when no previous selection exists", () => {
  const restored = buildRestoredSettings(
    {
      defaultProvider: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
      defaultModel: "gpt-5.4",
      theme: "dark",
    },
    {
      id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    },
  );

  assert.deepEqual(restored, {
    theme: "dark",
  });
});

type TestHarness = {
  commands: Record<string, PiCommandDefinition>;
  ctx: CommandContext;
  dependencies: ExtensionDependencies;
  state: {
    config: StoredConfig;
    modelsRegistry: AgentModelsRegistry;
    authClears: string[];
    agentModelClears: string[];
    restoredProviders: Array<string | undefined>;
    savedConfigs: StoredConfig[];
    savedModelRegistries: unknown[];
    syncAuthProviders: string[];
    syncSettingsProviders: string[];
    syncAgentProviders: string[];
    setModels: PiModel[];
    registeredProviders: string[];
    unregisteredProviders: string[];
    notifications: Array<{ message: string; level: string }>;
    inputs: string[];
    selects: string[];
    selectPrompts: Array<{ label: string; options: string[] }>;
    fetched: Array<{ baseUrl: string; apiKey: string }>;
    sessionStartHandlers: Array<
      (event: unknown, ctx: CommandContext) => Promise<void> | void
    >;
  };
};

function createHarness(options?: {
  config?: StoredConfig;
  modelsRegistry?: AgentModelsRegistry;
  fetchModelsResult?: { models: ModelRecord[]; resolvedBaseUrl: string };
  fetchModelsError?: Error;
  inputs?: string[];
  selects?: string[];
  currentModel?: PiModel | null;
  modelLookupResult?: PiModel | null;
}): TestHarness {
  const state = {
    config: options?.config || ensureStoredConfig(null),
    modelsRegistry: options?.modelsRegistry || { providers: {} },
    authClears: [] as string[],
    agentModelClears: [] as string[],
    restoredProviders: [] as Array<string | undefined>,
    savedConfigs: [] as StoredConfig[],
    savedModelRegistries: [] as unknown[],
    syncAuthProviders: [] as string[],
    syncSettingsProviders: [] as string[],
    syncAgentProviders: [] as string[],
    setModels: [] as PiModel[],
    registeredProviders: [] as string[],
    unregisteredProviders: [] as string[],
    notifications: [] as Array<{ message: string; level: string }>,
    inputs: [...(options?.inputs || [])],
    selects: [...(options?.selects || [])],
    selectPrompts: [] as Array<{ label: string; options: string[] }>,
    fetched: [] as Array<{ baseUrl: string; apiKey: string }>,
    sessionStartHandlers: [] as Array<
      (event: unknown, ctx: CommandContext) => Promise<void> | void
    >,
  };

  const dependencies: ExtensionDependencies = {
    loadConfig: async () => structuredClone(state.config),
    saveConfig: async (config) => {
      state.config = structuredClone(config);
      state.savedConfigs.push(structuredClone(config));
    },
    clearConfig: async () => {
      state.config = ensureStoredConfig(null);
    },
    loadModelsRegistry: async () => structuredClone(state.modelsRegistry),
    saveModelsRegistry: async (registry) => {
      state.modelsRegistry = structuredClone(registry as AgentModelsRegistry);
      state.savedModelRegistries.push(structuredClone(registry));
    },
    syncAuthStore: async (provider) => {
      state.syncAuthProviders.push(provider.id);
    },
    syncSettings: async (provider) => {
      state.syncSettingsProviders.push(provider.id);
    },
    syncAgentModelsRegistry: async (providerId) => {
      state.syncAgentProviders.push(providerId);
    },
    clearAuthStore: async (providerId) => {
      state.authClears.push(providerId);
    },
    clearAgentModelsRegistry: async (providerId) => {
      state.agentModelClears.push(providerId);
    },
    restoreSettings: async (provider) => {
      state.restoredProviders.push(provider?.id);
    },
    fetchModels: async (baseUrl, apiKey) => {
      state.fetched.push({ baseUrl, apiKey });
      if (options?.fetchModelsError) {
        throw options.fetchModelsError;
      }
      return (
        options?.fetchModelsResult || {
          resolvedBaseUrl: baseUrl,
          models: [
            {
              id: "gpt-5.5",
              name: "gpt-5.5",
            },
          ],
        }
      );
    },
  };

  const commands: Record<string, PiCommandDefinition> = {};
  const ctx: CommandContext = {
    hasUI: true,
    model: options?.currentModel || null,
    modelRegistry: {
      find: (providerId, modelId) =>
        options?.modelLookupResult === undefined
          ? { id: modelId, provider: providerId }
          : options.modelLookupResult,
    },
    ui: {
      input: async () => state.inputs.shift(),
      select: async (label, optionList) => {
        state.selectPrompts.push({ label, options: [...optionList] });
        return state.selects.shift();
      },
      notify: (message, level) => {
        state.notifications.push({ message, level });
      },
    },
  };

  return { commands, ctx, dependencies, state };
}

async function registerTestExtension(harness: TestHarness) {
  await createExtension(harness.dependencies)({
    registerProvider: (providerId) => {
      harness.state.registeredProviders.push(providerId);
    },
    unregisterProvider: (providerId) => {
      harness.state.unregisteredProviders.push(providerId);
    },
    setModel: async (model) => {
      harness.state.setModels.push(model);
      return model;
    },
    registerCommand: (name, definition) => {
      harness.commands[name] = definition;
    },
    on: (eventName, handler) => {
      if (eventName === "session_start") {
        harness.state.sessionStartHandlers.push(handler);
      }
    },
  } as PiInstance);
}

test("default export is a callable extension registrar", () => {
  assert.equal(typeof registerExtension, "function");
});

test("login command registers provider, saves config, and selects default model", async () => {
  const harness = createHarness({
    inputs: ["Work Proxy", "https://proxy.example", "secret-key"],
    selects: ["1. gpt-5.5"],
    fetchModelsResult: {
      resolvedBaseUrl: "https://proxy.example/v1",
      models: [{ id: "gpt-5.5", name: "gpt-5.5" }],
    },
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-login"].handler("", harness.ctx);

  assert.equal(harness.state.config.providers.length, 1);
  assert.equal(
    harness.state.config.activeProviderId,
    `${EXTENSION_PROVIDER_PREFIX}:work-proxy`,
  );
  assert.deepEqual(harness.state.fetched, [
    { baseUrl: "https://proxy.example", apiKey: "secret-key" },
  ]);
  assert.deepEqual(harness.state.registeredProviders, [
    `${EXTENSION_PROVIDER_PREFIX}:work-proxy`,
  ]);
  assert.deepEqual(harness.state.setModels, [
    { id: "gpt-5.5", provider: `${EXTENSION_PROVIDER_PREFIX}:work-proxy` },
  ]);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Default model set to gpt-5.5",
    ),
  );
});

test("switch command activates selected provider from cached models", async () => {
  const providerA = buildStoredConfig({
    name: "Alpha",
    baseUrl: "https://alpha.example/v1",
    apiKey: "a",
    defaultModelId: "alpha-model",
  });
  const providerB = buildStoredConfig({
    name: "Beta",
    baseUrl: "https://beta.example/v1",
    apiKey: "b",
    defaultModelId: "beta-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: providerA.id,
      providers: [providerA, providerB],
    },
    modelsRegistry: {
      providers: {
        [providerA.id]: { models: [{ id: "alpha-model" }] },
        [providerB.id]: { models: [{ id: "beta-model" }] },
      },
    },
    selects: ["Beta"],
    currentModel: { id: "alpha-model", provider: providerA.id },
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-switch"].handler("", harness.ctx);

  assert.deepEqual(harness.state.unregisteredProviders, [providerA.id]);
  assert.deepEqual(harness.state.registeredProviders.slice(-1), [providerB.id]);
  assert.equal(harness.state.config.activeProviderId, providerB.id);
  assert.deepEqual(harness.state.setModels.slice(-1), [
    { id: "beta-model", provider: providerB.id },
  ]);
});

test("clear command removes active provider and restores previous settings", async () => {
  const provider = buildStoredConfig({
    name: "Solo",
    baseUrl: "https://solo.example/v1",
    apiKey: "solo-key",
    defaultModelId: "solo-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [{ id: "solo-model" }] },
      },
    },
    selects: ["Solo"],
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-clear"].handler("", harness.ctx);

  assert.deepEqual(harness.state.unregisteredProviders.slice(-1), [
    provider.id,
  ]);
  assert.deepEqual(harness.state.authClears, [provider.id]);
  assert.deepEqual(harness.state.agentModelClears, [provider.id]);
  assert.deepEqual(harness.state.restoredProviders, [provider.id]);
  assert.equal(harness.state.config.providers.length, 0);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === `Removed ${provider.name}`,
    ),
  );
});

test("session_start on startup prompts login when no active provider exists", async () => {
  const harness = createHarness();

  await registerTestExtension(harness);
  await harness.state.sessionStartHandlers[0](
    { reason: "startup" },
    harness.ctx,
  );

  assert.deepEqual(harness.state.setModels, []);
  assert.ok(
    harness.state.notifications.some(
      (entry) =>
        entry.message ===
        "Run /openai-compatible-login to configure OpenAI Compatible.",
    ),
  );
});

test("session_start auto-selects saved default model for active provider", async () => {
  const provider = buildStoredConfig({
    name: "Auto",
    baseUrl: "https://auto.example/v1",
    apiKey: "auto-key",
    defaultModelId: "auto-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [{ id: "auto-model" }] },
      },
    },
  });

  await registerTestExtension(harness);
  await harness.state.sessionStartHandlers[0](
    { reason: "reload" },
    harness.ctx,
  );

  assert.deepEqual(harness.state.setModels.slice(-1), [
    { id: "auto-model", provider: provider.id },
  ]);
  assert.ok(
    harness.state.notifications.some(
      (entry) =>
        entry.message ===
        `Selected default model: ${provider.name} / auto-model`,
    ),
  );
});

test("refresh updates cached models and falls back default model when prior default is missing", async () => {
  const provider = buildStoredConfig({
    name: "Refreshable",
    baseUrl: "https://refresh.example/v1",
    apiKey: "refresh-key",
    defaultModelId: "stale-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [{ id: "stale-model" }] },
      },
    },
    fetchModelsResult: {
      resolvedBaseUrl: "https://refresh.example/v1",
      models: [{ id: "fresh-model", name: "fresh-model" }],
    },
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-refresh"].handler("", harness.ctx);

  assert.deepEqual(harness.state.fetched, [
    { baseUrl: "https://refresh.example/v1", apiKey: "refresh-key" },
  ]);
  assert.equal(harness.state.config.providers[0].defaultModelId, "fresh-model");
  assert.deepEqual(harness.state.setModels.slice(-1), [
    { id: "fresh-model", provider: provider.id },
  ]);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Refreshed 1 model(s) for Refreshable",
    ),
  );
});

test("login reports fetch failures without saving provider state", async () => {
  const harness = createHarness({
    inputs: ["Broken Proxy", "https://broken.example", "bad-key"],
    fetchModelsError: new Error("boom"),
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-login"].handler("", harness.ctx);

  assert.equal(harness.state.config.providers.length, 0);
  assert.deepEqual(harness.state.registeredProviders, []);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Setup failed: boom",
    ),
  );
});

test("switch reports cancellation without changing provider", async () => {
  const provider = buildStoredConfig({
    name: "Keep",
    baseUrl: "https://keep.example/v1",
    apiKey: "keep-key",
    defaultModelId: "keep-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    selects: [""],
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-switch"].handler("", harness.ctx);

  assert.equal(harness.state.config.activeProviderId, provider.id);
  assert.deepEqual(harness.state.setModels, []);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Switch cancelled",
    ),
  );
});

test("login skips model selection when discovery returns no models", async () => {
  const harness = createHarness({
    inputs: ["No Models", "https://empty.example", "empty-key"],
    fetchModelsResult: {
      resolvedBaseUrl: "https://empty.example/v1",
      models: [],
    },
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-login"].handler("", harness.ctx);

  assert.equal(harness.state.selectPrompts.length, 0);
  assert.equal(harness.state.config.providers.length, 1);
  assert.equal(harness.state.config.providers[0].defaultModelId, undefined);
  assert.deepEqual(harness.state.setModels, []);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Registered No Models with 0 model(s)",
    ),
  );
  assert.equal(
    harness.state.notifications.some((entry) =>
      entry.message.startsWith("Default model set to "),
    ),
    false,
  );
});

test("session_start does nothing when cached models are empty", async () => {
  const provider = buildStoredConfig({
    name: "Empty Cache",
    baseUrl: "https://empty-cache.example/v1",
    apiKey: "cache-key",
    defaultModelId: "missing-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [] },
      },
    },
  });

  await registerTestExtension(harness);
  await harness.state.sessionStartHandlers[0](
    { reason: "reload" },
    harness.ctx,
  );

  assert.deepEqual(harness.state.setModels, []);
  assert.equal(
    harness.state.notifications.some((entry) =>
      entry.message.startsWith("Selected default model: "),
    ),
    false,
  );
});

test("session_start does nothing when model registry cannot resolve the preferred model", async () => {
  const provider = buildStoredConfig({
    name: "Lookup Miss",
    baseUrl: "https://lookup-miss.example/v1",
    apiKey: "lookup-key",
    defaultModelId: "lookup-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [{ id: "lookup-model" }] },
      },
    },
    modelLookupResult: null,
  });

  await registerTestExtension(harness);
  await harness.state.sessionStartHandlers[0](
    { reason: "reload" },
    harness.ctx,
  );

  assert.deepEqual(harness.state.setModels, []);
  assert.equal(
    harness.state.notifications.some((entry) =>
      entry.message.startsWith("Selected default model: "),
    ),
    false,
  );
});

test("refresh reports fetch failures without changing active provider state", async () => {
  const provider = buildStoredConfig({
    name: "Stable",
    baseUrl: "https://stable.example/v1",
    apiKey: "stable-key",
    defaultModelId: "stable-model",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: provider.id,
      providers: [provider],
    },
    modelsRegistry: {
      providers: {
        [provider.id]: { models: [{ id: "stable-model" }] },
      },
    },
    fetchModelsError: new Error("refresh-boom"),
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-refresh"].handler("", harness.ctx);

  assert.equal(harness.state.config.activeProviderId, provider.id);
  assert.equal(
    harness.state.config.providers[0].defaultModelId,
    "stable-model",
  );
  assert.deepEqual(harness.state.unregisteredProviders, []);
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "Refresh failed: refresh-boom",
    ),
  );
});

test("clear all removes every provider and clears persisted state", async () => {
  const providerA = buildStoredConfig({
    name: "Alpha",
    baseUrl: "https://alpha.example/v1",
    apiKey: "alpha-key",
  });
  const providerB = buildStoredConfig({
    name: "Beta",
    baseUrl: "https://beta.example/v1",
    apiKey: "beta-key",
  });
  const harness = createHarness({
    config: {
      version: 2,
      activeProviderId: providerA.id,
      providers: [providerA, providerB],
    },
    selects: ["all providers"],
  });

  await registerTestExtension(harness);
  await harness.commands["openai-compatible-clear"].handler("", harness.ctx);

  assert.deepEqual(harness.state.unregisteredProviders.slice(-2), [
    providerA.id,
    providerB.id,
  ]);
  assert.deepEqual(harness.state.authClears, [providerA.id, providerB.id]);
  assert.deepEqual(harness.state.agentModelClears, [
    providerA.id,
    providerB.id,
  ]);
  assert.deepEqual(harness.state.restoredProviders, [providerA.id]);
  assert.equal(harness.state.config.providers.length, 0);
  assert.deepEqual(harness.state.modelsRegistry, { providers: {} });
  assert.ok(
    harness.state.notifications.some(
      (entry) => entry.message === "All OpenAI-compatible providers removed",
    ),
  );
});
