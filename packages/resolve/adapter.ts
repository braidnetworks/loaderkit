import type { FileSystemAsync, FileSystemSync, FileSystemTask } from "./fs.js";
import type { Task } from "@braidai/lang/task/utility";
import { accept } from "@braidai/lang/task/utility";

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
