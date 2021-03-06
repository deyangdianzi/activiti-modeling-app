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

import { Actions, Effect, ofType } from '@ngrx/effects';
import { Inject, Injectable } from '@angular/core';
import { catchError, filter, map, mergeMap, switchMap, tap, withLatestFrom } from 'rxjs/operators';
import { forkJoin, Observable, of, zip } from 'rxjs';
import { Router } from '@angular/router';

import {
    CHANGED_PROCESS_DIAGRAM,
    ChangedProcessAction,
    CREATE_PROCESS_ATTEMPT,
    CREATE_PROCESS_SUCCESS,
    CreateProcessAttemptAction,
    CreateProcessSuccessAction,
    DELETE_PROCESS_ATTEMPT,
    DELETE_PROCESS_SUCCESS,
    DeleteProcessAttemptAction,
    DeleteProcessSuccessAction,
    DOWNLOAD_PROCESS_DIAGRAM,
    DownloadProcessAction,
    DOWNLOAD_PROCESS_SVG_IMAGE,
    DownloadProcessSVGImageAction,
    GET_PROCESS_ATTEMPT,
    GET_PROCESSES_ATTEMPT,
    GetProcessAttemptAction,
    GetProcessesAttemptAction,
    GetProcessesSuccessAction,
    GetProcessSuccessAction,
    REMOVE_DIAGRAM_ELEMENT,
    RemoveDiagramElementAction,
    RemoveElementMappingAction,
    SelectModelerElementAction,
    SHOW_PROCESSES,
    ShowProcessesAction,
    UPDATE_PROCESS_ATTEMPT,
    UPDATE_PROCESS_FAILED,
    UPDATE_PROCESS_SUCCESS,
    UpdateProcessAttemptAction,
    UpdateProcessFailedAction,
    UpdateProcessPayload,
    UpdateProcessSuccessAction,
    UPLOAD_PROCESS_ATTEMPT,
    UploadProcessAttemptAction,
    VALIDATE_PROCESS_ATTEMPT,
    ValidateProcessAttemptAction,
    ValidateProcessPayload,
    DeleteProcessExtensionAction,
    OpenSaveAsProcessAction,
    OPEN_PROCESS_SAVE_AS_FORM,
    SAVE_AS_PROCESS_ATTEMPT,
    SaveAsProcessAttemptAction
} from './process-editor.actions';
import {
    AmaState,
    BpmnElement,
    createModelName,
    EntityDialogForm,
    GeneralError,
    SetApplicationLoadingStateAction,
    LogFactoryService,
    ModelClosedAction,
    ModelOpenedAction,
    OpenConfirmDialogAction,
    PROCESS,
    Process,
    ProcessModelerService,
    ProcessModelerServiceToken,
    selectOpenedModel,
    selectSelectedProcess,
    selectSelectedProjectId,
    SetAppDirtyStateAction,
    SnackbarErrorAction,
    SnackbarInfoAction,
    UPDATE_SERVICE_PARAMETERS,
    UploadFileAttemptPayload,
    ErrorResponse,
    SaveAsDialogPayload,
    SaveAsDialogComponent,
    DialogService,
    ModelExtensions
} from '@alfresco-dbp/modeling-shared/sdk';
import { ProcessEditorService } from '../services/process-editor.service';
import { selectProcessesLoaded, selectSelectedElement } from './process-editor.selectors';
import { Store } from '@ngrx/store';
import { getProcessLogInitiator, PROCESS_SVG_IMAGE } from '../services/process-editor.constants';
import { ProcessValidationResponse } from './process-editor.state';

export const PROCESS_CONTENT_TYPE = 'text/xml';
export const XML_PROCESS_TAG = 'bpmn2:process';
export const XML_DOCUMENTATION_TAG = 'bpmn2:documentation';
export const XML_NAME_ATTRIBUTE = 'name';
export const XML_BPMNDI_PLANE_TAG = 'bpmndi:BPMNPlane';
export const XML_BPMNDI_PLANE_ELEMENT_ATTRIBUTE = 'bpmnElement';
export const XML_DEFINITIONS_TAG = 'bpmn2:definitions';

@Injectable()
export class ProcessEditorEffects {

    constructor(
        private store: Store<AmaState>,
        private actions$: Actions,
        private dialogService: DialogService,
        private processEditorService: ProcessEditorService,
        private logFactory: LogFactoryService,
        private router: Router,
        @Inject(ProcessModelerServiceToken) private processModelerService: ProcessModelerService
    ) {}

