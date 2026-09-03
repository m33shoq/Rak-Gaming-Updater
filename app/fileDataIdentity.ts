export function isSameFile(file1: FileData, file2: FileData): boolean {
	return file1.fileName === file2.fileName &&
		file1.displayName === file2.displayName &&
		file1.hash === file2.hash &&
		file1.relativePath === file2.relativePath;
}
