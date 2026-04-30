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
  canonicalizeProviderName,
  ensureAgentModelsRegistry,
  ensureStoredConfig,
  getProviderCacheEntry,
  getProviderId,
  getProviderSelectionModelId,
  mergeProviderModelsRegistry,
  putProviderProfile,
  removeProviderModelsRegistryEntry,
  removeProviderProfile,
  updateProviderLastModel,
} from "./index.ts";

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

test("applyCurrentSelection captures previous selection and switches to concrete provider", () => {
  const config = {
    id: `${EXTENSION_PROVIDER_PREFIX}:diyproxy`,
    defaultModelId: "gpt-5.4",
  };

  const nextSettings = applyCurrentSelection(
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
    previousProvider: "anthropic",
    previousModel: "claude-sonnet-4",
  });
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
