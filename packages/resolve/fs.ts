import type { Task } from "@braidai/lang/task/utility";
import * as fsS from "node:fs";
import * as fs from "node:fs/promises";

/** @internal */
export interface FileSystemTask {
	readonly directoryExists: (path: URL) => Task<boolean>;
	readonly fileExists: (path: URL) => Task<boolean>;
	readonly readFile: (path: URL) => Task<string>;
	readonly readLink?: (path: URL) => Task<string | undefined>;
}

export interface FileSystemAsync {
	readonly directoryExists: (path: URL) => Promise<boolean>;
	readonly fileExists: (path: URL) => Promise<boolean>;
	readonly readFile: (path: URL) => Promise<string>;
	readonly readLink?: (path: URL) => Promise<string | undefined>;
}

export interface FileSystemSync {
	readonly directoryExists: (path: URL) => boolean;
	readonly fileExists: (path: URL) => boolean;
	readonly readFile: (path: URL) => string;
	readonly readLink?: (path: URL) => string | undefined;
}

export const defaultAsyncFileSystem: FileSystemAsync = {
	directoryExists: async path => {
		try {
			const stat = await fs.stat(path);
			return stat.isDirectory();
		} catch {
			return false;
		}
	},

	fileExists: async path => {
		try {
			const stat = await fs.stat(path);
			return stat.isFile();
		} catch {
			return false;
		}
	},

	readFile: async path => fs.readFile(path, "utf8"),

	readLink: async path => {
		try {
			return await fs.readlink(path);
		} catch {
			return undefined;
		}
	},
};

export const defaultSyncFileSystem: FileSystemSync = {
	directoryExists: path => {
		try {
			const stat = fsS.statSync(path);
			return stat.isDirectory();
		} catch {
			return false;
		}
	},

	fileExists: path => {
		try {
			const stat = fsS.statSync(path);
			return stat.isFile();
		} catch {
			return false;
		}
	},

	readFile: path => fsS.readFileSync(path, "utf8"),

	readLink: path => {
		try {
			return fsS.readlinkSync(path);
		} catch {
			return undefined;
		}
	},
};
