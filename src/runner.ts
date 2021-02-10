/**
 * Copyright 2019 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
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

import rimraf from 'rimraf';
import { promisify } from 'util';
import { Dispatcher } from './dispatcher';
import { config, matrix, ParameterRegistration, parameterRegistrations, setParameterValues } from './fixtures';
import { Reporter } from './reporter';
import { generateTests } from './testGenerator';
import { monotonicTime, prependErrorMessage, raceAgainstDeadline } from './util';
import { RunnerSuite } from './runnerTest';
import { runnerSpec } from './runnerSpec';
import { debugLog } from './debug';
import { Suite } from './test';
import { rootFixtures } from './spec';
export { Reporter } from './reporter';
export { Config } from './config';
export { Test, TestResult, Suite, TestStatus, TestError } from './test';

const removeFolderAsync = promisify(rimraf);

type RunResult = 'passed' | 'failed' | 'sigint' | 'forbid-only' | 'no-tests';

export class Runner {
  private _reporter: Reporter;
  private _rootSuite: RunnerSuite;
  private _suites: RunnerSuite[] = [];

  constructor(reporter: Reporter) {
    this._reporter = reporter;
  }

  loadFiles(files: string[]): { parameters: Map<string, ParameterRegistration> } {
    debugLog(`loadFiles`, files);
    // First traverse tests.
    for (const file of files) {
      const suite = new RunnerSuite(rootFixtures, '');
      suite.file = file;
      const revertBabelRequire = runnerSpec(suite, config);
      try {
        require(file);
      } catch (e) {
        prependErrorMessage(e, `Error while reading ${file}:\n`);
        throw e;
      }
      this._suites.push(suite);
      revertBabelRequire();
    }

    // Set default values
    for (const param of parameterRegistrations.values()) {
      if (!(param.name in matrix))
        setParameterValues(param.name, [param.defaultValue]);
    }
    return { parameters: parameterRegistrations };
  }

  generateTests(options: { parameters?: { [key: string]: (string | boolean | number)[] } } = {}): Suite {
    if (options.parameters) {
      for (const name of Object.keys(options.parameters))
        setParameterValues(name, options.parameters[name]);
    }

    // We can only generate tests after parameters have been assigned.
    this._suites = excludeNonOnlyFiles(this._suites);
    this._rootSuite = generateTests(this._suites, config);
    return this._rootSuite;
  }

  list() {
    this._reporter.onBegin(config, this._rootSuite);
    this._reporter.onEnd();
  }

  async run(): Promise<RunResult> {
    await removeFolderAsync(config.outputDir).catch(e => {});

    if (config.forbidOnly) {
      const hasOnly = this._rootSuite.findSpec(t => t._only) || this._rootSuite.findSuite(s => s._only);
      if (hasOnly)
        return 'forbid-only';
    }

    const total = this._rootSuite.total;
    if (!total)
      return 'no-tests';
    const globalDeadline = config.globalTimeout ? config.globalTimeout + monotonicTime() : 0;
    const { result, timedOut } = await raceAgainstDeadline(this._runTests(this._rootSuite), globalDeadline);
    if (timedOut) {
      this._reporter.onTimeout(config.globalTimeout);
      process.exit(1);
    }
    return result;
  }

  private async _runTests(suite: RunnerSuite): Promise<RunResult> {
    // Trial run does not need many workers, use one.
    const runner = new Dispatcher(suite, { ...config, workers: config.workers }, this._reporter);
    let sigint = false;
    let sigintCallback: () => void;
    const sigIntPromise = new Promise(f => sigintCallback = f);
    const sigintHandler = () => {
      process.off('SIGINT', sigintHandler);
      sigint = true;
      sigintCallback();
    };
    process.on('SIGINT', sigintHandler);
    this._reporter.onBegin(config, suite);
    await Promise.race([runner.run(), sigIntPromise]);
    await runner.stop();
    this._reporter.onEnd();
    process.off('SIGINT', sigintHandler);
    if (sigint)
      return 'sigint';
    return runner.hasWorkerErrors() || suite.findSpec(spec => !spec.ok()) ? 'failed' : 'passed';
  }
}

function excludeNonOnlyFiles(suites: RunnerSuite[]): RunnerSuite[] {
  // This makes sure we don't generate 1000000 tests if only one spec is focused.
  const filtered = suites.filter(suite => suite._hasOnly());
  return filtered.length === 0 ? suites : filtered;
}