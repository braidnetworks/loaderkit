🐘 @loaderkit/ts - A nodejs loader for TypeScript
=================================================

This is a simple loader for well-configured TypeScript projects running in nodejs.

This loader does not perform any type checking. It only performs transpilation. A well-configured
project should run `tsc -b -w` in a separate process.

This loader should only be used in projects which use ECMAScript modules. A well-configured project
should not be using CommonJS.

Source maps are passed along in the transpilation process, so the `--enable-source-maps` nodejs flag
is recommended.

An extra degree of care has been taken to ensure that `import.meta.url`, and the internal `url`
values are reasonable. When an output destination is specified in the nearest `tsconfig.json` then
`import.meta.url` will be the value it would have been if run from the `tsc`-transpiled output. The
internal `url` property will be resolved to the TypeScript source file which ensures good support
with chained loaders such as [dynohot](https://github.com/braidnetworks/dynohot).


EXAMPLE
-------

`main.ts`
```ts
const value: string = 'hello world';
console.log(value);
```

```
$ node --import @loaderkit/ts/register test.ts
hello world
```

OR

```
$ node --loader @loaderkit/ts test.ts
hello world
```
