import { readFileSync } from 'node:fs';
import VanillaTest from 'vanilla-test';

const vanillaTestMetadata = JSON.parse(readFileSync(
  new URL('./package.json', import.meta.resolve('vanilla-test')),
  'utf8'
));

export const SUITE_NAMES = Object.freeze([
  'Unit',
  'Functional',
  'Integration',
  'Regression'
]);

export const VANILLA_TEST_VERSION = vanillaTestMetadata.version;
const REQUIRED_VANILLA_TEST_VERSION = '2.1.0';

export function assert(condition, message = 'Assertion failed.') {
  if (!condition) {
    throw new Error(message);
  }
}

export function requirePassingCase(detail, continuation) {
  assert(
    detail?.status === 'passed',
    `Cannot ${continuation}: prerequisite case ${detail?.id || 'unknown'} failed.`
  );
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
    stack: error instanceof Error ? error.stack || null : null
  };
}

function summarize(details) {
  return SUITE_NAMES.map((name) => {
    const suiteDetails = details.filter((detail) => detail.suite === name);
    const failed = suiteDetails.filter((detail) => detail.status === 'failed').length;
    return {
      failed,
      name,
      passed: suiteDetails.length - failed,
      total: suiteDetails.length
    };
  });
}

function validateCase(registry, suite, id, description, operation) {
  assert(SUITE_NAMES.includes(suite), `Unknown installed-extension suite: ${suite}.`);
  assert(typeof id === 'string' && id.length > 0,
    'Installed-extension cases require a stable ID.');
  assert(typeof description === 'string' && description.length > 0,
    `${id} requires a test description.`);
  assert(typeof operation === 'function', `${id} requires a test operation.`);
  assert(!registry.ids.has(id), `Duplicate installed-extension test ID: ${id}.`);
  assert(!registry.descriptions.has(description),
    `Duplicate installed-extension test description: ${description}.`);
  registry.ids.add(id);
  registry.descriptions.add(description);
}

export function createExtensionHarness() {
  assert(
    VANILLA_TEST_VERSION === REQUIRED_VANILLA_TEST_VERSION,
    `Installed-extension tests require vanilla-test ${REQUIRED_VANILLA_TEST_VERSION}.`
  );
  const framework = new VanillaTest();
  const details = [];
  const registry = {
    descriptions: new Set(),
    ids: new Set()
  };
  let reported = false;

  async function runCase(suite, id, description, operation) {
    assert(!reported, 'Installed-extension cases cannot run after their report.');
    validateCase(registry, suite, id, description, operation);
    const descriptor = `[${suite}] ${description}`;
    framework.expects(descriptor);
    let detail;

    try {
      await operation();
      framework.pass();
      detail = { description, error: null, id, status: 'passed', suite };
    } catch (error) {
      framework.fail();
      detail = {
        description,
        error: serializeError(error),
        id,
        status: 'failed',
        suite
      };
    } finally {
      framework.done();
    }

    details.push(detail);
    return detail;
  }

  async function runRequiredCase(suite, id, description, operation, continuation) {
    const detail = await runCase(suite, id, description, operation);
    requirePassingCase(detail, continuation);
    return detail;
  }

  function report() {
    assert(!reported, 'Installed-extension results can only be reported once.');
    reported = true;
    const frameworkResults = framework.report();
    const suites = summarize(details);
    return {
      complete: true,
      details,
      failed: frameworkResults.failureCount,
      framework: {
        name: 'vanilla-test',
        results: frameworkResults,
        version: VANILLA_TEST_VERSION
      },
      passed: frameworkResults.total - frameworkResults.failureCount,
      suites,
      total: frameworkResults.total
    };
  }

  return { report, runCase, runRequiredCase };
}

function resultSuites(result) {
  assert(Array.isArray(result?.suites), 'A test result is missing suite totals.');
  assert(result.suites.length === SUITE_NAMES.length,
    'Test results must contain exactly four suites.');
  assert(result.suites.every((suite, index) => suite.name === SUITE_NAMES[index]),
    'Test result suites are out of order.');
  return result.suites;
}

export function combineTestResults(...results) {
  const filtered = results.filter(Boolean);
  assert(filtered.length > 0, 'At least one test result is required.');
  const details = filtered.flatMap((result) => result.details || []);
  const ids = new Set();
  const descriptions = new Set();

  for (const detail of details) {
    assert(typeof detail.id === 'string' && detail.id.length > 0,
      'Combined test details require stable IDs.');
    assert(typeof detail.description === 'string' && detail.description.length > 0,
      `${detail.id} has no combined test description.`);
    assert(SUITE_NAMES.includes(detail.suite), `${detail.id} has an unknown suite.`);
    assert(['failed', 'passed'].includes(detail.status),
      `${detail.id} has an unknown test status.`);
    assert(!ids.has(detail.id), `Duplicate combined test ID: ${detail.id}.`);
    assert(!descriptions.has(detail.description),
      `Duplicate combined test description: ${detail.description}.`);
    ids.add(detail.id);
    descriptions.add(detail.description);
  }

  const suites = SUITE_NAMES.map((name, index) => filtered.reduce(
    (combined, result) => {
      const suite = resultSuites(result)[index];
      return {
        failed: combined.failed + suite.failed,
        name,
        passed: combined.passed + suite.passed,
        total: combined.total + suite.total
      };
    },
    { failed: 0, name, passed: 0, total: 0 }
  ));
  const failed = suites.reduce((total, suite) => total + suite.failed, 0);
  const passed = suites.reduce((total, suite) => total + suite.passed, 0);
  const total = suites.reduce((sum, suite) => sum + suite.total, 0);

  assert(details.length === total, 'Combined suite totals do not match the case registry.');
  assert(passed + failed === total, 'Combined pass/fail totals are inconsistent.');

  return {
    complete: filtered.every((result) => result.complete === true),
    details,
    failed,
    framework: {
      name: 'vanilla-test',
      version: VANILLA_TEST_VERSION
    },
    passed,
    suites,
    total
  };
}

export function printTestSummary(result, label = 'DBOPFS Studio') {
  resultSuites(result);
  for (const suite of result.suites) {
    console.log(
      `${label} ${suite.name}: ${suite.passed}/${suite.total} passed` +
      `${suite.failed ? `, ${suite.failed} failed` : ''}`
    );
  }
  console.log(
    `${label} TOTAL: ${result.passed}/${result.total} vanilla-test cases passed` +
    `${result.failed ? `, ${result.failed} failed` : ''}.`
  );
}
