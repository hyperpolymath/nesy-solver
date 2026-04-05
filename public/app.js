// SPDX-License-Identifier: PMPL-1.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>

// nesy-solver frontend bootstrap — CodeMirror 6 editor + prove dispatcher.
// JS (not TS) per policy; ReScript App.res is parallel and will supersede when wired in E1.5.

import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { StreamLanguage } from "https://esm.sh/@codemirror/language@6.10.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";

// ── Sample obligations keyed by language ─────────────────────────────
const samples = {
  smtlib: `(set-logic QF_LIA)
(declare-const x Int)
(declare-const y Int)
(assert (= (+ x y) 10))
(assert (= (- x y) 4))
(check-sat)
(get-model)
`,
  lean: `theorem add_comm (a b : Nat) : a + b = b + a := by
  induction a with
  | zero => simp
  | succ n ih => simp [Nat.add_succ, Nat.succ_add, ih]
`,
  coq: `Theorem plus_O_n : forall n : nat, 0 + n = n.
Proof.
  intros n.
  simpl.
  reflexivity.
Qed.
`,
  idris2: `plusCommutes : (n, m : Nat) -> n + m = m + n
plusCommutes Z     m = rewrite plusZeroRightNeutral m in Refl
plusCommutes (S k) m = rewrite plusCommutes k m in
                       rewrite plusSuccRightSucc m k in Refl
`,
  agda: `+-comm : (n m : ℕ) → n + m ≡ m + n
+-comm zero    m = sym (+-identityʳ m)
+-comm (suc n) m rewrite +-comm n m | +-suc m n = refl
`,
};

// Minimal streaming languages — enough for highlighting, not full parsing.
// Real LSP integration deferred to E3+.
const smtLang = StreamLanguage.define({
  token(stream) {
    if (stream.match(/\(set-logic|declare-const|declare-fun|assert|check-sat|get-model|define-fun|forall|exists/)) return "keyword";
    if (stream.match(/[A-Za-z_][A-Za-z0-9_\-]*/)) return "variableName";
    if (stream.match(/[0-9]+/)) return "number";
    if (stream.match(/;.*/)) return "lineComment";
    stream.next();
    return null;
  },
});

// ── State ─────────────────────────────────────────────────────────────
let editorView = null;
const editorEl = document.getElementById("editor");
const langSelect = document.getElementById("lang-select");
const classSelect = document.getElementById("class-select");
const proverSelect = document.getElementById("prover-select");
const proveBtn = document.getElementById("prove-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

// ── Editor init ───────────────────────────────────────────────────────
function mountEditor(langKey) {
  const content = samples[langKey] ?? "";
  if (editorView) editorView.destroy();
  editorView = new EditorView({
    doc: content,
    extensions: [
      basicSetup,
      smtLang,
      oneDark,
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "var(--mono)" },
      }),
    ],
    parent: editorEl,
  });
}

// ── Actions ───────────────────────────────────────────────────────────
async function prove() {
  if (!editorView) return;
  const content = editorView.state.doc.toString();
  const language = langSelect.value;
  const obligationClass = classSelect.value;
  const prover = proverSelect.value;

  setStatus("submitting...", "pending");
  proveBtn.disabled = true;

  try {
    const resp = await fetch("/api/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, obligationClass, prover, content }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();
    renderResult(body);
    setStatus(body.mock ? "mock result" : "verified", "ok");
  } catch (err) {
    setStatus(`error: ${err.message}`, "err");
    renderResult({ error: err.message });
  } finally {
    proveBtn.disabled = false;
  }
}

function renderResult(body) {
  if (body.error) {
    resultEl.innerHTML = `<p class="verdict invalid">error</p><pre>${escapeHtml(body.error)}</pre>`;
    return;
  }
  const verdictClass = body.valid === true ? "valid" : body.valid === false ? "invalid" : "unknown";
  const verdictText = body.valid === true ? "valid" : body.valid === false ? "invalid" : "unknown";
  resultEl.innerHTML = `
    <p class="verdict ${verdictClass}">${verdictText}</p>
    <dl>
      <dt>prover</dt><dd>${escapeHtml(body.prover ?? "—")}</dd>
      <dt>duration</dt><dd>${body.duration_ms ?? "—"} ms</dd>
      <dt>goals remaining</dt><dd>${body.goals_remaining ?? "—"}</dd>
      <dt>tactics used</dt><dd>${body.tactics_used ?? "—"}</dd>
      <dt>strategy</dt><dd>${escapeHtml(body.strategy_tag ?? "—")}</dd>
    </dl>
    ${body.prover_output ? `<pre>${escapeHtml(body.prover_output)}</pre>` : ""}
    ${body.mock ? `<p class="placeholder">⚠ Mock response — E3 will wire real echidna backend.</p>` : ""}
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind ?? ""}`;
}

// ── Events ────────────────────────────────────────────────────────────
langSelect.addEventListener("change", () => mountEditor(langSelect.value));
proveBtn.addEventListener("click", prove);
clearBtn.addEventListener("click", () => {
  if (editorView) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length } });
  resultEl.innerHTML = `<p class="placeholder">Submit an obligation to see the prover's verdict.</p>`;
  setStatus("", "");
});

// ── Boot ──────────────────────────────────────────────────────────────
mountEditor(langSelect.value);
setStatus("ready", "ok");