    @Effect()
    showProcessesEffect = this.actions$.pipe(
        ofType<ShowProcessesAction>(SHOW_PROCESSES),
        map(action => action.projectId),
        switchMap(projectId => zip(of(projectId), this.store.select(selectProcessesLoaded))),
        switchMap(([projectId, loaded]) => loaded ? of() : of(new GetProcessesAttemptAction(projectId)))
    );

    @Effect()
    getProcessesEffect = this.actions$.pipe(
        ofType<GetProcessesAttemptAction>(GET_PROCESSES_ATTEMPT),
        switchMap(action => this.getProcesses(action.projectId))
    );

    @Effect()
    removeDiagramElementEffect = this.actions$.pipe(
        ofType<RemoveDiagramElementAction>(REMOVE_DIAGRAM_ELEMENT),
        filter(action => [BpmnElement.ServiceTask, BpmnElement.UserTask, BpmnElement.CallActivity, BpmnElement.Participant].includes(<BpmnElement>action.element.type)),
        mergeMap(action => zip(of(action), this.store.select(selectOpenedModel))),
        mergeMap(([action, process]) => action.element.type === BpmnElement.Participant ?
            of(new DeleteProcessExtensionAction(process.id, action.element.processId)) :
            of(new RemoveElementMappingAction(action.element.id, process.id, action.element.processId))
        )
    );

    @Effect()
    createProcessEffect = this.actions$.pipe(
        ofType<CreateProcessAttemptAction>(CREATE_PROCESS_ATTEMPT),
        mergeMap(action => zip(of(action), this.store.select(selectSelectedProjectId))),
        mergeMap(([action, projectId]) => this.createProcess(action.payload, action.navigateTo, projectId))
    );

    @Effect()
    uploadProcessEffect = this.actions$.pipe(
        ofType<UploadProcessAttemptAction>(UPLOAD_PROCESS_ATTEMPT),
        switchMap(action => this.uploadProcess(action.payload))
    );

    @Effect()
    deleteProcessEffect = this.actions$.pipe(
        ofType<DeleteProcessAttemptAction>(DELETE_PROCESS_ATTEMPT),
        map(action => action.processId),
        mergeMap(processId => this.deleteProcess(processId))
    );

    @Effect({ dispatch: false })
    deleteProcessSuccessEffect = this.actions$.pipe(
        ofType<DeleteProcessSuccessAction>(DELETE_PROCESS_SUCCESS),
        withLatestFrom(this.store.select(selectSelectedProjectId)),
        map(([action, projectId]) => {
            this.router.navigate(['/projects', projectId]);
        })
    );

    @Effect({ dispatch: false })
    createProcessSuccessEffect = this.actions$.pipe(
        ofType<CreateProcessSuccessAction>(CREATE_PROCESS_SUCCESS),
        withLatestFrom(this.store.select(selectSelectedProjectId)),
        tap(([action, projectId]) => {
            if (action.navigateTo) {
                this.router.navigate(['/projects', projectId, 'process', action.process.id]);
            }
        })
    );

    @Effect()
    updateProcessEffect = this.actions$.pipe(
        ofType<UpdateProcessAttemptAction>(UPDATE_PROCESS_ATTEMPT),
        map(action => action.payload),
        mergeMap(payload => zip(of(payload), this.store.select(selectSelectedProcess), this.store.select(selectSelectedProjectId))),
        mergeMap(([payload, process, projectId]) => this.updateProcess(payload, process, projectId))
    );

    @Effect()
    updateProcessSuccessEffect = this.actions$.pipe(
        ofType<UpdateProcessSuccessAction>(UPDATE_PROCESS_SUCCESS),
        mergeMap(() => of(new SetApplicationLoadingStateAction(false)))
    );

    @Effect()
    updateProcessFailedEffect = this.actions$.pipe(
        ofType<UpdateProcessFailedAction>(UPDATE_PROCESS_FAILED),
        mergeMap(() => of(new SetApplicationLoadingStateAction(false)))
    );

    @Effect()
    validateProcessEffect = this.actions$.pipe(
        ofType<ValidateProcessAttemptAction>(VALIDATE_PROCESS_ATTEMPT),
        withLatestFrom(this.store.select(selectSelectedProjectId)),
        mergeMap(([action, projectId]) => this.validateProcess({...action.payload, projectId}))
    );

