import {
  buildStoredConfig,
  getProviderById,
  getProviderByName,
  getProviderCacheEntry,
  getProviderSelectionModelId,
  putProviderProfile,
  removeProviderProfile,
  updateProviderLastModel,
} from "./config.ts";
import {
  buildRegisteredProviderConfig,
  fetchModels,
  mergeProviderModelsRegistry,
  removeProviderModelsRegistryEntry,
} from "./models.ts";
import { isRecord, normalizeBaseUrl } from "./shared.ts";
import {
  clearAgentModelsRegistry,
  clearAuthStore,
  clearConfig,
  loadConfig,
  loadModelsRegistry,
  restoreSettings,
  saveConfig,
  saveModelsRegistry,
  syncAgentModelsRegistry,
  syncAuthStore,
  syncSettings,
} from "./storage.ts";
import type {
  ActivationOptions,
  CommandContext,
  ModelRecord,
  PiInstance,
  ProviderProfile,
  RegisteredProviderConfig,
  StoredConfig,
} from "./types.ts";

export type ExtensionDependencies = {
  clearAgentModelsRegistry: typeof clearAgentModelsRegistry;
  clearAuthStore: typeof clearAuthStore;
  clearConfig: typeof clearConfig;
  fetchModels: typeof fetchModels;
  loadConfig: typeof loadConfig;
  loadModelsRegistry: typeof loadModelsRegistry;
  restoreSettings: typeof restoreSettings;
  saveConfig: typeof saveConfig;
  saveModelsRegistry: typeof saveModelsRegistry;
  syncAgentModelsRegistry: typeof syncAgentModelsRegistry;
  syncAuthStore: typeof syncAuthStore;
  syncSettings: typeof syncSettings;
};

const defaultDependencies: ExtensionDependencies = {
  clearAgentModelsRegistry,
  clearAuthStore,
  clearConfig,
  fetchModels,
  loadConfig,
  loadModelsRegistry,
  restoreSettings,
  saveConfig,
  saveModelsRegistry,
  syncAgentModelsRegistry,
  syncAuthStore,
  syncSettings,
};

async function registerProviderInstance(
  pi: PiInstance,
  config: ProviderProfile,
  models: ModelRecord[],
  dependencies: ExtensionDependencies,
): Promise<{ provider: RegisteredProviderConfig; models: ModelRecord[] }> {
  const provider = buildRegisteredProviderConfig(config, models);
  pi.registerProvider(config.id, provider);
  await dependencies.syncAuthStore(config);
  await dependencies.syncAgentModelsRegistry(
    config.id,
    config,
    provider.models,
  );
  await dependencies.syncSettings(config);
  return { provider, models: provider.models };
}

