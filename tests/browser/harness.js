import VanillaTest from '/node_modules/vanilla-test/index.js';

export const SUITE_NAMES = Object.freeze([
  'Unit',
  'Functional',
  'Integration',
  'Regression'
]);

export function assert(condition, message = 'Assertion failed.') {
  if (!condition) {
    throw new Error(message);
  }
}

export async function fetchOk(url) {
  const response = await fetch(url, { cache: 'no-store' });
  assert(response.ok, `${url} returned HTTP ${response.status}.`);
  return response;
}

export async function expectError(operation, predicate, message) {
  let caught = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert(caught && predicate(caught), message);
  return caught;
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

export function createHarness() {
  const framework = new VanillaTest();
  const details = [];

  async function runCase(suite, testCase, context) {
    const descriptor = `[${suite}] ${testCase.description}`;
    framework.expects(descriptor);
    try {
      await testCase.run(context);
      framework.pass();
      details.push({
        description: testCase.description,
        id: testCase.id,
        status: 'passed',
        suite
      });
    } catch (error) {
      framework.fail();
      details.push({
        description: testCase.description,
        error: error instanceof Error ? error.message : String(error),
        id: testCase.id,
        status: 'failed',
        suite
      });
    } finally {
      framework.done();
    }
  }

  async function runSuites(suites, context = {}) {
    assert(Array.isArray(suites) && suites.length === SUITE_NAMES.length,
      'All four browser-test suites must be registered.');
    assert(suites.every((suite, index) => suite.name === SUITE_NAMES[index]),
      'Browser-test suites must run in Unit, Functional, Integration, Regression order.');

    const ids = new Set();
    const descriptors = new Set();
    for (const suite of suites) {
      for (const testCase of suite.cases || []) {
        assert(typeof testCase.id === 'string' && testCase.id.length > 0,
          `${suite.name} contains a test without an ID.`);
        assert(typeof testCase.description === 'string' && testCase.description.length > 0,
          `${testCase.id} has no test description.`);
        assert(typeof testCase.run === 'function', `${testCase.id} has no test operation.`);
        assert(!ids.has(testCase.id), `Duplicate browser-test ID: ${testCase.id}.`);
        ids.add(testCase.id);
        const descriptor = testCase.description;
        assert(!descriptors.has(descriptor),
          `Duplicate browser-test description: ${testCase.description}.`);
        descriptors.add(descriptor);
      }
    }

    for (const suite of suites) {
      assert(Array.isArray(suite.cases) && suite.cases.length > 0,
        `${suite.name} must contain at least one test.`);
      for (const testCase of suite.cases) {
        await runCase(suite.name, testCase, context);
      }
    }

    const report = framework.report(false);
    const suiteResults = summarize(details);
    return {
      complete: true,
      details,
      failed: report.failed.length,
      passed: report.passed.length,
      suites: suiteResults,
      total: report.passed.length + report.failed.length
    };
  }

  return { runSuites };
}
