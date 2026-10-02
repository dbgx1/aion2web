import * as z from "zod/v4";
import { Result as SafeParseResult } from "../types/fp.js";
import { CostDetails } from "./costdetails.js";
import { SDKValidationError } from "./errors/sdkvalidationerror.js";
/**
 * Detailed completion token usage
 */
export type ChatUsageCompletionTokensDetails = {
    /**
     * Accepted prediction tokens
     */
    acceptedPredictionTokens?: number | null | undefined;
    /**
     * Tokens used for audio output
     */
    audioTokens?: number | null | undefined;
    /**
     * Tokens used for reasoning
     */
    reasoningTokens?: number | null | undefined;
    /**
     * Rejected prediction tokens
     */
    rejectedPredictionTokens?: number | null | undefined;
};
/**
 * Detailed prompt token usage
 */
export type ChatUsagePromptTokensDetails = {
    /**
     * Audio input tokens
     */
    audioTokens?: number | undefined;
    /**
     * Tokens written to cache. Only returned for models with explicit caching and cache write pricing.
     */
    cacheWriteTokens?: number | undefined;
    /**
     * Cached prompt tokens
     */
    cachedTokens?: number | undefined;
    /**
     * Video input tokens
     */
    videoTokens?: number | undefined;
};
/**
 * Usage for server-side tool execution (e.g., web search)
 */
export type ServerToolUseDetails = {
    /**
     * Number of OpenRouter server tool calls that executed and produced a result
     */
    toolCallsExecuted?: number | null | undefined;
    /**
     * Total number of OpenRouter server-orchestrated tool calls the model requested, across all tool types. Provider-native tools (e.g. native web search) are not counted here.
     */
    toolCallsRequested?: number | null | undefined;
    /**
     * Number of web searches performed by server-side tools. For server-orchestrated tool calls a web search is also counted in tool_calls_requested; provider-native web search may report web_search_requests only. Do not sum the two.
     */
    webSearchRequests?: number | null | undefined;
};
/**
 * Token usage statistics
 */
export type ChatUsage = {
    /**
     * Number of tokens in the completion
     */
    completionTokens: number;
    /**
     * Detailed completion token usage
     */
    completionTokensDetails?: ChatUsageCompletionTokensDetails | null | undefined;
    /**
     * Cost of the completion
     */
    cost?: number | null | undefined;
    /**
     * Breakdown of upstream inference costs
     */
    costDetails?: CostDetails | null | undefined;
    /**
     * Whether a request was made using a Bring Your Own Key configuration
     */
    isByok?: boolean | undefined;
    /**
     * Number of tokens in the prompt
     */
    promptTokens: number;
    /**
     * Detailed prompt token usage
     */
    promptTokensDetails?: ChatUsagePromptTokensDetails | null | undefined;
    /**
     * Usage for server-side tool execution (e.g., web search)
     */
    serverToolUseDetails?: ServerToolUseDetails | null | undefined;
    /**
     * Total number of tokens
     */
    totalTokens: number;
};
/** @internal */
export declare const ChatUsageCompletionTokensDetails$inboundSchema: z.ZodType<ChatUsageCompletionTokensDetails, unknown>;
export declare function chatUsageCompletionTokensDetailsFromJSON(jsonString: string): SafeParseResult<ChatUsageCompletionTokensDetails, SDKValidationError>;
/** @internal */
export declare const ChatUsagePromptTokensDetails$inboundSchema: z.ZodType<ChatUsagePromptTokensDetails, unknown>;
export declare function chatUsagePromptTokensDetailsFromJSON(jsonString: string): SafeParseResult<ChatUsagePromptTokensDetails, SDKValidationError>;
/** @internal */
export declare const ServerToolUseDetails$inboundSchema: z.ZodType<ServerToolUseDetails, unknown>;
export declare function serverToolUseDetailsFromJSON(jsonString: string): SafeParseResult<ServerToolUseDetails, SDKValidationError>;
/** @internal */
export declare const ChatUsage$inboundSchema: z.ZodType<ChatUsage, unknown>;
export declare function chatUsageFromJSON(jsonString: string): SafeParseResult<ChatUsage, SDKValidationError>;
//# sourceMappingURL=chatusage.d.ts.map