    @Effect()
    getProcessEffect = this.actions$.pipe(
        ofType<GetProcessAttemptAction>(GET_PROCESS_ATTEMPT),
        mergeMap(action => zip(of(action.payload), this.store.select(selectSelectedProjectId))),
        mergeMap(([processId, projectId]) => this.getProcess(processId, projectId))
    );

    @Effect({ dispatch: false })
    downloadProcessEffect = this.actions$.pipe(
        ofType<DownloadProcessAction>(DOWNLOAD_PROCESS_DIAGRAM),
        map(({ process }) => this.downloadProcessDiagram(process.id, process.name))
    );

    @Effect({ dispatch: false })
    downloadProcessSVGImageEffect = this.actions$.pipe(
        ofType<DownloadProcessSVGImageAction>(DOWNLOAD_PROCESS_SVG_IMAGE),
        map(({ process }) => this.downloadProcessSVGImage(process.name))
    );

    @Effect()
    changedProcessDiagramEffect = this.actions$.pipe(
        ofType(CHANGED_PROCESS_DIAGRAM),
        mergeMap(() => of(new SetAppDirtyStateAction(true)))
    );

    @Effect()
    updateServiceParameterSEffect = this.actions$.pipe(
        ofType(UPDATE_SERVICE_PARAMETERS),
        mergeMap(() => of(new SetAppDirtyStateAction(true)))
    );

    @Effect()
    changedElementEffect = this.actions$.pipe(
        ofType<ChangedProcessAction>(CHANGED_PROCESS_DIAGRAM),
        map(action => action.element),
        mergeMap(element => zip(of(element), this.store.select(selectSelectedElement))),
        filter(([element, selected]) => {
            return (
                selected !== null &&
                selected.id === element.id &&
                (selected.name !== element.name || selected.type !== element.type)
            );
        }),
        mergeMap(([element, selected]) => of(new SelectModelerElementAction(element)))
    );

    @Effect({ dispatch: false })
    openSaveAsProcessEffect = this.actions$.pipe(
        ofType<OpenSaveAsProcessAction>(OPEN_PROCESS_SAVE_AS_FORM),
        tap((action) => this.openSaveAsProcessDialog(action.dialogData))
    );

    @Effect()
    saveAsProcessEffect = this.actions$.pipe(
        ofType<SaveAsProcessAttemptAction>(SAVE_AS_PROCESS_ATTEMPT),
        mergeMap((action) => zip(of(action), this.store.select(selectSelectedProjectId))),
        mergeMap(([action, projectId]) => this.saveAsProcess(action.payload, action.navigateTo, projectId))
    );

    private validateProcess(payload: ValidateProcessPayload) {
        return this.processEditorService.validate(payload.processId, payload.content, payload.projectId, payload.extensions).pipe(
            switchMap(() => [new SetApplicationLoadingStateAction(true), payload.action, new SetApplicationLoadingStateAction(false)]),
            catchError((response) => {
                const parsedResponse = JSON.parse(response.message);

                if (parsedResponse.status !== 400) {
                    return of(null);
                }

                const errors = this.handleProcessValidationError(parsedResponse);
                if (payload.errorAction) {
                    return [
                        payload.errorAction,
                        this.logFactory.logError(getProcessLogInitiator(), errors)
                    ];
                }
                return [
                    new OpenConfirmDialogAction({
                        dialogData: {
                            title: payload.title || 'APP.DIALOGS.CONFIRM.TITLE',
                            subtitle: 'APP.DIALOGS.ERROR.SUBTITLE',
                            messages: errors
                        },
                        action: payload.action
                    }),
                    this.logFactory.logError(getProcessLogInitiator(), errors)
                ];
            })
        );
    }

    private updateProcess(payload: UpdateProcessPayload, process: Process, projectId: string): Observable<SnackbarErrorAction | {}> {
        return this.processEditorService.update(
            payload.processId,
            { ...process, ...payload.metadata },
            payload.content,
            projectId
        ).pipe(
            switchMap((updateResponse) => [
                new SetApplicationLoadingStateAction(true),
                new UpdateProcessSuccessAction({
                    id: payload.processId,
                    changes: {
                        ...payload.metadata,
                        version: updateResponse.version
                    }
                }, payload.content),
                new SetAppDirtyStateAction(false),
                this.logFactory.logInfo(getProcessLogInitiator(), 'PROCESS_EDITOR.PROCESS_SAVED'),
                new SnackbarInfoAction('PROCESS_EDITOR.PROCESS_SAVED')
            ]),
            catchError(e => this.handleProcessUpdatingError(e)));
    }

