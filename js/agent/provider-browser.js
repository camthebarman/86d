/* agent/provider-browser.js — the development provider.

   Calls the Anthropic API straight from the page with a key the operator
   pasted in. This is a SHIM. It exists so the Ask tab can be used and
   demonstrated before there is a server, and it is listed in SECURITY.md as a
   production blocker: a key in a browser is a key anyone with that browser
   can take, and no amount of care here changes that.

   It is written to be deleted. Nothing outside this file knows about API keys,
   Anthropic, or CORS headers; AgentService.use(ServerProvider) replaces the
   whole thing without touching the Ask tab. */

const BrowserClaudeProvider = (function () {
  const KEY_STORE = "86d:credential:anthropic";
  const LEGACY_KEY_STORE = "gbg.agent.key";
  const API_URL = "https://api.anthropic.com/v1/messages";
  const MODEL = "claude-opus-5";

  // Credentials are deliberately NOT in Store: they are not organization data,
  // they must never land in an export or a backup, and they are per-device.
  function getKey() {
    try {
      const key = localStorage.getItem(KEY_STORE);
      if (key) return key;
      const legacy = localStorage.getItem(LEGACY_KEY_STORE);
      if (legacy) {
        localStorage.setItem(KEY_STORE, legacy);
        localStorage.removeItem(LEGACY_KEY_STORE);
        return legacy;
      }
      return "";
    } catch (e) {
      return "";
    }
  }

  function setKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function generate({ question, context, system, history, onDelta }) {
    const key = getKey();
    if (!key) throw AppErrors.ai("No API key connected.");

    const messages = (history || []).map((turn) => ({ role: turn.role, content: turn.content }));
    messages.push({
      role: "user",
      // The data is fenced and labelled as records so the model treats it as
      // content, not as instructions. The real defence is server-side scoping;
      // this is the client-side half of it.
      content:
        "Here is the selected data for this question:\n\n```json\n" +
        JSON.stringify(context) +
        "\n```\n\nQuestion: " +
        question,
    });

    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          // Required for a browser to call the API directly. Its name is not an
          // accident — see SECURITY.md.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          system,
          output_config: { effort: "medium" },
          stream: true,
          messages,
        }),
      });
    } catch (e) {
      throw AppErrors.network("Couldn't reach the Claude API. Check this device's connection.", { cause: e });
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = (body && body.error && body.error.message) || "";
      } catch (e) { /* body wasn't JSON */ }
      if (res.status === 401) throw AppErrors.ai("That API key was rejected. Check it in Connection settings.", { status: 401 });
      if (res.status === 429) throw AppErrors.network("Rate limited by the API — wait a moment and ask again.", { status: 429 });
      if (res.status >= 500) throw AppErrors.network("The Claude API is having trouble right now. Try again shortly.", { status: res.status });
      throw AppErrors.ai(`The API returned ${res.status}${detail ? ": " + detail : "."}`, { status: res.status });
    }

    // Server-sent events: each "data:" line is one JSON event.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let stopReason = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(payload); } catch (e) { continue; }
        if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
          full += evt.delta.text;
          if (onDelta) onDelta(evt.delta.text);
        } else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason) {
          stopReason = evt.delta.stop_reason;
        } else if (evt.type === "error") {
          throw AppErrors.ai((evt.error && evt.error.message) || "The API reported an error mid-answer.");
        }
      }
    }

    if (stopReason === "refusal") throw AppErrors.ai("Claude declined to answer that one. Try rephrasing it.");
    if (!full.trim()) throw AppErrors.ai("The API returned an empty answer. Try asking again.");
    return full;
  }

  return {
    id: "browser-direct",
    label: "Claude, direct from this browser",
    model: MODEL,
    // Named so the UI can warn honestly rather than implying this is safe.
    isDevelopmentOnly: true,
    isReady: () => !!getKey(),
    getKey, setKey, generate,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { BrowserClaudeProvider };
