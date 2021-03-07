/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { expect } from 'folio';
import path from 'path';
import { folio } from './fixtures';
const { it } = folio;

it('should work with parameters', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'fixtures.js': `
      exports.toBeRenamed = { parameters: { worker: { description: '', defaultValue: '', values: ['A', 'B', 'C'] } } };
    `,
    'a.test.js': `
      test('should use worker A', (test, parameters) => {
        test.fail(parameters.worker !== 'A');
      }, async ({worker}) => {
        expect(true).toBe(false);
      });
    `,
    'b.test.js': `
      test('should use worker B', (test, parameters) => {
        test.fail(parameters.worker !== 'B');
      }, async ({worker}) => {
        expect(true).toBe(false);
      });
    `,
    'c.test.js': `
      test('should use worker C', (test, parameters) => {
        test.fail(parameters.worker !== 'C');
      }, async ({worker}) => {
        expect(true).toBe(false);
      });
    `,
  }, { 'skip-all': true });
  expect(result.exitCode).toBe(0);
  const suites = result.report.suites;
  expect(suites[0].file).toContain('a.test.js');
  expect(suites[0].suites[0].specs[0].tests.length).toBe(3);
  expect(suites[1].file).toContain('b.test.js');
  expect(suites[1].suites[0].specs[0].tests.length).toBe(3);
  expect(suites[2].file).toContain('c.test.js');
  expect(suites[2].suites[0].specs[0].tests.length).toBe(3);
  const paramsLog = [];
  const resultsLog = [];
  for (let i = 0; i < 3; ++i) {
    for (const test of suites[i].suites[0].specs[0].tests) {
      for (const name of Object.keys(test.parameters))
        paramsLog.push(name + '=' + test.parameters[name]);
      resultsLog.push(test.expectedStatus);
    }
  }
  expect(paramsLog.join('|')).toBe('worker=A|worker=B|worker=C|worker=A|worker=B|worker=C|worker=A|worker=B|worker=C');
  expect(resultsLog.join('|')).toBe('passed|failed|failed|failed|passed|failed|failed|failed|passed');
});

it('should emit test annotations', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.test.js': `
      test('should emit annotation', (test, parameters) => {
        test.fail(true, 'Fail annotation');
      }, async ({}) => {
        expect(true).toBe(false);
      });
    `
  }, { 'skip-all': true });
  expect(result.exitCode).toBe(0);
  expect(result.report.suites[0].suites[0].specs[0].tests[0].annotations).toEqual([{ type: 'fail', description: 'Fail annotation' }]);
});

it('should have relative always-posix paths', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.test.js': `
      test('math works!', async ({}) => {
        expect(1 + 1).toBe(2);
      });
    `
  }, { 'skip-all': true });
  expect(result.exitCode).toBe(0);
  expect(result.report.config.testDir.indexOf(path.win32.sep)).toBe(-1);
  expect(result.report.config.outputDir.indexOf(path.win32.sep)).toBe(-1);
  expect(result.report.suites[0].suites[0].specs[0].file).toBe('a.test.js');
  expect(result.report.suites[0].suites[0].specs[0].line).toBe(5);
  expect(result.report.suites[0].suites[0].specs[0].column).toBe(7);
});

it('should emit suite annotations', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.test.js': `
      test.describe('annotate', test => {
        test.fixme('Fix me!');
      }, () => {
        test('test', async ({}) => {
          expect(true).toBe(false);
        });
      });
    `
  }, { 'skip-all': true });
  expect(result.exitCode).toBe(0);
  expect(result.report.suites[0].suites[0].suites[0].specs[0].tests[0].annotations).toEqual([{ type: 'fixme', description: 'Fix me!' }]);
});
