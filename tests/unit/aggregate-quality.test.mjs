import { describe, expect, it } from 'vitest';
import {
  aggregateQualityResults,
  runGitRevParse,
  validateGateShas,
} from '../../scripts/aggregate-quality.mjs';

describe('aggregate-quality script policy', () => {
  const validSha = '74cd2eb446481fffa553a2d625d58285de12d203';
  const otherSha = 'abd36b2000000000000000000000000000000000';

  describe('runGitRevParse', () => {
    it('returns a 40-character hex SHA from the current repository', () => {
      const sha = runGitRevParse();
      expect(sha).toMatch(/^[0-9a-f]{40}$/i);
    });

    it('throws error when git execution fails in invalid directory', () => {
      expect(() => runGitRevParse('/nonexistent-dir-for-git')).toThrow(/git rev-parse HEAD failed/);
    });
  });

  describe('validateGateShas', () => {
    it('passes when expected and actual SHAs match (case-insensitive)', () => {
      expect(validateGateShas(validSha, validSha.toUpperCase(), 'test-job')).toBe(true);
    });

    it('throws error when expected SHA is invalid or missing', () => {
      expect(() => validateGateShas('', validSha)).toThrow(/Expected SHA is missing or invalid/);
      expect(() => validateGateShas('not-a-sha', validSha)).toThrow(
        /Expected SHA is missing or invalid/,
      );
    });

    it('throws error when actual SHA is invalid or missing', () => {
      expect(() => validateGateShas(validSha, '')).toThrow(
        /Actual SHA for job is missing or invalid/,
      );
      expect(() => validateGateShas(validSha, 'short')).toThrow(
        /Actual SHA for job is missing or invalid/,
      );
    });

    it('throws error on SHA mismatch', () => {
      expect(() => validateGateShas(validSha, otherSha, 'code_quality')).toThrow(
        /SHA mismatch for code_quality: expected "74cd2eb446481fffa553a2d625d58285de12d203", but got actual "abd36b2000000000000000000000000000000000"/,
      );
    });
  });

  describe('aggregateQualityResults', () => {
    const validResults = {
      code_quality: { result: 'success', testedSha: validSha },
      integration_quality: { result: 'success', testedSha: validSha },
      security_quality: { result: 'success', testedSha: validSha },
      browser_quality: { result: 'success', testedSha: validSha },
    };

    it('aggregates all gate successes and returns testedSha', () => {
      const agg = aggregateQualityResults({
        expectedSha: validSha,
        results: validResults,
      });
      expect(agg).toEqual({
        success: true,
        testedSha: validSha.toLowerCase(),
      });
    });

    it('rejects missing or invalid expectedSha', () => {
      expect(() =>
        aggregateQualityResults({ expectedSha: 'invalid', results: validResults }),
      ).toThrow(/expectedSha "invalid" is missing or invalid/);
    });

    it('rejects missing jobs', () => {
      const partial = { ...validResults };
      delete partial.browser_quality;

      expect(() => aggregateQualityResults({ expectedSha: validSha, results: partial })).toThrow(
        /missing results for required jobs: browser_quality/,
      );
    });

    it('rejects non-success job result (failure, cancelled, skipped)', () => {
      for (const nonSuccess of ['failure', 'cancelled', 'skipped']) {
        const altered = {
          ...validResults,
          integration_quality: { result: nonSuccess, testedSha: validSha },
        };
        expect(() => aggregateQualityResults({ expectedSha: validSha, results: altered })).toThrow(
          new RegExp(`job "integration_quality" concluded with "${nonSuccess}"`),
        );
      }
    });

    it('rejects missing or invalid testedSha on job', () => {
      const altered = {
        ...validResults,
        security_quality: { result: 'success', testedSha: '' },
      };
      expect(() => aggregateQualityResults({ expectedSha: validSha, results: altered })).toThrow(
        /job "security_quality" has missing or invalid testedSha/,
      );
    });

    it('rejects mismatched testedSha against expected target SHA', () => {
      const altered = {
        ...validResults,
        code_quality: { result: 'success', testedSha: otherSha },
      };
      expect(() => aggregateQualityResults({ expectedSha: validSha, results: altered })).toThrow(
        /job "code_quality" tested SHA "abd36b2000000000000000000000000000000000" does not match target SHA "74cd2eb446481fffa553a2d625d58285de12d203"/,
      );
    });
  });
});
