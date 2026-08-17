import { isMainModule } from './project.mjs';
import { combineTestResults, printTestSummary } from '../tests/extension/harness.mjs';
import { runBrowserTests } from './test-browser.mjs';
import { testInstalledExtension } from './test-extension.mjs';
import { validateManifest } from './validate-manifest.mjs';
import { validateStoreAssets } from './validate-store-assets.mjs';

export async function runAllTests() {
  const validation = await validateManifest();
  console.log(`Manifest ${validation.manifest.version} is valid.`);
  const storeAssets = await validateStoreAssets();
  console.log(`Store assets are valid (${storeAssets.files} PNG files).`);
  const browserResult = await runBrowserTests();
  let installedResult;
  try {
    installedResult = await testInstalledExtension();
  } catch (error) {
    if (error?.testResult) {
      const partialResult = combineTestResults(browserResult, error.testResult);
      printTestSummary(partialResult, 'ALL TESTS PARTIAL');
      error.testResult = partialResult;
    }
    throw error;
  }
  const result = combineTestResults(browserResult, installedResult);
  printTestSummary(result, 'ALL TESTS');
  if (result.failed) {
    const error = new Error(`${result.failed} of ${result.total} Studio tests failed.`);
    error.testResult = result;
    throw error;
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  runAllTests().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
