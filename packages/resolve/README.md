🔎 @loaderkit/resolve - General purpose nodejs module resolver
==============================================================

An abstract implementation of the nodejs module resolution algorithms. It implements both the
[CommonJS](https://nodejs.org/api/modules.html#all-together) and
[modules](https://nodejs.org/api/esm.html#resolution-and-loading-algorithm) algorithms. Originally
authored for [arethetypeswrong](https://arethetypeswrong.github.io).

See also: [resolve](https://www.npmjs.com/package/resolve),
[enhanced-resolve](https://github.com/webpack/enhanced-resolve), and
[esm-resolve](https://www.npmjs.com/package/esm-resolve). This module addresses some complaints that
none of the other implementations fully implement:

- Web browser support
- Abstract filesystems
- Sensible TypeScript-first types
- Shakeable ESM exports
- Promise & synchronous implementations
