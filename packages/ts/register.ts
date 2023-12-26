import { register } from "node:module";

// I can not believe they did this.
register("@loaderkit/ts", {
	parentURL: import.meta.url,
});
