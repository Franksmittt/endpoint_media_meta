/**
 * Google Drive tidy-up — runs in YOUR Google account (script.google.com).
 *
 * HOW TO USE
 * 1. Open https://script.google.com → New project → paste this whole file.
 * 2. Save. Click Run → choose `dryRunOrganize` → Authorize (Drive access).
 * 3. View results: Execution log (View → Logs) or Extensions → Apps Script → Executions.
 * 4. When the plan looks right, set CONFIG.DRY_RUN = false, save, run `runOrganize`.
 *
 * SAFETY
 * - Default is dry run (no moves).
 * - Only touches direct FILE children of the folder you set (not subfolders).
 * - Creates a dated parent folder "Drive cleanup YYYY-MM-DD" with buckets inside.
 * - Does not delete anything. Does not empty Trash.
 *
 * LIMITS
 * - Google caps runtime (~6 min). Huge roots: run in batches or narrow SOURCE_FOLDER_ID.
 */

var CONFIG = {
  /** true = only log what would happen */
  DRY_RUN: true,

  /**
   * Folder to READ files from (only its immediate files, not inside subfolders).
   * Empty string "" = My Drive root (often messy). Or paste a folder ID from the URL:
   * https://drive.google.com/drive/folders/THIS_PART_IS_THE_ID
   */
  SOURCE_FOLDER_ID: "",

  /**
   * Optional: put the cleanup bundle inside this folder instead of root.
   * "" = under My Drive root.
   */
  DESTINATION_PARENT_FOLDER_ID: "",
};

/** Bucket names by MIME type pattern */
var MIME_BUCKETS = [
  { name: "PDFs", test: function (m) { return m === "application/pdf"; } },
  { name: "Images", test: function (m) { return m.indexOf("image/") === 0; } },
  { name: "Video", test: function (m) { return m.indexOf("video/") === 0; } },
  { name: "Audio", test: function (m) { return m.indexOf("audio/") === 0; } },
  {
    name: "Google Docs",
    test: function (m) {
      return m === "application/vnd.google-apps.document";
    },
  },
  {
    name: "Spreadsheets",
    test: function (m) {
      return m === "application/vnd.google-apps.spreadsheet";
    },
  },
  {
    name: "Presentations",
    test: function (m) {
      return m === "application/vnd.google-apps.presentation";
    },
  },
  {
    name: "Archives",
    test: function (m) {
      return (
        m === "application/zip" ||
        m === "application/x-zip-compressed" ||
        m.indexOf("application/x-rar") === 0
      );
    },
  },
];

function getSourceFolder_() {
  if (CONFIG.SOURCE_FOLDER_ID && CONFIG.SOURCE_FOLDER_ID.length > 0) {
    return DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);
  }
  return DriveApp.getRootFolder();
}

function getDestParent_() {
  if (CONFIG.DESTINATION_PARENT_FOLDER_ID && CONFIG.DESTINATION_PARENT_FOLDER_ID.length > 0) {
    return DriveApp.getFolderById(CONFIG.DESTINATION_PARENT_FOLDER_ID);
  }
  return DriveApp.getRootFolder();
}

function bucketNameForMime_(mime) {
  for (var i = 0; i < MIME_BUCKETS.length; i++) {
    if (MIME_BUCKETS[i].test(mime)) return MIME_BUCKETS[i].name;
  }
  return "Other";
}

/**
 * First run this. Check View → Logs (or Executions) for the plan.
 */
function dryRunOrganize() {
  CONFIG.DRY_RUN = true;
  organizeImpl_();
}

/**
 * After dry run looks good: set CONFIG.DRY_RUN = false in the editor, save, run this.
 */
function runOrganize() {
  if (CONFIG.DRY_RUN) {
    throw new Error("Set CONFIG.DRY_RUN = false in the script before runOrganize.");
  }
  organizeImpl_();
}

function organizeImpl_() {
  var source = getSourceFolder_();
  var destParent = getDestParent_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var bundleName = "Drive cleanup " + stamp;

  var bundle = CONFIG.DRY_RUN ? null : getOrCreateChildFolder_(destParent, bundleName);
  if (CONFIG.DRY_RUN) {
    Logger.log("[DRY RUN] Would create folder: %s / %s", destParent.getName(), bundleName);
  }

  var bucketFolders = {};
  var files = source.getFiles();
  var n = 0;
  while (files.hasNext()) {
    var file = files.next();
    n++;
    var mime = file.getMimeType();
    var bucket = bucketNameForMime_(mime);

    if (!bucketFolders[bucket]) {
      if (CONFIG.DRY_RUN) {
        Logger.log(
          "[DRY RUN] Would ensure subfolder under bundle: %s / %s",
          bundleName,
          bucket
        );
        bucketFolders[bucket] = true;
      } else {
        bucketFolders[bucket] = getOrCreateChildFolder_(bundle, bucket);
      }
    }

    var targetFolder = CONFIG.DRY_RUN ? null : bucketFolders[bucket];
    var msg =
      (CONFIG.DRY_RUN ? "[DRY RUN] Would move: " : "Moved: ") +
      file.getName() +
      " → " +
      bundleName +
      "/" +
      bucket +
      " (mime: " +
      mime +
      ")";

    Logger.log(msg);

    if (!CONFIG.DRY_RUN) {
      file.moveTo(targetFolder);
    }
  }

  Logger.log("Done. Files processed: %s (folders in source were left untouched).", n);
}

function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}
