// The preset list, in display order.
//
// Order matters — it is the order presets appear in the PRESETS & COT tab, and
// newest-first is deliberate. Adding a preset generation means adding a file
// here and one line below; adding a preset to an existing generation means
// editing only that generation's file.

// VCRP: only the V10 engines ship; the V4-V9 generations were removed.
import { modes_v10 } from "./v10.js";

export const modes = [
    ...modes_v10,
];
