import type { BuildFailure } from "esbuild";
import type { LoadHook, ResolveHook } from "node:module";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as babelParse, types as t } from "@babel/core";
import babelGen from "@babel/generator";
import { transform } from "esbuild";
import nodeResolve from "resolve";
import { splitURLAndQuery, withNodeCallback } from "./utility.js";

const self = new URL(import.meta.url);
const ignoreString = self.searchParams.get("ignore");
const ignorePattern = ignoreString === null ? /[/\\]node_modules[/\\]/ : new RegExp(ignoreString);
const testAnyTypeScript = /\.[cm]?tsx?$/i;
const testModule = /\.mtsx?$/i;
const testCommonJS = /\.ctsx?$/i;
const nodeVersion = `node${process.versions.node}`;

function makeFindConfiguration<Type extends object>(
	configuration: string,
	parse: (content: string, configPath: string) => Type | Promise<Type>,
) {
	const cache = new Map<string, Promise<Type | null>>();
	const readCached = (configPath: string) =>
		cache.get(configPath) ?? function() {
			const promise = async function() {
				try {
					return await parse(await fs.readFile(configPath, "utf8"), configPath);
				} catch {
					return null;
				}
			}();
			cache.set(configPath, promise);
			return promise;
		}();
	const findCached = async (filename: string, stopAt?: string) => {
		let dir = dirname(filename);
		while (true) {
			const configPath = join(dir, configuration);
			const result = await readCached(configPath);
			if (result !== null) {
				return [ result, configPath ] as const;
			}
			const next = dirname(dir);
			if (next === dir || next === stopAt) {
				return null;
			} else {
				dir = next;
			}
		}
	};
	return [ findCached, readCached ] as const;
}

const [ findPackageJson ] = makeFindConfiguration(
	"package.json",
	content => JSON.parse(content) as { type?: string });
const [ findTsConfigJson, readTsConfigJson ] = makeFindConfiguration(
	"tsconfig.json",
	async (content, configPath) => {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
		let tsConfigJson = new Function(`return ${content}`)() as Record<string, any>;
		let tsConfigPath = configPath;
		if (tsConfigJson.compilerOptions.outDir !== undefined) {
			tsConfigJson.compilerOptions.outDir = join(dirname(tsConfigPath), tsConfigJson.compilerOptions.outDir);
		}
		if (tsConfigJson.compilerOptions.rootDir !== undefined) {
			tsConfigJson.compilerOptions.rootDir = join(dirname(tsConfigPath), tsConfigJson.compilerOptions.rootDir);
		}
		while (tsConfigJson.extends !== undefined) {
			tsConfigPath = join(dirname(tsConfigPath), tsConfigJson.extends);
			const nextTsConfigJson = await readTsConfigJson(tsConfigPath);
			if (nextTsConfigJson === null) {
				break;
			} else {
				tsConfigJson = {
					...nextTsConfigJson,
					compilerOptions: {
						...nextTsConfigJson.compilerOptions,
						...tsConfigJson.compilerOptions,
					},
				};
			}
		}
		return tsConfigJson;
	});

async function outputToSource(path: string) {
	const [ , packageJsonLocation ] = await findPackageJson(path) ?? [];
	if (packageJsonLocation !== undefined) {
		const [ tsConfigJson ] = await findTsConfigJson(path, packageJsonLocation) ?? [];
		if (tsConfigJson !== undefined) {
			const { outDir, rootDir, emitDeclarationOnly, noEmit } = tsConfigJson.compilerOptions ?? {};
			if (!noEmit && !emitDeclarationOnly && rootDir !== undefined) {
				if (outDir === undefined) {
					if (path.startsWith(rootDir)) {
						return path.replace(/\.([cm])?js(x?)$/i, ".$1ts$2");
					}
				} else if (path.startsWith(outDir)) {
					return (rootDir as string) + path.slice(outDir.length).replace(/\.([cm])?js(x?)$/i, ".$1ts$2");
				}
			}
		}
	}
}

async function sourceToOutput(path: string) {
	const [ , packageJsonLocation ] = await findPackageJson(path) ?? [];
	if (packageJsonLocation !== undefined) {
		const [ tsConfigJson ] = await findTsConfigJson(path, packageJsonLocation) ?? [];
		if (tsConfigJson !== undefined) {
			const { outDir, rootDir, emitDeclarationOnly, noEmit } = tsConfigJson.compilerOptions ?? {};
			if (!noEmit && !emitDeclarationOnly && rootDir !== undefined && path.startsWith(rootDir)) {
				if (outDir === undefined) {
					const output = path.replace(/\.([cm])?ts(x?)$/i, ".$1js$2");
					return [ output, tsConfigJson ] as const;
				} else {
					const output = (outDir as string) + path.slice(rootDir.length).replace(/\.([cm])?ts(x?)$/i, ".$1js$2");
					return [ output, tsConfigJson ] as const;
				}
			}
		}
	}
}

