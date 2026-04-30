export { default } from "./src/extension.ts";

export {
  EXTENSION_PROVIDER_PREFIX,
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
  RegisteredProviderConfig,
  SettingsStore,
  StoredConfig,
} from "./src/types.ts";
