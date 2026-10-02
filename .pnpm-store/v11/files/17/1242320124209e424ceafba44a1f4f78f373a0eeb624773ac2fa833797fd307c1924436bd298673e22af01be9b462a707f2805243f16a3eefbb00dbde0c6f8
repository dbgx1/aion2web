import { getOpenRouterApiKeyFromEnv } from "../utils/client.js";
import "../utils/index.js";
import { OpenRouterTextAdapter } from "./text.js";
import { ChatStreamSummarizeAdapter } from "@tanstack/ai/adapters";
//#region src/adapters/summarize.ts
/**
* Creates an OpenRouter summarize adapter with explicit API key.
* Type resolution happens here at the call site.
*
* @param model - The model name (e.g., 'openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet')
* @param apiKey - Your OpenRouter API key
* @param config - Optional additional configuration
* @returns Configured OpenRouter summarize adapter instance with resolved types
*
* @example
* ```typescript
* const adapter = createOpenRouterSummarize('openai/gpt-4o-mini', 'sk-or-...');
* ```
*/
function createOpenRouterSummarize(model, apiKey, config) {
	return new ChatStreamSummarizeAdapter(new OpenRouterTextAdapter({
		apiKey,
		...config
	}, model), model, "openrouter");
}
/**
* Creates an OpenRouter summarize adapter with automatic API key detection from environment variables.
* Type resolution happens here at the call site.
*
* Looks for `OPENROUTER_API_KEY` in:
* - `process.env` (Node.js)
* - `window.env` (Browser with injected env)
*
* @param model - The model name (e.g., 'openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet')
* @param config - Optional configuration (excluding apiKey which is auto-detected)
* @returns Configured OpenRouter summarize adapter instance with resolved types
* @throws Error if OPENROUTER_API_KEY is not found in environment
*
* @example
* ```typescript
* // Automatically uses OPENROUTER_API_KEY from environment
* const adapter = openRouterSummarize('openai/gpt-4o-mini');
*
* await summarize({
*   adapter,
*   text: "Long article text..."
* });
* ```
*/
function openRouterSummarize(model, config) {
	return createOpenRouterSummarize(model, getOpenRouterApiKeyFromEnv(), config);
}
//#endregion
export { createOpenRouterSummarize, openRouterSummarize };

//# sourceMappingURL=summarize.js.map