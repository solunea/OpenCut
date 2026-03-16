import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

interface ZipEntry {
	name: string;
	data: Buffer;
	crc32: number;
	compressedData: Buffer;
	compressedSize: number;
	uncompressedSize: number;
	modTime: number;
	modDate: number;
	offset: number;
}

const repoRoot = resolve(import.meta.dir, "../../..");
const sourceDir = resolve(repoRoot, "apps/chrome-extension");
const outputFile = resolve(
	repoRoot,
	"apps/web/public/downloads/opencut-cursor-tracker.zip",
);

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function getCrc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date: Date): { modTime: number; modDate: number } {
	const year = Math.max(1980, date.getFullYear());
	const modTime =
		(date.getHours() << 11) |
		(date.getMinutes() << 5) |
		Math.floor(date.getSeconds() / 2);
	const modDate =
		((year - 1980) << 9) |
		((date.getMonth() + 1) << 5) |
		date.getDate();
	return { modTime, modDate };
}

function shouldInclude(relativePath: string): boolean {
	return !(
		relativePath.startsWith("node_modules/") ||
		relativePath.endsWith(".zip") ||
		relativePath.endsWith("Thumbs.db") ||
		relativePath.endsWith(".DS_Store")
	);
}

function collectFiles(directory: string): string[] {
	const entries = readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name));
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(fullPath));
			continue;
		}
		if (entry.isFile()) {
			files.push(fullPath);
		}
	}

	return files;
}

function createZipEntries(files: string[]): ZipEntry[] {
	let offset = 0;

	return files.map((filePath) => {
		const data = readFileSync(filePath);
		const stats = statSync(filePath);
		const fileName = relative(sourceDir, filePath).replaceAll("\\", "/");
		const compressedData = deflateRawSync(data);
		const fileNameBuffer = Buffer.from(fileName, "utf8");
		const { modTime, modDate } = getDosDateTime(stats.mtime);
		const entry: ZipEntry = {
			name: fileName,
			data,
			crc32: getCrc32(data),
			compressedData,
			compressedSize: compressedData.length,
			uncompressedSize: data.length,
			modTime,
			modDate,
			offset,
		};
		offset += 30 + fileNameBuffer.length + compressedData.length;
		return entry;
	});
}

function buildLocalHeader(entry: ZipEntry): Buffer {
	const fileNameBuffer = Buffer.from(entry.name, "utf8");
	const header = Buffer.alloc(30);
	header.writeUInt32LE(0x04034b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(0, 6);
	header.writeUInt16LE(8, 8);
	header.writeUInt16LE(entry.modTime, 10);
	header.writeUInt16LE(entry.modDate, 12);
	header.writeUInt32LE(entry.crc32, 14);
	header.writeUInt32LE(entry.compressedSize, 18);
	header.writeUInt32LE(entry.uncompressedSize, 22);
	header.writeUInt16LE(fileNameBuffer.length, 26);
	header.writeUInt16LE(0, 28);
	return Buffer.concat([header, fileNameBuffer, entry.compressedData]);
}

function buildCentralHeader(entry: ZipEntry): Buffer {
	const fileNameBuffer = Buffer.from(entry.name, "utf8");
	const header = Buffer.alloc(46);
	header.writeUInt32LE(0x02014b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(20, 6);
	header.writeUInt16LE(0, 8);
	header.writeUInt16LE(8, 10);
	header.writeUInt16LE(entry.modTime, 12);
	header.writeUInt16LE(entry.modDate, 14);
	header.writeUInt32LE(entry.crc32, 16);
	header.writeUInt32LE(entry.compressedSize, 20);
	header.writeUInt32LE(entry.uncompressedSize, 24);
	header.writeUInt16LE(fileNameBuffer.length, 28);
	header.writeUInt16LE(0, 30);
	header.writeUInt16LE(0, 32);
	header.writeUInt16LE(0, 34);
	header.writeUInt16LE(0, 36);
	header.writeUInt32LE(0, 38);
	header.writeUInt32LE(entry.offset, 42);
	return Buffer.concat([header, fileNameBuffer]);
}

function buildZip(entries: ZipEntry[]): Buffer {
	const localParts = entries.map(buildLocalHeader);
	const centralParts = entries.map(buildCentralHeader);
	const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
	const centralDirectoryOffset = localParts.reduce((sum, part) => sum + part.length, 0);
	const endRecord = Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054b50, 0);
	endRecord.writeUInt16LE(0, 4);
	endRecord.writeUInt16LE(0, 6);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectorySize, 12);
	endRecord.writeUInt32LE(centralDirectoryOffset, 16);
	endRecord.writeUInt16LE(0, 20);
	return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

const sourceFiles = collectFiles(sourceDir).filter((filePath) => {
	const relativePath = relative(sourceDir, filePath).replaceAll("\\", "/");
	return shouldInclude(relativePath);
});

if (sourceFiles.length === 0) {
	throw new Error("No Chrome extension files were found to package");
}

const zipEntries = createZipEntries(sourceFiles);
const zipBuffer = buildZip(zipEntries);
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, zipBuffer);

console.log(
	`Packaged OpenCut Cursor Tracker (${zipEntries.length} files) -> ${relative(repoRoot, outputFile).replaceAll("\\", "/")}`,
);
