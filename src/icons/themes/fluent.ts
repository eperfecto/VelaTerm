//! Fluent UI System Icons (Regular, 20 px) © Microsoft Corporation, MIT; see THIRD-PARTY-NOTICES.md.
//! Files are imported one by one rather than globbed so only the listed icons are bundled, and a renamed
//! upstream file fails the build instead of rendering blank.

import type { IconTheme } from "../types";
import { svgGlyph } from "../svgGlyph";
import chevronRightSvg from "@fluentui/svg-icons/icons/chevron_right_20_regular.svg?raw";
import chevronDownSvg from "@fluentui/svg-icons/icons/chevron_down_20_regular.svg?raw";
import arrowLeftSvg from "@fluentui/svg-icons/icons/arrow_left_20_regular.svg?raw";
import arrowRightSvg from "@fluentui/svg-icons/icons/arrow_right_20_regular.svg?raw";
import arrowUpSvg from "@fluentui/svg-icons/icons/arrow_up_20_regular.svg?raw";
import homeSvg from "@fluentui/svg-icons/icons/home_20_regular.svg?raw";
import menuSvg from "@fluentui/svg-icons/icons/navigation_20_regular.svg?raw";
import moreSvg from "@fluentui/svg-icons/icons/more_horizontal_20_regular.svg?raw";
import collapseSvg from "@fluentui/svg-icons/icons/arrow_minimize_vertical_20_regular.svg?raw";
import expandSvg from "@fluentui/svg-icons/icons/arrow_maximize_vertical_20_regular.svg?raw";
import panelRightClosedSvg from "@fluentui/svg-icons/icons/panel_right_expand_20_regular.svg?raw";
import panelRightOpenSvg from "@fluentui/svg-icons/icons/panel_right_contract_20_regular.svg?raw";
import panelLeftClosedSvg from "@fluentui/svg-icons/icons/panel_left_expand_20_regular.svg?raw";
import panelLeftOpenSvg from "@fluentui/svg-icons/icons/panel_left_contract_20_regular.svg?raw";
import splitVSvg from "@fluentui/svg-icons/icons/split_vertical_20_regular.svg?raw";
import splitHSvg from "@fluentui/svg-icons/icons/split_horizontal_20_regular.svg?raw";
import plusSvg from "@fluentui/svg-icons/icons/add_20_regular.svg?raw";
import minusSvg from "@fluentui/svg-icons/icons/subtract_20_regular.svg?raw";
import checkSvg from "@fluentui/svg-icons/icons/checkmark_20_regular.svg?raw";
import closeSvg from "@fluentui/svg-icons/icons/dismiss_20_regular.svg?raw";
import clearSvg from "@fluentui/svg-icons/icons/backspace_20_regular.svg?raw";
import cancelSvg from "@fluentui/svg-icons/icons/dismiss_circle_20_regular.svg?raw";
import removeSvg from "@fluentui/svg-icons/icons/subtract_circle_20_regular.svg?raw";
import failedSvg from "@fluentui/svg-icons/icons/error_circle_20_regular.svg?raw";
import searchSvg from "@fluentui/svg-icons/icons/search_20_regular.svg?raw";
import filterSvg from "@fluentui/svg-icons/icons/filter_20_regular.svg?raw";
import slidersSvg from "@fluentui/svg-icons/icons/options_20_regular.svg?raw";
import copySvg from "@fluentui/svg-icons/icons/copy_20_regular.svg?raw";
import renameSvg from "@fluentui/svg-icons/icons/rename_20_regular.svg?raw";
import trashSvg from "@fluentui/svg-icons/icons/delete_20_regular.svg?raw";
import undoSvg from "@fluentui/svg-icons/icons/arrow_undo_20_regular.svg?raw";
import sendSvg from "@fluentui/svg-icons/icons/send_20_regular.svg?raw";
import saveSvg from "@fluentui/svg-icons/icons/save_20_regular.svg?raw";
import shareSvg from "@fluentui/svg-icons/icons/share_20_regular.svg?raw";
import externalSvg from "@fluentui/svg-icons/icons/open_20_regular.svg?raw";
import refreshSvg from "@fluentui/svg-icons/icons/arrow_clockwise_20_regular.svg?raw";
import loadingSvg from "@fluentui/svg-icons/icons/spinner_ios_20_regular.svg?raw";
import retrySvg from "@fluentui/svg-icons/icons/arrow_repeat_all_20_regular.svg?raw";
import stopSvg from "@fluentui/svg-icons/icons/stop_20_regular.svg?raw";
import projectSvg from "@fluentui/svg-icons/icons/cube_20_regular.svg?raw";
import projectPlusSvg from "@fluentui/svg-icons/icons/cube_add_20_regular.svg?raw";
import projectOpenSvg from "@fluentui/svg-icons/icons/open_folder_20_regular.svg?raw";
import collectionSvg from "@fluentui/svg-icons/icons/stack_20_regular.svg?raw";
import newGroupSvg from "@fluentui/svg-icons/icons/collections_add_20_regular.svg?raw";
import folderSvg from "@fluentui/svg-icons/icons/folder_20_regular.svg?raw";
import folderFillSvg from "@fluentui/svg-icons/icons/folder_20_filled.svg?raw";
import folderOpenSvg from "@fluentui/svg-icons/icons/folder_open_20_regular.svg?raw";
import folderPlusSvg from "@fluentui/svg-icons/icons/folder_add_20_regular.svg?raw";
import revealSvg from "@fluentui/svg-icons/icons/folder_arrow_right_20_regular.svg?raw";
import driveSvg from "@fluentui/svg-icons/icons/hard_drive_20_regular.svg?raw";
import fileSvg from "@fluentui/svg-icons/icons/document_20_regular.svg?raw";
import filePlusSvg from "@fluentui/svg-icons/icons/document_add_20_regular.svg?raw";
import fileUploadSvg from "@fluentui/svg-icons/icons/arrow_upload_20_regular.svg?raw";
import fileDownloadSvg from "@fluentui/svg-icons/icons/arrow_download_20_regular.svg?raw";
import fileArchiveSvg from "@fluentui/svg-icons/icons/folder_zip_20_regular.svg?raw";
import openInEditorSvg from "@fluentui/svg-icons/icons/document_edit_20_regular.svg?raw";
import terminalSvg from "@fluentui/svg-icons/icons/window_console_20_regular.svg?raw";
import terminalRedrawSvg from "@fluentui/svg-icons/icons/arrow_sync_20_regular.svg?raw";
import globalTerminalSvg from "@fluentui/svg-icons/icons/globe_20_regular.svg?raw";
import botSvg from "@fluentui/svg-icons/icons/bot_20_regular.svg?raw";
import gamepadSvg from "@fluentui/svg-icons/icons/games_20_regular.svg?raw";
import planExecuteSvg from "@fluentui/svg-icons/icons/clipboard_task_list_ltr_20_regular.svg?raw";
import planSvg from "@fluentui/svg-icons/icons/clipboard_text_ltr_20_regular.svg?raw";
import tasksSvg from "@fluentui/svg-icons/icons/task_list_ltr_20_regular.svg?raw";
import workflowSvg from "@fluentui/svg-icons/icons/flowchart_20_regular.svg?raw";
import backgroundStatusSvg from "@fluentui/svg-icons/icons/layer_20_regular.svg?raw";
import runInBackgroundSvg from "@fluentui/svg-icons/icons/arrow_minimize_20_regular.svg?raw";
import sessionImportSvg from "@fluentui/svg-icons/icons/arrow_import_20_regular.svg?raw";
import sessionResumeSvg from "@fluentui/svg-icons/icons/play_circle_20_regular.svg?raw";
import chatRewindSvg from "@fluentui/svg-icons/icons/history_20_regular.svg?raw";
import autoContinueSvg from "@fluentui/svg-icons/icons/fast_forward_20_regular.svg?raw";
import aiActionSvg from "@fluentui/svg-icons/icons/sparkle_20_regular.svg?raw";
import aiSessionTitleSvg from "@fluentui/svg-icons/icons/text_effects_sparkle_20_regular.svg?raw";
import aiCommitMessageSvg from "@fluentui/svg-icons/icons/wand_20_regular.svg?raw";
import elicitationSvg from "@fluentui/svg-icons/icons/chat_help_20_regular.svg?raw";
import mcpSvg from "@fluentui/svg-icons/icons/puzzle_piece_20_regular.svg?raw";
import gitSvg from "@fluentui/svg-icons/icons/branch_20_regular.svg?raw";
import gitCloneSvg from "@fluentui/svg-icons/icons/folder_arrow_left_20_regular.svg?raw";
import gitPushSvg from "@fluentui/svg-icons/icons/cloud_arrow_up_20_regular.svg?raw";
import gitPublishSvg from "@fluentui/svg-icons/icons/arrow_export_up_20_regular.svg?raw";
import gitPullSvg from "@fluentui/svg-icons/icons/cloud_arrow_down_20_regular.svg?raw";
import gitDiscardSvg from "@fluentui/svg-icons/icons/arrow_reset_20_regular.svg?raw";
import branchSvg from "@fluentui/svg-icons/icons/branch_fork_20_regular.svg?raw";
import memoryEntrySvg from "@fluentui/svg-icons/icons/lightbulb_20_regular.svg?raw";
import memoryGlobalSvg from "@fluentui/svg-icons/icons/brain_circuit_20_regular.svg?raw";
import memoryCollectionsSvg from "@fluentui/svg-icons/icons/library_20_regular.svg?raw";
import notebookImportSvg from "@fluentui/svg-icons/icons/document_arrow_up_20_regular.svg?raw";
import notebookTrashSvg from "@fluentui/svg-icons/icons/bin_recycle_20_regular.svg?raw";
import archiveSvg from "@fluentui/svg-icons/icons/archive_20_regular.svg?raw";
import archiveRestoreSvg from "@fluentui/svg-icons/icons/archive_arrow_back_20_regular.svg?raw";
import archiveExportSvg from "@fluentui/svg-icons/icons/arrow_export_20_regular.svg?raw";
import browserTabSvg from "@fluentui/svg-icons/icons/tab_desktop_20_regular.svg?raw";
import browserControlSvg from "@fluentui/svg-icons/icons/globe_search_20_regular.svg?raw";
import browserReloadSvg from "@fluentui/svg-icons/icons/arrow_rotate_clockwise_20_regular.svg?raw";
import browserStopSvg from "@fluentui/svg-icons/icons/dismiss_square_20_regular.svg?raw";
import openInBrowserSvg from "@fluentui/svg-icons/icons/window_new_20_regular.svg?raw";
import compassSvg from "@fluentui/svg-icons/icons/compass_northwest_20_regular.svg?raw";
import webServerSvg from "@fluentui/svg-icons/icons/server_20_regular.svg?raw";
import portsSvg from "@fluentui/svg-icons/icons/connector_20_regular.svg?raw";
import remoteAccessSvg from "@fluentui/svg-icons/icons/phone_desktop_20_regular.svg?raw";
import remoteConnectSvg from "@fluentui/svg-icons/icons/desktop_arrow_right_20_regular.svg?raw";
import publicShareSvg from "@fluentui/svg-icons/icons/globe_person_20_regular.svg?raw";
import accountSvg from "@fluentui/svg-icons/icons/person_20_regular.svg?raw";
import updateDownloadSvg from "@fluentui/svg-icons/icons/arrow_circle_down_20_regular.svg?raw";
import updateReadySvg from "@fluentui/svg-icons/icons/arrow_circle_up_20_regular.svg?raw";
import appRestartSvg from "@fluentui/svg-icons/icons/power_20_regular.svg?raw";
import skillsUpdateSvg from "@fluentui/svg-icons/icons/star_emphasis_20_regular.svg?raw";
import devToolsSvg from "@fluentui/svg-icons/icons/bug_20_regular.svg?raw";
import gearSvg from "@fluentui/svg-icons/icons/settings_20_regular.svg?raw";
import infoSvg from "@fluentui/svg-icons/icons/info_20_regular.svg?raw";
import warnSvg from "@fluentui/svg-icons/icons/warning_20_regular.svg?raw";
import feedbackSvg from "@fluentui/svg-icons/icons/chat_warning_20_regular.svg?raw";
import bellSvg from "@fluentui/svg-icons/icons/alert_20_regular.svg?raw";
import bellOffSvg from "@fluentui/svg-icons/icons/alert_off_20_regular.svg?raw";
import clockSvg from "@fluentui/svg-icons/icons/clock_20_regular.svg?raw";
import lockSvg from "@fluentui/svg-icons/icons/lock_closed_20_regular.svg?raw";
import eyeSvg from "@fluentui/svg-icons/icons/eye_20_regular.svg?raw";
import eyeOffSvg from "@fluentui/svg-icons/icons/eye_off_20_regular.svg?raw";
import cpuSvg from "@fluentui/svg-icons/icons/developer_board_20_regular.svg?raw";
import monitorSvg from "@fluentui/svg-icons/icons/desktop_20_regular.svg?raw";
import sunSvg from "@fluentui/svg-icons/icons/weather_sunny_20_regular.svg?raw";
import moonSvg from "@fluentui/svg-icons/icons/weather_moon_20_regular.svg?raw";
import themeSystemSvg from "@fluentui/svg-icons/icons/dark_theme_20_regular.svg?raw";
import codeSvg from "@fluentui/svg-icons/icons/code_20_regular.svg?raw";
import bracesSvg from "@fluentui/svg-icons/icons/braces_20_regular.svg?raw";
import hashSvg from "@fluentui/svg-icons/icons/number_symbol_20_regular.svg?raw";
import databaseSvg from "@fluentui/svg-icons/icons/database_20_regular.svg?raw";
import fontSvg from "@fluentui/svg-icons/icons/text_font_20_regular.svg?raw";
import docLinesSvg from "@fluentui/svg-icons/icons/document_text_20_regular.svg?raw";
import imageSvg from "@fluentui/svg-icons/icons/image_20_regular.svg?raw";
import musicSvg from "@fluentui/svg-icons/icons/music_note_2_20_regular.svg?raw";
import videoSvg from "@fluentui/svg-icons/icons/video_20_regular.svg?raw";
import spreadsheetSvg from "@fluentui/svg-icons/icons/table_20_regular.svg?raw";
import presentationSvg from "@fluentui/svg-icons/icons/slide_layout_20_regular.svg?raw";
import printSvg from "@fluentui/svg-icons/icons/print_20_regular.svg?raw";
import clipboardSvg from "@fluentui/svg-icons/icons/clipboard_20_regular.svg?raw";
import scissorsSvg from "@fluentui/svg-icons/icons/cut_20_regular.svg?raw";
import shotRectSvg from "@fluentui/svg-icons/icons/rectangle_landscape_20_regular.svg?raw";
import shotEllipseSvg from "@fluentui/svg-icons/icons/circle_20_regular.svg?raw";
import shotArrowSvg from "@fluentui/svg-icons/icons/arrow_up_right_20_regular.svg?raw";
import shotPenSvg from "@fluentui/svg-icons/icons/pen_20_regular.svg?raw";
import shotMosaicSvg from "@fluentui/svg-icons/icons/blur_20_regular.svg?raw";
import shotTextSvg from "@fluentui/svg-icons/icons/text_t_20_regular.svg?raw";

