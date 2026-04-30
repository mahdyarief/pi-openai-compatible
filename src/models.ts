import { ensureAgentModelsRegistry } from "./config.ts";
import {
  getCandidateBaseUrls,
  isRecord,
  normalizeBaseUrl,
  toOptionalString,
} from "./shared.ts";
import type {
  AgentModelsRegistry,
  FetchModelsResult,
  ModelRecord,
  ProviderCacheEntry,
  ProviderProfile,
  RegisteredProviderConfig,
} from "./types.ts";

type Cost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function inferReasoning(modelId: string): boolean {
  return /(^o[0-9])|(reason)|(thinking)|(r1)/i.test(modelId);
}

function inferImageSupport(modelId: string): boolean {
  return /(vision)|(vl)|(^gpt-4o)|(^gpt-4\.1)|(^gemini)/i.test(modelId);
}

function getModelCost(modelId: string): Cost {
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

export function buildWritableProviderCacheEntry(
  providerId: string,
  config: Pick<ProviderProfile, "name" | "baseUrl" | "defaultModelId">,
  models: ModelRecord[],
): ProviderCacheEntry {
  return Object.fromEntries(
    Object.entries({
      provider: providerId,
      name: String(config.name || "OpenAI Compatible"),
      baseUrl: normalizeBaseUrl(String(config.baseUrl || "")),
      api: "openai-completions",
      defaultModelId: toOptionalString(config.defaultModelId),
      updatedAt: new Date().toISOString(),
      models,
    }).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as ProviderCacheEntry;
}

export function mergeProviderModelsRegistry(
  registry: unknown,
  providerId: string,
  config: Partial<ProviderProfile>,
  models: ModelRecord[],
): AgentModelsRegistry {
  const nextRegistry = ensureAgentModelsRegistry(registry);

  nextRegistry.providers[providerId] = {
    ...buildWritableProviderCacheEntry(
      providerId,
      {
        name: String(config.name || "OpenAI Compatible"),
        baseUrl: String(config.baseUrl || ""),
        defaultModelId: toOptionalString(config.defaultModelId),
      },
      models,
    ),
    apiKey: String(config.apiKey || ""),
  };

  return nextRegistry;
}

export function removeProviderModelsRegistryEntry(
  registry: unknown,
  providerId: string,
): AgentModelsRegistry {
  const nextRegistry = ensureAgentModelsRegistry(registry);
  delete nextRegistry.providers[providerId];
  return nextRegistry;
}

function getModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

async function tryFetchModels(
  modelsUrl: string,
  apiKey: string,
): Promise<unknown> {
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

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
): Promise<FetchModelsResult> {
  const candidateBaseUrls = getCandidateBaseUrls(baseUrl);
  let payload: unknown = null;
  let resolvedBaseUrl: string | null = null;
  const errors: string[] = [];

  for (const candidateBaseUrl of candidateBaseUrls) {
    const modelsUrl = getModelsUrl(candidateBaseUrl);
    try {
      payload = await tryFetchModels(modelsUrl, apiKey);
      resolvedBaseUrl = candidateBaseUrl;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${modelsUrl} -> ${message}`);
    }
  }

  if (!payload || !resolvedBaseUrl) {
    throw new Error(`Failed to fetch models. Tried: ${errors.join(" | ")}`);
  }

  const payloadRecord = isRecord(payload) ? payload : {};
  const rawModels = Array.isArray(payloadRecord.data)
    ? payloadRecord.data
    : Array.isArray(payloadRecord.models)
      ? payloadRecord.models
      : [];

  if (rawModels.length === 0) {
    throw new Error(
      `No models returned by provider. Resolved base URL: ${resolvedBaseUrl}`,
    );
  }

  const models = rawModels
    .filter(
      (model): model is Record<string, unknown> =>
        isRecord(model) &&
        typeof model.id === "string" &&
        model.id.trim().length > 0,
    )
    .map((model) => {
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
      } satisfies ModelRecord;
    })
    .sort((a, b) =>
      String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, {
        sensitivity: "base",
      }),
    );

  return { models, resolvedBaseUrl };
}

export function buildRegisteredProviderConfig(
  config: ProviderProfile,
  models: ModelRecord[],
): RegisteredProviderConfig {
  const providerLabel = String(config.name || "OpenAI Compatible");
  const normalizedBaseUrl = normalizeBaseUrl(
    String(config.baseUrl || "https://diyproxy.fly.dev/v1"),
  );

  return {
    baseUrl: normalizedBaseUrl,
    apiKey: String(config.apiKey || ""),
    api: "openai-completions",
    models: models.map((model) => ({
      ...model,
      baseUrl: normalizedBaseUrl,
      name: `${providerLabel} / ${
        String(model.name || model.id)
          .split(" / ")
          .slice(-1)[0]
      }`,
    })),
  };
}
