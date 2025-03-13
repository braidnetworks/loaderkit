import type { LoaderFileSystem, PackageJson, ResolutionConfig } from "./utility/scope.js";
import type { FileSystemAsync } from "@loaderkit/resolve/fs";
import type { LoadHook, ResolveHook } from "node:module";
import type {} from "dynohot";
import { resolve as cjsResolve } from "@loaderkit/resolve/cjs";
import { resolve as esmResolve } from "@loaderkit/resolve/esm";
import { transpileSource } from "./utility/esbuild.js";
import { makeResolveTypeScriptPackage, resolveFormat, resolvePackage } from "./utility/scope.js";
import { absoluteJavaScriptToTypeScript, absoluteTypeScriptToJavaScript, outputToSourceCandidates, sourceToOutput, testAnyJSON, testAnyJavaScript, testAnyScript, testAnyTypeScript } from "./utility/translate.js";

const testHasScheme = /^[a-z][a-z0-9+.-]*:/i;
const commonJsExtensions = [ ".js", ".jsx" ];
const commonJsImportConditions = [ "node", "import", "require" ];
const commonJsRequireConditions = [ "node", "require" ];

/** @internal */
export function makeResolveAndLoad(underlyingFileSystem: LoaderFileSystem) {
	// Cache `package.json` reads
	const fileSystem = {
		...underlyingFileSystem,
		readFileJSON: function(readFileJSON) {
			const cache = new Map<string, Promise<unknown>>();
			return (url: URL) => cache.get(url.href) ?? function() {
				const result = readFileJSON(url);
				cache.set(url.href, result);
				return result;
			}();
		}(underlyingFileSystem.readFileJSON),
	};

	// tsconfig.resolver utilities
	const resolvedTypeScriptParents = new Map<string, URL>();
	const resolveTypeScriptPackage = makeResolveTypeScriptPackage(fileSystem);
	const resolveTsConfig = async (url: URL) => {
		const packageMeta = await resolvePackage(fileSystem, url);
		return resolveTypeScriptPackage(url, packageMeta?.packagePath);
	};

	// Resolves from .ts source files to another source file. Used for relative imports.
	const sourceResolverFileSystem = function(): FileSystemAsync {
		const findSource = async (url: URL) => {
			// First try .js -> .ts map since this is the most likely case
			if (testAnyJavaScript.test(url.pathname)) {
				const asTs = absoluteJavaScriptToTypeScript(url);
				if (await fileSystem.fileExists(asTs)) {
					return asTs;
				}
			}
			// Try file as is
			if (await fileSystem.fileExists(url)) {
				return url;
			}
		};
		return {
			...fileSystem,
			fileExists: async url => {
				if (testAnyScript.test(url.pathname)) {
					return await findSource(url) ? true : false;
				} else {
					return fileSystem.fileExists(url);
				}
			},
			readLink: async url => {
				if (testAnyScript.test(url.pathname)) {
					const source = await findSource(url);
					if (source) {
						if (source.href === url.href) {
							return fileSystem.readLink(url);
						} else {
							return source.pathname;
						}
					}
				}
				return fileSystem.readLink(url);
			},
		};
	}();

	// Resolves to output .js files. Used for fully qualified imports.
	const outputResolverFileSystem: FileSystemAsync = {
		...fileSystem,
		fileExists: async url => {
			if (
				testAnyScript.test(url.pathname) ||
				(testAnyJSON.test(url.pathname) && !url.pathname.endsWith("/package.json"))
			) {
				const tsConfig = await resolveTsConfig(url);
				for (const location of outputToSourceCandidates(url, tsConfig?.locations)) {
					if (await fileSystem.fileExists(location)) {
						return true;
					}
				}
				return false;
			} else {
				return fileSystem.fileExists(url);
			}
		},
		readLink: async url => {
			if (!testAnyScript.test(url.pathname) && !testAnyJSON.test(url.pathname)) {
				return fileSystem.readLink(url);
			}
		},
	};

	const makeResolver = (fileSystem: FileSystemAsync, packageJson: PackageJson | undefined, locations: ResolutionConfig | undefined) =>
		async (specifier: string, parentURL: URL) => {
			const parentFormat = resolveFormat(parentURL.pathname, packageJson);
			if (locations?.outputBase) {
				// Projects with outputs use a stricter resolution
				if (parentFormat === "module") {
					return esmResolve(fileSystem, specifier, parentURL);
				} else {
					return cjsResolve(fileSystem, specifier, parentURL);
				}
			} else {
				// Projects without outputs fall back to CJS resolution with custom conditions &
				// extensions. This simulates "bundler" like behavior.
				return cjsResolve(fileSystem, specifier, parentURL, {
					conditions: parentFormat === "module"
						? commonJsImportConditions
						: commonJsRequireConditions,
					extensions: commonJsExtensions,
				});
			}
		};

	const resolve: ResolveHook = (specifier, context, nextResolve) => {
		const { parentURL: parentUrlString } = context;
		if (parentUrlString === undefined) {
			// Program entrypoint. We can assume that `specifier` is a fully-resolved file URL with
			// no query parameters. It could be either a source file or an output file.
			return async function() {
				const url = new URL(specifier);
				const packageMeta = await resolvePackage(fileSystem, url);
				const tsConfig = await resolveTypeScriptPackage(url, packageMeta?.packagePath);
				const format = resolveFormat(specifier, packageMeta?.packageJson);
				const outputUrl = sourceToOutput(url, tsConfig?.locations);
				if (outputUrl) {
					// `node main.ts`
					resolvedTypeScriptParents.set(outputUrl.href, url);
					return {
						url: outputUrl.href,
						format,
						importAttributes: {
							...context.importAttributes,
							ts: url.href,
						},
						shortCircuit: true,
					};
				} else {
					for (const sourceUrl of outputToSourceCandidates(url, tsConfig?.locations)) {
						if (await fileSystem.fileExists(sourceUrl)) {
							// `node dist/main.js`
							resolvedTypeScriptParents.set(url.href, sourceUrl);
							return {
								url: url.href,
								format,
								importAttributes: {
									...context.importAttributes,
									ts: sourceUrl.href,
								},
								shortCircuit: true,
							};
						}
					}
					return nextResolve(specifier, context);
				}
			}();
		}

		// Bail early on relative imports from unknown parents
		// nb: Imports from `--import` on the command line use the cwd (ending in a slash) as the
		// parent
		const parentURL = new URL(parentUrlString);
		const sourceParentURL = resolvedTypeScriptParents.get(parentUrlString);
		if (!sourceParentURL && specifier.startsWith(".") && !parentUrlString.endsWith("/")) {
			return nextResolve(specifier, context);
		}

		// Check for fully-resolved .ts files, i.e. `import(import.meta.resolve('./specifier.js'))`
		if (
			specifier.startsWith("file:///") &&
			!specifier.includes("/node_modules/")
		) {
			return async function() {
				const outputUrl = new URL(specifier);
				const packageMeta = await resolvePackage(fileSystem, outputUrl);
				const tsConfig = await resolveTypeScriptPackage(outputUrl, packageMeta?.packagePath);
				const sourceUrl = await async function() {
					for (const url of outputToSourceCandidates(outputUrl, tsConfig?.locations)) {
						if (await fileSystem.fileExists(url)) {
							return url;
						}
					}
				}();
				if (!sourceUrl) {
					return nextResolve(specifier, context);
				}
				const format = resolveFormat(sourceUrl.pathname, packageMeta?.packageJson);
				resolvedTypeScriptParents.set(outputUrl.href, sourceUrl);
				return {
					format,
					url: outputUrl.href,
					importAttributes: {
						...context.importAttributes,
						ts: sourceUrl.href,
					},
					shortCircuit: true,
				};
			}();
		}

		// Bail on fully-qualified URLs
		if (testHasScheme.test(specifier)) {
			return nextResolve(specifier, context);
		}

		// Try as TypeScript resolution
		return async function() {

			// Look up parent tsconfig
			const packageMeta = await resolvePackage(fileSystem, parentURL);
			const tsConfig = await resolveTypeScriptPackage(parentURL, packageMeta?.packagePath);

			// Dispatch custom resolution
			const result = await async function() {
				try {
					if (specifier.startsWith(".")) {
						// Relative imports will use a resolver which returns the source file URL. It
						// must then be mapped to an output file.
						const resolve = makeResolver(sourceResolverFileSystem, packageMeta?.packageJson, tsConfig?.locations);
						const resolutionParentURL = sourceParentURL ?? parentURL;
						const sourceResolution = await resolve(specifier, resolutionParentURL);
						const resolvedTsConfig = await resolveTsConfig(resolutionParentURL);
						const outputUrl = sourceToOutput(sourceResolution.url, resolvedTsConfig?.locations);
						return {
							format: sourceResolution.format,
							url: outputUrl ?? absoluteTypeScriptToJavaScript(sourceResolution.url),
							sourceUrl: sourceResolution.url,
						};
					} else {
						// Fully-qualified imports resolve to an output file, which must then be mapped
						// back to source file. We must resolve to an output file fully-qualified
						// specifiers end up digging through `package.json` which will always list
						// output files.
						const resolve = makeResolver(outputResolverFileSystem, packageMeta?.packageJson, tsConfig?.locations);
						const outputResolution = await resolve(specifier, parentURL);
						const resolvedTsConfig = await resolveTsConfig(outputResolution.url);
						return {
							...outputResolution,
							sourceUrl: await async function() {
								for (const url of outputToSourceCandidates(outputResolution.url, resolvedTsConfig?.locations)) {
									if (await fileSystem.fileExists(url)) {
										return url;
									}
								}
							}(),
						};
					}
				} catch {}
			}();

			// On failure forward to next resolver
			if (!result) {
				return nextResolve(specifier, context);
			}

			// Return successful resolutions which did not resolve to a TypeScript source
			const { format, sourceUrl, url } = result;
			if (
				!sourceUrl ||
				url.protocol !== "file:" ||
				url.pathname.includes("/node_modules/") ||
				(format !== undefined && format !== "module" && format !== "commonjs" && format !== "json")
			) {
				return {
					format: format === "addon" ? undefined : format,
					shortCircuit: true,
					url: url.href,
				};
			}

			// Check for .ts import from non-bundler projects
			if (testAnyTypeScript.test(specifier.replace(/[#?].+/, "")) && tsConfig?.locations.outputBase) {
				throw new Error(`Cannot import TypeScript specifier '${specifier}' with TypeScript output artifacts enabled.`);
			}

			// If a direct `.ts` specifier was resolved (i.e. no outDir), or a .jsx / .tsx file,
			// then format will be null. So that needs to be resolved by us.
			const resolvedFormat = format ?? resolveFormat(sourceUrl.pathname, packageMeta?.packageJson);

			// Pass off to loader
			if (resolvedFormat === "module" || resolvedFormat === "json") {
				resolvedTypeScriptParents.set(url.href, sourceUrl);
				return {
					format: resolvedFormat,
					url: url.href,
					importAttributes: {
						...context.importAttributes,
						ts: sourceUrl.href,
					},
					shortCircuit: true,
				};
			} else {
				return {
					format: resolvedFormat,
					url: url.href,
					importAttributes: context.importAttributes,
					shortCircuit: true,
				};
			}
		}();
	};

	const load: LoadHook = (urlString, context, nextLoad) => {
		const { format, importAttributes } = context;
		const tsSource = importAttributes.ts;
		if (tsSource === undefined) {
			// Not resolved with this loader
			return nextLoad(urlString, context);
		}

		return async function() {
			// `tsSourceUrl` is a `.ts` file, or maybe a `.js` file with `allowJs`, or `.json` file with `allowJson`.
			const tsSourceUrl = new URL(tsSource);

			// dynohot integration
			if (context.hot) {
				context.hot.watch(tsSourceUrl);
			}

			// Resolve compiler options
			const packageMeta = await resolvePackage(fileSystem, tsSourceUrl);
			const tsConfig = await resolveTypeScriptPackage(tsSourceUrl, packageMeta?.packagePath);

			switch (format) {
				case "module": {
					// Validate attributes
					for (const key of Object.keys(importAttributes)) {
						if (key !== "ts") {
							throw new TypeError(`Import attribute '${key}' with value '${importAttributes[key]}' is not supported`);
						}
					}

					// Get transpiled source. JavaScript is also passed through esbuild in case downleveling
					// is expected.
					const content = await fileSystem.readFileString(tsSourceUrl);
					const payload = await transpileSource(content, format, tsSourceUrl, tsConfig?.compilerOptions ?? {});
					return {
						format,
						shortCircuit: true,
						source: payload,
					};
				}

				case "json": {
					// Pass source URL to JSON loader
					const filteredAttributes = Object.fromEntries(Object.entries(importAttributes).filter(([ key ]) => key !== "ts"));
					return nextLoad(tsSourceUrl.href, {
						...context,
						importAttributes: filteredAttributes,
					});
				}

				default:
					throw new Error("@loaderkit/ts: Unexpected format");
			}
		}();
	};

	return { load, resolve };
}
