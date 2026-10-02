import { convertWebSearchToolToAdapterFormat, isWebSearchTool } from "./web-search-tool.js";
import { convertWebFetchToolToAdapterFormat, isWebFetchTool } from "./web-fetch-tool.js";
import { convertFunctionToolToAdapterFormat } from "./function-tool.js";
import { assertUniqueToolNames } from "@tanstack/ai/adapter-internals";
//#region src/tools/tool-converter.ts
function convertToolsToProviderFormat(tools) {
	assertUniqueToolNames(tools);
	return tools.map((tool) => {
		if (isWebSearchTool(tool)) return convertWebSearchToolToAdapterFormat(tool);
		if (isWebFetchTool(tool)) return convertWebFetchToolToAdapterFormat(tool);
		return convertFunctionToolToAdapterFormat(tool);
	});
}
//#endregion
export { convertToolsToProviderFormat };

//# sourceMappingURL=tool-converter.js.map