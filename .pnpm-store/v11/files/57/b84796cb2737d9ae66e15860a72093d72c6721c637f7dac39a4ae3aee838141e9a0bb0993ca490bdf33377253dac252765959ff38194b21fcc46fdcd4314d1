import { BaseRerankAdapter } from '@tanstack/ai/adapters';
import { SDKOptions } from '@openrouter/sdk';
import { OpenRouterRerankModel, OpenRouterRerankProviderOptions } from '../rerank/rerank-provider-options.js';
import { RerankAdapterResult, RerankOptions } from '@tanstack/ai';
export interface OpenRouterRerankConfig extends SDKOptions {
}
/**
 * OpenRouter rerank adapter.
 *
 * Reorders documents by relevance to a query through OpenRouter's unified
 * `/v1/rerank` endpoint via the `@openrouter/sdk` SDK. The endpoint is
 * model-agnostic, so any rerank model OpenRouter offers works by passing its
 * slug (Cohere, NVIDIA, …). Returns scored indices into the submitted
 * documents; the `rerank()` activity maps those back to the caller's original
 * documents.
 */
export declare class OpenRouterRerankAdapter<TModel extends OpenRouterRerankModel> extends BaseRerankAdapter<TModel, OpenRouterRerankProviderOptions> {
    readonly name: "openrouter";
    private readonly client;
    constructor(config: OpenRouterRerankConfig, model: TModel);
    rerank(options: RerankOptions<OpenRouterRerankProviderOptions>): Promise<RerankAdapterResult>;
}
/**
 * Creates an OpenRouter rerank adapter with an explicit API key.
 *
 * @example
 * ```typescript
 * const adapter = createOpenRouterRerank('cohere/rerank-v3.5', 'sk-or-...')
 * ```
 */
export declare function createOpenRouterRerank<TModel extends OpenRouterRerankModel>(model: TModel, apiKey: string, config?: Omit<OpenRouterRerankConfig, 'apiKey'>): OpenRouterRerankAdapter<TModel>;
/**
 * Creates an OpenRouter rerank adapter, reading `OPENROUTER_API_KEY` from the
 * environment.
 *
 * @example
 * ```typescript
 * import { rerank } from '@tanstack/ai'
 * import { openRouterRerank } from '@tanstack/ai-openrouter'
 *
 * const { rerankedDocuments } = await rerank({
 *   adapter: openRouterRerank('cohere/rerank-v3.5'),
 *   query: 'talk about rain',
 *   documents: ['sunny day', 'rainy afternoon'],
 * })
 * ```
 */
export declare function openRouterRerank<TModel extends OpenRouterRerankModel>(model: TModel, config?: Omit<OpenRouterRerankConfig, 'apiKey'>): OpenRouterRerankAdapter<TModel>;
