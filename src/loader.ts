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

import { installTransform } from './transform';
import type { FullConfig, Config, ConfigOverrides, FullProject, Project, ReporterDescription, PreserveOutput } from './types';
import { errorWithCallLocation, prependErrorMessage } from './util';
import { setCurrentlyLoadingFileSuite } from './globals';
import { Suite } from './test';
import { SerializedLoaderData } from './ipc';
import * as path from 'path';
import { ProjectImpl } from './project';

export class Loader {
  private _defaultTimeout: number;
  private _defaultConfig: FullConfig;
  private _configOverrides: ConfigOverrides;
  private _fullConfig: FullConfig;
  private _config: Config = {};
  private _configFile: string | undefined;
  private _projects: ProjectImpl[] = [];
  private _fileSuites = new Map<string, Suite>();

  constructor(defaultConfig: FullConfig, configOverrides: ConfigOverrides, defaultTimeout: number) {
    this._defaultConfig = defaultConfig;
    this._configOverrides = configOverrides;
    this._fullConfig = { ...this._defaultConfig, ...configOverrides };
    this._defaultTimeout = defaultTimeout;
  }

  static deserialize(data: SerializedLoaderData): Loader {
    const loader = new Loader(data.defaultConfig, data.overrides, data.defaultTimeout);
    if ('file' in data.configFile)
      loader.loadConfigFile(data.configFile.file);
    else
      loader.loadEmptyConfig(data.configFile.config, data.configFile.rootDir);
    return loader;
  }

  loadConfigFile(file: string) {
    if (this._configFile)
      throw new Error('Cannot load two config files');
    const revertBabelRequire = installTransform();
    try {
      this._config = require(file);
      if ('default' in this._config)
        this._config = this._config['default'];
      this._processConfigObject(path.dirname(file));
      this._configFile = file;
    } catch (e) {
      prependErrorMessage(e, `Error while reading ${file}:\n`);
      throw e;
    } finally {
      revertBabelRequire();
    }
  }

  loadEmptyConfig(emptyConfig: Config, rootDir: string) {
    this._config = emptyConfig;
    this._processConfigObject(rootDir);
  }

  private _processConfigObject(rootDir: string) {
    // TODO: add config validation.
    for (const key of ['define', 'options', 'name', 'testIgnore', 'testMatch']) {
      if (('projects' in this._config) && (key in this._config))
        throw new Error(`When using projects, passing "${key}" is not supported`);
    }
    if ('testDir' in this._config && !path.isAbsolute(this._config.testDir))
      this._config.testDir = path.resolve(rootDir, this._config.testDir);
    const projects: Project[] = 'projects' in this._config ? this._config.projects : [this._config];

    this._fullConfig.rootDir = this._config.testDir || rootDir;
    this._fullConfig.forbidOnly = takeFirst(this._configOverrides.forbidOnly, this._config.forbidOnly, this._defaultConfig.forbidOnly);
    this._fullConfig.globalSetup = takeFirst(this._config.globalSetup, this._defaultConfig.globalSetup);
    this._fullConfig.globalTeardown = takeFirst(this._config.globalTeardown, this._defaultConfig.globalTeardown);
    this._fullConfig.globalTimeout = takeFirst(this._configOverrides.globalTimeout, this._config.globalTimeout, this._defaultConfig.globalTimeout);
    this._fullConfig.grep = takeFirst(this._configOverrides.grep, this._config.grep, this._defaultConfig.grep);
    this._fullConfig.maxFailures = takeFirst(this._configOverrides.maxFailures, this._config.maxFailures, this._defaultConfig.maxFailures);
    this._fullConfig.preserveOutput = takeFirst<PreserveOutput>(this._configOverrides.preserveOutput, this._config.preserveOutput, this._defaultConfig.preserveOutput);
    const reporter: ReporterDescription[] | undefined = this._config.reporter === undefined ? undefined :
      (Array.isArray(this._config.reporter) ? this._config.reporter : [this._config.reporter]);
    this._fullConfig.reporter = takeFirst(this._configOverrides.reporter, reporter, this._defaultConfig.reporter);
    this._fullConfig.quiet = takeFirst(this._configOverrides.quiet, this._config.quiet, this._defaultConfig.quiet);
    this._fullConfig.shard = takeFirst(this._configOverrides.shard, this._config.shard, this._defaultConfig.shard);
    this._fullConfig.updateSnapshots = takeFirst(this._configOverrides.updateSnapshots, this._config.updateSnapshots, this._defaultConfig.updateSnapshots);
    this._fullConfig.workers = takeFirst(this._configOverrides.workers, this._config.workers, this._defaultConfig.workers);

    for (const project of projects)
      this._addProject(project, this._fullConfig.rootDir);
    this._fullConfig.projects = this._projects.map(p => p.config);
  }

