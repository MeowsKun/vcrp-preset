// The Pura Director engines (VCRP).
//
// Pura's Director Preset 16.0, by Pura (https://platberlitz.github.io), as two engines.
// Their text is not stored here: it is assembled from the reader's Pura settings out of
// data/pura.js (generated from Pura's own preset) by src/vcrp/pura/index.js.
//
//   ORIGINAL  Pura's writing text word for word, with Pura's own controls.
//   ADAPTED   the same core, reworded only where VCRP's modules take over.

const base = { color: "#ec4899", isNew: true, p1: "", p2: "", p3: "", p4: "", p5: "", p6: "" };

export const modes_pura = [
    { ...base, id: "pura-original", label: "Pura Director · Original", pura: "original" },
    { ...base, id: "pura-adapted", label: "Pura Director · Adapted", pura: "adapted" },
];
