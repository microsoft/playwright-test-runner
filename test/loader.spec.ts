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
import { test, expect } from './folio-test';

test('should load an mjs file', async ({ runInlineTest }) => {
  // modules don't work with node < 12
  test.skip(parseInt(process.versions.node, 10) < 12);
  const { exitCode, passed } = await runInlineTest({
    'a.spec.mjs': `
        import fs from 'fs';
        const { test } = folio;
        test('succeeds', () => {
          expect(1 + 1).toBe(2);
        });
      `
  });
  expect(passed).toBe(1);
  expect(exitCode).toBe(0);
});
