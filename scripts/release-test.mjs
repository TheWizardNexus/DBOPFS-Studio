import { isMainModule, relativePath } from './project.mjs';
import { combineTestResults, printTestSummary } from '../tests/extension/harness.mjs';
import { runBrowserTests } from './test-browser.mjs';
import { testInstalledExtension } from './test-extension.mjs';
import { validateRelease } from './validate-release.mjs';

export async function testRelease() {
  const validation = await validateRelease();
  console.log(`Release ${validation.manifest.version} static validation passed.`);
  const browserResult = await runBrowserTests({ coverage: true, threshold: 60 });
  let installedResult;
  try {
    installedResult = await testInstalledExtension();
  } catch (error) {
    if (error?.testResult) {
      const partialResult = combineTestResults(browserResult, error.testResult);
      printTestSummary(partialResult, 'RELEASE TESTS PARTIAL');
      error.testResult = partialResult;
    }
    throw error;
  }
  const testResult = combineTestResults(browserResult, installedResult);
  printTestSummary(testResult, 'RELEASE TESTS');
  if (testResult.failed) {
    const error = new Error(`${testResult.failed} of ${testResult.total} release tests failed.`);
    error.testResult = testResult;
    throw error;
  }
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
