export { default } from "./src/extension.ts";

export {
  AGENT_MODELS_PATH,
  AUTH_PATH,
  CONFIG_PATH,
  EXTENSION_PROVIDER_PREFIX,
  MODELS_PATH,
  SETTINGS_PATH,
  canonicalizeProviderName,
  getCandidateBaseUrls,
  getProviderId,
  normalizeBaseUrl,
} from "./src/shared.ts";

export {
  buildStoredConfig,
  buildStoredConfigFromLegacy,
  ensureAgentModelsRegistry,
  ensureStoredConfig,
  getProviderCacheEntry,
  getProviderSelectionModelId,
  putProviderProfile,
  removeProviderProfile,
  updateProviderLastModel,
} from "./src/config.ts";

export {
  buildMergedWritableModelsRegistry,
  buildPrunedAgentModelsRegistry,
  buildPrunedAuthStore,
  buildStoredConfigFile,
  loadAgentModelsRegistry,
} from "./src/storage.ts";

export {
  applyCurrentSelection,
  buildPreviousSelection,
  buildRestoredSettings,
} from "./src/settings.ts";

export {
  buildRegisteredProviderConfig,
  buildWritableProviderCacheEntry,
  mergeProviderModelsRegistry,
  removeProviderModelsRegistryEntry,
} from "./src/models.ts";

export type {
  AgentModelsRegistry,
  AgentProviderEntry,
  AuthRecord,
  AuthStore,
  CommandContext,
  Cost,
  FetchModelsResult,
  ExtensionDependencies,
  JsonObject,
  ModelRecord,
  PiCommandDefinition,
  PiInstance,
  PiModel,
  PiModelRegistry,
  PiUi,
  PreviousSelection,
  ProviderCacheEntry,
  ProviderProfile,
  RecoveredProvider,
  RegisteredProviderConfig,
  SettingsStore,
  StoredConfig,
} from "./src/types.ts";
