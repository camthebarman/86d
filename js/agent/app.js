/* agent/app.js — the Ask tab.

   Two answer sources behind one input box: the built-in engine, which works
   with no key and answers from the data directly, and Claude, which handles
   open-ended questions when an operator has connected a key. The engine
   answers first when it recognises the question, because it is instant and
   its numbers come straight out of the app. Claude picks up everything else. */

const AgentApp = (function () {
  const ROOT = document.getElementById("mod-agent");
  const el = Core.el;
  const toast = Core.toast;

  // The transcript is deliberately not persisted: it's a shift tool, and
  // yesterday's questions about yesterday's counts would only mislead.
  let turns = [];
  let busy = false;

  function $(sel) { return ROOT.querySelector(sel); }

  // ---------- rendering ----------
  function bubble(turn) {
    const node = el("div", { class: "chat-turn chat-" + turn.role });
    if (turn.role === "assistant") {
      node.append(el("div", { class: "chat-who" }, [turn.via === "claude" ? "Claude" : "Assistant"]));
    }
    const body = el("div", { class: "chat-body" });
    if (turn.pending) {
      body.append(el("span", { class: "chat-dots" }, [el("i"), el("i"), el("i")]));
    } else {
      paragraphs(turn.text).forEach((p) => body.append(p));
      if (turn.table) body.append(renderTable(turn.table));
    }
    if (turn.error) node.classList.add("chat-error");
    node.append(body);
    return node;
  }

  // Answers arrive as plain text. Blank lines separate paragraphs, and lines
  // starting with a bullet or a number become a list — enough structure for
  // what both answer sources produce, without pulling in a Markdown parser.
  function paragraphs(text) {
    const out = [];
    String(text || "")
      .split(/\n\s*\n/)
      .forEach((block) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const bullets = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l));
        if (bullets.length === lines.length && lines.length > 1) {
          const ul = el("ul", { class: "chat-list" });
          lines.forEach((l) => ul.append(el("li", {}, [l.replace(/^([-*•]|\d+[.)])\s+/, "")])));
          out.push(ul);
        } else {
          out.push(el("p", {}, [lines.join(" ")]));
        }
      });
    if (!out.length) out.push(el("p", {}, [String(text || "")]));
    return out;
  }

  function renderTable(t) {
    const table = el("table", {}, [
      el("thead", {}, [el("tr", {}, t.head.map((h) => el("th", {}, [h])))]),
      el("tbody", {}, t.rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, [String(c)]))))),
    ]);
    return el("div", { class: "table-wrap chat-table" }, [table]);
  }

  function renderTranscript() {
    const log = $("#agent-log");
    log.innerHTML = "";
    if (!turns.length) {
      log.append(
        el("div", { class: "chat-empty" }, [
          el("h3", {}, ["Ask about tonight"]),
          el("p", { class: "muted" }, [
            "Everything in the Food, Beverage and Front of House tabs is fair game — counts, costs, what's 86'd, who's waiting. Answers come from this browser's own data, so they're always the numbers you're looking at.",
          ]),
          el(
            "div",
            { class: "chip-row" },
            AgentEngine.SUGGESTIONS.map((s) =>
              el("button", { class: "chip", onclick: () => submit(s) }, [s])
            )
          ),
        ])
      );
      return;
    }
    turns.forEach((t) => log.append(bubble(t)));
    log.scrollTop = log.scrollHeight;
  }

  // ---------- asking ----------
  async function submit(question) {
    const q = String(question || "").trim();
    if (!q || busy) return;

    turns.push({ role: "user", text: q });
    const input = $("#agent-input");
    input.value = "";

    const local = AgentEngine.answer(q);

    // The engine owns anything it recognises: instant, and its figures are the
    // app's own. Claude is for the rest.
    if (!local.unmatched) {
      turns.push({ role: "assistant", text: local.text, table: local.table });
      renderTranscript();
      return;
    }

    if (!AgentService.isReady()) {
      turns.push({
        role: "assistant",
        text:
          local.text +
          "\n\nFor anything beyond that, hit Connect Claude above and I'll answer open-ended questions about this data.",
      });
      renderTranscript();
      return;
    }

    const pending = { role: "assistant", via: "claude", text: "", pending: true };
    turns.push(pending);
    busy = true;
    setBusy(true);
    renderTranscript();

    const history = priorClaudeExchanges();

    try {
      await AgentService.ask(q, {
        history,
        onDelta: (chunk) => {
          pending.pending = false;
          pending.text += chunk;
          renderTranscript();
        },
      });
      pending.pending = false;
    } catch (err) {
      pending.pending = false;
      pending.error = true;
      pending.text = AppErrors.message(err);
    } finally {
      busy = false;
      setBusy(false);
      renderTranscript();
      $("#agent-input").focus();
    }
  }

  // The history we hand Claude has to alternate user/assistant strictly — the
  // API rejects two turns of the same role. Only complete exchanges Claude
  // itself answered can go back: a question the built-in engine handled would
  // otherwise leave its user turn in the transcript with no reply beside it,
  // and two user turns in a row is a 400. The current question is excluded —
  // it travels with the data payload instead.
  function priorClaudeExchanges(maxPairs) {
    const pairs = [];
    for (let i = 0; i < turns.length - 2; i++) {
      const q = turns[i];
      const a = turns[i + 1];
      if (q.role !== "user" || !a || a.role !== "assistant") continue;
      if (a.via !== "claude" || a.pending || a.error || !a.text.trim()) continue;
      pairs.push([
        { role: "user", content: q.text },
        { role: "assistant", content: a.text },
      ]);
    }
    return pairs.slice(-(maxPairs == null ? 3 : maxPairs)).flat();
  }

  function setBusy(on) {
    const btn = $("#agent-send");
    btn.disabled = on;
    btn.textContent = on ? "Thinking…" : "Ask";
  }

  // ---------- connection settings ----------
  function openConnection() {
    Core.openModal("Connect Claude", (body, close) => {
      const connected = AgentService.isReady();
      const input = el("input", {
        type: "password",
        placeholder: "sk-ant-…",
        value: "",
        autocomplete: "off",
      });

      const form = el("form", {}, [
        el("p", {}, [
          "The built-in assistant already answers the common questions with no setup at all. Connecting a key adds open-ended questions, answered by Claude over the same data.",
        ]),
        el("div", { class: "callout warn" }, [
          "This site is static files with no server, so the key is stored in this browser and sent straight to Anthropic from this page. Anyone who can use this browser profile, or run script on this site, can read it. Use a key you're willing to rotate, keep it to the devices your managers actually use, and don't put one into a browser the public can get at.",
        ]),
        el("div", { class: "field" }, [
          el("label", {}, [connected ? "Replace the stored key" : "Anthropic API key"]),
          input,
          el("div", { class: "hint" }, [
            connected
              ? "A key is stored on this device. Leave this blank to keep it."
              : "Get one from the Anthropic Console. It never leaves this browser except in the request to Anthropic.",
          ]),
        ]),
        el("p", { class: "hint" }, [`Answers use ${AgentService.describe().model}. Each question costs whatever that model costs on your account.`]),
        el("div", { class: "form-actions" }, [
          connected
            ? el("button", {
                type: "button",
                class: "btn btn-ghost danger",
                onclick: () => {
                  BrowserClaudeProvider.setKey("");
                  close();
                  syncConnectionButton();
                  toast("Key removed from this device.");
                },
              }, ["Remove Key"])
            : null,
          el("button", { type: "button", class: "btn", onclick: close }, ["Cancel"]),
          el("button", { type: "submit", class: "btn btn-primary" }, ["Save"]),
        ]),
      ]);

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const val = input.value.trim();
        if (!val) { close(); return; }
        if (!BrowserClaudeProvider.setKey(val)) {
          toast("This browser wouldn't store the key.");
          return;
        }
        close();
        syncConnectionButton();
        toast("Claude connected on this device.");
      });

      body.append(form);
    });
  }

  function syncConnectionButton() {
    const btn = $("#agent-connect");
    const on = AgentService.isReady();
    btn.textContent = on ? "Claude connected" : "Connect Claude";
    btn.classList.toggle("btn-primary", on);
    btn.classList.toggle("btn-ghost", !on);
    $("#agent-mode").textContent = on
      ? "Built-in answers, with Claude for anything open-ended."
      : "Built-in answers. Connect Claude for open-ended questions.";
  }

  // ---------- init ----------
  function init() {
    $("#agent-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submit($("#agent-input").value);
    });
    $("#agent-connect").addEventListener("click", openConnection);
    $("#agent-clear").addEventListener("click", () => {
      turns = [];
      renderTranscript();
    });
    syncConnectionButton();
    renderTranscript();
  }

  function focusInput() {
    const input = $("#agent-input");
    if (input) input.focus();
  }

  return { init, focusInput };
})();