async function promptForConfig(
  ctx: CommandContext,
  defaults?: Partial<ProviderProfile>,
): Promise<Pick<ProviderProfile, "name" | "baseUrl" | "apiKey"> | null> {
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
  pi: PiInstance,
  ctx: CommandContext,
  configState: StoredConfig,
  provider: ProviderProfile,
  models: ModelRecord[],
  dependencies: ExtensionDependencies,
  options?: ActivationOptions,
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

  await registerProviderInstance(pi, activeProvider, models, dependencies);

  nextConfig = putProviderProfile(nextConfig, activeProvider);
  nextConfig.activeProviderId = activeProvider.id;
  await dependencies.saveConfig(nextConfig);
  await dependencies.saveModelsRegistry(
    mergeProviderModelsRegistry(
      await dependencies.loadModelsRegistry(),
      activeProvider.id,
      activeProvider,
      models,
    ),
  );

  if (selectedModelId) {
    const model =
      typeof ctx.modelRegistry?.find === "function"
        ? ctx.modelRegistry.find(activeProvider.id, selectedModelId)
        : null;
    if (model) {
      await pi.setModel(model);
      nextConfig = updateProviderLastModel(
        nextConfig,
        activeProvider.id,
        selectedModelId,
      );
      await dependencies.saveConfig(nextConfig);
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

export function createExtension(
  overrides: Partial<ExtensionDependencies> = {},
): (pi: PiInstance) => Promise<void> {
  const dependencies: ExtensionDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return async function registerExtension(pi: PiInstance) {
    const initialConfig = await dependencies.loadConfig();
    const initialProvider = getProviderById(
      initialConfig,
      initialConfig.activeProviderId,
    );
    if (initialProvider) {
      try {
        const modelsRegistry = await dependencies.loadModelsRegistry();
        const entry = getProviderCacheEntry(modelsRegistry, initialProvider.id);
        if (
          entry?.models &&
          Array.isArray(entry.models) &&
          entry.models.length > 0
        ) {
          await registerProviderInstance(
            pi,
            initialProvider,
            entry.models as ModelRecord[],
            dependencies,
          );
        }
      } catch (error) {
        console.error(
          "[openai-compatible] Failed to load saved provider:",
          error,
        );
      }
    }

    pi.on("session_start", async (event, ctx) => {
      try {
        const configState = await dependencies.loadConfig();
        const activeProvider = getProviderById(
          configState,
          configState.activeProviderId,
        );
        const modelsRegistry = await dependencies.loadModelsRegistry();
        const savedEntry = activeProvider
          ? getProviderCacheEntry(modelsRegistry, activeProvider.id)
          : null;
        const reason =
          isRecord(event) && typeof event.reason === "string"
            ? event.reason
            : undefined;

        if (
          !activeProvider &&
          ctx.hasUI &&
          (reason === "startup" || reason === "reload")
        ) {
          ctx.ui.notify(
            "Run /openai-compatible-login to configure OpenAI Compatible.",
            "info",
          );
          return;
        }

        if (
          !activeProvider ||
          !savedEntry?.models ||
          !Array.isArray(savedEntry.models) ||
          savedEntry.models.length === 0
        ) {
          return;
        }

        const currentModel = ctx.model;
        if (currentModel && currentModel.provider === activeProvider.id) return;

        const preferredModelId = getProviderSelectionModelId(
          activeProvider,
          savedEntry.models as ModelRecord[],
        );
        if (!preferredModelId) return;

        const model =
          typeof ctx.modelRegistry?.find === "function"
            ? ctx.modelRegistry.find(activeProvider.id, preferredModelId)
            : null;
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
      handler: async (_args, ctx) => {
        const configState = await dependencies.loadConfig();
        const preselected = getProviderById(
          configState,
          configState.activeProviderId,
        );
        const draft = await promptForConfig(ctx, preselected || undefined);
        if (!draft) {
          ctx.ui.notify("Setup cancelled", "warning");
          return;
        }

        const existing = getProviderByName(configState, draft.name);
        const providerDraft = buildStoredConfig({ ...existing, ...draft });

        try {
          const discovered = await dependencies.fetchModels(
            providerDraft.baseUrl,
            providerDraft.apiKey,
          );
          providerDraft.baseUrl = discovered.resolvedBaseUrl;

          if (discovered.models.length > 0) {
            const modelOptions = discovered.models.map(
              (model, index) =>
                `${index + 1}. ${String(model.name || model.id)}`,
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
          } else {
            providerDraft.defaultModelId = undefined;
          }

          const nextConfig = putProviderProfile(configState, providerDraft);
          nextConfig.activeProviderId = providerDraft.id;
          await dependencies.saveConfig(nextConfig);

          await dependencies.saveModelsRegistry(
            mergeProviderModelsRegistry(
              await dependencies.loadModelsRegistry(),
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
            dependencies,
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
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Setup failed: ${message}`, "error");
        }
      },
    });

    pi.registerCommand("openai-compatible-refresh", {
      description: "Refresh models from the active OpenAI-compatible provider",
      handler: async (_args, ctx) => {
        const configState = await dependencies.loadConfig();
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
          const discovered = await dependencies.fetchModels(
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
              (model) => model.id === refreshedProvider.defaultModelId,
            )
          ) {
            refreshedProvider.defaultModelId = discovered.models[0]?.id;
          }

          const nextConfig = putProviderProfile(configState, refreshedProvider);
          nextConfig.activeProviderId = refreshedProvider.id;
          await dependencies.saveConfig(nextConfig);
          await dependencies.saveModelsRegistry(
            mergeProviderModelsRegistry(
              await dependencies.loadModelsRegistry(),
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
            dependencies,
            {
              notify: false,
            },
          );

          ctx.ui.notify(
            `Refreshed ${discovered.models.length} model(s) for ${refreshedProvider.name}`,
            "info",
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Refresh failed: ${message}`, "error");
        }
      },
    });

    pi.registerCommand("openai-compatible-list", {
      description: "List saved OpenAI-compatible providers",
      handler: async (_args, ctx) => {
        const configState = await dependencies.loadConfig();
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
      handler: async (_args, ctx) => {
        const configState = await dependencies.loadConfig();
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

        const modelsRegistry = await dependencies.loadModelsRegistry();
        const savedEntry = getProviderCacheEntry(
          modelsRegistry,
          selectedProvider.id,
        );
        if (
          !savedEntry?.models ||
          !Array.isArray(savedEntry.models) ||
          savedEntry.models.length === 0
        ) {
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
          savedEntry.models as ModelRecord[],
          dependencies,
        );
      },
    });

    pi.registerCommand("openai-compatible-clear", {
      description: "Remove one or all saved OpenAI-compatible provider configs",
      handler: async (_args, ctx) => {
        const configState = await dependencies.loadConfig();
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
            await dependencies.clearAuthStore(provider.id);
            await dependencies.clearAgentModelsRegistry(provider.id);
          }
          const activeProvider = getProviderById(
            configState,
            configState.activeProviderId,
          );
          await dependencies.restoreSettings(activeProvider);
          await dependencies.saveModelsRegistry({ providers: {} });
          await dependencies.clearConfig();
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
          await dependencies.restoreSettings(provider);
        }

        await dependencies.clearAuthStore(provider.id);
        await dependencies.clearAgentModelsRegistry(provider.id);
        await dependencies.saveModelsRegistry(
          removeProviderModelsRegistryEntry(
            await dependencies.loadModelsRegistry(),
            provider.id,
          ),
        );

        const nextConfig = removeProviderProfile(configState, provider.id);
        if (nextConfig.providers.length === 0) {
          await dependencies.clearConfig();
        } else {
          await dependencies.saveConfig(nextConfig);
        }

        ctx.ui.notify(`Removed ${provider.name}`, "info");
      },
    });
  };
}

const registerExtension = createExtension();

export default registerExtension;
