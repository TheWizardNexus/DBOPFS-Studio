import path from 'node:path';
import { extensionRoot, isMainModule, readJson } from './project.mjs';

export async function checkReleaseTag(tag = process.argv[2]) {
  const manifest = await readJson(path.join(extensionRoot, 'manifest.json'));
  const expected = `v${manifest.version}`;
  if (tag !== expected) {
    throw new Error(`Release tag ${tag || '(missing)'} must exactly match ${expected}.`);
  }
  console.log(`Release tag ${tag} matches manifest version ${manifest.version}.`);
  return manifest.version;
}

if (isMainModule(import.meta.url)) {
  checkReleaseTag().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
