# Changelog

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
