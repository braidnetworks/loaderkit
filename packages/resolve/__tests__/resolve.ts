import * as assert from "node:assert/strict";
import { test } from "node:test";
import { makeResolves } from "./__fixtures__/make.js";

await test("import self", () => {
	const { cjs } = makeResolves({
		"package.json": JSON.stringify({ name: "mod", exports: "./index.js" }),
		"index.js": "",
	});
	assert.strictEqual(cjs("mod", "main.js").url.href, "file:///index.js");

	const { esm } = makeResolves({
		"package.json": JSON.stringify({ name: "mod", type: "module", exports: "./index.js" }),
		"index.js": "",
	});
	assert.strictEqual(esm("mod", "main.js").url.href, "file:///index.js");
});

await test("shadowed core module", () => {
	const { cjs, esm } = makeResolves({
		"node_modules/util/package.json": JSON.stringify({ exports: { "./util": "./index.js" } }),
		"node_modules/util/index.js": "",
	});
	assert.strictEqual(cjs("util", "main.js").format, "builtin");
	assert.strictEqual(esm("util", "main.js").format, "builtin");

	assert.strictEqual(cjs("util/util", "main.js").url.href, "file:///node_modules/util/index.js");
	assert.strictEqual(esm("util/util", "main.js").url.href, "file:///node_modules/util/index.js");
});

await test("root node_modules", () => {
	const { cjs, esm } = makeResolves({
		"node_modules/mod/package.json": JSON.stringify({ exports: "./index.js" }),
		"node_modules/mod/index.js": "",
	});
	assert.strictEqual(cjs("mod", "main.js").url.href, "file:///node_modules/mod/index.js");
	assert.strictEqual(esm("mod", "main.js").url.href, "file:///node_modules/mod/index.js");
});

await test("trailing slash is not valid", () => {
	const { cjs, esm } = makeResolves({
		"node_modules/mod/package.json": JSON.stringify({
			exports: {
				"./*": "./index.js",
				"./test/": "./index.js",
			},
		}),
		"node_modules/mod/index.js": "",
		"package.json": JSON.stringify({
			imports: {
				"#test/*": "./index.js",
				"#test/test/": "./index.js",
			},
		}),
		"index.js": "",
	});
	assert.throws(() => cjs("mod/", "main.js"));
	assert.throws(() => cjs("mod/test/", "main.js"));
	assert.throws(() => cjs("mod/wildcard/", "main.js"));
	assert.throws(() => cjs("#test/", "main.js"));
	assert.throws(() => cjs("#test/test/", "main.js"));
	assert.throws(() => cjs("#test/wildcard/", "main.js"));
	assert.throws(() => esm("mod/", "main.js"));
	assert.throws(() => esm("mod/test/", "main.js"));
	assert.throws(() => esm("mod/wildcard/", "main.js"));
	assert.throws(() => esm("#test/", "main.js"));
	assert.throws(() => esm("#test/test/", "main.js"));
	assert.throws(() => esm("#test/wildcard/", "main.js"));
});

await test("trailing slash actually is valid sometimes", () => {
	const { cjs } = makeResolves({
		"node_modules/mod/package.json": JSON.stringify({}),
		"node_modules/mod/index.js": "",
	});
	cjs("mod/", "main.js");
});

await test("commonjs accepts package name that esm does not", () => {
	const { cjs, esm } = makeResolves({
		"node_modules/.mod/index.js": "",
	});
	cjs(".mod/", "main.js");
	assert.throws(() => esm(".mod/", "main.js"));
});

await test("unspecified legacy directory imports", () => {
	const { cjs, esm } = makeResolves({
		"node_modules/mod/package.json": "{}",
		"node_modules/mod/index.js": "",
	});
	cjs("mod", "main.js");
	esm("mod", "main.js");
});

await test("unspecified legacy main imports", () => {
	const packageJsons = [
		JSON.stringify({ main: "index" }),
		JSON.stringify({ type: "commonjs", main: "index" }),
	];
	for (const packageJson of packageJsons) {
		const { cjs, esm } = makeResolves({
			"node_modules/mod/package.json": packageJson,
			"node_modules/mod/index.js": "",
			"node_modules/mod/other.js": "",
		});
		cjs("mod", "main.js");
		cjs("mod/other", "main.js");
		esm("mod", "main.js");
		esm("mod/other", "main.js");
	}
});

await test("unspecified legacy main directory imports", () => {
	const packageJsons = [
		JSON.stringify({ main: "lib" }),
		JSON.stringify({ main: "lib/" }),
		JSON.stringify({ main: "./lib/" }),
	];
	for (const packageJson of packageJsons) {
		const { cjs, esm } = makeResolves({
			"node_modules/mod/package.json": packageJson,
			"node_modules/mod/lib/index.js": "",
		});
		cjs("mod", "main.js");
		esm("mod", "main.js");
	}
});

await test("any url", () => {
	const { esm } = makeResolves({});
	assert.strictEqual(esm("https://example.com/", "main.js").url.href, "https://example.com/");
});

await test("symlinked module", () => {
	const { esm } = makeResolves({
		".pnpm/mod@1.0.0/node_modules/mod/package.json": JSON.stringify({ exports: "./index.js" }),
		".pnpm/mod@1.0.0/node_modules/mod/index.js": "",
		"node_modules/mod*": "../.pnpm/mod@1.0.0/node_modules/mod",
		"node_modules/mod2*": "/.pnpm/mod@1.0.0/node_modules/mod",
	});
	assert.strictEqual(esm("mod", "main.js").url.href, "file:///.pnpm/mod@1.0.0/node_modules/mod/index.js");
	assert.strictEqual(esm("mod2", "main.js").url.href, "file:///.pnpm/mod@1.0.0/node_modules/mod/index.js");
});

await test("symlinked file", () => {
	const { cjs, esm } = makeResolves({
		"package.json": JSON.stringify({}),
		"real.js": "",
		"link.js*": "./real.js",
		"dir*": ".",
	});
	assert.strictEqual(cjs("./link.js", "main.js").url.href, "file:///real.js");
	assert.strictEqual(esm("./link.js", "main.js").url.href, "file:///real.js");
	// I explicitly do not care about this case. Only the file is resolved, not a full `basename`.
	assert.strictEqual(esm("./dir/link.js", "main.js").url.href, "file:///dir/link.js");
});

await test("main field", () => {
	const { cjs } = makeResolves({
		"package.json": JSON.stringify({ main: "./main.js" }),
		"main.js": "",
	});
	assert.strictEqual(cjs(".", "main.js").url.href, "file:///main.js");
});

await test("symlinked file format", () => {
	const { cjs, esm } = makeResolves({
		"package.json": JSON.stringify({}),
		"cjs.cjs": "",
		"cjs*": "cjs.cjs",
		"mjs.mjs": "",
		"mjs*": "mjs.mjs",
	});
	assert.strictEqual(cjs("./cjs", "main.js").format, "commonjs");
	assert.strictEqual(esm("./mjs", "main.js").format, "module");
});

await test("percent encoded is invalid", () => {
	const { esm } = makeResolves({
		"package.json": JSON.stringify({
			exports: "main.mjs",
		}),
		"a/b/main.mjs": "",
	});
	assert.throws(() => esm("./a%2fmain.mjs", "main.mjs").format, "esm");
	assert.throws(() => esm("./a%2Fmain.mjs", "main.mjs").format, "esm");
});
