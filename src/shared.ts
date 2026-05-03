import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_PROVIDER_PREFIX = "openai-compatible";
export const CONFIG_VERSION = 2;
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = join(SRC_DIR, "..");
const AGENT_DIR = join(SRC_DIR, "..", "..", "..");
export const CONFIG_PATH = join(EXTENSION_DIR, "provider-config.json");
export const AUTH_PATH = join(AGENT_DIR, "auth.json");
export const AGENT_MODELS_PATH = join(AGENT_DIR, "models.json");
export const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
export const MODELS_PATH = join(EXTENSION_DIR, "provider-models.json");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeBaseUrl(value: string): string {
  return String(value).trim().replace(/\/+$/, "");
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

export function isExtensionProviderId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === EXTENSION_PROVIDER_PREFIX ||
      value.startsWith(`${EXTENSION_PROVIDER_PREFIX}:`))
  );
}

export function getCandidateBaseUrls(value: string): string[] {
  const normalized = normalizeBaseUrl(value);
  const candidates = new Set<string>();

  if (normalized) {
    candidates.add(normalized);
  }

  if (normalized.endsWith("/models")) {
    candidates.add(normalizeBaseUrl(normalized.replace(/\/models$/i, "")));
  }

  if (normalized.endsWith("/chat/completions")) {
    candidates.add(
      normalizeBaseUrl(normalized.replace(/\/chat\/completions$/i, "")),
    );
  }

  if (
    normalized &&
    !normalized.endsWith("/v1") &&
    !normalized.endsWith("/models") &&
    !normalized.endsWith("/chat/completions")
  ) {
    candidates.add(`${normalized}/v1`);
  }

  return [...candidates].filter(Boolean);
}
