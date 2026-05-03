# pi-openai-compatible

A Pi extension for configuring and using OpenAI-compatible providers with a guided command flow, local multi-provider storage, and automatic model registration.

## Why this exists

Pi supports custom providers, but the default `/login` flow is not ideal for OpenAI-compatible endpoints that require a custom base URL, custom API key, and provider-specific model discovery.

This extension provides a cleaner workflow:

- configure providers through explicit extension commands
- discover models directly from the provider
- keep multiple saved provider profiles
- switch active providers without re-entering credentials
- restore the last or default model automatically

## Features

- guided login flow with `/openai-compatible-login`
- support for multiple saved OpenAI-compatible provider profiles
- provider upsert by canonicalized provider name
- model discovery against OpenAI-compatible `/models` endpoints
- automatic active-provider registration in Pi
- automatic default-model selection on startup and provider switch
- last-selected-model memory per provider
- refresh, list, switch, and clear commands
- sanitized model cache that excludes API keys
- strict TypeScript codebase with modular internal structure

## Installation

Install this repository inside your Pi extensions directory:

- `~/.pi/agent/extensions/pi-openai-compatible`

Then reload Pi.

After installation, run:

- `/openai-compatible-login`

## Quick start

1. Reload Pi.
2. Run `/openai-compatible-login`.
3. Enter:
   - provider name
   - base URL
   - API key
4. Let the extension fetch available models.
5. Choose a default model if models are available.
6. Use `/model` to switch models inside the active provider.
7. Use `/openai-compatible-switch` to activate another saved provider later.

## Commands

### `/openai-compatible-login`
Creates or updates a provider profile and activates it.

Flow:
1. prompts for provider name
2. prompts for base URL
3. prompts for API key
4. fetches models from the provider
5. prompts for a default model when models are available
6. saves or updates the provider profile
7. caches discovered model metadata
8. registers the provider in Pi
9. auto-selects the chosen or inferred default model when possible

Notes:
- if the provider returns zero models, setup still succeeds
- in that zero-model case, no model-selection prompt is shown
- provider profiles are upserted by canonical provider name, not raw display text

### `/openai-compatible-list`
Lists saved provider profiles.

Shows:
- active marker
- provider name
- base URL
- last selected model or default model

### `/openai-compatible-switch`
Activates another saved provider.

Behavior:
- loads cached models for the selected provider
- unregisters the previously active extension provider
- registers the selected provider
- restores the last selected model when available
- otherwise falls back to the configured default model
- otherwise falls back to the first cached model

### `/openai-compatible-refresh`
Refreshes models for the active provider.

Behavior:
- fetches models again from the active provider config
- updates the cached provider model registry
- preserves the active provider identity
- resets the default model only if the old default no longer exists
- re-registers the active provider with the refreshed model list

### `/openai-compatible-clear`
Removes one saved provider or all saved providers.

Behavior:
- clears saved auth and model-registry entries for removed providers
- restores previous Pi settings when removing the active provider
- supports removing all saved extension providers at once

## Provider and model behavior

### Provider IDs

Each saved provider gets a stable Pi provider id derived from its name.

Examples:
- `openai-compatible:diyproxy`
- `openai-compatible:work-proxy`

### Model display names

Registered model names are prefixed with the provider name for clarity.

Examples:
- `diyproxy / gpt-5.5`
- `work proxy / claude-sonnet-4-6`

### Default and last model selection

The extension uses this model-selection order:

1. last selected model for that provider
2. configured default model for that provider
3. first available cached model

This is used during:
- startup or reload auto-selection
- provider switching
- provider refresh activation

## Base URL handling

The extension normalizes base URLs and tries common OpenAI-compatible forms.

Examples of accepted input:
- `https://example.com`
- `https://example.com/v1`
- `https://example.com/v1/chat/completions`

The extension will normalize and probe likely API-compatible base URLs as needed for model discovery.

## Local files and generated state

This extension uses two local generated files in the extension directory:

- `provider-config.json`
  - stores saved provider profiles
  - includes API keys
  - tracks active provider and remembered selections
- `provider-models.json`
  - stores cached discovered model metadata by provider id
  - intentionally excludes API keys

These files are treated as local generated state and should remain gitignored.

## Internal architecture

The runtime entrypoint is `index.ts`, which re-exports public helpers and the default extension registration function.

The implementation is split across `src/`:

- `src/extension.ts`
  - command registration
  - session-start behavior
  - provider activation flow
  - dependency-injection seam for integration tests
- `src/config.ts`
  - stored-config normalization and migrations
  - provider profile lookup and updates
- `src/models.ts`
  - model discovery
  - provider registry merging
  - Pi provider config construction
- `src/storage.ts`
  - JSON file persistence
  - synchronization with Pi auth/settings/model registry files
- `src/settings.ts`
  - previous-selection capture and restored settings behavior
- `src/shared.ts`
  - path constants and shared helpers
- `src/types.ts`
  - internal types for providers, models, Pi interfaces, and storage

## Testing and quality checks

The project includes unit and integration-style tests covering:

- URL normalization and candidate base URLs
- config migration and profile management
- provider registry writes and sanitization
- non-mutating settings helpers
- login, switch, clear, refresh, and session-start flows
- failure and edge-case command behavior

Useful commands:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run knip`
- `npm run check`

## Development notes

- the project is intentionally buildless for local extension use
- `index.ts` is the public entrypoint used by Pi
- strict TypeScript is enabled
- cached model metadata is sanitized before local persistence
- only the active extension provider is registered into Pi at a time

## Limitations

- this extension does not use Pi's built-in `/login`
- pricing is not fetched from provider APIs; any pricing logic is code-defined
- model capability inference may need provider-specific adjustments for unusual APIs
- only the active saved provider is registered on startup

## Example provider setup

Example values:

- provider name: `diyproxy`
- base URL: `https://kvcman.fly.dev/v1`
- API key: `your-api-key`

## License

MIT
