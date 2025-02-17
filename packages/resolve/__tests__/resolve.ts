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
		"node_modules/mod/package.json": JSON.stringify({ exports: { "./": "./index.js" } }),
		"node_modules/mod/index.js": "",
	});
	assert.throws(() => cjs("mod/", "main.js"));
	assert.throws(() => esm("mod/", "main.js"));
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
	});
	assert.strictEqual(esm("mod", "main.js").url.href, "file:///.pnpm/mod@1.0.0/node_modules/mod/index.js");
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
