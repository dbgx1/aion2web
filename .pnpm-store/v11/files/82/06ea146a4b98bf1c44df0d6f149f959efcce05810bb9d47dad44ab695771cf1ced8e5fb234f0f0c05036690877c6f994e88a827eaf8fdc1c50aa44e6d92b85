import { brandProviderTool } from "@tanstack/ai";
//#region src/tools/web-search-tool.ts
/**
* Stable runtime marker used to identify a `webSearchTool()`-created tool so
* `convertToolsToProviderFormat` can route it without relying on the mutable
* public `tool.name`.
*/
var WEB_SEARCH_TOOL_KIND = "openrouter.web_search";
/** A tool is a webSearchTool() output iff its metadata carries our branded kind marker. */
function isWebSearchTool(tool) {
	return tool.metadata?.__kind === WEB_SEARCH_TOOL_KIND;
}
/**
* Converts a branded web-search tool to OpenRouter's wire format. Throws if
* the metadata doesn't match the expected shape — callers must gate on
* `isWebSearchTool()` first.
*/
function convertWebSearchToolToAdapterFormat(tool) {
	const metadata = tool.metadata;
	if (!metadata || metadata.__kind !== "openrouter.web_search") throw new Error(`convertWebSearchToolToAdapterFormat: tool "${tool.name}" is not a valid webSearchTool() output (missing branded metadata).`);
	return {
		type: "openrouter:web_search",
		...metadata.parameters !== void 0 && { parameters: metadata.parameters }
	};
}
/**
* Creates a branded web search tool for use with OpenRouter models.
*
* The web search tool is available across all OpenRouter chat models via the
* OpenRouter gateway. Pass the returned value in the `tools` array when
* calling a chat function.
*
* Note: prior versions accepted a `searchPrompt` option that was silently
* dropped on the wire. The SDK's `WebSearchConfig` does not model that field;
* use `maxResults`, `searchContextSize`, or `userLocation` to tune the call.
*/
function webSearchTool(options) {
	return brandProviderTool({
		name: "web_search",
		description: "",
		metadata: {
			__kind: WEB_SEARCH_TOOL_KIND,
			...options !== void 0 && { parameters: options }
		}
	});
}
//#endregion
export { WEB_SEARCH_TOOL_KIND, convertWebSearchToolToAdapterFormat, isWebSearchTool, webSearchTool };

//# sourceMappingURL=web-search-tool.js.map