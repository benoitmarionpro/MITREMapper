Build or modify a local-first, field-ready application.

Core principles:
- Prefer a standalone HTML file or small static folder that opens in a standard browser.
- Do not require a server, install step, admin rights, database, or client infrastructure for the core use case.
- Keep deterministic local logic as the default; call an LLM only where it adds clear value.
- Make the LLM provider and model runtime settings, never architectural dependencies.

Add an LLM API layer with:
- explicit client/user approval before any AI call;
- dynamic provider selection: OpenAI, Anthropic, Mistral, Azure OpenAI / Azure AI Foundry, Ollama Cloud / compatible endpoint, and generic OpenAI-compatible endpoint;
- dynamic model loading when supported, with curated fallback models when loading fails;
- a connection test, visible status states, and clear user-facing errors;
- one centralized client abstraction, e.g. LLMClient, exposing getAvailableModels, testConnection, and generate.

AI settings UX:
- Add a mandatory checkbox: "I confirm that AI use is authorized for this content and complies with the client's rules."
- Block all AI calls until checked.
- Show provider-specific fields: API key, model, base URL, Azure HTTPS endpoint, deployment, and API version as needed.
- Validate authorization, provider, model, keys, HTTPS endpoints, and normalized base URLs before every call.

Secret handling:
- Never export, log, embed, or save API keys in project data, prompts, metadata, generated HTML, or downloadable files.
- Store keys separately from project data, using sessionStorage by default.
- Use persistent localStorage only behind an explicit "Remember this key on this browser" option.
- Provide "Clear API keys", use password fields, never reveal full keys, and migrate/remove unsafe legacy storage.

Errors and local constraints:
- Return contextual errors with operation, provider, model, HTTP status, code, and provider message, but never secrets.
- Handle missing keys, invalid endpoints, network/CORS failures, non-OK HTTP responses, empty responses, and malformed JSON.
- If browser CORS blocks a provider, document a compatible endpoint or add an optional strict proxy: HTTPS-only, allowlisted hosts, filtered headers, no secret logs, clean JSON errors.

Acceptance checks:
- No AI call before approval.
- Provider switching updates fields, validation, and models.
- Model loading succeeds or falls back clearly.
- Exports contain no secrets.
- The app remains local, portable, and usable without a mandatory server.