// SPDX-License-Identifier: PMPL-1.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>

// Placeholder ReScript entry for E1.5 — will replace public/app.js once the
// ReScript toolchain is wired. For E1, public/app.js handles the UI directly
// so we can deploy a working preview without blocking on a full build pipeline.

let version = "0.1.0"
let phase = "E1 — static scaffold (ReScript wiring deferred to E1.5)"

// Keep a simple hello function so the file compiles meaningfully when the
// rescript compiler is invoked. It does nothing in the current build.
let hello = () => {
  Js.Console.log(`nesy-solver ${version} [${phase}]`)
}
