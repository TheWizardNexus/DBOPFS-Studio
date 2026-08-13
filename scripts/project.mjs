import { access, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(scriptsDirectory, '..');
export const extensionRoot = resolveFromProject(
  process.env.DBOPFS_EXTENSION_DIR || 'extension'
);
export const pagesRoot = resolveFromProject(process.env.DBOPFS_PAGES_DIR || 'docs');

export function resolveFromProject(value) {
  return path.resolve(projectRoot, value);
}

export function isMainModule(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === metaUrl;
}

export async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  const source = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${relativePath(filePath)} is not valid JSON: ${error.message}`);
  }
}

export async function walkFiles(root, options = {}) {
  const includeHidden = options.includeHidden ?? true;
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in release inputs: ${relativePath(absolutePath)}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  const rootStats = await lstat(root);
  if (!rootStats.isDirectory()) {
    throw new Error(`${relativePath(root)} must be a directory.`);
  }
  await visit(root);
  return files;
}

export function relativePath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

export function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes ${relativePath(root)}: ${candidate}`);
  }
}
