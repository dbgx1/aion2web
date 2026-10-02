import { OPENROUTER_VIDEO_MODEL_META } from "../model-meta.js";
//#region src/video/video-provider-options.ts
var VIDEO_MODEL_META = OPENROUTER_VIDEO_MODEL_META;
/** Capability metadata for a video model, or undefined when unknown. */
function getVideoModelMeta(model) {
	return VIDEO_MODEL_META[model];
}
function getVideoDurationOptions(model) {
	const durations = VIDEO_MODEL_META[model]?.durations;
	if (!durations || durations.length === 0) return { kind: "none" };
	return {
		kind: "discrete",
		values: durations
	};
}
/**
* Validate a requested size against the model's supported sizes. No-op when
* the model (or its size list) is unknown — OpenRouter then validates
* server-side.
*/
function validateVideoSize(model, size) {
	if (!size) return;
	const sizes = VIDEO_MODEL_META[model]?.sizes;
	if (!sizes || sizes.includes(size)) return;
	throw new Error(`openrouter: model ${model} does not support size '${size}'. Supported sizes: ${sizes.join(", ")}.`);
}
/**
* Validate a requested duration (seconds) against the model's supported
* durations. No-op when the model (or its duration list) is unknown.
*/
function validateVideoDuration(model, duration) {
	if (duration === void 0) return;
	const durations = VIDEO_MODEL_META[model]?.durations;
	if (!durations || durations.includes(duration)) return;
	throw new Error(`openrouter: model ${model} does not support duration ${duration}s. Supported durations: ${durations.join(", ")}s.`);
}
//#endregion
export { getVideoDurationOptions, getVideoModelMeta, validateVideoDuration, validateVideoSize };

//# sourceMappingURL=video-provider-options.js.map