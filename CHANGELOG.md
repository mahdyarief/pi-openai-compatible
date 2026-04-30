# Changelog

## 0.70.7

Quality, architecture, testing, and documentation improvements.

### Added
- multi-provider profile management with stable provider IDs
- provider switching and listing flows for saved OpenAI-compatible providers
- integration-style command tests covering login, switch, clear, refresh, and session-start behavior
- edge-case coverage for zero-model discovery, empty caches, missing model lookups, cancellation flows, and fetch failures
- architecture documentation in the README

### Changed
- modularized the implementation from a large single entry file into focused `src/` modules
- enabled strict TypeScript mode
- standardized development scripts for format, lint, typecheck, test, and check
- made current-selection application non-mutating
- sanitized cached model metadata before persistence
- improved provider registry normalization and event typing
- clarified command behavior, generated files, and internal architecture in the README

### Fixed
- candidate base URL handling for endpoint-like OpenAI-compatible inputs
- provider cache writes to avoid storing API keys in `provider-models.json`
- zero-model login flow so setup succeeds without prompting for model selection
- several export/import issues uncovered during modularization and test expansion

### Notes
- `provider-config.json` and `provider-models.json` are treated as generated local state and should remain gitignored
- only the active extension provider is registered into Pi at a time

## 0.70.6

Initial public version.

### Added
- guided login flow with `/openai-compatible-login`
- model refresh command with `/openai-compatible-refresh`
- cleanup command with `/openai-compatible-clear`
- automatic model discovery from OpenAI-compatible providers
- default model selection during setup
- automatic default model selection on startup/reload
- alphabetical model sorting by model name
- predefined pricing for exact model IDs `gpt-5.4` and `gpt-5.5`

### Notes
- uses command-based setup instead of Pi `/login`
- stores provider config and cached models locally in the extension directory