/** @internal */
export const resolve: ResolveHook = (specifier, context, nextResolve) => {
	const { parentURL } = context;
	// Bail early in fully-specified or ignored cases
	if (
		parentURL === undefined ||
		!testAnyTypeScript.test(parentURL) ||
		!parentURL.startsWith("file:") ||
		ignorePattern.test(parentURL) ||
		/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(specifier)
	) {
		return nextResolve(specifier, context);
	}
	// Try as TypeScript resolution
	return async function() {
		const [ location, query ] = splitURLAndQuery(specifier);
		const result = await async function() {
			// Replace `./import.js` with `./import.ts`
			const localSpecifier = location.startsWith(".") ? location.replace(/\.([cm])?js(x?)$/i, ".$1ts$2") : location;
			try {
				// Try to resolve with built-in resolver. This works for most paths except
				// bundle-specific cruft.
				return await nextResolve(localSpecifier + query, context);
			} catch (error) {
				// Use `resolve` npm package
				const resolved = await withNodeCallback<string | undefined>(callback =>
					nodeResolve(localSpecifier, {
						basedir: dirname(fileURLToPath(parentURL)),
						extensions: [ ".ts", ".tsx", ".cts", ".mts" ],
						preserveSymlinks: false,
					}, callback));
				if (resolved !== undefined) {
					return {
						url: String(pathToFileURL(resolved)) + query,
					};
				}
				throw error;
			}
		}();
		// Bail early if resolution to ignored file
		const [ resultLocation, resultQuery ] = splitURLAndQuery(result.url);
		if (
			!resultLocation.startsWith("file:") ||
			ignorePattern.test(resultLocation)
		) {
			return result;
		}
		// Transforming CommonJS files doesn't actually work, so resolve to the TypeScript-built
		// location
		if (resultLocation.endsWith(".cts")) {
			const [ outputPath ] = await sourceToOutput(resultLocation) ?? [];
			if (outputPath === undefined) {
				throw new Error(`Unable to resolve ${resultLocation} to output location`);
			}
			return {
				...result,
				url: String(pathToFileURL(outputPath)) + resultQuery,
			};
		}
		// If we found a non-ts file then attempt to resolve it to the source .ts. This happens with
		// built package imports.
		if (!testAnyTypeScript.test(resultLocation)) {
			const resultPath = fileURLToPath(resultLocation);
			const sourcePath = await outputToSource(resultPath);
			if (sourcePath !== undefined) {
				return {
					...result,
					url: String(pathToFileURL(sourcePath)) + resultQuery,
				};
			}
		}
		// Otherwise, pass result through unchanged
		return result;
	}();
};

/** @internal */
export const load: LoadHook = async (urlString, context, nextLoad) => {
	const [ location, query ] = splitURLAndQuery(urlString);
	if (
		location.startsWith("file:") &&
		!ignorePattern.test(location) &&
		testAnyTypeScript.test(location)
	) {
		// Get output location, so that `import.meta.url` matches what the built TypeScript output
		// would see.
		const locationPath = fileURLToPath(location);
		const [ outputLocation, foundTsConfigJson ] = await sourceToOutput(locationPath) ?? [];
		const tsConfigJson = foundTsConfigJson ?? await async function() {
			const [ , packageJsonLocation ] = await findPackageJson(locationPath) ?? [];
			const [ tsConfigJson ] = await findTsConfigJson(locationPath, packageJsonLocation) ?? [];
			return tsConfigJson;
		}();
		// Get module format
		const format =
			testModule.test(location) ? "module" :
			testCommonJS.test(location) ? "commonjs" :
			context.format === "commonjs" || context.format === "module" ? context.format :
			await async function() {
				const [ packageJson ] = await findPackageJson(locationPath) ?? [];
				return packageJson?.type === "module" ? "module" : "commonjs";
			}();
		// Compile from TypeScript
		const content = await fs.readFile(locationPath, "utf8");
		const compilerOptions: Record<string, any> = tsConfigJson?.compilerOptions ?? {};
		try {
			const result = await transform(content, {
				format: format === "module" ? "esm" : "cjs",
				loader: location.endsWith("x") ? "tsx" : "ts",
				target: nodeVersion,
				sourcefile: locationPath,
				sourcemap: "external",
				tsconfigRaw: {
					compilerOptions: {
						jsx: compilerOptions.jsx,
						preserveValueImports: compilerOptions.preserveValueImports || compilerOptions.verbatimModuleSyntax,
						target: compilerOptions.target,
					},
				},
			});

			// Attach the correct `import.meta.url`. The `includes` operation will catch instances
			// like `import. meta` since this was just run through esbuild.
			if (result.code.includes("import.meta")) {
				const responseURL = outputLocation === undefined ? urlString : String(pathToFileURL(outputLocation)) + query;
				const ast = babelParse(result.code, {
					babelrc: false,
					configFile: false,
					filename: locationPath,
					retainLines: true,
					sourceType: "module",
					parserOpts: {
						plugins: [
							"explicitResourceManagement",
							[ "importAttributes", { deprecatedAssertSyntax: true } ],
						],
					},
				})!;
				ast.program.body.unshift(
					t.expressionStatement(
						t.assignmentExpression(
							"=",
							t.memberExpression(
								t.metaProperty(t.identifier("import"), t.identifier("meta")),
								t.identifier("url"),
							),
							t.stringLiteral(responseURL)),
					));
				const withMeta = babelGen.default(ast, {
					retainLines: true,
					sourceMaps: true,
					// @ts-expect-error -- The types of this property are still wrong in 2024
					inputSourceMap: result.map,
				});
				result.code = withMeta.code;
				result.map = JSON.stringify(withMeta.map);
			}

			// Attach encoded source map
			const responsePayload = `${result.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(result.map).toString("base64")}`;
			return {
				format,
				shortCircuit: true,
				source: responsePayload,
			};
		} catch (error: any) {
			if (error.errors) {
				const buildError: BuildFailure = error;
				const message = buildError.errors[0]!;
				const location = message.location === null ? "" : `:${message.location.line}:${message.location.column}`;
				const previousStack = error.stack.slice(error.stack.indexOf("\n    at"));
				const stack = `SyntaxError: ${message.text}\n    at (${urlString}${location})${previousStack}`;
				throw Object.assign(new SyntaxError(message.text), { stack });
			} else {
				// Greppable. It means babel failed to parse/process the response from esbuild
				throw Object.assign(new SyntaxError(error.message), {
					note: "this happened in the loader",
					stack: error.stack,
					urlString,
				});
			}
		}
	}
	return nextLoad(urlString, context);
};
