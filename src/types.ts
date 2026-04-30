export type JsonObject = Record<string, unknown>;

export type Cost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ModelRecord = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: Cost;
  contextWindow?: number;
  maxTokens?: number;
  compat?: {
    supportsDeveloperRole: boolean;
    supportsReasoningEffort: boolean;
    maxTokensField: string;
  };
  baseUrl?: string;
  [key: string]: unknown;
};

export type ProviderProfile = {
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

export type StoredConfig = {
  version: number;
  activeProviderId?: string;
  providers: ProviderProfile[];
};

export type ProviderCacheEntry = {
  provider: string;
  name: string;
  baseUrl: string;
  api: "openai-completions";
  defaultModelId?: string;
  updatedAt: string;
  models: ModelRecord[];
};

export type AgentProviderEntry = ProviderCacheEntry & {
  apiKey: string;
};

export type AgentModelsRegistry = {
  providers: Record<string, Partial<AgentProviderEntry>>;
};

export type AuthRecord = {
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: "openai-completions";
  defaultModelId?: string;
  previousProvider?: string;
  previousModel?: string;
  authenticated: boolean;
  updatedAt: string;
};

export type PreviousSelection = {
  previousProvider?: string;
  previousModel?: string;
};

export type SettingsStore = Record<string, unknown> & {
  defaultProvider?: string;
  defaultModel?: string;
};

export type AuthStore = Record<string, unknown> & {
  providers?: Record<string, unknown>;
  defaultProvider?: string;
  currentProvider?: string;
  authenticatedProviders?: string[];
};

export type FetchModelsResult = {
  models: ModelRecord[];
  resolvedBaseUrl: string;
};

export type ActivationOptions = {
  notify?: boolean;
};

export type PiModel = {
  id: string;
  provider: string;
};

export type PiModelRegistry = {
  find?: (providerId: string, modelId: string) => PiModel | null | undefined;
};

export type PiUi = {
  input: (
    label: string,
    defaultValue?: string,
  ) => Promise<string | null | undefined>;
  select: (
    label: string,
    options: string[],
  ) => Promise<string | null | undefined>;
  notify: (message: string, level: "info" | "warning" | "error") => void;
};

export type CommandContext = {
  hasUI?: boolean;
  ui: PiUi;
  model?: PiModel | null;
  modelRegistry?: PiModelRegistry;
};

export type PiCommandDefinition = {
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<void>;
};

export type RegisteredProviderConfig = {
  baseUrl: string;
  apiKey: string;
  api: "openai-completions";
  models: ModelRecord[];
};

export type PiInstance = {
  registerProvider: (
    providerId: string,
    provider: RegisteredProviderConfig,
  ) => void;
  unregisterProvider: (providerId: string) => void;
  setModel: (model: PiModel) => Promise<unknown>;
  registerCommand: (name: string, definition: PiCommandDefinition) => void;
  on: (
    event: string,
    handler: (event: unknown, ctx: CommandContext) => Promise<void>,
  ) => void;
};
