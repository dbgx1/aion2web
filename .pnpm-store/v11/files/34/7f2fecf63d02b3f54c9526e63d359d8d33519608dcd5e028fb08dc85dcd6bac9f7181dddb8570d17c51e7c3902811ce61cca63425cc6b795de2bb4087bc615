import { OpenRouterWebSearchServerTool } from '@openrouter/sdk/models';
import { ProviderTool, Tool } from '@tanstack/ai';
/**
 * Stable runtime marker used to identify a `webSearchTool()`-created tool so
 * `convertToolsToProviderFormat` can route it without relying on the mutable
 * public `tool.name`.
 */
export declare const WEB_SEARCH_TOOL_KIND = "openrouter.web_search";
/**
 * Wire shape for OpenRouter's `openrouter:web_search` server tool, sourced
 * directly from `@openrouter/sdk`'s `OpenRouterWebSearchServerTool` so the
 * SDK's outbound Zod schema preserves every field on the wire.
 *
 * @see https://openrouter.ai/docs/guides/features/server-tools/web-search
 */
export type WebSearchToolConfig = OpenRouterWebSearchServerTool;
/** @deprecated Renamed to `WebSearchToolConfig`. Will be removed in a future release. */
export type WebSearchTool = WebSearchToolConfig;
export type OpenRouterWebSearchTool = ProviderTool<'openrouter', 'web_search'>;
/** A tool is a webSearchTool() output iff its metadata carries our branded kind marker. */
export declare function isWebSearchTool(tool: Tool): boolean;
/**
 * Converts a branded web-search tool to OpenRouter's wire format. Throws if
 * the metadata doesn't match the expected shape — callers must gate on
 * `isWebSearchTool()` first.
 */
export declare function convertWebSearchToolToAdapterFormat(tool: Tool): WebSearchToolConfig;
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
export declare function webSearchTool(options?: OpenRouterWebSearchServerTool['parameters']): OpenRouterWebSearchTool;
