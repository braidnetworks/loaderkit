import { register } from "node:module";

register("@loaderkit/ts/loader", {
	parentURL: import.meta.url,
});
