import {
  EXTENSION_PROVIDER_PREFIX,
  isExtensionProviderId,
  toOptionalString,
} from "./shared.ts";
import type {
  AuthStore,
  PreviousSelection,
  ProviderProfile,
  SettingsStore,
} from "./types.ts";

export function buildPreviousSelection(
  authStore: AuthStore,
  settings: SettingsStore,
): PreviousSelection {
  const authPreviousProvider =
    toOptionalString(authStore.currentProvider) ||
    toOptionalString(authStore.defaultProvider);
  const settingsPreviousProvider = toOptionalString(settings.defaultProvider);
  const previousProvider =
    authPreviousProvider && !isExtensionProviderId(authPreviousProvider)
      ? authPreviousProvider
      : settingsPreviousProvider &&
          !isExtensionProviderId(settingsPreviousProvider)
        ? settingsPreviousProvider
        : undefined;

  const previousModel =
    toOptionalString(settings.defaultModel) &&
    !isExtensionProviderId(settings.defaultProvider)
      ? toOptionalString(settings.defaultModel)
      : undefined;

  return Object.fromEntries(
    Object.entries({ previousProvider, previousModel }).filter(
      ([, fieldValue]) => fieldValue !== undefined,
    ),
  ) as PreviousSelection;
}

export function applyCurrentSelection(
  settings: SettingsStore,
  config: Pick<
    ProviderProfile,
    "id" | "defaultModelId" | "previousProvider" | "previousModel"
  >,
): SettingsStore {
  const nextSettings = { ...settings };
  const resolvedConfig = {
    ...config,
    previousProvider:
      config.previousProvider ||
      (!isExtensionProviderId(nextSettings.defaultProvider)
        ? toOptionalString(nextSettings.defaultProvider)
        : undefined),
    previousModel:
      config.previousModel ||
      (!isExtensionProviderId(nextSettings.defaultProvider)
        ? toOptionalString(nextSettings.defaultModel)
        : undefined),
  };

  nextSettings.defaultProvider = String(
    resolvedConfig.id || EXTENSION_PROVIDER_PREFIX,
  );
  if (resolvedConfig.defaultModelId) {
    nextSettings.defaultModel = String(resolvedConfig.defaultModelId);
  }

  return Object.fromEntries(
    Object.entries(nextSettings).filter(
      ([, fieldValue]) => fieldValue !== undefined,
    ),
  ) as SettingsStore;
}

export function buildRestoredSettings(
  settings: SettingsStore,
  config: Partial<ProviderProfile> | null,
): SettingsStore {
  const nextSettings = { ...settings };
  const wasUsingExtension = isExtensionProviderId(nextSettings.defaultProvider);

  if (wasUsingExtension) {
    nextSettings.defaultProvider = config?.previousProvider
      ? String(config.previousProvider)
      : undefined;
  }

  if (config?.previousModel) {
    nextSettings.defaultModel = String(config.previousModel);
  } else if (wasUsingExtension) {
    nextSettings.defaultModel = undefined;
  }

  return Object.fromEntries(
    Object.entries(nextSettings).filter(
      ([, fieldValue]) => fieldValue !== undefined,
    ),
  ) as SettingsStore;
}
