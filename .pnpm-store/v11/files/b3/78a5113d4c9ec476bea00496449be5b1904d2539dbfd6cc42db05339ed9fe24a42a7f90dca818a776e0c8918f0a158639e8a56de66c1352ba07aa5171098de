import { generateId, getApiKeyFromEnv } from "@tanstack/ai-utils";
//#region src/utils/client.ts
function getOpenRouterApiKeyFromEnv() {
	return getApiKeyFromEnv("OPENROUTER_API_KEY");
}
function generateId$1(prefix) {
	return generateId(prefix);
}
function buildHeaders(config) {
	const headers = {
		Authorization: `Bearer ${config.apiKey}`,
		"Content-Type": "application/json"
	};
	if (config.httpReferer) headers["HTTP-Referer"] = config.httpReferer;
	if (config.xTitle) headers["X-Title"] = config.xTitle;
	return headers;
}
//#endregion
export { buildHeaders, generateId$1 as generateId, getOpenRouterApiKeyFromEnv };

//# sourceMappingURL=client.js.map