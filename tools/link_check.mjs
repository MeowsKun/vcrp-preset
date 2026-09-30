// Loads the whole extension in Node against a stubbed SillyTavern, to catch broken
// imports/exports and module-level errors without running SillyTavern.
// Run from the repo root:   node tools/link_check.mjs
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildFakeTree, installBrowserGlobals } from "./st_stub.mjs";

const { ext, jsFiles } = buildFakeTree("link-check");
installBrowserGlobals();
try {
    await import(pathToFileURL(join(ext, "index.js")).href);
    console.log(`\nLINK CHECK PASSED: ${jsFiles.length} modules loaded`);
} catch (e) {
    console.error("\nLINK CHECK FAILED:", e);
    process.exit(1);
}
