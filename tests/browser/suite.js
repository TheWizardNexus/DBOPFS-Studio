import { createHarness } from './harness.js';
import unitSuite from './suites/unit.js';
import functionalSuite from './suites/functional.js';
import integrationSuite from './suites/integration.js';
import regressionSuite from './suites/regression.js';

const suites = [unitSuite, functionalSuite, integrationSuite, regressionSuite];

function render(result) {
  const summary = document.querySelector('#summary');
  summary.className = result.failed ? 'fail' : 'pass';
  summary.textContent = `${result.passed}/${result.total} tests passed across ` +
    `${result.suites.length} suites.`;

  const results = document.querySelector('#results');
  results.replaceChildren(...result.suites.map((suite) => {
    const section = document.createElement('section');
    section.className = 'test-suite';

    const heading = document.createElement('h2');
    heading.textContent = `${suite.name} — ${suite.passed}/${suite.total} passed`;
    section.append(heading);

    const list = document.createElement('ol');
    const details = result.details.filter((detail) => detail.suite === suite.name);
    list.replaceChildren(...details.map((detail) => {
      const item = document.createElement('li');
      item.className = detail.status === 'passed' ? 'pass' : 'fail';
      item.textContent = detail.error
        ? `${detail.description}: ${detail.error}`
        : detail.description;
      return item;
    }));
    section.append(list);
    return section;
  }));
}

async function run() {
  const harness = createHarness();
  const result = await harness.runSuites(suites, {});
  globalThis.__DBOPFS_TEST_RESULTS__ = result;
  render(result);
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  globalThis.__DBOPFS_TEST_RESULTS__ = {
    complete: true,
    details: [{
      description: 'browser test harness completes',
      error: message,
      id: 'harness.complete',
      status: 'failed',
      suite: 'Harness'
    }],
    failed: 1,
    passed: 0,
    suites: [{ failed: 1, name: 'Harness', passed: 0, total: 1 }],
    total: 1
  };
  render(globalThis.__DBOPFS_TEST_RESULTS__);
});