    private downloadProcessDiagram(processId: string, processName: string) {
        const name = createModelName(processName);
        return this.processModelerService
            .export()
            .then(data => this.processEditorService.downloadDiagram(name, data))
            .catch(_ => this.handleError('APP.PROCESSES.ERRORS.DOWNLOAD_DIAGRAM'));
    }

    private downloadProcessSVGImage(processName: string) {
        const name = createModelName(processName);
        return this.processModelerService
            .export(PROCESS_SVG_IMAGE)
            .then(data => this.processEditorService.downloadSVGImage(name, data))
            .catch(_ => this.handleError('APP.PROCESSES.ERRORS.DOWNLOAD_SVG_IMAGE'));
    }

    private getProcess(processId: string, projectId: string) {
        const processDetails$ = this.processEditorService.getDetails(processId, projectId),
            processDiagram$ = this.processEditorService.getDiagram(processId);

        return forkJoin(processDetails$, processDiagram$).pipe(
            switchMap(([process, diagram]) => [
                new GetProcessSuccessAction({ process, diagram }),
                new ModelOpenedAction({ id: process.id, type: process.type }),
                new SetAppDirtyStateAction(false)
            ]),
            catchError(e =>
                this.handleError('PROCESS_EDITOR.ERRORS.LOAD_DIAGRAM')));
    }

    private uploadProcess(payload: UploadFileAttemptPayload): Observable<void | {} | SnackbarInfoAction | CreateProcessSuccessAction> {
        return this.processEditorService.upload(payload).pipe(
            switchMap(process => [
                new CreateProcessSuccessAction(process, true),
                new SnackbarInfoAction('PROCESS_EDITOR.UPLOAD_SUCCESS')
            ]),
            catchError(_ => this.handleError('PROJECT_EDITOR.ERROR.UPLOAD_FILE')));
    }

    private getProcesses(projectId: string): Observable<{} | GetProcessesSuccessAction> {
        return this.processEditorService.getAll(projectId).pipe(
            switchMap(processes => of(new GetProcessesSuccessAction(processes))),
            catchError(_ => this.handleError('PROJECT_EDITOR.ERROR.LOAD_MODELS')));
    }

    private deleteProcess(processId: string): Observable<{} | SnackbarInfoAction | DeleteProcessSuccessAction> {
        return this.processEditorService.delete(processId).pipe(
            switchMap(() => [
                new DeleteProcessSuccessAction(processId),
                new SetAppDirtyStateAction(false),
                new ModelClosedAction({ id: processId, type: PROCESS }),
                new SnackbarInfoAction('PROJECT_EDITOR.PROCESS_DIALOG.PROCESS_DELETED')
            ]),
            catchError(_ => this.handleError('PROJECT_EDITOR.ERROR.DELETE_PROCESS')));
    }

    private createProcess(form: Partial<EntityDialogForm>, navigateTo: boolean, projectId: string): Observable<{} | SnackbarInfoAction | CreateProcessSuccessAction> {
        return this.processEditorService.create(form, projectId).pipe(
            switchMap((process) => [
                new CreateProcessSuccessAction(process, navigateTo),
                new SnackbarInfoAction('PROJECT_EDITOR.PROCESS_DIALOG.PROCESS_CREATED')
            ]),
            catchError(e => this.handleProcessCreationError(e)));
    }

    private handleError(userMessage: string): Observable<SnackbarErrorAction> {
        return of(new SnackbarErrorAction(userMessage));
    }

    private handleProcessUpdatingError(error: ErrorResponse): Observable<SnackbarErrorAction | {}> {
        let errorMessage;
        const message = error.message ? JSON.parse(error.message) : {};

        if (error.status === 409) {
            errorMessage = 'PROJECT_EDITOR.ERROR.UPDATE_PROCESS.DUPLICATION';
        } else if (message.errors && (message.errors[0].code === 'model.invalid.name.empty')) {
            errorMessage = 'PROJECT_EDITOR.ERROR.UPDATE_PROCESS.EMPTY_NAME';
        } else {
            errorMessage = 'PROJECT_EDITOR.ERROR.UPDATE_PROCESS.GENERAL';
        }
        return of(new SnackbarErrorAction(errorMessage), new UpdateProcessFailedAction());
    }

