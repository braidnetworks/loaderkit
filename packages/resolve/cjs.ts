import type { Resolution } from "./esm.js";
import type { FileSystemAsync, FileSystemSync, FileSystemTask } from "./fs.js";
import type { Task } from "@braidai/lang/task/utility";
import { begin, expect, task } from "@braidai/lang/task/task";
import { makeFileSystemAsyncAdapter, makeFileSystemSyncAdapter } from "./adapter.js";
import { esmFileFormat, extractNameAndSubpath, lookupPackageScope, packageExportsResolve, packageImportsResolve, readPackageJson, resolveDirectoryLinks, resolveFileLinks } from "./esm.js";
import { nodeCoreModules } from "./node-modules.js";

// https://nodejs.org/api/modules.html#all-together

const defaultConditions = [ "node", "require" ];

export async function resolve(fs: FileSystemAsync, specifier: string, parentURL: URL): Promise<Resolution> {
	return task(() => resolver(makeFileSystemAsyncAdapter(fs), specifier, parentURL));
}

export function resolveSync(fs: FileSystemSync, specifier: string, parentURL: URL): Resolution {
	return expect(begin(task(() => resolver(makeFileSystemSyncAdapter(fs), specifier, parentURL))));
}

// require(X) from module at path Y
// X = parentURL + fragment
function *resolver(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution> {
	// 1. If X is a core module,
	//   a. return the core module
	//   b. STOP
	if (fragment.startsWith("node:")) {
		return { format: "builtin", url: new URL(encodeFragment(fragment)) };
	} else if (nodeCoreModules.includes(fragment)) {
		return { format: "builtin", url: new URL(`node:${encodeFragment(fragment)}`) };
	}

	// 2. If X begins with '/'
	if (fragment.startsWith("/")) {
		// a. set Y to be the file system root
		parentURL = new URL("/", parentURL);
	}

	// 3. If X begins with './' or '/' or '../'
	if (fragment.startsWith("./") || fragment.startsWith("../")) {
		// a. LOAD_AS_FILE(Y + X)
		const asFile = yield* loadAsFile(fs, fragment, parentURL);
		if (asFile) {
			return asFile;
		}

		// b. LOAD_AS_DIRECTORY(Y + X)
		const asDirectory = yield* loadAsDirectory(fs, new URL(`${encodeFragment(fragment)}/`, parentURL));
		if (asDirectory) {
			return asDirectory;
		}

		// c. THROW "not found"
		throw new Error("not found");
	}

	// 4. If X begins with '#'
	if (fragment.startsWith("#")) {
		// a. LOAD_PACKAGE_IMPORTS(X, dirname(Y))
		const asPackageImports = yield* loadPackageImports(fs, fragment, new URL(".", parentURL));
		if (asPackageImports) {
			return asPackageImports;
		}
	}

	// 5. LOAD_PACKAGE_SELF(X, dirname(Y))
	const asSelf = yield* loadPackageSelf(fs, fragment, new URL(".", parentURL));
	if (asSelf) {
		return asSelf;
	}

	// 6. LOAD_NODE_MODULES(X, dirname(Y))
	const asNodeModules = yield* loadNodeModules(fs, fragment, new URL(".", parentURL));
	if (asNodeModules) {
		return asNodeModules;
	}

	// 7. THROW "not found"
	throw new Error("not found");
}

// MAYBE_DETECT_AND_LOAD(X)
function maybeDetectAndLoad(fs: FileSystemTask, file: URL) {
	// nb: Omitted.
	return loadWithFormat(fs, file);
	// 1. If X parses as a CommonJS module, load X as a CommonJS module. STOP.
	// 2. Else, if the source code of X can be parsed as ECMAScript module using
	//    DETECT_MODULE_SYNTAX defined in the ESM resolver
	//   a. Load X as an ECMAScript module. STOP.
	// 3. THROW the SyntaxError from attempting to parse X as CommonJS in 1. STOP.
}

// LOAD_AS_FILE(X)
// X = parentURL + fragment
function *loadAsFile(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution | undefined> {
	const encodedFragment = encodeFragment(fragment);
	// 1. If X is a file, load X as its file extension format. STOP
	const asFile = new URL(encodedFragment, parentURL);
	if (yield* fs.fileExists(asFile)) {
		const realname = yield* resolveFileLinks(fs, asFile);
		return yield* loadWithFormat(fs, realname);
	}

	// 2. If X.js is a file,
	const asJsFile = new URL(`${encodedFragment}.js`, parentURL);
	if (yield* fs.fileExists(asJsFile)) {
		const realname = yield* resolveFileLinks(fs, asJsFile);
		// a. Find the closest package scope SCOPE to X.
		const packageURL = yield* lookupPackageScope(fs, parentURL);
		// b. If no scope was found
		if (packageURL === null) {
			// 1. MAYBE_DETECT_AND_LOAD(X.js)
			return yield* maybeDetectAndLoad(fs, realname);
		}
		// c. If the SCOPE/package.json contains "type" field,
		const pjson = yield* readPackageJson(fs, packageURL);
		if (pjson?.type === "module") {
			//   1. If the "type" field is "module", load X.js as an ECMAScript module. STOP.
			return { format: "module", url: realname };
		} else if (pjson?.type === "commonjs") {
			// 2. If the "type" field is "commonjs", load X.js as an CommonJS module. STOP.
			return { format: "commonjs", url: realname };
		}
		// d. MAYBE_DETECT_AND_LOAD(X.js)
		return yield* maybeDetectAndLoad(fs, realname);
	}

	// 3. If X.json is a file, parse X.json to a JavaScript Object. STOP
	const asJsonFile = new URL(`${encodedFragment}.json`, parentURL);
	if (yield* fs.fileExists(asJsonFile)) {
		const realname = yield* resolveFileLinks(fs, asJsonFile);
		return { format: "json", url: realname };
	}

	// 4. If X.node is a file, load X.node as binary addon. STOP
	const asNodeFile = new URL(`${encodedFragment}.node`, parentURL);
	if (yield* fs.fileExists(asNodeFile)) {
		const realname = yield* resolveFileLinks(fs, asNodeFile);
		return { format: "builtin", url: realname };
	}
}

// LOAD_INDEX(X)
// X = parentURL + fragment
function *loadIndex(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution | undefined> {
	const encodedFragment = encodeFragment(fragment);
	// 1. If X/index.js is a file
	const asJsIndex = new URL(`${encodedFragment}/index.js`, parentURL);
	if (yield* fs.fileExists(asJsIndex)) {
		const realname = yield* resolveFileLinks(fs, asJsIndex);
		// a. Find the closest package scope SCOPE to X.
		const packageURL = yield* lookupPackageScope(fs, parentURL);
		// b. If no scope was found, load X/index.js as a CommonJS module. STOP.
		if (packageURL === null) {
			return { format: "commonjs", url: realname };
		}
		// c. If the SCOPE/package.json contains "type" field,
		const pjson = yield* readPackageJson(fs, packageURL);
		if (pjson?.type === "module") {
			// 1. If the "type" field is "module", load X/index.js as an ECMAScript module. STOP.
			return { format: "module", url: realname };
		} else {
			// 2. Else, load X/index.js as an CommonJS module. STOP.
			return { format: "commonjs", url: realname };
		}
	}

	// 2. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
	const asJsonIndex = new URL(`${encodedFragment}/index.json`, parentURL);
	if (yield* fs.fileExists(asJsonIndex)) {
		const realname = yield* resolveFileLinks(fs, asJsonIndex);
		return { format: "json", url: realname };
	}

	// 3. If X/index.node is a file, load X/index.node as binary addon. STOP
	const asNodeIndex = new URL(`${encodedFragment}/index.node`, parentURL);
	if (yield* fs.fileExists(asNodeIndex)) {
		const realname = yield* resolveFileLinks(fs, asNodeIndex);
		return { format: "addon", url: realname };
	}
}

// LOAD_AS_DIRECTORY(X)
function *loadAsDirectory(fs: FileSystemTask, path: URL): Task<Resolution | undefined> {
	// 1. If X/package.json is a file,
	//   a. Parse X/package.json, and look for "main" field.
	const pjson = yield* readPackageJson(fs, path);
	//   b. If "main" is a falsy value, GOTO 2.
	if (typeof pjson?.name === "string") {
		// c. let M = X + (json main field)
		// d. LOAD_AS_FILE(M)
		const asFile = yield* loadAsFile(fs, pjson.name, path);
		if (asFile) {
			return asFile;
		}

		// e. LOAD_INDEX(M)
		const asIndex = yield* loadIndex(fs, pjson.name, path);
		if (asIndex) {
			return asIndex;
		}

		// f. LOAD_INDEX(X) DEPRECATED
		const asDeprecatedIndex = yield* loadIndex(fs, ".", path);
		if (asDeprecatedIndex) {
			return asDeprecatedIndex;
		}

		// g. THROW "not found"
		throw new Error("not found");
	}
	// 2. LOAD_INDEX(X)
	return yield* loadIndex(fs, ".", path);
}

function *loadWithFormat(fs: FileSystemTask, url: URL): Task<Resolution> {
	// nb: The algorithm doesn't specify this but the implementation seems to do something similar.
	// You cannot require a bare `.js` file from a `.cjs` parent with a `{"type":"module"}`
	// `package.json`.
	const format = yield* esmFileFormat(fs, url);
	return { format, url };
}

// LOAD_NODE_MODULES(X, START)
function *loadNodeModules(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution | undefined> {
	const parts = extractNameAndSubpath(fragment);
	if (!parts) {
		return;
	}
	const subpathFragment = parts.subpath.slice(1);

	// 1. let DIRS = NODE_MODULES_PATHS(START)
	// 2. for each DIR in DIRS:
	for (const dir of nodeModulesPaths(parentURL)) {
		// Not specified, but crucial for performance in CJS graphs. Otherwise the following
		// branches check a ton of files that will never exist.
		if (!(yield* fs.directoryExists(dir))) {
			continue;
		}
		const realname = yield* resolveDirectoryLinks(fs, new URL(encodeFragment(`${parts.name}/`), dir));

		// a. LOAD_PACKAGE_EXPORTS(X, DIR)
		const asPackageExports = yield* loadPackageExports(fs, parts.subpath, realname);
		if (asPackageExports) {
			return asPackageExports;
		}

		// b. LOAD_AS_FILE(DIR/X)
		const asFile = yield* loadAsFile(fs, subpathFragment, realname);
		if (asFile) {
			return asFile;
		}

		// c. LOAD_AS_DIRECTORY(DIR/X)
		const asDirectory = yield* loadAsDirectory(fs, new URL(`${encodeFragment(subpathFragment)}/`, realname));
		if (asDirectory) {
			return asDirectory;
		}
	}
}

// NODE_MODULES_PATHS(START)
function *nodeModulesPaths(path: URL) {
	// 1. let PARTS = path split(START)
	// 2. let I = count of PARTS - 1
	// 3. let DIRS = []
	// 4. while I >= 0,
	const sentinel = new URL("/", path);
	do {
		// a. if PARTS[I] = "node_modules", GOTO d.
		if (!path.pathname.endsWith("/node_modules/")) {
			// b. DIR = path join(PARTS[0 .. I] + "node_modules")
			// c. DIRS = DIR + DIRS
			yield new URL("node_modules/", path);
		}
		// d. let I = I - 1
		path = new URL("..", path);
	} while (path.href !== sentinel.href);
	// 5. return DIRS + GLOBAL_FOLDERS
}

// LOAD_PACKAGE_IMPORTS(X, DIR)
function *loadPackageImports(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution | undefined> {
	// 1. Find the closest package scope SCOPE to DIR.
	const packageURL = yield* lookupPackageScope(fs, parentURL);

	// 2. If no scope was found, return.
	if (packageURL === null) {
		return;
	}

	// 3. If the SCOPE/package.json "imports" is null or undefined, return.
	const pjson = yield* readPackageJson(fs, packageURL);
	if (pjson?.imports == null) {
		return;
	}

	// 4. If `--experimental-require-module` is enabled
	//   a. let CONDITIONS = ["node", "require", "module-sync"]
	//   b. Else, let CONDITIONS = ["node", "require"]
	// nb: Omitted

	// 5. let MATCH = PACKAGE_IMPORTS_RESOLVE(X, pathToFileURL(SCOPE), CONDITIONS) [defined in the ESM resolver]
	const match = yield* packageImportsResolve(fs, fragment, packageURL, [ "node", "require" ]);

	// 6. RESOLVE_ESM_MATCH(MATCH).
	return yield* resolveEsmMatch(fs, match);
}

// LOAD_PACKAGE_EXPORTS(X, DIR)
function *loadPackageExports(fs: FileSystemTask, subpath: string, parentURL: URL): Task<Resolution | undefined> {

	// 3. Parse DIR/NAME/package.json, and look for "exports" field.
	const pjson = yield* readPackageJson(fs, parentURL);
	if (pjson === null) {
		return;
	}

	// 4. If "exports" is null or undefined, return.
	if (pjson.exports == null) {
		return;
	}

	// 5. If `--experimental-require-module` is enabled
	//  a. let CONDITIONS = ["node", "require", "module-sync"]
	//  b. Else, let CONDITIONS = ["node", "require"]
	// nb: Omitted
	const conditions = [ "node", "require" ];

	// 6. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(DIR/NAME), "." + SUBPATH, `package.json`
	//    "exports", CONDITIONS) defined in the ESM resolver.
	const match = yield* packageExportsResolve(fs, parentURL, `.${subpath}`, pjson.exports, conditions);

	// 7. RESOLVE_ESM_MATCH(MATCH)
	return yield* resolveEsmMatch(fs, match);
}

// LOAD_PACKAGE_SELF(X, DIR)
function *loadPackageSelf(fs: FileSystemTask, fragment: string, parentURL: URL): Task<Resolution | undefined> {
	// 1. Find the closest package scope SCOPE to DIR.
	const packageURL = yield* lookupPackageScope(fs, parentURL);

	// 2. If no scope was found, return.
	if (packageURL === null) {
		return;
	}

	// 3. If the SCOPE/package.json "exports" is null or undefined, return.
	const pjson = yield* readPackageJson(fs, packageURL);
	if (pjson?.exports == null) {
		return;
	}

	// 4. If the SCOPE/package.json "name" is not the first segment of X, return.
	if (
		typeof pjson.name !== "string" ||
		(fragment !== pjson.name && !fragment.startsWith(`${pjson.name}/`))
	) {
		return;
	}

	// 5. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(SCOPE), "." + X.slice("name".length),
	//    `package.json` "exports", ["node", "require"]) defined in the ESM resolver.
	const match = yield* packageExportsResolve(fs, packageURL, `.${fragment.slice(pjson.name.length)}`, pjson.exports, defaultConditions);

	// 6. RESOLVE_ESM_MATCH(MATCH)
	return yield* resolveEsmMatch(fs, match);
}

// RESOLVE_ESM_MATCH(MATCH)
function *resolveEsmMatch(fs: FileSystemTask, match: URL): Task<Resolution> {
	// 1. let RESOLVED_PATH = fileURLToPath(MATCH)
	// 2. If the file at RESOLVED_PATH exists, load RESOLVED_PATH as its extension format. STOP
	if (yield* fs.fileExists(match)) {
		const realname = yield* resolveFileLinks(fs, match);
		return yield* loadWithFormat(fs, realname);
	}

	// 3. THROW "not found"
	throw new Error("not found");
}

/**
 * CommonJS resolves based on file names, but ESM is URL-native. This function encodes a `require`
 * specifier as a URL fragment in a way that file names will be preserved through `URL`.
 */
function encodeFragment(fragment: string) {
	const encodeOneCharacter = (char: string) => `%${char.charCodeAt(0).toString(16)}`;
	const encodeOneOrMoreCharacters = (string: string) => string.length === 1
		? encodeOneCharacter(string)
		: string.replace(/[^]/g, encodeOneCharacter);
	// See: https://url.spec.whatwg.org/#concept-basic-url-parser
	// "Remove any leading and trailing C0 control or space from input."
	// "Remove all ASCII tab or newline from input."
	// Therefore: Leading control characters must be encoded, as well as newlines and tabs, and %'s
	// of course.
	return fragment.replace(/^[\x00-\x20%]+|[\r\n\t%]/g, encodeOneOrMoreCharacters);
}
