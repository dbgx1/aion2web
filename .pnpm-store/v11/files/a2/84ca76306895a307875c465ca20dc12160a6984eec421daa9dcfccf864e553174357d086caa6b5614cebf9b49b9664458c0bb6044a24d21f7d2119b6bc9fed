import { brandProviderTool } from "@tanstack/ai";
//#region src/tools/web-fetch-tool.ts
/**
* Stable runtime marker used to identify a `webFetchTool()`-created tool so
* `convertToolsToProviderFormat` can route it without relying on the mutable
* public `tool.name`.
*/
var WEB_FETCH_TOOL_KIND = "openrouter.web_fetch";
/** A tool is a webFetchTool() output iff its metadata carries our branded kind marker. */
function isWebFetchTool(tool) {
	return tool.metadata?.__kind === WEB_FETCH_TOOL_KIND;
}
/**
* Converts a branded web-fetch tool to OpenRouter's wire format. Throws if
* the metadata doesn't match the expected shape — callers must gate on
* `isWebFetchTool()` first.
*/
function convertWebFetchToolToAdapterFormat(tool) {
	const metadata = tool.metadata;
	if (!metadata || metadata.__kind !== "openrouter.web_fetch") throw new Error(`convertWebFetchToolToAdapterFormat: tool "${tool.name}" is not a valid webFetchTool() output (missing branded metadata).`);
	return {
		type: "openrouter:web_fetch",
		...metadata.parameters !== void 0 && { parameters: metadata.parameters }
	};
}
/**
* Creates a branded web fetch tool for use with OpenRouter models.
*
* The web fetch tool is available across all OpenRouter chat models via the
* OpenRouter gateway. The model decides which URL to fetch; the `engine`
* option chooses how OpenRouter retrieves it. With `engine: 'native'` the
* provider's own fetch is used (e.g. Anthropic's `web_fetch` on Claude
* models), in which case `allowedDomains` / `blockedDomains` may not be
* respected. Use `'openrouter'`, `'exa'`, or `'firecrawl'` for consistent
* behaviour across models.
*
* Pass the returned value in the `tools` array when calling a chat function.
*/
function webFetchTool(options) {
	return brandProviderTool({
		name: "web_fetch",
		description: "",
		metadata: {
			__kind: WEB_FETCH_TOOL_KIND,
			...options !== void 0 && { parameters: options }
		}
	});
}
//#endregion
export { WEB_FETCH_TOOL_KIND, convertWebFetchToolToAdapterFormat, isWebFetchTool, webFetchTool };

//# sourceMappingURL=web-fetch-tool.js.map