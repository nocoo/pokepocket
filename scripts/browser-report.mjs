import { readFileSync } from 'node:fs';
import { REQUIRED_TEST_COUNT, OPTIONAL_TEST_COUNT } from './browser-shared.mjs';

export { REQUIRED_TEST_COUNT, OPTIONAL_TEST_COUNT };

function isNonNegativeInteger(val) {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0;
}

export function validatePlaywrightJsonReport(reportOrPath, options = {}) {
  let report;
  if (typeof reportOrPath === 'string') {
    let content;
    try {
      content = readFileSync(reportOrPath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read Playwright JSON report at "${reportOrPath}": ${err.message}`);
    }
    try {
      report = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `Playwright JSON report at "${reportOrPath}" contains malformed JSON: ${err.message}`,
      );
    }
  } else if (typeof reportOrPath === 'object' && reportOrPath !== null) {
    report = reportOrPath;
  } else {
    throw new Error('Expected report object or string path to report JSON');
  }

  const expectedTestCount = options.expectedTestCount;
  const expectedSuiteCount = options.expectedSuiteCount;

  if (report.errors && report.errors.length > 0) {
    throw new Error(`Playwright run encountered top-level errors: ${report.errors.join('; ')}`);
  }

  if (!report.suites || !Array.isArray(report.suites) || report.suites.length === 0) {
    throw new Error('Playwright report contains zero test suites.');
  }

  if (expectedSuiteCount !== undefined && report.suites.length !== expectedSuiteCount) {
    throw new Error(
      `Playwright report suite count mismatch: expected ${expectedSuiteCount}, found ${report.suites.length}`,
    );
  }

  const stats = report.stats;
  if (!stats) {
    throw new Error('Playwright report missing stats object.');
  }

  if (!isNonNegativeInteger(stats.expected)) {
    throw new Error('Playwright report stats.expected must be a finite non-negative integer.');
  }
  if (!isNonNegativeInteger(stats.unexpected)) {
    throw new Error('Playwright report stats.unexpected must be a finite non-negative integer.');
  }
  if (!isNonNegativeInteger(stats.flaky)) {
    throw new Error('Playwright report stats.flaky must be a finite non-negative integer.');
  }
  if (!isNonNegativeInteger(stats.skipped)) {
    throw new Error('Playwright report stats.skipped must be a finite non-negative integer.');
  }

  if (stats.unexpected !== 0) {
    throw new Error(`Playwright report contains ${stats.unexpected} unexpected failures.`);
  }
  if (stats.flaky !== 0) {
    throw new Error(`Playwright report contains ${stats.flaky} flaky tests.`);
  }
  if (stats.skipped !== 0) {
    throw new Error(
      `Playwright report contains ${stats.skipped} skipped tests; zero skipped allowed.`,
    );
  }

  let totalTestsInspected = 0;

  function inspectSuite(suite) {
    if (suite.specs && Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec.ok) {
          throw new Error(`Spec "${spec.title}" is not ok.`);
        }
        if (!spec.tests || !Array.isArray(spec.tests) || spec.tests.length === 0) {
          throw new Error(`Spec "${spec.title}" contains no test entries.`);
        }

        for (const test of spec.tests) {
          totalTestsInspected++;

          if (test.expectedStatus !== 'passed') {
            throw new Error(
              `Test "${spec.title}" has expectedStatus "${test.expectedStatus}". Expected failure masking is forbidden; only "passed" is allowed.`,
            );
          }
          if (test.status !== 'expected') {
            throw new Error(
              `Test "${spec.title}" outcome status is "${test.status}". Only "expected" (passing as expected) is allowed.`,
            );
          }

          if (!test.results || !Array.isArray(test.results) || test.results.length === 0) {
            throw new Error(`Test "${spec.title}" has no results recorded.`);
          }

          if (test.results.length !== 1) {
            throw new Error(
              `Test "${spec.title}" recorded ${test.results.length} results. Retries or multiple executions are forbidden.`,
            );
          }

          const res = test.results[0];
          if (res.status !== 'passed') {
            throw new Error(
              `Test result for "${spec.title}" has status "${res.status}". Only "passed" results are allowed (no retries, failures, or skips).`,
            );
          }
          if (res.retry !== 0) {
            throw new Error(
              `Test result for "${spec.title}" has retry count ${res.retry}. Only first-attempt retry:0 is allowed.`,
            );
          }
          if (res.error || (res.errors && res.errors.length > 0)) {
            throw new Error(
              `Test result for "${spec.title}" contains errors despite passing status.`,
            );
          }
        }
      }
    }

    if (suite.suites && Array.isArray(suite.suites)) {
      for (const childSuite of suite.suites) {
        inspectSuite(childSuite);
      }
    }
  }

  for (const rootSuite of report.suites) {
    inspectSuite(rootSuite);
  }

  if (totalTestsInspected === 0) {
    throw new Error('Playwright report contains 0 passing tests; positive execution required.');
  }

  if (stats.expected !== totalTestsInspected) {
    throw new Error(
      `Playwright stats.expected (${stats.expected}) does not match inspected passed tests (${totalTestsInspected}).`,
    );
  }

  if (expectedTestCount !== undefined && totalTestsInspected !== expectedTestCount) {
    throw new Error(
      `Playwright report executed ${totalTestsInspected} tests, which does not match required exact count of ${expectedTestCount}.`,
    );
  }

  return {
    totalTests: totalTestsInspected,
    suitesCount: report.suites.length,
    duration: stats.duration,
  };
}
