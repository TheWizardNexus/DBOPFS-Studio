import { isMainModule, relativePath } from './project.mjs';
import { runBrowserTests } from './test-browser.mjs';
import { testInstalledExtension } from './test-extension.mjs';
import { validateRelease } from './validate-release.mjs';

export async function testRelease() {
  const validation = await validateRelease();
  console.log(`Release ${validation.manifest.version} static validation passed.`);
  await runBrowserTests({ coverage: true, threshold: 60 });
  await testInstalledExtension();
  const packaged = await validateRelease({ package: true });
  console.log(`Release package verified: ${relativePath(packaged.package.outputPath)}`);
  console.log(`SHA-256 ${packaged.package.digest}`);
  console.log(`Checksum: ${relativePath(packaged.package.checksumPath)}`);
  return packaged;
}

if (isMainModule(import.meta.url)) {
  testRelease().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
