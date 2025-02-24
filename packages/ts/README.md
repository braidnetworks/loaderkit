[![npm version](https://badgen.now.sh/npm/v/@loaderkit/ts)](https://www.npmjs.com/package/@loaderkit/ts)
[![isc license](https://badgen.now.sh/npm/license/@loaderkit/ts)](https://github.com/braidnetworks/loaderkit/blob/main/LICENSE)
[![github action](https://github.com/braidnetworks/loaderkit/actions/workflows/build.yaml/badge.svg)](https://github.com/braidnetworks/loaderkit/actions/workflows/build.yaml)
[![npm downloads](https://badgen.now.sh/npm/dm/@loaderkit/ts)](https://www.npmjs.com/package/@loaderkit/ts)

🐘 @loaderkit/ts - A nodejs loader for TypeScript
=================================================

This is a simple loader for well-configured TypeScript projects running in nodejs.

This loader does not perform any type checking. It only performs transpilation. A well-configured
project should run `tsc -b -w` in a separate process.

This loader should only be used in projects which use ECMAScript modules. A well-configured project
should not be using CommonJS.

Source maps are passed along in the transpilation process, so the `--enable-source-maps` nodejs flag
is recommended.

An extra degree of care has been taken to ensure that `import.meta.url` is correct. My belief is
that the behavior of your program should not be different between development and production
versions. And I don't think that this should be controversial either. So, when an output destination
is specified in the nearest `tsconfig.json` then `import.meta.url` will be the value it would have
been if run from the `tsc`-transpiled output.


EXAMPLE
-------

`main.ts`
```ts
const value: string = 'hello world';
console.log(value);
```

```
$ node --import @loaderkit/ts test.ts
hello world
```
