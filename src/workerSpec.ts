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

import { WorkerSpec, WorkerSuite } from './workerTest';
import { installTransform } from './transform';
import { callLocation } from './util';
import { FolioImpl, setImplementation, SpecType } from './spec';
import { TestModifier } from './testModifier';

let currentRunSuites: WorkerSuite[];

export function workerSpec(suite: WorkerSuite): () => void {
  const suites = [suite];
  currentRunSuites = suites;

  const it = (spec: SpecType, folio: FolioImpl, title: string, modifierFn: (modifier: TestModifier, parameters: any) => void | Function, fn?: Function) => {
    fn = fn || modifierFn;
    const test = new WorkerSpec(folio, title, fn, suites[0]);
    const location = callLocation(suite.file);
    test.file = location.file;
    test.line = location.line;
    test.column = location.column;
    return test;
  };

  const describe = (spec: SpecType, folio: FolioImpl, title: string, modifierFn: (modifier: TestModifier, parameters: any) => void | Function, fn?: Function) => {
    fn = fn || modifierFn;
    const child = new WorkerSuite(folio, title, suites[0]);
    const location = callLocation(suite.file);
    child.file = location.file;
    child.line = location.line;
    child.column = location.column;
    suites.unshift(child);
    fn();
    suites.shift();
  };

  setImplementation({
    it,
    describe,
    beforeEach: (folio, fn) => currentRunSuites[0]._addHook('beforeEach', fn),
    afterEach: (folio, fn) => currentRunSuites[0]._addHook('afterEach', fn),
    beforeAll: (folio, fn) => currentRunSuites[0]._addHook('beforeAll', fn),
    afterAll: (folio, fn) => currentRunSuites[0]._addHook('afterAll', fn),
  });

  return installTransform(suite.file);
}
