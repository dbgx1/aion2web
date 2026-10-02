import { TokenUsage } from '@tanstack/ai';
import { ChatUsage } from '@openrouter/sdk/models';
/**
 * OpenRouter-specific provider usage details.
 * These fields are unique to OpenRouter and placed in providerUsageDetails.
 */
export type OpenRouterProviderUsageDetails = {
    /** Accepted prediction tokens (speculative decoding) */
    acceptedPredictionTokens?: number;
    /** Rejected prediction tokens (speculative decoding) */
    rejectedPredictionTokens?: number;
};
/**
 * Build normalized TokenUsage from OpenRouter's ChatUsage object.
 * Returns `undefined` when the provider reported no usage object, so callers
 * omit the field rather than fabricating zeroed totals.
 */
export declare function buildOpenRouterUsage(usage: ChatUsage | undefined | null): TokenUsage<OpenRouterProviderUsageDetails> | undefined;
