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

import { folio as baseFolio } from '../..';

const builder = baseFolio.extend<{ workerWrap: number }, { testWrap: string }>();

builder.setTestFixture('testWrap', async ({}, runTest) => {
  await runTest('testWrap');
});
builder.setWorkerFixture('workerWrap', async ({}, runTest) => {
  await runTest(42);
});

export const fixtures1 = builder.build();
