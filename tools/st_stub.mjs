// Builds a fake SillyTavern tree around a copy of the extension, so it can be imported in Node.
//
// Every SillyTavern export the extension imports is stubbed. A stub reads its value from
// globalThis.__ST__[name] at load time when the test provides one, and is otherwise a
// harmless catch-all. Used by link_check.mjs and test_fork.mjs.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CATCH_ALL = "new Proxy(function(){}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : anything), apply: () => anything, construct: () => anything })";

/** Copies the extension into a fresh fake ST tree and writes the stubs. Returns the extension path. */
export function buildFakeTree(label) {
    const root = join(tmpdir(), `vcrp-${label}`);
    const ext = join(root, "public", "scripts", "extensions", "third-party", "vcrp-preset");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(ext, { recursive: true });
    for (const f of readdirSync(REPO)) {
        if ([".git", "Screenshots", "img", "tools"].includes(f)) continue;
        cpSync(join(REPO, f), join(ext, f), { recursive: true });
    }

    const jsFiles = [];
    (function walk(d) {
        for (const f of readdirSync(d)) {
            const p = join(d, f);
            if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) jsFiles.push(p);
        }
    })(ext);

    // `import a, { b, c as d } from "x"` and re-exports `export { b, c } from "x"` that leave the extension.
    const importRe = /(?:import|export)\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?(?:\*\s+as\s+[\w$]+)?\s*from\s*["']([^"']+)["']/g;
    const stubs = new Map();
    for (const file of jsFiles) {
        for (const m of readFileSync(file, "utf8").matchAll(importRe)) {
            const target = resolve(dirname(file), m[3]);
            if (target.startsWith(ext + sep)) continue;
            if (!stubs.has(target)) stubs.set(target, new Set());
            if (m[1]) stubs.get(target).add("default");
            (m[2] || "").split(",").map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach(n => stubs.get(target).add(n));
        }
    }
    for (const [path, names] of stubs) {
        mkdirSync(dirname(path), { recursive: true });
        let code = `const anything = ${CATCH_ALL};\nconst ST = globalThis.__ST__ || {};\n`;
        for (const n of names) {
            code += n === "default"
                ? "export default ST.default ?? anything;\n"
                : `export const ${n} = ST[${JSON.stringify(n)}] ?? anything;\n`;
        }
        writeFileSync(path, code);
    }
    return { ext, jsFiles, stubs };
}

/** Minimal browser globals so module-level code can run. */
export function installBrowserGlobals() {
    const $stub = new Proxy(function () { return $stub; }, { get: (t, k) => (k === "then" ? undefined : $stub) });
    Object.assign(globalThis, {
        window: globalThis, jQuery: () => {}, $: $stub,
        toastr: { info() {}, success() {}, error() {}, warning() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: {
            addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
            createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} },
        },
    });
    if (!globalThis.SillyTavern) globalThis.SillyTavern = { getContext: () => new Proxy({}, { get: () => $stub }) };
}
