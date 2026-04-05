// SPDX-License-Identifier: PMPL-1.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>

// nesy-solver dev server — Deno serves static files + proxies the API.
// E3 wires /api/prove and /api/strategy to the V-lang backend
// (proven-nesy-solver-api running on NESY_BACKEND_URL, default :9000),
// which forwards to echidna (:8090) and verisim-api (:8080).
//
// When the backend is unreachable the handlers degrade to a mock response
// with `mock: true` so the frontend never 500s.

import { serveDir } from "@std/http/file-server";
import { join } from "@std/path";

// Default port 8787 to avoid collision with verisim-api (8080) on the dev host.
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const BACKEND_URL = Deno.env.get("NESY_BACKEND_URL") ?? "http://localhost:9000";
const ROOT = new URL(".", import.meta.url).pathname;

/** POST /api/prove — proxies to V backend /prove, degrades to mock on failure. */
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

  try {
    const resp = await fetch(`${BACKEND_URL}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, obligationClass, prover, content }),
      signal: AbortSignal.timeout(30_000),
    });
    const bodyText = await resp.text();
    return new Response(bodyText, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.warn(`backend unreachable: ${err.message} — returning mock`);
    return json(mockProveResponse({ language, obligationClass, prover, content }));
  }
}

/** GET /api/strategy?class=safety — proxies to V backend /strategy/:class. */
async function handleStrategy(req) {
  const url = new URL(req.url);
  const cls = url.searchParams.get("class") ?? "safety";
  try {
    const resp = await fetch(`${BACKEND_URL}/strategy/${encodeURIComponent(cls)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const bodyText = await resp.text();
    return new Response(bodyText, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.warn(`backend unreachable: ${err.message} — returning mock strategy`);
    return json({
      mock: true,
      obligation_class: cls,
      recommendations: [{ prover: "z3", success_rate: 0, avg_duration_ms: 0, total_attempts: 0 }],
    });
  }
}

/** GET /api/health — aggregates frontend + backend health. */
async function handleHealth() {
  let backend = null;
  try {
    const resp = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    if (resp.ok) backend = await resp.json();
  } catch (_err) {
    backend = { reachable: false, url: BACKEND_URL };
  }
  return json({
    status: "ok",
    version: "0.1.0",
    frontend_port: PORT,
    backend_url: BACKEND_URL,
    backend,
  });
}

/** Mock prove response used when the V backend is unreachable. */
function mockProveResponse({ language, obligationClass, prover, content }) {
  const valid = /check-sat|Qed|refl|Refl|by\s/.test(content);
  const resolvedProver = prover === "auto" ? pickProver(obligationClass, language) : prover;
  const duration_ms = 20 + Math.floor(Math.random() * 80);
  return {
    valid,
    outcome: valid ? "success" : "failure",
    prover: resolvedProver,
    duration_ms,
    goals_remaining: valid ? 0 : 1,
    tactics_used: valid ? 3 : 0,
    obligation_class: obligationClass,
    language,
    strategy_tag: "mock-handler",
    prover_output: valid
      ? `; ${resolvedProver} OK (mock)\n; ${content.split("\n").length} lines processed`
      : `; ${resolvedProver} could not dispatch (mock)\n; backend ${BACKEND_URL} unreachable`,
    attempt_id: null,
    recorded: false,
    mock: true,
  };
}

function pickProver(obligationClass, language) {
  const byLang = { smtlib: "Z3", lean: "Lean", coq: "Coq", idris2: "Idris2", agda: "Agda" };
  const byClass = {
    safety: "Z3", linearity: "Idris2", termination: "Agda",
    equiv: "Lean", correctness: "Coq",
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

async function handler(req) {
  const url = new URL(req.url);

  if (url.pathname === "/api/prove" && req.method === "POST") return handleProve(req);
  if (url.pathname === "/api/strategy" && req.method === "GET") return handleStrategy(req);
  if (url.pathname === "/api/health" && req.method === "GET") return handleHealth();

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await Deno.readTextFile(join(ROOT, "index.html"));
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return serveDir(req, { fsRoot: ROOT, showIndex: false, quiet: true });
}

console.log(`nesy-solver dev server listening on http://localhost:${PORT}`);
console.log(`  backend: ${BACKEND_URL}`);
Deno.serve({ port: PORT }, handler);
