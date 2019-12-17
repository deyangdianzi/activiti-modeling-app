/*!
 * @license
 * Copyright 2019 Alfresco, Inc. and/or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { testConfig } from '../../test.config';
import { LoginPage } from 'ama-testing/e2e';
import { DeleteEntityDialog } from 'ama-testing/e2e';
import { SnackBar } from 'ama-testing/e2e';
import { NodeEntry } from '@alfresco/js-api';
import { Backend } from 'ama-testing/e2e';
import { getBackend } from 'ama-testing/e2e';
import { AuthenticatedPage } from 'ama-testing/e2e';
import { ProjectContentPage } from 'ama-testing/e2e';
import { ProcessContentPage } from 'ama-testing/e2e';

describe('Delete process', () => {
    const adminUser = {
        user: testConfig.ama.user,
        password: testConfig.ama.password
    };

    const authenticatedPage = new AuthenticatedPage(testConfig);
    const snackBar = new SnackBar();
    const deleteEntityDialog = new DeleteEntityDialog();
    let processContentPage: ProcessContentPage;
    let projectContentPage: ProjectContentPage;

    let backend: Backend;
    let project: NodeEntry;
    let process: NodeEntry;

    beforeAll(async () => {
        backend = await getBackend(testConfig).setUp();
        project = await backend.project.create();

        const loginPage = LoginPage.get();
        await loginPage.navigateTo();
        await loginPage.login(adminUser.user, adminUser.password);
    });

    afterAll(async () => {
        await backend.project.delete(project.entry.id);
        await backend.tearDown();
        await authenticatedPage.logout();
    });

    beforeEach(async () => {
        process = await backend.process.create(project.entry.id);
        projectContentPage = new ProjectContentPage(testConfig, project.entry.id);
        processContentPage = new ProcessContentPage(testConfig, project.entry.id, process.entry.id);
        await processContentPage.navigateTo();
        await processContentPage.isLoaded();
        await processContentPage.deleteProcess();
    });

    it('[C282019] Delete process with confirmation', async () => {
        await deleteEntityDialog.checkDialogAndConfirm('process');
        await expect(await snackBar.isDeletedSuccessfully('process')).toBe(true, 'Process deletion snackbar message was not displayed properly.');
        await expect(await projectContentPage.isModelNotInList('process', process.entry.id)).toBe(true, 'Process was not removed from the left sidebar.');
        await expect(await processContentPage.isUnloaded()).toBe(true, 'After process deletion, the process editor should be unloaded');
    });

    it('[C286409] Prevent deletion of process if confirmation is rejected', async () => {
        await deleteEntityDialog.checkDialogAndReject('process');
        await expect(await projectContentPage.isModelInList('process', process.entry.name)).toBe(true, 'Process should be in the left sidebar');
    });
});
