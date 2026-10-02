import * as z from "zod/v4";
import { OpenEnum } from "../types/enums.js";
import { Result as SafeParseResult } from "../types/fp.js";
import { EndpointStatus } from "./endpointstatus.js";
import { SDKValidationError } from "./errors/sdkvalidationerror.js";
import { Parameter } from "./parameter.js";
import { PercentileStats } from "./percentilestats.js";
import { ProviderName } from "./providername.js";
export type Pricing = {
    /**
     * Price in USD per audio input token
     */
    audio?: string | undefined;
    /**
     * Price in USD per audio output token
     */
    audioOutput?: string | undefined;
    /**
     * Price in USD per token for completion (output) generation
     */
    completion: string;
    /**
     * Fractional discount applied to this endpoint's pricing; the price is multiplied by (1 - discount) (0 = no discount, 1 = free)
     */
    discount?: number | undefined;
    /**
     * Price in USD per input image
     */
    image?: string | undefined;
    /**
     * Price in USD per output image
     */
    imageOutput?: string | undefined;
    /**
     * Price in USD per image token
     */
    imageToken?: string | undefined;
    /**
     * Price in USD per cached audio input token
     */
    inputAudioCache?: string | undefined;
    /**
     * Price in USD per cached input token (read)
     */
    inputCacheRead?: string | undefined;
    /**
     * Price per cache-write token, in USD per token. For providers with multiple cache TTLs (e.g. Anthropic), this is the default (5-minute) cache-write rate.
     */
    inputCacheWrite?: string | undefined;
    /**
     * Price per 1-hour cache-write token, in USD per token. Only present for providers that price an extended (1-hour) cache TTL separately, such as Anthropic.
     */
    inputCacheWrite1h?: string | undefined;
    /**
     * Price in USD per internal reasoning token
     */
    internalReasoning?: string | undefined;
    /**
     * Price in USD per token for prompt (input) processing
     */
    prompt: string;
    /**
     * Price in USD per request
     */
    request?: string | undefined;
    /**
     * Price in USD per web search
     */
    webSearch?: string | undefined;
};
export declare const PublicEndpointQuantization: {
    readonly Int4: "int4";
    readonly Int8: "int8";
    readonly Fp4: "fp4";
    readonly Fp6: "fp6";
    readonly Fp8: "fp8";
    readonly Fp16: "fp16";
    readonly Bf16: "bf16";
    readonly Fp32: "fp32";
    readonly Unknown: "unknown";
};
export type PublicEndpointQuantization = OpenEnum<typeof PublicEndpointQuantization>;
/**
 * Information about a specific model endpoint
 */
export type PublicEndpoint = {
    contextLength: number;
    /**
     * Latency percentiles in milliseconds over the last 30 minutes. Latency measures time to first token. Only visible when authenticated with an API key or cookie; returns null for unauthenticated requests.
     */
    latencyLast30m: PercentileStats | null;
    maxCompletionTokens: number | null;
    maxPromptTokens: number | null;
    /**
     * The unique identifier for the model (permaslug)
     */
    modelId: string;
    modelName: string;
    name: string;
    pricing: Pricing;
    providerName: ProviderName;
    quantization: PublicEndpointQuantization | null;
    status?: EndpointStatus | undefined;
    supportedParameters: Array<Parameter>;
    supportsImplicitCaching: boolean;
    tag: string;
    throughputLast30m: PercentileStats | null;
    /**
     * Uptime percentage over the last 1 day, calculated as successful requests / (successful + error requests) * 100. Rate-limited requests are excluded. Returns null if insufficient data.
     */
    uptimeLast1d: number | null;
    uptimeLast30m: number | null;
    /**
     * Uptime percentage over the last 5 minutes, calculated as successful requests / (successful + error requests) * 100. Rate-limited requests are excluded. Returns null if insufficient data.
     */
    uptimeLast5m: number | null;
};
/** @internal */
export declare const Pricing$inboundSchema: z.ZodType<Pricing, unknown>;
export declare function pricingFromJSON(jsonString: string): SafeParseResult<Pricing, SDKValidationError>;
/** @internal */
export declare const PublicEndpointQuantization$inboundSchema: z.ZodType<PublicEndpointQuantization, unknown>;
/** @internal */
export declare const PublicEndpoint$inboundSchema: z.ZodType<PublicEndpoint, unknown>;
export declare function publicEndpointFromJSON(jsonString: string): SafeParseResult<PublicEndpoint, SDKValidationError>;
//# sourceMappingURL=publicendpoint.d.ts.map