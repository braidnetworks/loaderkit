import type { TranspileOptions } from "./scope.js";
import type { BuildFailure } from "esbuild";
import type { ModuleFormat } from "node:module";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { testAnyTypeScript } from "./translate.js";

const nodeVersion = `node${process.versions.node}`;

function isBuildFailure(error: unknown): error is BuildFailure & Error {
	return typeof error === "object" && error !== null && "errors" in error;
}

/** @internal */
export async function transpileSource(
	sourceText: string,
	format: ModuleFormat,
	sourceLocation: URL,
	compilerOptions: TranspileOptions,
) {
	try {
		// nb: CommonJS is not actually supported. You would need a whole new thing that
		// shims `require`, `__filename`, etc.
		const result = await transform(sourceText, {
			format: format === "module" ? "esm" : "cjs",
			loader: function() {
				const { pathname } = sourceLocation;
				if (testAnyTypeScript.test(pathname)) {
					return /x/i.test(pathname) ? "tsx" : "ts";
				} else {
					return /x/i.test(pathname) ? "jsx" : "js";
				}
			}(),
			target: nodeVersion,
			sourcefile: fileURLToPath(sourceLocation),
			sourcemap: "external",
			tsconfigRaw: {
				compilerOptions,
			},
		});
		// Attach encoded source map
		return `${result.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(result.map).toString("base64")}`;
	} catch (cause) {
		if (isBuildFailure(cause)) {
			const message = cause.errors[0]!;
			const location = message.location === null ? "" : `:${message.location.line}:${message.location.column}`;
			const stack = `SyntaxError: ${message.text}\n    at (${sourceLocation.href}${location})`;
			throw Object.assign(new SyntaxError(message.text, { cause }), { stack });
		} else {
			throw cause;
		}
	}

}
