import * as z from "zod/v4";
import { OpenEnum } from "../types/enums.js";
/**
 * A curated OpenRouter fusion preset (slugs follow `<task>-<tier>`, e.g. `general-high`). Expands server-side into the preset's analysis_models panel and judge model, so callers never name individual models. Explicitly provided `analysis_models` / `model` take precedence.
 */
export declare const PresetEnum: {
    readonly GeneralHigh: "general-high";
    readonly GeneralBudget: "general-budget";
    readonly GeneralFast: "general-fast";
};
/**
 * A curated OpenRouter fusion preset (slugs follow `<task>-<tier>`, e.g. `general-high`). Expands server-side into the preset's analysis_models panel and judge model, so callers never name individual models. Explicitly provided `analysis_models` / `model` take precedence.
 */
export type PresetEnum = OpenEnum<typeof PresetEnum>;
export type FusionPluginTool = {
    /**
     * Optional configuration forwarded as the tool's `parameters` object.
     */
    parameters?: {
        [k: string]: any | null;
    } | undefined;
    /**
     * Server tool type identifier (e.g. "openrouter:web_search", "openrouter:web_fetch").
     */
    type: string;
};
export type FusionPlugin = {
    /**
     * Slugs of models to run in parallel as the "expert panel" the judge analyzes. Each model receives the same user prompt with web_search + web_fetch enabled. Capped at 8 models to bound cost amplification. When omitted, defaults to the Quality preset from the /labs/fusion UI (~anthropic/claude-opus-latest, ~openai/gpt-latest, ~google/gemini-pro-latest).
     */
    analysisModels?: Array<string> | undefined;
    /**
     * Set to false to disable the fusion plugin for this request. Defaults to true.
     */
    enabled?: boolean | undefined;
    id: "fusion";
    /**
     * Maximum number of tool-calling steps each panelist (analysis model) and the judge model may take during their agentic web-research loop. Models with web_search/web_fetch enabled iterate until they produce a text response or hit this ceiling. Defaults to 8. Capped at 16.
     */
    maxToolCalls?: number | undefined;
    /**
     * Slug of the model that performs both the judge step (with web_search + web_fetch) and the final synthesis. When omitted, defaults to the first model in the Quality preset.
     */
    model?: string | undefined;
    /**
     * A curated OpenRouter fusion preset (slugs follow `<task>-<tier>`, e.g. `general-high`). Expands server-side into the preset's analysis_models panel and judge model, so callers never name individual models. Explicitly provided `analysis_models` / `model` take precedence.
     */
    preset?: PresetEnum | undefined;
    /**
     * Server tools available to panelist and judge inner calls. Each entry uses the same `{ type, parameters? }` shorthand as the outer Chat Completions request. When omitted, defaults to `[{ type: "openrouter:web_search" }, { type: "openrouter:web_fetch" }]`. Pass an empty array to disable tools entirely (panelists answer from parametric knowledge only).
     */
    tools?: Array<FusionPluginTool> | undefined;
};
/** @internal */
export declare const PresetEnum$outboundSchema: z.ZodType<string, PresetEnum>;
/** @internal */
export type FusionPluginTool$Outbound = {
    parameters?: {
        [k: string]: any | null;
    } | undefined;
    type: string;
};
/** @internal */
export declare const FusionPluginTool$outboundSchema: z.ZodType<FusionPluginTool$Outbound, FusionPluginTool>;
export declare function fusionPluginToolToJSON(fusionPluginTool: FusionPluginTool): string;
/** @internal */
export type FusionPlugin$Outbound = {
    analysis_models?: Array<string> | undefined;
    enabled?: boolean | undefined;
    id: "fusion";
    max_tool_calls?: number | undefined;
    model?: string | undefined;
    preset?: string | undefined;
    tools?: Array<FusionPluginTool$Outbound> | undefined;
};
/** @internal */
export declare const FusionPlugin$outboundSchema: z.ZodType<FusionPlugin$Outbound, FusionPlugin>;
export declare function fusionPluginToJSON(fusionPlugin: FusionPlugin): string;
//# sourceMappingURL=fusionplugin.d.ts.map