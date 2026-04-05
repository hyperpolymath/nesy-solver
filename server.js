// SPDX-License-Identifier: PMPL-1.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>

// nesy-solver dev server — Deno (NOT Node) serves static files + stub API.
// E3 will replace /api/prove with a proxy to proven-server → echidna :8090.

import { serveDir } from "@std/http/file-server";
import { join } from "@std/path";

// Default port 8787 to avoid collision with verisim-api (8080) on the dev host.
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const ROOT = new URL(".", import.meta.url).pathname;

/**
 * Mock prove handler. Mirrors echidna /api/verify response shape so the
 * frontend contract is stable before E3 wires the real backend.
 *
 * Request shape:  { language, obligationClass, prover, content }
 * Response shape: { valid, duration_ms, goals_remaining, tactics_used,
 *                   prover, strategy_tag, prover_output, mock: true }
 */
async function handleProve(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { language, obligationClass, prover, content } = body ?? {};
  if (typeof content !== "string" || content.length === 0) {
    return json({ error: "content required" }, 400);
  }

  // Deterministic mock: "valid" iff content references `check-sat`, `Qed`, `refl`, `Refl`, or `by`.
  const valid = /check-sat|Qed|refl|Refl|by\s/.test(content);
  const resolvedProver = prover === "auto" ? pickProver(obligationClass, language) : prover;
  const duration_ms = 20 + Math.floor(Math.random() * 80);

  return json({
    valid,
    duration_ms,
    goals_remaining: valid ? 0 : 1,
    tactics_used: valid ? 3 : 0,
    prover: resolvedProver,
    obligation_class: obligationClass,
    language,
    strategy_tag: "mock-handler",
    prover_output: valid
      ? `; ${resolvedProver} OK (mock)\n; ${content.split("\n").length} lines processed`
      : `; ${resolvedProver} could not dispatch (mock)\n; E3 will wire real echidna backend`,
    mock: true,
  });
}

/** Crude strategy fallback — replaced in E3 by verisim-api /strategy query. */
function pickProver(obligationClass, language) {
  const byLang = {
    smtlib: "Z3",
    lean: "Lean",
    coq: "Coq",
    idris2: "Idris2",
    agda: "Agda",
  };
  const byClass = {
    safety: "Z3",
    linearity: "Idris2",
    termination: "Agda",
    equiv: "Lean",
    correctness: "Coq",
  };
  return byClass[obligationClass] ?? byLang[language] ?? "Z3";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Serves index.html at root, static files for /public/*, and API for /api/*. */
async function handler(req) {
  const url = new URL(req.url);

  if (url.pathname === "/api/prove" && req.method === "POST") {
    return handleProve(req);
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json({ status: "ok", version: "0.1.0", mode: "mock" });
  }
  if (url.pathname === "/api/strategy" && req.method === "GET") {
    // Mock strategy data — E3 proxies verisim-api /api/v1/proof_attempts/strategy
    return json({
      mock: true,
      classes: {
        safety: { top: "Z3", success_rate: 0.92, n: 24 },
        linearity: { top: "Idris2", success_rate: 0.78, n: 9 },
        termination: { top: "Agda", success_rate: 0.71, n: 7 },
      },
    });
  }

  // Static files
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await Deno.readTextFile(join(ROOT, "index.html"));
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return serveDir(req, { fsRoot: ROOT, showIndex: false, quiet: true });
}

console.log(`nesy-solver dev server listening on http://localhost:${PORT}`);
console.log(`  mode: mock (echidna backend wires in E3)`);
Deno.serve({ port: PORT }, handler);
