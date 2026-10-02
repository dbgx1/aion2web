import { WebFetchServerTool } from '@openrouter/sdk/models';
import { ProviderTool, Tool } from '@tanstack/ai';
/**
 * Stable runtime marker used to identify a `webFetchTool()`-created tool so
 * `convertToolsToProviderFormat` can route it without relying on the mutable
 * public `tool.name`.
 */
export declare const WEB_FETCH_TOOL_KIND = "openrouter.web_fetch";
/**
 * Wire shape for OpenRouter's `openrouter:web_fetch` server tool, sourced
 * directly from `@openrouter/sdk`'s `WebFetchServerTool` so the SDK's outbound
 * Zod schema preserves every field on the wire.
 *
 * @see https://openrouter.ai/docs/guides/features/server-tools/web-fetch
 */
export type WebFetchToolConfig = WebFetchServerTool;
export type OpenRouterWebFetchTool = ProviderTool<'openrouter', 'web_fetch'>;
/** A tool is a webFetchTool() output iff its metadata carries our branded kind marker. */
export declare function isWebFetchTool(tool: Tool): boolean;
/**
 * Converts a branded web-fetch tool to OpenRouter's wire format. Throws if
 * the metadata doesn't match the expected shape — callers must gate on
 * `isWebFetchTool()` first.
 */
export declare function convertWebFetchToolToAdapterFormat(tool: Tool): WebFetchToolConfig;
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
export declare function webFetchTool(options?: WebFetchServerTool['parameters']): OpenRouterWebFetchTool;
