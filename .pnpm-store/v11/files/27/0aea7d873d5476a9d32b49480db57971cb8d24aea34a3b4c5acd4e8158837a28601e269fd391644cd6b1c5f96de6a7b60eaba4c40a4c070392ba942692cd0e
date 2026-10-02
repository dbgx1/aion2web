import { BaseImageAdapter } from '@tanstack/ai/adapters';
import { OpenRouterClientConfig } from '../utils/client.js';
import { OpenRouterImageModelInputModalitiesByName, OpenRouterImageModelProviderOptionsByName, OpenRouterImageModelSizeByName, OpenRouterImageProviderOptions } from '../image/image-provider-options.js';
import { ImageGenerationOptions, ImageGenerationResult } from '@tanstack/ai';
import { OPENROUTER_IMAGE_MODELS } from '../model-meta.js';
export interface OpenRouterImageConfig extends OpenRouterClientConfig {
}
export type OpenRouterImageModel = (typeof OPENROUTER_IMAGE_MODELS)[number];
export declare class OpenRouterImageAdapter<TModel extends OpenRouterImageModel> extends BaseImageAdapter<TModel, OpenRouterImageProviderOptions, OpenRouterImageModelProviderOptionsByName, OpenRouterImageModelSizeByName, OpenRouterImageModelInputModalitiesByName> {
    readonly kind: "image";
    readonly name: "openrouter";
    private readonly client;
    constructor(config: OpenRouterImageConfig, model: TModel);
    generateImages(options: ImageGenerationOptions<OpenRouterImageProviderOptions>): Promise<ImageGenerationResult>;
    protected generateId(): string;
    private transformResponse;
}
export declare function createOpenRouterImage<TModel extends OpenRouterImageModel>(model: TModel, apiKey: string, config?: Omit<OpenRouterImageConfig, 'apiKey'>): OpenRouterImageAdapter<TModel>;
export declare function openRouterImage<TModel extends OpenRouterImageModel>(model: TModel, config?: Omit<OpenRouterImageConfig, 'apiKey'>): OpenRouterImageAdapter<TModel>;
