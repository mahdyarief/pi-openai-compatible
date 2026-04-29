import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDER_ID = "openai-compatible";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(EXTENSION_DIR, "..", "..");
const CONFIG_PATH = join(EXTENSION_DIR, "provider-config.json");
const AUTH_PATH = join(AGENT_DIR, "auth.json");
const SETTINGS_PATH = join(AGENT_DIR, "settings.json");

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed;
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

async function loadConfig(): Promise<any | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfig(config: any): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function clearConfig(): Promise<void> {
  try {
    await rm(CONFIG_PATH);
  } catch {}
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

async function loadAuthStore(): Promise<any> {
  return (await loadJsonFile(AUTH_PATH)) || {};
}

function buildAuthRecord(config: any): any {
  const record = {
    provider: PROVIDER_ID,
    name: String(config.name || "OpenAI Compatible"),
    baseUrl: normalizeBaseUrl(String(config.baseUrl || "")),
    apiKey: String(config.apiKey || ""),
    api: "openai-completions",
    defaultModelId: config.defaultModelId
      ? String(config.defaultModelId)
      : undefined,
    authenticated: Boolean(config.apiKey),
    updatedAt: new Date().toISOString(),
  };

  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

async function syncAuthStore(config: any): Promise<void> {
  const authStore = await loadAuthStore();
  const authRecord = buildAuthRecord(config);

  authStore.providers = {
    ...(authStore.providers && typeof authStore.providers === "object"
      ? authStore.providers
      : {}),
    [PROVIDER_ID]: {
      ...(authStore.providers?.[PROVIDER_ID] || {}),
      ...authRecord,
    },
  };

  authStore[PROVIDER_ID] = {
    ...(authStore[PROVIDER_ID] && typeof authStore[PROVIDER_ID] === "object"
      ? authStore[PROVIDER_ID]
      : {}),
    ...authRecord,
  };

  authStore.defaultProvider = PROVIDER_ID;
  authStore.currentProvider = PROVIDER_ID;
  authStore.authenticatedProviders = Array.from(
    new Set([
      ...(Array.isArray(authStore.authenticatedProviders)
        ? authStore.authenticatedProviders
        : []),
      PROVIDER_ID,
    ]),
  );

  await saveJsonFile(AUTH_PATH, authStore);
}

async function clearAuthStore(): Promise<void> {
  const authStore = await loadAuthStore();
  let changed = false;

  if (authStore.providers?.[PROVIDER_ID]) {
    delete authStore.providers[PROVIDER_ID];
    changed = true;
  }

  if (authStore[PROVIDER_ID]) {
    delete authStore[PROVIDER_ID];
    changed = true;
  }

  if (Array.isArray(authStore.authenticatedProviders)) {
    const filtered = authStore.authenticatedProviders.filter(
      (providerId: any) => providerId !== PROVIDER_ID,
    );
    if (filtered.length !== authStore.authenticatedProviders.length) {
      authStore.authenticatedProviders = filtered;
      changed = true;
    }
  }

  if (authStore.defaultProvider === PROVIDER_ID) {
    delete authStore.defaultProvider;
    changed = true;
  }

  if (authStore.currentProvider === PROVIDER_ID) {
    delete authStore.currentProvider;
    changed = true;
  }

  if (changed) {
    await saveJsonFile(AUTH_PATH, authStore);
  }
}

async function syncSettings(config: any): Promise<void> {
  const settings = (await loadJsonFile(SETTINGS_PATH)) || {};
  settings.defaultProvider = PROVIDER_ID;
  if (config.defaultModelId) {
    settings.defaultModel = String(config.defaultModelId);
  }
  await saveJsonFile(SETTINGS_PATH, settings);
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

function buildProviderConfig(config: any, models: any[]): any {
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
      name: `${providerLabel} / ${model.name.split(" / ").slice(-1)[0]}`,
    })),
  };
}

const MODELS_PATH = join(EXTENSION_DIR, "provider-models.json");

