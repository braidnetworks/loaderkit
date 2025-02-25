import type { FileSystemAsync, FileSystemSync, FileSystemTask } from "./fs.js";
import type { Task } from "@braidai/lang/task/utility";
import { accept } from "@braidai/lang/task/utility";

export function makeTestFileSystem(files: Record<string, string>): FileSystemSync {
	const checkProto = (url: URL) => {
		if (url.protocol !== "file:") {
			throw new Error(`Unsupported protocol: ${url.protocol}`);
		}
	};

	// Convert URL path to an actual "file" name
	const extractPath = (url: URL) => decodeURIComponent(url.pathname.slice(1));

	// By convention a directory URL ends with a slash. This removes it, converting it to a "file".
	const dirToPath = (url: URL) => new URL(`file://${url.pathname.slice(0, -1)}`);

	// Resolves all links in the URL's path lineage
	const realName = (url: URL) => {
		// Flatten multiple slashes, which I guess is just how filesystems work.
		url = new URL(url.href.replace(/\/+/g, "/"));
		// Read direct file link
		const linked = fs.readLink(url);
		if (linked !== undefined) {
			return realName(new URL(linked, url));
		}
		// Walk parent directories
		let dir = new URL(".", url);
		while (dir.pathname !== "/") {
			const linked = fs.readLink(dirToPath(dir));
			if (linked === undefined) {
				dir = new URL("..", dir);
			} else {
				const base = function() {
					if (linked === "/") {
						return new URL("/", dir);
					} else if (linked.startsWith("/")) {
						return new URL(`${linked}/`, dir);
					} else if (linked.endsWith(".")) {
						return new URL(`../${linked}`, dir);
					} else {
						return new URL(`../${linked}/`, dir);
					}
				}();
				return realName(new URL(url.pathname.slice(dir.pathname.length), base));
			}
		}
		return url;
	};

	const readFileString = (path: URL) => {
		checkProto(path);
		const file = extractPath(realName(path));
		const content = files[file];
		if (content === undefined) {
			throw new Error(`File not found: ${file}`);
		}
		return content;
	};

	const fs: FileSystemSync = {
		directoryExists(path) {
			checkProto(path);
			if (!path.pathname.endsWith("/")) {
				return false;
			}
			const dir = extractPath(realName(path));
			return Object.keys(files).some(key => key.startsWith(dir));
		},
		fileExists(path) {
			checkProto(path);
			return extractPath(realName(path)) in files;
		},
		readFileJSON(path): unknown {
			return JSON.parse(readFileString(path));
		},
		readFileString,
		readLink(path) {
			checkProto(path);
			return files[`${extractPath(path)}*`];
		},
	};
	return fs;
}

export function makeAsyncFileSystemFromSyncForTesting(fs: FileSystemSync): FileSystemAsync {
	return {
		// eslint-disable-next-line @typescript-eslint/require-await
		directoryExists: async path => fs.directoryExists(path),
		// eslint-disable-next-line @typescript-eslint/require-await
		fileExists: async path => fs.fileExists(path),
		// eslint-disable-next-line @typescript-eslint/require-await
		readFileJSON: async path => fs.readFileJSON(path),
		// eslint-disable-next-line @typescript-eslint/require-await
		readLink: async path => fs.readLink(path),
		...fs.readFileString && {
			// eslint-disable-next-line @typescript-eslint/require-await
			readFileString: async path => fs.readFileString!(path),
		},
	};
}

/** @internal */
export function makeFileSystemSyncAdapter(fs: FileSystemSync): FileSystemTask {
	return {
		// eslint-disable-next-line require-yield
		*directoryExists(path: URL): Task<boolean> {
			return fs.directoryExists(path);
		},
		// eslint-disable-next-line require-yield
		*fileExists(path: URL): Task<boolean> {
			return fs.fileExists(path);
		},
		// eslint-disable-next-line require-yield
		*readFileJSON(path: URL): Task<unknown> {
			return fs.readFileJSON(path);
		},
		// eslint-disable-next-line require-yield
		*readLink(path: URL): Task<string | undefined> {
			return fs.readLink(path);
		},
	};
}

/** @internal */
export function makeFileSystemAsyncAdapter(fs: FileSystemAsync): FileSystemTask {
	return {
		*directoryExists(path: URL): Task<boolean> {
			return yield* accept(fs.directoryExists(path));
		},
		*fileExists(path: URL): Task<boolean> {
			return yield* accept(fs.fileExists(path));
		},
		*readFileJSON(path: URL): Task<unknown> {
			return yield* accept(fs.readFileJSON(path));
		},
		*readLink(path: URL): Task<string | undefined> {
			return yield* accept(fs.readLink(path));
		},
	};
}
