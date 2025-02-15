import type { FileSystemAsync, FileSystemSync, FileSystemTask } from "./fs.js";
import type { Task } from "@braidai/lang/task/utility";
import { accept } from "@braidai/lang/task/utility";

export function makeTestFileSystem(files: Record<string, string>) {
	const fs: FileSystemSync = {
		directoryExists(path) {
			if (!path.pathname.endsWith("/")) {
				return false;
			}
			const dir = decodeURIComponent(path.pathname.slice(1));
			return Object.keys(files).some(key => key.startsWith(dir));
		},
		fileExists(path) {
			return decodeURIComponent(path.pathname.slice(1)) in files;
		},
		readFile(path) {
			const file = decodeURIComponent(path.pathname.slice(1));
			const content = files[file];
			if (content === undefined) {
				throw new Error(`File not found: ${file}`);
			}
			return content;
		},
	};
	return fs;
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
		*readFile(path: URL): Task<string> {
			return fs.readFile(path);
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
		*readFile(path: URL): Task<string> {
			return yield* accept(fs.readFile(path));
		},
	};
}