async function loadDiscoveredModels(): Promise<any[] | null> {
  try {
    const raw = await readFile(MODELS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveDiscoveredModels(models: any[]): Promise<void> {
  await mkdir(dirname(MODELS_PATH), { recursive: true });
  await writeFile(MODELS_PATH, `${JSON.stringify(models, null, 2)}\n`, "utf8");
}

async function clearDiscoveredModels(): Promise<void> {
  try {
    await rm(MODELS_PATH);
  } catch {}
}

async function registerFromConfig(
  pi: any,
  config: any,
): Promise<{ provider: any; models: any[] }> {
  const models =
    (await loadDiscoveredModels()) ||
    (await fetchModels(config.baseUrl, config.apiKey)).models;
  const provider = buildProviderConfig(config, models);
  pi.registerProvider(PROVIDER_ID, provider);
  await syncAuthStore(config);
  await syncSettings(config);
  return { provider, models: provider.models };
}

async function registerSetupProvider(pi: any): Promise<void> {
  const config = await loadConfig();
  if (!config) return;

  const models =
    (await loadDiscoveredModels()) ||
    (await fetchModels(config.baseUrl, config.apiKey)).models;
  pi.registerProvider(PROVIDER_ID, buildProviderConfig(config, models));
  await syncAuthStore(config);
  await syncSettings(config);
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

export default async function (pi: any) {
  const initialConfig = await loadConfig();
  if (initialConfig) {
    try {
      await registerFromConfig(pi, initialConfig);
    } catch (error) {
      console.error(
        "[openai-compatible] Failed to load saved provider:",
        error,
      );
    }
  }

  pi.on("session_start", async (event: any, ctx: any) => {
    try {
      const config = await loadConfig();
      const savedModels = await loadDiscoveredModels();

      if (
        !config &&
        ctx.hasUI &&
        (event?.reason === "startup" || event?.reason === "reload")
      ) {
        ctx.ui.notify(
          "Run /openai-compatible-setup to configure OpenAI Compatible.",
          "info",
        );
        return;
      }

      if (!config || !savedModels || savedModels.length === 0) return;

      const currentModel = ctx.model;
      if (currentModel && currentModel.provider === PROVIDER_ID) return;

      const preferredModelId =
        config.defaultModelId &&
        savedModels.some(
          (savedModel: any) => savedModel.id === config.defaultModelId,
        )
          ? config.defaultModelId
          : savedModels[0]?.id;
      if (!preferredModelId) return;

      const model = ctx.modelRegistry?.find?.(PROVIDER_ID, preferredModelId);
      if (!model) return;

      const selected = await pi.setModel(model);
      if (selected) {
        ctx.ui.notify(
          `Selected default model: ${config.name} / ${model.id}`,
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

  pi.registerCommand("openai-compatible-setup", {
    description:
      "Create or update an OpenAI-compatible provider and auto-fetch its models",
    handler: async (_args: string, ctx: any) => {
      const existing = await loadConfig();
      const config = await promptForConfig(ctx, existing || undefined);
      if (!config) {
        ctx.ui.notify("Setup cancelled", "warning");
        return;
      }

      try {
        const discovered = await fetchModels(config.baseUrl, config.apiKey);
        config.baseUrl = discovered.resolvedBaseUrl;

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
        config.defaultModelId =
          selectedModelIndex >= 0
            ? discovered.models[selectedModelIndex]?.id
            : discovered.models[0]?.id;

        await saveConfig(config);
        await saveDiscoveredModels(discovered.models);
        await syncAuthStore(config);
        await syncSettings(config);

        pi.unregisterProvider(PROVIDER_ID);
        pi.registerProvider(
          PROVIDER_ID,
          buildProviderConfig(config, discovered.models),
        );

        if (config.defaultModelId) {
          const model = ctx.modelRegistry?.find?.(
            PROVIDER_ID,
            config.defaultModelId,
          );
          if (model) {
            await pi.setModel(model);
          }
        }

        ctx.ui.notify(
          `Registered ${config.name} with ${discovered.models.length} model(s)`,
          "info",
        );
        if (config.defaultModelId) {
          ctx.ui.notify(
            `Default model set to ${config.defaultModelId}`,
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
    description: "Refresh models from the saved OpenAI-compatible provider",
    handler: async (_args: string, ctx: any) => {
      const config = await loadConfig();
      if (!config) {
        ctx.ui.notify(
          "No saved provider config. Run /openai-compatible-setup first.",
          "warning",
        );
        return;
      }

      try {
        const discovered = await fetchModels(config.baseUrl, config.apiKey);
        config.baseUrl = discovered.resolvedBaseUrl;
        if (
          !config.defaultModelId ||
          !discovered.models.some(
            (model: any) => model.id === config.defaultModelId,
          )
        ) {
          config.defaultModelId = discovered.models[0]?.id;
        }
        pi.unregisterProvider(PROVIDER_ID);
        pi.registerProvider(
          PROVIDER_ID,
          buildProviderConfig(config, discovered.models),
        );
        await saveConfig(config);
        await saveDiscoveredModels(discovered.models);
        await syncAuthStore(config);
        await syncSettings(config);
        ctx.ui.notify(
          `Refreshed ${discovered.models.length} model(s) for ${config.name}`,
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

  pi.registerCommand("openai-compatible-clear", {
    description: "Remove the saved OpenAI-compatible provider config",
    handler: async (_args: string, ctx: any) => {
      await clearConfig();
      await clearDiscoveredModels();
      await clearAuthStore();
      pi.unregisterProvider(PROVIDER_ID);
      ctx.ui.notify("OpenAI-compatible provider removed", "info");
    },
  });
}