  async loadTestFile(file: string) {
    if (this._fileSuites.has(file))
      return this._fileSuites.get(file)!;
    const revertBabelRequire = installTransform();
    try {
      const suite = new Suite('');
      suite.file = file;
      setCurrentlyLoadingFileSuite(suite);
      if (file.endsWith('.mjs')) {
        // eval to prevent typescript from transpiling us here.
        await eval('import(file)');
      } else {
        require(file);
      }
      this._fileSuites.set(file, suite);
      return suite;
    } catch (e) {
      prependErrorMessage(e, `Error while reading ${file}:\n`);
      throw e;
    } finally {
      revertBabelRequire();
      setCurrentlyLoadingFileSuite(undefined);
    }
  }

  loadGlobalHook(file: string): () => any {
    const revertBabelRequire = installTransform();
    try {
      const hook = require(file);
      if (typeof hook !== 'function')
        throw errorWithCallLocation(`globalSetup and globalTeardown files must export a single function.`);
      return hook;
    } catch (e) {
      prependErrorMessage(e, `Error while reading ${file}:\n`);
      throw e;
    } finally {
      revertBabelRequire();
    }
  }

  fullConfig(): FullConfig {
    return this._fullConfig;
  }

  projects() {
    return this._projects;
  }

  fileSuites() {
    return this._fileSuites;
  }

  serialize(): SerializedLoaderData {
    return {
      defaultTimeout: this._defaultTimeout,
      defaultConfig: this._defaultConfig,
      configFile: this._configFile ? { file: this._configFile } : { config: this._config, rootDir: this._fullConfig.rootDir },
      overrides: this._configOverrides,
    };
  }

  private _addProject(projectConfig: Project, rootDir: string) {
    let testDir = takeFirst(projectConfig.testDir, rootDir);
    if (!path.isAbsolute(testDir))
      testDir = path.resolve(rootDir, testDir);

    const useRootDirForSnapshots = !projectConfig.snapshotDir && !!this._config.snapshotDir;
    let snapshotDir = '';
    if (useRootDirForSnapshots) {
      if (!path.isAbsolute(this._config.snapshotDir) && !('testDir' in this._config))
        throw new Error(`When using projects, passing relative "snapshotDir" in the root requires "testDir"`);
      snapshotDir = path.isAbsolute(this._config.snapshotDir) ? this._config.snapshotDir : path.resolve(this._config.testDir, this._config.snapshotDir);
    } else {
      snapshotDir = path.resolve(testDir, projectConfig.snapshotDir || '__snapshots__');
    }

    const fullProject: FullProject = {
      define: projectConfig.define || [],
      outputDir: takeFirst(this._configOverrides.outputDir, projectConfig.outputDir, this._config.outputDir, path.resolve(process.cwd(), 'test-results')),
      repeatEach: takeFirst(this._configOverrides.repeatEach, projectConfig.repeatEach, this._config.repeatEach, 1),
      retries: takeFirst(this._configOverrides.retries, projectConfig.retries, this._config.retries, 0),
      snapshotDir,
      metadata: projectConfig.metadata,
      name: projectConfig.name || '',
      testDir,
      testIgnore: projectConfig.testIgnore || [],
      testMatch: projectConfig.testMatch || '**/?(*.)+(spec|test).+(ts|js|mjs)',
      timeout: takeFirst(this._configOverrides.timeout, projectConfig.timeout, this._config.timeout, this._defaultTimeout),
      use: projectConfig.use || {},
    };
    this._projects.push(new ProjectImpl(fullProject, this._projects.length, useRootDirForSnapshots));
  }
}

const takeFirst = <T>(...args: (T | undefined)[]): T => {
  for (const arg of args) {
    if (arg !== undefined)
      return arg;
  }
};
