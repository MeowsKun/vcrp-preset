// Identity constants. Kept apart from state.js because these never change at
// runtime, and because almost every module wants extensionName for the
// extension_settings lookup — importing that shouldn't drag mutable state along.

// extension_settings key. "VCRP" is the key VCRP V8 used, so its profiles carry over.
export const extensionName = "VCRP";
// Derived from where this file was loaded, so the extension works under any folder name
// (e.g. "vcrp-preset" from a git install). This file is src/core/, two levels below the root.
export const extensionFolderPath = new URL("../../", import.meta.url).pathname.replace(/^\/+/, "").replace(/\/+$/, "");
