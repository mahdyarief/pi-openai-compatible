# pi-openai-compatible

A Pi extension that lets you configure and use multiple OpenAI-compatible providers with a clean setup flow.

Instead of relying on `/login`, this extension gives you a guided command-based setup that asks for:

- provider name
- base URL
- API key
- default model

It then fetches the provider's available models, saves the provider profile locally, and auto-selects your preferred default model.

## Features

- clean login flow with `/openai-compatible-login`
- works with OpenAI-compatible APIs
- supports multiple saved provider profiles with different base URLs
- upserts provider profiles by provider name
- auto-fetches models from each provider
- lets you choose a default model during setup
- remembers the last selected model per provider
- registers only the active provider on startup
- supports switching, listing, refreshing, and clearing providers later
- supports custom token pricing rules in the extension code
- avoids the confusing `/login` UX for custom providers

## Installation

### Option 1: copy into your Pi extensions directory

Copy this project into your Pi extensions directory:

- `~/.pi/agent/extensions/pi-openai-compatible`

Then reload Pi.

### Option 2: clone from GitHub

Clone the repository into your Pi extensions directory and reload Pi.

After installation, run:

- `/openai-compatible-login`

## Commands

### `/openai-compatible-login`
Guided login flow.

What it does:
1. asks for provider name
2. asks for base URL
3. asks for API key
4. fetches available models
5. lets you choose a default model
6. creates or updates the saved provider profile by provider name
7. caches the models for that provider
8. activates the provider and auto-selects the chosen default model

### `/openai-compatible-list`
Shows all saved provider profiles.

What it shows:
- provider name
- base URL
- active marker
- default or last selected model

### `/openai-compatible-switch`
Switches to another saved provider profile.

What it does:
- loads cached models for the selected provider
- registers that provider into Pi
- restores its last selected model if available
- falls back to the configured default model

### `/openai-compatible-refresh`
Refreshes the model list from the active provider config.

Useful when:
- the provider adds new models
- you changed pricing logic in the extension
- you want to refresh cached model metadata

### `/openai-compatible-clear`
Removes one saved provider or all saved providers.

## How it works

The extension registers the active provider with a concrete provider ID derived from its name.

Examples:
- `openai-compatible:diyproxy`
- `openai-compatible:work-proxy`

Model display names are automatically prefixed with your chosen provider name.

Example:
- `diyproxy / gpt-5.5`
- `diyproxy / claude-sonnet-4-6`

## Setup

Recommended flow:
1. reload Pi
2. run `/openai-compatible-login`
3. complete the prompts
4. use `/model` if you want to switch models inside the active provider
5. use `/openai-compatible-switch` if you want to activate another saved provider

## Example provider setup

Example values:
- provider name: `diyproxy`
- base URL: `https://diyproxy.fly.dev/v1`
- API key: `your-api-key`

The extension will try common OpenAI-compatible model endpoints automatically, including cases where the provider base URL is entered with or without `/v1`.

## Default model behavior

During setup, you can choose a default model from the fetched model list.

After you switch models in Pi, the extension remembers the last selected model for that provider.

On later startup, reload, or provider switch, the extension will:
- try to restore the saved last selected model first
- fall back to the configured default model
- fall back to the first available cached model if needed

## Pricing

Model pricing is defined in the extension source code.

Right now, the extension includes predefined pricing rules for exact model IDs:
- `gpt-5.4`
- `gpt-5.5`

All other models default to zero cost unless you add more pricing rules.

## Local files used by the extension

The extension stores local data in its own directory:

- `provider-config.json` — saved provider profiles and active provider state
- `provider-models.json` — cached discovered models keyed by provider id

These files may contain sensitive information such as API keys, so do not commit them to a public repository.

## Limitations

- this extension does not use Pi `/login`
- only the active saved provider is registered on startup
- pricing is not fetched from the provider API; it is defined manually in code
- model capabilities are inferred from model IDs and API metadata, so some providers may need custom adjustments

## Why this extension exists

Pi supports custom providers, but the default `/login` flow is not ideal for custom OpenAI-compatible endpoints that need manual setup.

This extension provides a cleaner UX for that case.

## Repository checklist

Before publishing, consider adding:
- screenshots
- version compatibility notes for Pi
- more predefined pricing rules
- provider-specific examples
- a `.gitignore` that excludes local config and cached model files

## License

MIT
