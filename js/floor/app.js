/* floor/app.js — rendering, dragging, timers and event wiring. Depends on FloorStorage. */

const FloorApp = (function () {
  let state = FloorStorage.load();
  let selectedId = null;
  // Off by default and never persisted: a shift always starts with the room
  // locked, so a tap can only ever change a table's status.
  let arranging = false;

  // Waits past these marks get coloured so a long ticket is obvious at a glance.
  const WAIT_WARN_MS = 20 * 60 * 1000;
  const WAIT_OVER_MS = 35 * 60 * 1000;

  // ---------- generic helpers ----------
  // Every lookup is scoped to this tool's own subtree, so the three tools can
  // reuse the same class names (.tab-btn, .panel) without colliding.
  const ROOT = document.getElementById("mod-floor");
  function $(sel, root) { return (root || ROOT).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || ROOT).querySelectorAll(sel)); }
  const el = Core.el;
  function persist() { FloorStorage.save(state); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  const toast = Core.toast;

  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtMinutes(ms) {
    const mins = Math.round(ms / 60000);
    return mins === 1 ? "1 min" : `${mins} min`;
  }
  function fmtTimeOfDay(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // ---------- modal ----------
  const openModal = Core.openModal;
  const closeModal = Core.closeModal;

  // ---------- floor plan ----------
  function tables() { return state.layouts[state.activeLayout] || []; }
  function findTable(id) { return tables().find((t) => t.id === id); }
  function layoutLabel(id) {
    const layout = FloorStorage.LAYOUTS.find((l) => l.id === id);
    return layout ? layout.label : id;
  }

  function metaText(table) {
    if (table.status === "clean") return `${table.seats} top`;
    const guests = table.guests || 0;
    const clock = table.seatedAt ? fmtClock(Date.now() - table.seatedAt) : "--";
    return `${guests}g · ${clock}`;
  }

  function tableClass(table) {
    let cls = `table-shape shape-${table.shape} st-${table.status}`;
    if (table.w < 6) cls += " tiny";
    if (table.id === selectedId) cls += " selected";
    return cls;
  }

  function tableNode(table) {
    const node = el("div", {
      class: tableClass(table),
      "data-id": table.id,
      role: "button",
      tabindex: "0",
      "aria-label": `Table ${table.label}, ${FloorStorage.STATUS_LABELS[table.status]}`,
      title: `${table.label} — seats ${table.seats}`,
    }, [
      el("span", { class: "t-label" }, [table.label]),
      el("span", { class: "t-meta" }, [metaText(table)]),
    ]);
    node.style.left = table.x + "%";
    node.style.top = table.y + "%";
    node.style.width = table.w + "%";
    attachDrag(node, table);
    node.addEventListener("keydown", (e) => {
      if (arranging) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTap(table); }
    });
    return node;
  }

  function fixtureNode(fixture) {
    const node = el("div", { class: "fixture", "aria-hidden": "true" }, [fixture.label]);
    node.style.left = fixture.x + "%";
    node.style.top = fixture.y + "%";
    node.style.width = fixture.w + "%";
    node.style.height = fixture.h + "%";
    return node;
  }

  function renderFloor() {
    const floor = $("#floor");
    floor.innerHTML = "";
    FloorStorage.fixtures(state.activeLayout).forEach((f) => floor.appendChild(fixtureNode(f)));
    tables().forEach((t) => floor.appendChild(tableNode(t)));
    renderFloorStats();
    renderTablePanel();
  }

  // In-place refresh so a status change never rebuilds the floor — rebuilding
  // mid-drag or mid-typing would drop the pointer capture or the caret.
  function updateTableNode(table) {
    const node = $(`.table-shape[data-id="${table.id}"]`);
    if (!node) return;
    node.className = tableClass(table);
    node.setAttribute("aria-label", `Table ${table.label}, ${FloorStorage.STATUS_LABELS[table.status]}`);
    const meta = $(".t-meta", node);
    if (meta) meta.textContent = metaText(table);
  }

  function renderFloorStats() {
    const counts = { clean: 0, seated: 0, dirty: 0 };
    let guests = 0;
    tables().forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
      if (t.status === "seated") guests += Number(t.guests) || 0;
    });
    const stats = [
      { label: "Clean", value: counts.clean, cls: "" },
      { label: "Seated", value: counts.seated, cls: "seated" },
      { label: "Dirty", value: counts.dirty, cls: "dirty" },
      { label: "Guests Seated", value: guests, cls: "" },
    ];
    const wrap = $("#floor-stats");
    wrap.innerHTML = "";
    stats.forEach((s) => {
      wrap.appendChild(el("div", { class: "stat-chip " + s.cls }, [
        el("div", { class: "label" }, [s.label]),
        el("div", { class: "value" }, [String(s.value)]),
      ]));
    });
  }

  // ---------- drag ----------
  function attachDrag(node, table) {
    let dragging = false, moved = false;
    let startX = 0, startY = 0, originX = 0, originY = 0;
    let floorRect = null, halfW = 0, halfH = 0;

    node.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      originX = table.x;
      originY = table.y;
      floorRect = $("#floor").getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      // Half the shape, in the same percentage units as x/y, so it can be
      // clamped to stay fully inside the room.
      halfW = (nodeRect.width / 2) / floorRect.width * 100;
      halfH = (nodeRect.height / 2) / floorRect.height * 100;
      // Capture keeps the drag alive when the pointer outruns the shape. It can
      // throw if the pointer is already gone, which must not abort the drag.
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
    });

    node.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // A few pixels of slop keeps a fat-fingered tap from registering as a drag.
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      if (!arranging) return;
      node.classList.add("dragging");
      table.x = Number(clamp(originX + (dx / floorRect.width) * 100, halfW, 100 - halfW).toFixed(2));
      table.y = Number(clamp(originY + (dy / floorRect.height) * 100, halfH, 100 - halfH).toFixed(2));
      node.style.left = table.x + "%";
      node.style.top = table.y + "%";
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      node.classList.remove("dragging");
      if (moved && arranging) persist();
      else if (!moved && !arranging) handleTap(table);
    }

    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", () => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove("dragging");
      if (moved && arranging) persist();
    });
  }

  // First tap opens the table; tapping the one that's already open cycles it.
  function handleTap(table) {
    if (selectedId !== table.id) {
      const previous = selectedId ? findTable(selectedId) : null;
      selectedId = table.id;
      if (previous) updateTableNode(previous);
      updateTableNode(table);
      renderTablePanel();
    } else {
      const order = FloorStorage.STATUSES;
      setStatus(table, order[(order.indexOf(table.status) + 1) % order.length]);
    }
  }

  function setStatus(table, status) {
    if (table.status === status) return;
    if (status === "seated") {
      table.seatedAt = Date.now();
      table.lastTurnMs = null;
      if (!table.guests) table.guests = table.seats;
    } else if (status === "clean") {
      // Turn is over: bank the elapsed time and stop the clock.
      if (table.seatedAt) table.lastTurnMs = Date.now() - table.seatedAt;
      table.seatedAt = null;
      table.guests = 0;
      table.party = null;
    }
    // Flipping to dirty leaves the clock running — the table isn't turned
    // until it's been bussed and reset, and that wait is worth seeing.
    table.status = status;
    persist();
    updateTableNode(table);
    renderFloorStats();
    renderTablePanel();
  }

  // ---------- table detail panel ----------
  function renderTablePanel() {
    const panel = $("#table-panel");
    panel.innerHTML = "";
    const table = selectedId ? findTable(selectedId) : null;

    if (!table) {
      panel.appendChild(el("div", { class: "empty-state" }, [
        el("p", {}, ["No table open."]),
        el("p", { class: "muted" }, [arranging
          ? "Drag tables into place. Tap Done Arranging to lock the room and go back to service."
          : "Tap a table to set guests, notes and status."]),
      ]));
      return;
    }

    panel.appendChild(el("div", { class: "tp-head" }, [
      el("h3", {}, [`Table ${table.label}`]),
      el("span", { class: "pill st-" + table.status }, [FloorStorage.STATUS_LABELS[table.status]]),
    ]));
    panel.appendChild(el("div", { class: "tp-seats" }, [
      `Seats ${table.seats} · ${layoutLabel(state.activeLayout)}`,
    ]));

    if (table.party) {
      const party = el("div", { class: "tp-party" }, [el("strong", {}, [table.party.name])]);
      if (table.party.notes) party.appendChild(el("div", { class: "muted" }, [table.party.notes]));
      panel.appendChild(party);
    }

    const running = Boolean(table.seatedAt);
    panel.appendChild(el("div", { class: "tp-timer" }, [
      el("div", { class: "label" }, [running ? "Seated for" : "Timer stopped"]),
      el("div", { class: "clock" + (running ? " running" : ""), id: "tp-clock" }, [
        running ? fmtClock(Date.now() - table.seatedAt) : "0:00",
      ]),
    ]));

    const statusRow = el("div", { class: "status-row" });
    FloorStorage.STATUSES.forEach((status) => {
      const on = table.status === status;
      statusRow.appendChild(el("button", {
        class: "btn btn-sm" + (on ? " on st-" + status : ""),
        onclick: () => setStatus(table, status),
      }, [FloorStorage.STATUS_LABELS[status]]));
    });
    panel.appendChild(statusRow);

    const guestField = el("div", { class: "field" }, [
      el("label", { for: "tp-guests" }, ["Guest Count"]),
      el("input", { type: "number", id: "tp-guests", min: "0", step: "1", value: String(table.guests || 0) }),
    ]);
    panel.appendChild(guestField);
    $("#tp-guests", guestField).addEventListener("input", (e) => {
      table.guests = Math.max(0, parseInt(e.target.value, 10) || 0);
      persist();
      updateTableNode(table);
      renderFloorStats();
    });

    const notesField = el("div", { class: "field" }, [
      el("label", { for: "tp-notes" }, ["Notes"]),
      el("textarea", { id: "tp-notes", placeholder: "Anniversary, allergy, wobbly leg…" }),
    ]);
    panel.appendChild(notesField);
    const notes = $("#tp-notes", notesField);
    notes.value = table.notes || "";
    notes.addEventListener("input", (e) => {
      table.notes = e.target.value;
      persist();
    });

    if (table.lastTurnMs) {
      panel.appendChild(el("p", { class: "muted", style: "font-size:12.5px;margin:0 0 10px" }, [
        `Last turn: ${fmtMinutes(table.lastTurnMs)}`,
      ]));
    }

    panel.appendChild(el("button", {
      class: "btn btn-ghost btn-sm btn-block",
      onclick: () => {
        const open = table;
        selectedId = null;
        updateTableNode(open);
        renderTablePanel();
      },
    }, ["Close"]));
  }

  // ---------- waitlist ----------
  function addWaitEntry(entry) {
    state.waitlist.push(entry);
    persist();
    renderWaitlist();
  }

  function removeWaitEntry(id) {
    state.waitlist = state.waitlist.filter((w) => w.id !== id);
    persist();
    renderWaitlist();
  }

  // Every clean table across both layouts, with the ones big enough for the
  // party first and the smallest of those at the top — the host's usual choice.
  function seatableTables(partySize) {
    const options = [];
    FloorStorage.LAYOUTS.forEach((layout) => {
      (state.layouts[layout.id] || [])
        .filter((t) => t.status === "clean")
        .forEach((table) => options.push({ table, layout }));
    });
    return options.sort((a, b) => {
      const aFits = a.table.seats >= partySize;
      const bFits = b.table.seats >= partySize;
      if (aFits !== bFits) return aFits ? -1 : 1;
      // Fitting tables: tightest fit first. Too-small tables: biggest first.
      return aFits ? a.table.seats - b.table.seats : b.table.seats - a.table.seats;
    });
  }

  function seatEntryAt(entry, table, layoutId) {
    if (arranging) setArranging(false);
    if (state.activeLayout !== layoutId) {
      state.activeLayout = layoutId;
      $all(".layout-btn").forEach((b) => b.classList.toggle("active", b.dataset.layout === layoutId));
    }
    // Set the count before the status flip so it isn't overwritten by the
    // seat-count default setStatus applies to a table seated straight off the floor.
    table.guests = entry.party;
    table.party = { name: entry.name, notes: entry.notes || "" };
    selectedId = table.id;
    setStatus(table, "seated");
    state.waitlist = state.waitlist.filter((w) => w.id !== entry.id);
    persist();
    renderFloor();
    renderWaitlist();
    switchTab("floor");
    toast(`${entry.name} seated at ${table.label}`);
  }

  function promptSeat(entry) {
    openModal(`Seat ${entry.name} — party of ${entry.party}`, (body, close) => {
      const options = seatableTables(entry.party);
      if (!options.length) {
        body.appendChild(el("p", { class: "muted" }, ["No clean tables open right now."]));
      } else {
        body.appendChild(el("p", { class: "muted", style: "font-size:12.5px" }, [
          "Pick a table — the ones that fit the party are listed first.",
        ]));
        const picker = el("div", { class: "table-picker" });
        options.forEach(({ table, layout }) => {
          const fits = table.seats >= entry.party;
          picker.appendChild(el("button", {
            class: "picker-item" + (fits ? "" : " short"),
            type: "button",
            onclick: () => { seatEntryAt(entry, table, layout.id); close(); },
          }, [
            el("span", { class: "pi-label" }, [table.label]),
            el("span", { class: "pi-sub" }, [`${layout.label} · seats ${table.seats}`]),
          ]));
        });
        body.appendChild(picker);
      }
      body.appendChild(el("div", { class: "form-actions" }, [
        el("button", { class: "btn btn-ghost", onclick: close }, ["Cancel"]),
        el("button", {
          class: "btn",
          onclick: () => { removeWaitEntry(entry.id); close(); toast(`Seated ${entry.name}`); },
        }, ["Seat without a table"]),
      ]));
    });
  }

  function waitClass(ms) {
    if (ms >= WAIT_OVER_MS) return "over";
    if (ms >= WAIT_WARN_MS) return "warn";
    return "";
  }

  function renderWaitStats() {
    const now = Date.now();
    const parties = state.waitlist.length;
    const guests = state.waitlist.reduce((sum, w) => sum + (Number(w.party) || 0), 0);
    const longest = state.waitlist.reduce((max, w) => Math.max(max, now - w.addedAt), 0);
    const stats = [
      { label: "Parties Waiting", value: String(parties) },
      { label: "Guests Waiting", value: String(guests) },
      { label: "Longest Wait", value: parties ? fmtClock(longest) : "—" },
    ];
    const wrap = $("#wait-stats");
    wrap.innerHTML = "";
    stats.forEach((s) => {
      wrap.appendChild(el("div", { class: "stat-chip" }, [
        el("div", { class: "label" }, [s.label]),
        el("div", { class: "value" }, [s.value]),
      ]));
    });
  }

  function waitNode(entry) {
    const waited = Date.now() - entry.addedAt;
    const tone = waitClass(waited);

    const main = el("div", { class: "wait-main" }, [
      el("div", { class: "wait-name" }, [`${entry.name} · party of ${entry.party}`]),
      el("div", { class: "wait-sub" }, [
        (entry.phone ? entry.phone + " · " : "") + "added " + fmtTimeOfDay(entry.addedAt),
      ]),
    ]);
    if (entry.notes) main.appendChild(el("div", { class: "wait-notes" }, [entry.notes]));

    return el("div", { class: "wait-item" + (tone ? " waiting-" + (tone === "over" ? "over" : "long") : ""), "data-id": entry.id }, [
      main,
      el("div", { class: "wait-clock" }, [
        el("div", { class: "elapsed " + tone, "data-since": String(entry.addedAt) }, [fmtClock(waited)]),
        el("div", { class: "quoted" }, ["waiting"]),
      ]),
      el("div", { class: "wait-actions" }, [
        el("button", {
          class: "btn btn-primary btn-sm",
          onclick: () => promptSeat(entry),
        }, ["Seat"]),
        el("button", {
          class: "btn btn-ghost btn-sm danger",
          onclick: () => { removeWaitEntry(entry.id); toast(`Removed ${entry.name}`); },
        }, ["Delete"]),
      ]),
    ]);
  }

  function renderWaitlist() {
    renderWaitStats();
    const list = $("#wait-list");
    list.innerHTML = "";
    if (!state.waitlist.length) {
      list.appendChild(el("div", { class: "card empty-state" }, [
        el("p", {}, ["Nobody waiting."]),
        el("p", { class: "muted" }, ["Added parties show a live wait timer here."]),
      ]));
      return;
    }
    state.waitlist.forEach((entry) => list.appendChild(waitNode(entry)));
  }

  // ---------- live timers ----------
  // One interval drives every clock on the page, and it only rewrites the text
  // it owns, so open inputs and in-progress drags are never disturbed.
  function tick() {
    const now = Date.now();
    tables().forEach((t) => {
      if (!t.seatedAt) return;
      const node = $(`.table-shape[data-id="${t.id}"] .t-meta`);
      if (node) node.textContent = metaText(t);
    });

    const clock = $("#tp-clock");
    const open = selectedId ? findTable(selectedId) : null;
    if (clock && open && open.seatedAt) clock.textContent = fmtClock(now - open.seatedAt);

    $all(".wait-item").forEach((item) => {
      const elapsedNode = $(".elapsed", item);
      if (!elapsedNode) return;
      const since = Number(elapsedNode.getAttribute("data-since"));
      const waited = now - since;
      const tone = waitClass(waited);
      elapsedNode.textContent = fmtClock(waited);
      elapsedNode.className = "elapsed " + tone;
      item.className = "wait-item" + (tone ? " waiting-" + (tone === "over" ? "over" : "long") : "");
    });

    if (state.waitlist.length) renderWaitStats();
  }

  // ---------- shift reset ----------
  function confirmClearAll() {
    openModal("Clear all for end of shift?", (body, close) => {
      body.appendChild(el("p", {}, ["This empties the waitlist and hands every table back clean on both layouts, clearing guest counts, notes and running timers."]));
      body.appendChild(el("p", { class: "muted" }, ["Table positions stay exactly as you have them."]));
      body.appendChild(el("div", { class: "form-actions" }, [
        el("button", { class: "btn btn-ghost", onclick: close }, ["Cancel"]),
        el("button", {
          class: "btn btn-primary",
          onclick: () => {
            FloorStorage.clearShift(state);
            selectedId = null;
            persist();
            renderFloor();
            renderWaitlist();
            close();
            toast("Shift cleared");
          },
        }, ["Clear Everything"]),
      ]));
    });
  }

  function confirmDemo() {
    openModal("Load a Friday night?", (body, close) => {
      body.appendChild(el("p", {}, ["This fills both layouts with a busy Friday service and a waitlist of parties, replacing whatever is on the floor now."]));
      body.appendChild(el("p", { class: "muted" }, ["Table positions are left exactly as you have them."]));
      body.appendChild(el("div", { class: "form-actions" }, [
        el("button", { class: "btn btn-ghost", onclick: close }, ["Cancel"]),
        el("button", {
          class: "btn btn-primary",
          onclick: () => {
            FloorDemo.apply(state);
            selectedId = null;
            setArranging(false);
            persist();
            renderFloor();
            renderWaitlist();
            close();
            toast("Friday night loaded");
          },
        }, ["Load Friday Night"]),
      ]));
    });
  }

  // ---------- init ----------
  function switchTab(tab) {
    $all(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $all(".panel").forEach((p) => p.classList.toggle("active", p.id === "floor-panel-" + tab));
  }

  function switchLayout(layoutId) {
    if (state.activeLayout === layoutId) return;
    state.activeLayout = layoutId;
    selectedId = null;
    persist();
    $all(".layout-btn").forEach((b) => b.classList.toggle("active", b.dataset.layout === layoutId));
    renderFloor();
  }

  function setArranging(on) {
    arranging = on;
    $("#floor").classList.toggle("arranging", on);
    $("#btn-arrange").textContent = on ? "Done Arranging" : "Arrange Tables";
    // btn-ghost's transparent background outranks btn-primary's fill, so the
    // active state swaps the classes rather than stacking them.
    $("#btn-arrange").classList.toggle("btn-primary", on);
    $("#btn-arrange").classList.toggle("btn-ghost", !on);
    $("#btn-reset-layout").hidden = !on;
    $("#floor-sub").textContent = on
      ? "Drag tables to match the real room. Positions save as you go."
      : "Tap a table to open it. Tap it again to cycle clean → seated → dirty. Tables stay put during service.";
    if (on && selectedId) {
      const open = findTable(selectedId);
      selectedId = null;
      if (open) updateTableNode(open);
      renderTablePanel();
    }
  }

  function init() {
    $("#floor-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (btn) switchTab(btn.dataset.tab);
    });

    $("#layout-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest(".layout-btn");
      if (btn) switchLayout(btn.dataset.layout);
    });
    $all(".layout-btn").forEach((b) => b.classList.toggle("active", b.dataset.layout === state.activeLayout));

    $("#btn-arrange").addEventListener("click", () => {
      setArranging(!arranging);
      toast(arranging ? "Drag tables to rearrange the room" : "Tables locked");
    });

    $("#btn-reset-layout").addEventListener("click", () => {
      FloorStorage.resetPositions(state, state.activeLayout);
      persist();
      renderFloor();
      toast(`${layoutLabel(state.activeLayout)} positions reset`);
    });

    $("#btn-demo").addEventListener("click", confirmDemo);
    $("#btn-clear-all").addEventListener("click", confirmClearAll);

    $("#wait-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#wait-name").value.trim();
      if (!name) { toast("Name is required"); $("#wait-name").focus(); return; }
      addWaitEntry({
        id: uid(),
        name,
        phone: $("#wait-phone").value.trim(),
        party: Math.max(1, parseInt($("#wait-party").value, 10) || 1),
        notes: $("#wait-notes").value.trim(),
        addedAt: Date.now(),
      });
      e.target.reset();
      $("#wait-party").value = "2";
      $("#wait-name").focus();
      toast(`${name} added to the waitlist`);
    });

    setArranging(false);
    renderFloor();
    renderWaitlist();
    setInterval(tick, 1000);
  }

  // What the house dashboard needs from the floor, without reaching into this
  // tool's state directly.
  function summary() {
    const all = FloorStorage.LAYOUTS.flatMap((l) => state.layouts[l.id] || []);
    const seated = all.filter((t) => t.status === "seated");
    const dirty = all.filter((t) => t.status === "dirty");
    const now = Date.now();
    const waits = state.waitlist.map((w) => now - w.addedAt);
    return {
      tables: all.length,
      seated: seated.length,
      dirty: dirty.length,
      clean: all.filter((t) => t.status === "clean").length,
      guests: seated.reduce((s, t) => s + (Number(t.guests) || 0), 0),
      seats: all.reduce((s, t) => s + (Number(t.seats) || 0), 0),
      waiting: state.waitlist.length,
      longestWaitMs: waits.length ? Math.max(...waits) : 0,
      quotedParties: state.waitlist.slice(0, 3).map((w) => ({ name: w.name, party: w.party, waitedMs: now - w.addedAt })),
    };
  }

  return { init, summary, switchTab, fmtMinutes, get state() { return state; } };
})();
