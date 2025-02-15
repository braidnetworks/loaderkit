import { makeTestFileSystem } from "@loaderkit/resolve/adapter";
import { resolveSync as cjsResolve } from "@loaderkit/resolve/cjs";
import { resolveSync as esmResolve } from "@loaderkit/resolve/esm";

/** @internal */
export function makeResolves(files: Record<string, string>) {
	const fs = makeTestFileSystem(files);
	const cjs = (specifier: string, parentPath: string) =>
		cjsResolve(fs, specifier, new URL(encodeURIComponent(parentPath), "file:///"));
	const esm = (specifier: string, parentPath: string) =>
		esmResolve(fs, specifier, new URL(encodeURIComponent(parentPath), "file:///"));
	return { cjs, esm };
}