export const fluentTheme: IconTheme = {
  id: "fluent",
  label: "settings.iconThemeFluent",
  viewBox: "0 0 20 20",
  mode: "fill",
  icons: {
    chevronRight: svgGlyph(chevronRightSvg),
    chevronDown: svgGlyph(chevronDownSvg),
    arrowLeft: svgGlyph(arrowLeftSvg),
    arrowRight: svgGlyph(arrowRightSvg),
    arrowUp: svgGlyph(arrowUpSvg),
    home: svgGlyph(homeSvg),
    menu: svgGlyph(menuSvg),
    more: svgGlyph(moreSvg),
    collapse: svgGlyph(collapseSvg),
    expand: svgGlyph(expandSvg),
    panelRightClosed: svgGlyph(panelRightClosedSvg),
    panelRightOpen: svgGlyph(panelRightOpenSvg),
    panelLeftClosed: svgGlyph(panelLeftClosedSvg),
    panelLeftOpen: svgGlyph(panelLeftOpenSvg),
    splitV: svgGlyph(splitVSvg),
    splitH: svgGlyph(splitHSvg),
    plus: svgGlyph(plusSvg),
    minus: svgGlyph(minusSvg),
    check: svgGlyph(checkSvg),
    close: svgGlyph(closeSvg),
    clear: svgGlyph(clearSvg),
    cancel: svgGlyph(cancelSvg),
    remove: svgGlyph(removeSvg),
    failed: svgGlyph(failedSvg),
    search: svgGlyph(searchSvg),
    filter: svgGlyph(filterSvg),
    sliders: svgGlyph(slidersSvg),
    copy: svgGlyph(copySvg),
    rename: svgGlyph(renameSvg),
    trash: svgGlyph(trashSvg),
    undo: svgGlyph(undoSvg),
    send: svgGlyph(sendSvg),
    save: svgGlyph(saveSvg),
    share: svgGlyph(shareSvg),
    external: svgGlyph(externalSvg),
    refresh: svgGlyph(refreshSvg),
    loading: svgGlyph(loadingSvg),
    retry: svgGlyph(retrySvg),
    stop: svgGlyph(stopSvg),
    project: svgGlyph(projectSvg),
    projectPlus: svgGlyph(projectPlusSvg),
    projectOpen: svgGlyph(projectOpenSvg),
    collection: svgGlyph(collectionSvg),
    newGroup: svgGlyph(newGroupSvg),
    folder: svgGlyph(folderSvg, folderFillSvg),
    folderOpen: svgGlyph(folderOpenSvg),
    folderPlus: svgGlyph(folderPlusSvg),
    reveal: svgGlyph(revealSvg),
    drive: svgGlyph(driveSvg),
    file: svgGlyph(fileSvg),
    filePlus: svgGlyph(filePlusSvg),
    fileUpload: svgGlyph(fileUploadSvg),
    fileDownload: svgGlyph(fileDownloadSvg),
    fileArchive: svgGlyph(fileArchiveSvg),
    openInEditor: svgGlyph(openInEditorSvg),
    terminal: svgGlyph(terminalSvg),
    terminalRedraw: svgGlyph(terminalRedrawSvg),
    globalTerminal: svgGlyph(globalTerminalSvg),
    bot: svgGlyph(botSvg),
    gamepad: svgGlyph(gamepadSvg),
    planExecute: svgGlyph(planExecuteSvg),
    plan: svgGlyph(planSvg),
    tasks: svgGlyph(tasksSvg),
    workflow: svgGlyph(workflowSvg),
    backgroundStatus: svgGlyph(backgroundStatusSvg),
    runInBackground: svgGlyph(runInBackgroundSvg),
    sessionImport: svgGlyph(sessionImportSvg),
    sessionResume: svgGlyph(sessionResumeSvg),
    chatRewind: svgGlyph(chatRewindSvg),
    autoContinue: svgGlyph(autoContinueSvg),
    aiAction: svgGlyph(aiActionSvg),
    aiSessionTitle: svgGlyph(aiSessionTitleSvg),
    aiCommitMessage: svgGlyph(aiCommitMessageSvg),
    elicitation: svgGlyph(elicitationSvg),
    mcp: svgGlyph(mcpSvg),
    git: svgGlyph(gitSvg),
    gitClone: svgGlyph(gitCloneSvg),
    gitPush: svgGlyph(gitPushSvg),
    gitPublish: svgGlyph(gitPublishSvg),
    gitPull: svgGlyph(gitPullSvg),
    gitDiscard: svgGlyph(gitDiscardSvg),
    branch: svgGlyph(branchSvg),
    memoryEntry: svgGlyph(memoryEntrySvg),
    memoryGlobal: svgGlyph(memoryGlobalSvg),
    memoryCollections: svgGlyph(memoryCollectionsSvg),
    notebookImport: svgGlyph(notebookImportSvg),
    notebookTrash: svgGlyph(notebookTrashSvg),
    archive: svgGlyph(archiveSvg),
    archiveRestore: svgGlyph(archiveRestoreSvg),
    archiveExport: svgGlyph(archiveExportSvg),
    browserTab: svgGlyph(browserTabSvg),
    browserControl: svgGlyph(browserControlSvg),
    browserReload: svgGlyph(browserReloadSvg),
    browserStop: svgGlyph(browserStopSvg),
    openInBrowser: svgGlyph(openInBrowserSvg),
    compass: svgGlyph(compassSvg),
    webServer: svgGlyph(webServerSvg),
    ports: svgGlyph(portsSvg),
    remoteAccess: svgGlyph(remoteAccessSvg),
    remoteConnect: svgGlyph(remoteConnectSvg),
    publicShare: svgGlyph(publicShareSvg),
    account: svgGlyph(accountSvg),
    updateDownload: svgGlyph(updateDownloadSvg),
    updateReady: svgGlyph(updateReadySvg),
    appRestart: svgGlyph(appRestartSvg),
    skillsUpdate: svgGlyph(skillsUpdateSvg),
    devTools: svgGlyph(devToolsSvg),
    gear: svgGlyph(gearSvg),
    info: svgGlyph(infoSvg),
    warn: svgGlyph(warnSvg),
    feedback: svgGlyph(feedbackSvg),
    bell: svgGlyph(bellSvg),
    bellOff: svgGlyph(bellOffSvg),
    clock: svgGlyph(clockSvg),
    lock: svgGlyph(lockSvg),
    eye: svgGlyph(eyeSvg),
    eyeOff: svgGlyph(eyeOffSvg),
    cpu: svgGlyph(cpuSvg),
    monitor: svgGlyph(monitorSvg),
    sun: svgGlyph(sunSvg),
    moon: svgGlyph(moonSvg),
    themeSystem: svgGlyph(themeSystemSvg),
    code: svgGlyph(codeSvg),
    braces: svgGlyph(bracesSvg),
    hash: svgGlyph(hashSvg),
    database: svgGlyph(databaseSvg),
    font: svgGlyph(fontSvg),
    docLines: svgGlyph(docLinesSvg),
    image: svgGlyph(imageSvg),
    music: svgGlyph(musicSvg),
    video: svgGlyph(videoSvg),
    spreadsheet: svgGlyph(spreadsheetSvg),
    presentation: svgGlyph(presentationSvg),
    print: svgGlyph(printSvg),
    clipboard: svgGlyph(clipboardSvg),
    scissors: svgGlyph(scissorsSvg),
    shotRect: svgGlyph(shotRectSvg),
    shotEllipse: svgGlyph(shotEllipseSvg),
    shotArrow: svgGlyph(shotArrowSvg),
    shotPen: svgGlyph(shotPenSvg),
    shotMosaic: svgGlyph(shotMosaicSvg),
    shotText: svgGlyph(shotTextSvg),
  },
};
