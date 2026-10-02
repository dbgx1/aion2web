/**
 * Transform a JSON schema to be compatible with OpenAI-style structured output requirements.
 * The base requirements (which OpenRouter inherits because it routes to upstream OpenAI-compatible
 * structured-output backends) are:
 * - All properties must be in the `required` array
 * - Optional fields should have null added to their type union
 * - additionalProperties must be false for objects
 *
 * @param schema - JSON schema to transform
 * @param originalRequired - Original required array (to know which fields were optional)
 * @returns Transformed schema compatible with strict structured output
 */
export declare function makeStructuredOutputCompatible(schema: Record<string, any>, originalRequired?: Array<string>): Record<string, any>;
