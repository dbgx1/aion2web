//#region src/adapters/cost.ts
/**
* Wire-key → canonical-key mapping. Snake_case keys come from the raw/UNKNOWN
* `response.completed` fallback in the Responses adapter; camelCase keys come
* from the SDK-parsed path. Both Chat Completions' prompt/completions naming
* and Responses' input/output naming collapse onto `upstreamInputCost` /
* `upstreamOutputCost`.
*/
var KNOWN_DETAIL_KEYS = {
	upstream_inference_cost: "upstreamCost",
	upstreamInferenceCost: "upstreamCost",
	upstream_inference_prompt_cost: "upstreamInputCost",
	upstreamInferencePromptCost: "upstreamInputCost",
	upstream_inference_input_cost: "upstreamInputCost",
	upstreamInferenceInputCost: "upstreamInputCost",
	upstream_inference_completions_cost: "upstreamOutputCost",
	upstreamInferenceCompletionsCost: "upstreamOutputCost",
	upstream_inference_output_cost: "upstreamOutputCost",
	upstreamInferenceOutputCost: "upstreamOutputCost"
};
function asRecord(value) {
	return typeof value === "object" && value !== null ? value : void 0;
}
/**
* Narrow a raw `cost_details`/`costDetails` map to the canonical fields of
* `UsageCostBreakdown`. Negative values (e.g. discounts) are preserved; `null`,
* non-finite numbers, non-numeric values, and unknown keys are dropped.
*/
function extractCostDetails(details) {
	const record = asRecord(details);
	if (!record) return void 0;
	const out = {};
	for (const [rawKey, value] of Object.entries(record)) {
		const key = KNOWN_DETAIL_KEYS[rawKey];
		if (!key) continue;
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/**
* Extract `cost`/`costDetails` from a provider usage object.
*
* - `cost` is attached only when it is a finite number — this preserves `cost === 0`
*   and rejects `NaN`/`Infinity`, and does not clamp negative values.
* - `costDetails` is attached only alongside a valid `cost` (an orphan breakdown
*   without a total cannot be reconciled and is dropped). Both camelCase
*   `costDetails` and snake_case `cost_details` are read.
*
* Returns an empty object when no usable cost is present, so call sites can spread
* the result unconditionally.
*/
function extractUsageCost(usage) {
	const record = asRecord(usage);
	if (!record) return {};
	const cost = record.cost;
	if (typeof cost !== "number" || !Number.isFinite(cost)) return {};
	const costDetails = extractCostDetails(record.costDetails ?? record.cost_details);
	return {
		cost,
		...costDetails && { costDetails }
	};
}
//#endregion
export { extractUsageCost };

//# sourceMappingURL=cost.js.map