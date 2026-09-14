// SPDX-License-Identifier: MPL-2.0
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
    const verdict = textElement("p", "error", "verdict invalid");
    const output = textElement("pre", body.error);
    resultEl.replaceChildren(verdict, output);
    return;
  }
  const verdictClass = body.valid === true ? "valid" : body.valid === false ? "invalid" : "unknown";
  const verdictText = body.valid === true ? "valid" : body.valid === false ? "invalid" : "unknown";
  const verdict = textElement("p", verdictText, `verdict ${verdictClass}`);
  if (body.recorded === true) {
    verdict.append(" ", textElement("span", "recorded", "badge ok"));
  } else if (body.recorded === false && !body.mock) {
    verdict.append(" ", textElement("span", "not recorded", "badge warn"));
  }

  const details = document.createElement("dl");
  appendDetail(details, "prover", body.prover ?? "—");
  appendDetail(details, "duration", `${body.duration_ms ?? "—"} ms`);
  appendDetail(details, "goals remaining", body.goals_remaining ?? "—");
  appendDetail(details, "tactics used", body.tactics_used ?? "—");
  appendDetail(details, "strategy", body.strategy_tag ?? "—");
  if (body.attempt_id) appendDetail(details, "attempt", body.attempt_id);
  if (body.obligation_id) {
    appendDetail(details, "obligation", `${String(body.obligation_id).slice(0, 16)}…`, "truncate");
  }

  const children = [verdict, details];
  if (body.prover_output) children.push(textElement("pre", body.prover_output));
  if (body.mock) {
    children.push(textElement("p", "⚠ Backend unreachable — showing mock response.", "placeholder"));
  }
  resultEl.replaceChildren(...children);
}

async function loadStrategy(classValue) {
  const target = classValue === "auto" ? "safety" : classValue;
  try {
    const resp = await fetch(`/api/strategy/${encodeURIComponent(target)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();
    renderStrategy(body, target);
  } catch (err) {
    const strategyEl = document.getElementById("strategy");
    if (strategyEl) {
      strategyEl.replaceChildren(textElement("p", `Strategy data unavailable: ${err.message}`, "placeholder"));
    }
  }
}

function renderStrategy(body, targetClass) {
  const strategyEl = document.getElementById("strategy");
  if (!strategyEl) return;
  const recs = body.recommendations ?? [];
  if (recs.length === 0) {
    const placeholder = textElement("p", "No attempts recorded yet for class ", "placeholder");
    placeholder.append(textElement("code", targetClass), ".");
    strategyEl.replaceChildren(placeholder);
    return;
  }

  const classLabel = textElement("p", "class: ", "strategy-class");
  classLabel.append(textElement("code", targetClass));
  if (body.mock) classLabel.append(" (mock)");

  const table = document.createElement("table");
  table.className = "strategy-table";
  const headRow = document.createElement("tr");
  for (const heading of ["prover", "success", "avg", "n"]) {
    headRow.append(textElement("th", heading));
  }
  const thead = document.createElement("thead");
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  for (const rec of recs.slice(0, 5)) {
    const row = document.createElement("tr");
    row.append(
      textElement("td", rec.prover),
      textElement("td", `${((rec.success_rate ?? 0) * 100).toFixed(1)}%`),
      textElement("td", `${(rec.avg_duration_ms ?? 0).toFixed(0)} ms`),
      textElement("td", rec.total_attempts ?? 0),
    );
    tbody.append(row);
  }
  table.append(thead, tbody);
  strategyEl.replaceChildren(classLabel, table);
}

function textElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function appendDetail(list, label, value, className = "") {
  list.append(textElement("dt", label), textElement("dd", value, className));
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind ?? ""}`;
}

// ── Events ────────────────────────────────────────────────────────────
langSelect.addEventListener("change", () => mountEditor(langSelect.value));
classSelect.addEventListener("change", () => loadStrategy(classSelect.value));
proveBtn.addEventListener("click", async () => { await prove(); loadStrategy(classSelect.value); });
clearBtn.addEventListener("click", () => {
  if (editorView) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length } });
  resultEl.replaceChildren(textElement("p", "Submit an obligation to see the prover's verdict.", "placeholder"));
  setStatus("", "");
});

// ── Boot ──────────────────────────────────────────────────────────────
mountEditor(langSelect.value);
loadStrategy(classSelect.value);
setStatus("ready", "ok");
