/* agent/claude.js — the optional Claude connection.

   The built-in engine answers the common questions offline. This adds
   open-ended ones on top, by sending a snapshot of the current data to the
   Claude API and streaming the answer back.

   There is no server here — this site is static files — so the request goes
   straight from the browser to api.anthropic.com with the operator's own key.
   Anthropic gates that path behind an explicit header, and the key lives in
   this browser's localStorage, readable by anything that can run script on
   this origin. That's an acceptable trade for a back-of-house tool used by
   trusted staff on their own devices, and a bad one for a page the public can
   reach. The Ask tab says so before it takes a key. */

const AgentClaude = (function () {
  const KEY_STORE = "gbg.agent.key";
  const API_URL = "https://api.anthropic.com/v1/messages";
  const MODEL = "claude-opus-5";

  function getKey() {
    try {
      return localStorage.getItem(KEY_STORE) || "";
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
  function isConnected() {
    return !!getKey();
  }

  const SYSTEM = [
    "You are the back-of-house assistant for Generic Bar & Grill, a bar and restaurant.",
    "You are answering questions from the managers and staff who run the place.",
    "",
    "Every question is about the venue's own operating data, which is given to you below as JSON:",
    "the kitchen's ingredients, recipes and counts; the bar's ingredients, house-made preps, drinks and counts;",
    "and the floor right now — every table, its status and its guests, plus the waitlist.",
    "",
    "Rules:",
    "- Answer only from the data given. It is the whole truth about this venue.",
    "- If the data does not contain the answer, say so plainly. Never invent a number, a dish, or a price.",
    "- Money is USD. Quote real figures from the data rather than rounding them away.",
    "- Be brief and concrete, the way a good sous chef or bar manager answers on shift.",
    "  Short paragraphs or a tight list. No preamble, no restating the question.",
    "- 'Below par' means on-hand is under the par level — it needs ordering.",
    "- \"86'd\" means it cannot be made with what is currently counted in.",
    "- When you are asked what to do, give a recommendation, not a list of options.",
  ].join("\n");

  // Streams the answer, calling onDelta with each chunk of text as it lands.
  // Resolves with the full text; rejects with a message worth showing a user.
  async function ask(question, history, onDelta) {
    const key = getKey();
    if (!key) throw new Error("No API key connected.");

    const data = AgentEngine.snapshot();
    const messages = [];
    (history || []).forEach((turn) => {
      messages.push({ role: turn.role, content: turn.content });
    });
    messages.push({
      role: "user",
      content:
        "Here is the venue's current data:\n\n```json\n" +
        JSON.stringify(data) +
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
          // Required for a browser to call the API directly; without it the
          // request is refused before it reaches the model.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL,
          // Deliberately modest: these are short shift-floor answers, and the
          // ceiling only exists so a runaway response can't stall the tab.
          max_tokens: 4000,
          system: SYSTEM,
          // A question over one small snapshot doesn't need deep reasoning,
          // and the person asking is standing at the host stand waiting.
          output_config: { effort: "medium" },
          stream: true,
          messages,
        }),
      });
    } catch (e) {
      throw new Error("Couldn't reach the Claude API. Check this device's connection.");
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = (body && body.error && body.error.message) || "";
      } catch (e) { /* body wasn't JSON */ }
      if (res.status === 401) throw new Error("That API key was rejected. Check it in Connection settings.");
      if (res.status === 429) throw new Error("Rate limited by the API — wait a moment and ask again.");
      if (res.status >= 500) throw new Error("The Claude API is having trouble right now. Try again shortly.");
      throw new Error(`The API returned ${res.status}${detail ? ": " + detail : "."}`);
    }

    // Server-sent events: each "data:" line is one JSON event. We only care
    // about the text deltas and about a refusal or an error arriving mid-stream.
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
        try {
          evt = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
          full += evt.delta.text;
          if (onDelta) onDelta(evt.delta.text);
        } else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason) {
          stopReason = evt.delta.stop_reason;
        } else if (evt.type === "error") {
          throw new Error((evt.error && evt.error.message) || "The API reported an error mid-answer.");
        }
      }
    }

    if (stopReason === "refusal") {
      throw new Error("Claude declined to answer that one. Try rephrasing it.");
    }
    if (!full.trim()) {
      throw new Error("The API returned an empty answer. Try asking again.");
    }
    return full;
  }

  return { ask, getKey, setKey, isConnected, MODEL };
})();
