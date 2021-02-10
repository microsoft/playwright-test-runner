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

import { default as ignore } from 'fstream-ignore';
import * as commander from 'commander';
import * as fs from 'fs';
import { default as minimatch } from 'minimatch';
import * as path from 'path';
import { Reporter, EmptyReporter } from './reporter';
import DotReporter from './reporters/dot';
import JSONReporter from './reporters/json';
import JUnitReporter from './reporters/junit';
import LineReporter from './reporters/line';
import ListReporter from './reporters/list';
import { Multiplexer } from './reporters/multiplexer';
import { Runner } from './runner';
import { assignConfig, config, ParameterRegistration } from './fixtures';
import { defaultConfig } from './config';
import { dim } from 'colors/safe';

export const reporters = {
  'dot': DotReporter,
  'json': JSONReporter,
  'junit': JUnitReporter,
  'line': LineReporter,
  'list': ListReporter,
  'null': EmptyReporter,
};

const availableReporters = Object.keys(reporters).map(r => `"${r}"`).join();

const loadProgram = new commander.Command();
addRunnerOptions(loadProgram, true);
loadProgram.helpOption(false);
loadProgram.action(async command => {
  try {
    await runTests(command);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
});
loadProgram.parse(process.argv);

async function runTests(command) {

  let shard: { total: number, current: number } | undefined;
  if (command.shard) {
    const pair = command.shard.split('/').map((t: string) => parseInt(t, 10));
    shard = { current: pair[0] - 1, total: pair[1] };
  }
  const testDir = path.resolve(process.cwd(), command.args[0] || '.');
  const reporterList = command.reporter.split(',');
  const reporterObjects: Reporter[] = reporterList.map(c => {
    if (reporters[c])
      return new reporters[c]();
    try {
      const p = path.resolve(process.cwd(), c);
      return new (require(p).default)();
    } catch (e) {
      console.error('Invalid reporter ' + c, e);
      process.exit(1);
    }
  });

  const reporter = new Multiplexer(reporterObjects);

  if (command.watch) {
    while (true) {
      console.clear();
      const before = new Set(Object.keys(require.cache));
      const result = await doRun(command, shard, testDir, reporter);
      const filesToWatch = new Set<string>();
      for (const name in require.cache) {
        if (before.has(name))
          continue;
        filesToWatch.add(name);
        delete require.cache[name];
      }
      if (result === 'sigint')
        process.exit(130);
      let callback;
      const promise = new Promise(x => callback = x);
      for (const file of filesToWatch) {
        fs.watchFile(file, {
          interval: 150
        },callback);
      }
      console.log(dim('Watching for file changes...'));
      await promise;
      for (const file of filesToWatch)
        fs.unwatchFile(file, callback);
    }
  } else {
    const result = await doRun(command, shard, testDir, reporter);
    if (result === 'sigint')
      process.exit(130);

    if (result === 'forbid-only') {
      console.error('=====================================');
      console.error(' --forbid-only found a focused test.');
      console.error('=====================================');
      process.exit(1);
    }
    if (result === 'no-tests') {
      console.error('=================');
      console.error(' no tests found.');
      console.error('=================');
      process.exit(1);
    }
    process.exit(result === 'failed' ? 1 : 0);
  }

}

async function doRun(command, shard, testDir, reporter) {
  if (!fs.existsSync(testDir))
    throw new Error(`${testDir} does not exist`);

  let files: string[];
  if (fs.statSync(testDir).isDirectory())
    files = filterFiles(testDir, await collectFiles(testDir), command.args.slice(1), command.testMatch, command.testIgnore);
  else
    files = [testDir];

  const runner = new Runner(reporter);
  assignConfig(defaultConfig);
  const parameterRegistrations = runner.loadFiles(files).parameters;
  const parameters: { [key: string]: (string | boolean | number)[] } = {};
  for (const param of command.param || []) {
    const match = param.match(/([^=]+)=(.*)/);
    const [_, name, value] = match ? match : ['', param, 'true'];
    if (!parameterRegistrations.has(name)) {
      console.error(`unknown parameter '${name}'`);
      process.exit(1);
    }
    const registration = parameterRegistrations.get(name);
    let list = parameters[name];
    if (!list) {
      list = [];
      parameters[name] = list;
    }
    if (typeof registration.defaultValue === 'string')
      list.push(value);
    else if (typeof registration.defaultValue === 'number')
      list.push(parseFloat(value));
    else if (typeof registration.defaultValue === 'boolean')
      list.push(value === 'true');
  }


  // Assign config values after runner.loadFiles to set defaults from the command
  // line.
  config.testDir = testDir;
  if (command.forbidOnly)
    config.forbidOnly = true;
  if (command.globalTimeout)
    config.globalTimeout = parseInt(command.globalTimeout, 10);
  if (command.grep)
    config.grep = command.grep;
  if (command.maxFailures || command.x)
    config.maxFailures = command.x ? 1 : parseInt(command.maxFailures, 10);
  if (command.outputDir)
    config.outputDir = command.output;
  if (command.quiet)
    config.quiet = command.quiet;
  if (command.repeatEach)
    config.repeatEach = parseInt(command.repeatEach, 10);
  if (command.retries)
    config.retries = parseInt(command.retries, 10);
  if (shard)
    config.shard = shard;
  if (command.snapshotDir)
    config.snapshotDir = command.snapshotDir;
  if (command.timeout)
    config.timeout = parseInt(command.timeout, 10);
  if (command.updateSnapshots)
    config.updateSnapshots = !!command.updateSnapshots;
  if (command.workers)
    config.workers = parseInt(command.workers, 10);

  if (command.help === undefined) {
    printParametersHelp([...parameterRegistrations.values()]);
    process.exit(0);
  }

  runner.generateTests({ parameters });
  if (command.list) {
    runner.list();
    return;
  }

  return await runner.run();
}

async function collectFiles(testDir: string): Promise<string[]> {
  const list: string[] = [];
  let callback: (list: string[]) => void;
  const result = new Promise<string[]>(f => callback = f);
  ignore({ path: testDir, ignoreFiles: ['.gitignore']})
      .on('child', (c: any) => list.push(c.path))
      .on('end', () => callback(list));
  return result;
}

function filterFiles(base: string, files: string[], filters: string[], testMatch: string, testIgnore: string): string[] {
  if (!testIgnore.includes('/') && !testIgnore.includes('\\'))
    testIgnore = '**/' + testIgnore;
  if (!testMatch.includes('/') && !testMatch.includes('\\'))
    testMatch = '**/' + testMatch;
  return files.filter(file => {
    file = path.relative(base, file);
    if (testIgnore && minimatch(file, testIgnore))
      return false;
    if (testMatch && !minimatch(file, testMatch))
      return false;
    if (filters.length && !filters.find(filter => file.includes(filter)))
      return false;
    return true;
  });
}

function addRunnerOptions(program: commander.Command, param: boolean) {
  program = program
      .version('Version ' + /** @type {any} */ (require)('../package.json').version)
      .option('--forbid-only', `Fail if exclusive test(s) encountered (default: ${defaultConfig.forbidOnly})`)
      .option('-g, --grep <grep>', `Only run tests matching this string or regexp  (default: "${defaultConfig.grep}")`)
      .option('--global-timeout <timeout>', `Specify maximum time this test suite can run in milliseconds (default: 0 for unlimited)`)
      .option('-h, --help', `Display help`)
      .option('-j, --workers <workers>', `Number of concurrent workers, use 1 to run in single worker (default: number of CPU cores / 2)`)
      .option('--list', `Only collect all the test and report them`)
      .option('--max-failures <N>', `Stop after the first N failures (default: ${defaultConfig.maxFailures})`)
      .option('--output <outputDir>', `Folder for output artifacts (default: "test-results")`);
  if (param)
    program = program.option('-p, --param <name=value...>', `Specify fixture parameter value`);
  program = program
      .option('--quiet', `Suppress stdio`)
      .option('--repeat-each <repeat-each>', `Specify how many times to run the tests (default: ${defaultConfig.repeatEach})`)
      .option('--reporter <reporter>', `Specify reporter to use, comma-separated, can be ${availableReporters}`, process.env.CI ? 'dot' : 'line')
      .option('--retries <retries>', `Specify retry count (default: ${defaultConfig.retries})`)
      .option('--shard <shard>', `Shard tests and execute only selected shard, specify in the form "current/all", 1-based, for example "3/5"`)
      .option('--snapshot-dir <dir>', `Snapshot directory, relative to tests directory (default: "${defaultConfig.snapshotDir}"`)
      .option('--test-ignore <pattern>', `Pattern used to ignore test files`, 'node_modules/**')
      .option('--test-match <pattern>', `Pattern used to find test files`, '**/?(*.)+(spec|test).[jt]s')
      .option('--timeout <timeout>', `Specify test timeout threshold in milliseconds (default: ${defaultConfig.timeout})`)
      .option('-u, --update-snapshots', `Whether to update snapshots with actual results (default: ${defaultConfig.updateSnapshots})`)
      .option('--watch', 'watch mode')
      .option('-x', `Stop after the first failure`);
}

function printParametersHelp(parameterRegistrations: ParameterRegistration[]) {
  const program = new commander.Command();
  for (const registration of parameterRegistrations) {
    if (typeof registration.defaultValue === 'boolean')
      program.option(`-p, --param*${registration.name}`, registration.description, registration.defaultValue);
    else
      program.option(`-p, --param*${registration.name}=<value>`, registration.description, String(registration.defaultValue));
  }
  addRunnerOptions(program, false);
  console.log(program.helpInformation().replace(/--param\*/g, '--param '));
}
