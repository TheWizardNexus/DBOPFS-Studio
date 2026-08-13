import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import {
  extensionRoot,
  isMainModule,
  projectRoot,
  relativePath
} from './project.mjs';
import { validateManifest } from './validate-manifest.mjs';

const deterministicTimestamp = new Date('2000-01-01T00:00:00.000Z');

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function ensureSafeArchiveName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
}

export async function packageExtension(options = {}) {
  const validation = await validateManifest(options.root || extensionRoot);
  const root = validation.root;
  const defaultOutput = path.join(
    projectRoot,
    'artifacts',
    `dbopfs-studio-${validation.manifest.version}.zip`
  );
  const outputPath = path.resolve(options.output || defaultOutput);
  const entries = {};

  for (const filePath of validation.files) {
    const name = path.relative(root, filePath).split(path.sep).join('/');
    ensureSafeArchiveName(name);
    entries[name] = [new Uint8Array(await readFile(filePath)), {
      mtime: deterministicTimestamp,
      mode: 0o644
    }];
  }

  const archive = zipSync(entries, { level: 9 });
  const unpacked = unzipSync(archive);
  const expectedNames = Object.keys(entries).sort();
  const actualNames = Object.keys(unpacked).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw new Error('The generated archive does not match the validated extension file list.');
  }
  if (!unpacked['manifest.json']) {
    throw new Error('The generated archive does not contain manifest.json at its root.');
  }
  const archivedManifest = JSON.parse(new TextDecoder().decode(unpacked['manifest.json']));
  if (archivedManifest.version !== validation.manifest.version) {
    throw new Error('The archived manifest version changed during packaging.');
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive);
  const digest = createHash('sha256').update(archive).digest('hex');
  const checksumPath = `${outputPath}.sha256`;
  const checksum = `${digest}  ${path.basename(outputPath)}\n`;
  await writeFile(checksumPath, checksum);
  const savedArchive = await readFile(outputPath);
  const savedDigest = createHash('sha256').update(savedArchive).digest('hex');
  const savedChecksum = await readFile(checksumPath, 'utf8');
  if (savedDigest !== digest || savedChecksum !== checksum) {
    throw new Error('The saved extension archive or checksum does not match the generated digest.');
  }
  return {
    bytes: archive.byteLength,
    checksumPath,
    digest,
    files: actualNames.length,
    manifest: validation.manifest,
    outputPath
  };
}

if (isMainModule(import.meta.url)) {
  packageExtension({ output: optionValue('--output') })
    .then((result) => {
      console.log(`Packaged ${result.files} files as ${relativePath(result.outputPath)}.`);
      console.log(`SHA-256 ${result.digest}`);
      console.log(`Checksum ${relativePath(result.checksumPath)}.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
