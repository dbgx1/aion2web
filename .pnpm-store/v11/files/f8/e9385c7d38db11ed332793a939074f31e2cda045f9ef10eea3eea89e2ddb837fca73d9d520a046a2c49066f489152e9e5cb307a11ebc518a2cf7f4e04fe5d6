//#region src/internal/request-options.ts
/**
* Extract `headers` and `signal` from a `Request | RequestInit` for the
* OpenRouter SDK's per-call request-options. `Request` exposes `headers` as a
* `Headers` instance (HeadersInit-compatible) while `RequestInit` exposes
* `HeadersInit` directly — this helper accepts either shape so callers don't
* need to cast.
*
* Always returns an object (possibly empty) rather than `undefined` so test
* assertions that match the second argument shape via `expect.anything()` /
* `expect.objectContaining()` keep working when no request override was set.
*/
function extractRequestOptions(request) {
	if (!request) return {};
	return {
		...request.headers !== void 0 && { headers: request.headers },
		...request.signal !== void 0 && { signal: request.signal }
	};
}
//#endregion
export { extractRequestOptions };

//# sourceMappingURL=request-options.js.map