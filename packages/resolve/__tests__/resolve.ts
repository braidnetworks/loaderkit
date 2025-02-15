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
		"node_modules/mod/package.json": JSON.stringify({ exports: { ".": "./index.js" } }),
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
