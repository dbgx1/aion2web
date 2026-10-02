import { OPENROUTER_COMBINED_TOOLS_AND_SCHEMA_MODELS } from "../model-meta.js";
//#region src/internal/combined-tools-and-schema.ts
function stripOpenRouterModelVariant(model) {
	const variantIndex = model.indexOf(":");
	return variantIndex === -1 ? model : model.slice(0, variantIndex);
}
function openRouterSupportsCombinedToolsAndSchema(model, modelOptions) {
	return [model, ...modelOptions?.models ?? []].map(stripOpenRouterModelVariant).every((candidate) => OPENROUTER_COMBINED_TOOLS_AND_SCHEMA_MODELS.has(candidate));
}
//#endregion
export { openRouterSupportsCombinedToolsAndSchema };

//# sourceMappingURL=combined-tools-and-schema.js.map