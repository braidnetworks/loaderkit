import type { BuildFailure } from "esbuild";

/** @internal */
export function isBuildFailure(error: unknown): error is BuildFailure & Error {
	return typeof error === "object" && error !== null && "errors" in error;
}

/** @internal */
export function splitURLAndQuery(url: string) {
	const ii = url.indexOf("?");
	if (ii === -1) {
		return [ url, "" ] as const;
	} else {
		return [ url.slice(0, ii), url.slice(ii) ] as const;
	}
}

/**
 * Provides an adapter to convert node-style callbacks into promises. The behavior is a little more
 * explicit than `util.promisify`.
 *
 * @internal
 */
export function withNodeCallback<Type>(
	fn: (callback: (error: Error | null | undefined, result: Type) => void) => void,
): Promise<Type> {
	return new Promise<Type>((resolve, reject) => {
		fn((error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
}
