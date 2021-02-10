/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { installTransform } from './transform';
import { RunnerSuite, RunnerSpec } from './runnerTest';
import { callLocation, errorWithCallLocation } from './util';
import { FolioImpl, setImplementation, SpecType } from './spec';
import { TestModifier } from './testModifier';
import { Config } from './config';

export function runnerSpec(suite: RunnerSuite, config: Config): () => void {
  const suites = [suite];

  const it = (spec: SpecType, folio: FolioImpl, title: string, modifierFn: (modifier: TestModifier, parameters: any) => void | Function, fn?: Function) => {
    const suite = suites[0];
    if (typeof fn !== 'function') {
      fn = modifierFn;
      modifierFn = null;
    }
    const test = new RunnerSpec(folio, title, fn, suite);
    test._usedParameters = folio._pool.parametersForFunction(fn, `Test`, true);
    const location = callLocation(suite.file);
    test.file = location.file;
    test.line = location.line;
    test.column = location.column;
    if (spec === 'only')
      test._only = true;

    test._modifierFn = (modifier: TestModifier, parameters: any) => {
      if (spec === 'skip')
        modifier.skip();
      if (!modifier._timeout)
        modifier.setTimeout(config.timeout);
      if (modifierFn)
        modifierFn(modifier, parameters);
    };
    return test;
  };

  const describe = (spec: SpecType, folio: FolioImpl, title: string, modifierFn: (suite: TestModifier, parameters: any) => void | Function, fn?: Function) => {
    if (typeof fn !== 'function') {
      fn = modifierFn;
      modifierFn = null;
    }
    const child = new RunnerSuite(folio, title, suites[0]);
    const location = callLocation(suite.file);
    child.file = location.file;
    child.line = location.line;
    child.column = location.column;
    if (spec === 'only')
      child._only = true;

    child._modifierFn = (modifier: TestModifier, parameters: any) => {
      if (spec === 'skip')
        modifier.skip();
      if (!modifier._timeout)
        modifier.setTimeout(config.timeout);
      if (modifierFn)
        modifierFn(modifier, parameters);
    };

    suites.unshift(child);
    fn();
    suites.shift();
  };

  const hook = (hookName: string, folio: FolioImpl, fn: Function) => {
    const suite = suites[0];
    if (!suite.parent)
      throw errorWithCallLocation(`${hookName} hook should be called inside a describe block. Consider using an auto fixture.`);
    if (suite._folio !== folio)
      throw errorWithCallLocation(`Using ${hookName} hook from a different fixture set.\nAre you using describe and ${hookName} from different fixture files?`);
    suite._usedParameters.push(...folio._pool.parametersForFunction(fn, `${hookName} hook`, hookName === 'beforeEach' || hookName === 'afterEach'));
  };

  setImplementation({
    it,
    describe,
    beforeEach: (folio, fn) => hook('beforeEach', folio, fn),
    afterEach: (folio, fn) => hook('afterEach', folio, fn),
    beforeAll: (folio, fn) => hook('beforeAll', folio, fn),
    afterAll: (folio, fn) => hook('afterAll', folio, fn),
  });

  return installTransform(suite.file);
}
