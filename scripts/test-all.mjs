import { isMainModule } from './project.mjs';
import { runBrowserTests } from './test-browser.mjs';
import { testInstalledExtension } from './test-extension.mjs';
import { validateManifest } from './validate-manifest.mjs';

export async function runAllTests() {
  const validation = await validateManifest();
  console.log(`Manifest ${validation.manifest.version} is valid.`);
  await runBrowserTests();
  return testInstalledExtension();
}

if (isMainModule(import.meta.url)) {
  runAllTests().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