    private handleProcessCreationError(error: ErrorResponse): Observable<SnackbarErrorAction> {
        let errorMessage;

        if (error.status === 409) {
            errorMessage = 'PROJECT_EDITOR.ERROR.CREATE_PROCESS.DUPLICATION';
        } else {
            errorMessage = 'PROJECT_EDITOR.ERROR.CREATE_PROCESS.GENERAL';
        }

        return of(new SnackbarErrorAction(errorMessage));
    }

    private handleProcessValidationError(response: ProcessValidationResponse): string[] {
        if (response.errors) {
            return response.errors.map((error: GeneralError) => error.description);
        }
        return [response.message];
    }

    private openSaveAsProcessDialog(data: SaveAsDialogPayload) {
        this.dialogService.openDialog(SaveAsDialogComponent, { data });
    }

    private saveAsProcess(
        processPayload: Partial<SaveAsDialogPayload>,
        navigateTo: boolean,
        projectId: string): Observable<{} | SnackbarInfoAction | CreateProcessSuccessAction> {
        return this.processEditorService.create({ name: processPayload.name, description: processPayload.description }, projectId).pipe(
            tap((process: Process) => this.updateProcessExtensionsOnSaveAs(processPayload, process)),
            tap((process: Process) => processPayload.sourceContent = this.updateContentOnSaveAs(processPayload.sourceContent,
                 this.getProcessKey(process.extensions), processPayload.name, processPayload.description)),
            mergeMap((process: Process) => this.processEditorService.update(process.id, process, processPayload.sourceContent, projectId)),
            switchMap((process: Process) => [
                new CreateProcessSuccessAction(process, navigateTo),
                new SnackbarInfoAction('PROJECT_EDITOR.PROCESS_DIALOG.PROCESS_CREATED')
            ]),
            catchError(e => this.handleProcessCreationError(e)));
    }

    private getProcessKey(extensions: ModelExtensions): string {
        return Object.keys(extensions)[0];
    }

    private updateProcessExtensionsOnSaveAs(processPayload: Partial<SaveAsDialogPayload>, process: Process) {
        processPayload.sourceExtensions = {
            [this.getProcessKey(process.extensions)]: {
                ...processPayload.sourceExtensions[this.getProcessKey(processPayload.sourceExtensions)]
            }
        };
        process.extensions = processPayload.sourceExtensions;
    }

    private updateContentOnSaveAs(sourceContent: string, processKeyId: string, name: string, documentation: string): string {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(sourceContent, PROCESS_CONTENT_TYPE);
        this.updateProcessKeyId(xmlDoc, processKeyId);
        this.updateProcessName(xmlDoc, name);
        this.updateProcessDocumentation(xmlDoc, documentation);
        return xmlDoc.documentElement.outerHTML;
    }

    private updateProcessKeyId(xmlDoc: Document, processKeyId: string) {
        xmlDoc.getElementsByTagName(XML_PROCESS_TAG)[0].id = processKeyId;
        xmlDoc.getElementsByTagName(XML_BPMNDI_PLANE_TAG)[0].setAttribute(XML_BPMNDI_PLANE_ELEMENT_ATTRIBUTE, processKeyId);
    }

    private updateProcessName(xmlDoc: Document, name: string) {
        xmlDoc.getElementsByTagName(XML_PROCESS_TAG)[0].setAttribute(XML_NAME_ATTRIBUTE, name);
        xmlDoc.getElementsByTagName(XML_DEFINITIONS_TAG)[0].setAttribute(XML_NAME_ATTRIBUTE, name);
    }

    private updateProcessDocumentation(xmlDoc: Document, documentation: string) {
        const documentationTag = xmlDoc.getElementsByTagName(XML_DOCUMENTATION_TAG);
        if (!documentation) {
            if (documentationTag.length > 0) {
                xmlDoc.getElementsByTagName(XML_DOCUMENTATION_TAG)[0].remove();
            }
        } else {
            if (documentationTag.length > 0) {
                xmlDoc.getElementsByTagName(XML_DOCUMENTATION_TAG)[0].textContent = documentation;
            } else {
                this.addDocumentationTagToContent(xmlDoc, documentation);
            }
        }
    }

    private addDocumentationTagToContent(xmlDoc: Document, documentation: string) {
        const documentationElement = xmlDoc.createElement(XML_DOCUMENTATION_TAG);
        documentationElement.innerText = documentation;
        this.getProcessTag(xmlDoc).append(documentationElement);
    }

    private getProcessTag(xmlDoc: Document): Element {
        return xmlDoc.getElementsByTagName(XML_PROCESS_TAG)[0];
    }
}
