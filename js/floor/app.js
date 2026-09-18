/* floor/app.js — rendering, dragging, timers and event wiring. Depends on FloorStorage. */

const FloorApp = (function () {
  // Loaded in init(), after Store has hydrated — see food/app.js.
  let state = null;
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
  const uid = Ids.uuid;

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
    return new Date(Time.ms(ts)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
    const clock = table.seatedAt ? fmtClock(Time.since(table.seatedAt)) : "--";
    return `${guests}g · ${clock}`;
  }

  function tableClass(table) {
    let cls = `table-shape shape-${table.shape} st-${table.status}`;
    if (table.w < 6) cls += " tiny";
    // Opening one table of a joined run highlights the whole run, because the
    // run is what you are actually working with.
    const unit = selectedUnit();
    if (unit && unit.tables.some((t) => t.id === table.id)) cls += " selected";
    if (groupOf(table.id)) cls += " joined";
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
    groupsFor(state.activeLayout).forEach((g) => floor.appendChild(joinBandNode(g)));
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
    let joined = 0;
    // Counted in units: two tables pushed together are one table to a host.
    unitsFor(state.activeLayout).forEach((u) => {
      counts[u.status] = (counts[u.status] || 0) + 1;
      if (u.status === "seated") guests += u.guests;
      if (u.joined) joined += 1;
    });
    const stats = [
      { label: "Clean", value: counts.clean, cls: "" },
      { label: "Seated", value: counts.seated, cls: "seated" },
      { label: "Dirty", value: counts.dirty, cls: "dirty" },
      { label: "Guests Seated", value: guests, cls: "" },
    ];
    if (joined) stats.push({ label: joined === 1 ? "Joined Run" : "Joined Runs", value: joined, cls: "" });
    const wrap = $("#floor-stats");
    wrap.innerHTML = "";
    stats.forEach((s) => {
      wrap.appendChild(el("div", { class: "stat-chip " + s.cls }, [
        el("div", { class: "label" }, [s.label]),
        el("div", { class: "value" }, [String(s.value)]),
      ]));
    });
  }

  // ---------- joined tables ----------
  // Push two tables together in arrange mode and they become one table: one
  // unit on the stat strip, one entry in the seating picker, one combined seat
  // count. Nothing is stored for a join — it is read from where the tables sit,
  // so dragging them apart un-joins them with no extra bookkeeping.
  //
  // The geometry itself lives in floor/geometry.js, which knows nothing about
  // the DOM, so the hardest rule in this tool can be tested without a browser.
  const FLOOR_ASPECT = FloorGeometry.FLOOR_ASPECT;

  function groupsFor(layoutId) {
    return FloorGeometry.groups(state.layouts[layoutId] || []);
  }

  function groupOf(tableId, layoutId) {
    return groupsFor(layoutId || state.activeLayout).find((g) => g.ids.indexOf(tableId) !== -1) || null;
  }

  function unitsFor(layoutId) {
    return FloorGeometry.units(state.layouts[layoutId] || []);
  }

  function unitFor(table) {
    return FloorGeometry.unitFor(table, tables());
  }

  // The unit the open table belongs to, recomputed each time so it follows the
  // tables if they've been dragged together or apart since it was opened.
  function selectedUnit() {
    const table = selectedId ? findTable(selectedId) : null;
    return table ? unitFor(table) : null;
  }

  // The band drawn around a joined run, behind the tables themselves.
  function joinBandNode(group) {
    const pad = 0.9;
    const left = group.box.left - pad;
    const width = group.box.right - group.box.left + pad * 2;
    // Back out of percent-of-width into the percent-of-height the CSS wants.
    const top = (group.box.top - pad) * FLOOR_ASPECT;
    const height = (group.box.bottom - group.box.top + pad * 2) * FLOOR_ASPECT;
    const node = el("div", { class: "join-band st-" + group.status, "aria-hidden": "true" }, [
      el("span", { class: "join-tag" }, [`${group.label} · ${group.seats} seats`]),
    ]);
    node.style.left = left + "%";
    node.style.top = top + "%";
    node.style.width = width + "%";
    node.style.height = height + "%";
    return node;
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
      if (moved && arranging) {
        persist();
        // Where it landed decides what is joined to what, so the bands, the
        // stat strip and the open panel are all rebuilt from the new positions.
        renderFloor();
      } else if (!moved && !arranging) handleTap(table);
    }

    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", () => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove("dragging");
      if (moved && arranging) {
        persist();
        renderFloor();
      }
    });
  }

  // First tap opens the table; tapping the one that's already open cycles it.
  // A joined run answers as one: tapping any of its tables opens the run, and
  // cycling it moves every table in it together.
  function handleTap(table) {
    const unit = unitFor(table);
    const alreadyOpen = selectedId && unit.tables.some((t) => t.id === selectedId);
    if (!alreadyOpen) {
      const previous = selectedUnit();
      selectedId = table.id;
      if (previous) previous.tables.forEach(updateTableNode);
      unit.tables.forEach(updateTableNode);
      renderTablePanel();
    } else {
      const order = FloorStorage.STATUSES;
      setUnitStatus(unit, order[(order.indexOf(unit.status) + 1) % order.length]);
    }
  }

  // The per-table half of a status change. No rendering, no persistence — the
  // unit-level callers below own both, so a joined run is one write and one
  // repaint however many tables it holds.
  function applyStatus(table, status) {
    if (table.status === status) return false;
    if (status === "seated") {
      table.seatedAt = Time.now();
      table.lastTurnMs = null;
      // Deliberately does NOT default the guest count. On a joined run the
      // party has already been spread across these tables, and a table holding
      // the overflow legitimately holds zero — filling it to its seat count
      // here is how a party of 11 used to land as 19 guests. The unit-level
      // caller owns the default instead.
    } else if (status === "clean") {
      // Turn is over: bank the elapsed time and stop the clock.
      // lastTurnMs is a DURATION, not an instant, so it stays milliseconds.
      if (table.seatedAt) table.lastTurnMs = Time.since(table.seatedAt);
      table.seatedAt = null;
      table.guests = 0;
      table.party = null;
    }
    // Flipping to dirty leaves the clock running — the table isn't turned
    // until it's been bussed and reset, and that wait is worth seeing.
    table.status = status;
    return true;
  }

  function setUnitStatus(unit, status) {
    // Seating straight off the floor, with nobody assigned yet, assumes a full
    // house — one 4-top seats 4, a joined 4+4 seats 8. Measured before the
    // status flip, because flipping is what clears a count.
    const fillToCapacity = status === "seated" && unit.guests <= 0;
    let changed = false;
    unit.tables.forEach((t) => {
      if (applyStatus(t, status)) changed = true;
    });
    if (!changed) return;
    if (fillToCapacity) setUnitGuests(unit, unit.seats);
    Audit.record(Audit.ACTIONS.TABLE_STATUS_CHANGED, {
      entity: "table", entityId: unit.tables[0].id,
      summary: `${unit.joined ? "Run" : "Table"} ${unit.label} → ${FloorStorage.STATUS_LABELS[status]}`,
      after: status,
    });
    persist();
    // renderFloor repaints every table, the join bands and the panel — a join
    // changing status changes all three.
    renderFloor();
  }

  function setStatus(table, status) {
    setUnitStatus(unitFor(table), status);
  }

  // Seats a whole unit's worth of guests, filling each table to its own seat
  // count before spilling into the next — so a 6-top and a 4-top pushed
  // together read as 6 and 2 rather than 5 and 5.
  function setUnitGuests(unit, total) {
    const split = FloorGeometry.distributeGuests(unit.tables, total);
    unit.tables.forEach((t, i) => (t.guests = split[i]));
  }

  // ---------- table detail panel ----------
  function renderTablePanel() {
    const panel = $("#table-panel");
    panel.innerHTML = "";
    const table = selectedId ? findTable(selectedId) : null;
    const unit = table ? unitFor(table) : null;
    // A joined run keeps its party, its notes and its guest overflow on its
    // first table, so there is one place to read them from and one to write to.
    const anchor = unit ? unit.tables[0] : null;

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
      el("h3", {}, [unit.joined ? `Tables ${unit.label}` : `Table ${unit.label}`]),
      el("span", { class: "pill st-" + unit.status }, [FloorStorage.STATUS_LABELS[unit.status]]),
    ]));
    panel.appendChild(el("div", { class: "tp-seats" }, [
      `Seats ${unit.seats} · ${layoutLabel(state.activeLayout)}` +
        (unit.joined ? ` · ${unit.tables.length} tables pushed together` : ""),
    ]));

    const party = unit.tables.map((t) => t.party).find(Boolean);
    if (party) {
      const partyNode = el("div", { class: "tp-party" }, [el("strong", {}, [party.name])]);
      if (party.notes) partyNode.appendChild(el("div", { class: "muted" }, [party.notes]));
      panel.appendChild(partyNode);
    }

    const running = Boolean(unit.seatedAt);
    panel.appendChild(el("div", { class: "tp-timer" }, [
      el("div", { class: "label" }, [running ? "Seated for" : "Timer stopped"]),
      el("div", { class: "clock" + (running ? " running" : ""), id: "tp-clock" }, [
        running ? fmtClock(Time.since(unit.seatedAt)) : "0:00",
      ]),
    ]));

    const statusRow = el("div", { class: "status-row" });
    FloorStorage.STATUSES.forEach((status) => {
      const on = unit.status === status;
      statusRow.appendChild(el("button", {
        class: "btn btn-sm" + (on ? " on st-" + status : ""),
        onclick: () => setUnitStatus(unit, status),
      }, [FloorStorage.STATUS_LABELS[status]]));
    });
    panel.appendChild(statusRow);

    const guestField = el("div", { class: "field" }, [
      el("label", { for: "tp-guests" }, ["Guest Count"]),
      el("input", { type: "number", id: "tp-guests", min: "0", step: "1", value: String(unit.guests || 0) }),
    ]);
    panel.appendChild(guestField);
    $("#tp-guests", guestField).addEventListener("input", (e) => {
      setUnitGuests(unit, Math.max(0, parseInt(e.target.value, 10) || 0));
      persist();
      unit.tables.forEach(updateTableNode);
      renderFloorStats();
    });

    const notesField = el("div", { class: "field" }, [
      el("label", { for: "tp-notes" }, ["Notes"]),
      el("textarea", { id: "tp-notes", placeholder: "Anniversary, allergy, wobbly leg…" }),
    ]);
    panel.appendChild(notesField);
    const notes = $("#tp-notes", notesField);
    notes.value = anchor.notes || "";
    notes.addEventListener("input", (e) => {
      anchor.notes = e.target.value;
      persist();
    });

    const lastTurn = unit.tables.map((t) => t.lastTurnMs).filter(Boolean).sort((a, b) => b - a)[0];
    if (lastTurn) {
      panel.appendChild(el("p", { class: "muted", style: "font-size:12.5px;margin:0 0 10px" }, [
        `Last turn: ${fmtMinutes(lastTurn)}`,
      ]));
    }

    if (unit.joined) {
      panel.appendChild(el("p", { class: "muted", style: "font-size:12.5px;margin:0 0 10px" }, [
        "Joined because these tables are touching. Drag them apart in Arrange Tables to split the run.",
      ]));
    }

    panel.appendChild(el("button", {
      class: "btn btn-ghost btn-sm btn-block",
      onclick: () => {
        const open = unit.tables;
        selectedId = null;
        open.forEach(updateTableNode);
        renderTablePanel();
      },
    }, ["Close"]));
  }

  // ---------- waitlist ----------
  function addWaitEntry(entry) {
    state.waitlist.push(entry);
    Audit.record(Audit.ACTIONS.WAITLIST_ADDED, {
      entity: "waitlist_entry", entityId: entry.id, summary: `${entry.name}, party of ${entry.party}`,
    });
    persist();
    renderWaitlist();
  }

  function removeWaitEntry(id) {
    state.waitlist = state.waitlist.filter((w) => w.id !== id);
    persist();
    renderWaitlist();
  }

  // Every clean unit across both layouts — joined runs included, at their
  // combined seat count — with the ones big enough for the party first and the
  // smallest of those at the top, the host's usual choice. A run only offers
  // itself if all of it is clean; half a joined run is not a table.
  function seatableUnits(partySize) {
    const options = [];
    FloorStorage.LAYOUTS.forEach((layout) => {
      unitsFor(layout.id)
        .filter((u) => u.status === "clean")
        .forEach((unit) => options.push({ unit, layout }));
    });
    // Tightest fit first among those that fit, then the too-small ones biggest
    // first — the ranking lives in geometry so it can be tested directly.
    const ranked = FloorGeometry.rankForParty(options.map((o) => o.unit), partySize);
    return ranked.map((unit) => options.find((o) => o.unit === unit));
  }

  function seatEntryAt(entry, unit, layoutId) {
    if (arranging) setArranging(false);
    if (state.activeLayout !== layoutId) {
      state.activeLayout = layoutId;
      $all(".layout-btn").forEach((b) => b.classList.toggle("active", b.dataset.layout === layoutId));
    }
    // Set the count before the status flip so it isn't overwritten by the
    // seat-count default applied to a table seated straight off the floor.
    setUnitGuests(unit, entry.party);
    unit.tables[0].party = { name: entry.name, notes: entry.notes || "" };
    selectedId = unit.tables[0].id;
    unit.tables.forEach((t) => applyStatus(t, "seated"));
    state.waitlist = state.waitlist.filter((w) => w.id !== entry.id);
    Audit.record(Audit.ACTIONS.WAITLIST_SEATED, {
      entity: "waitlist_entry", entityId: entry.id,
      summary: `${entry.name} seated at ${unit.label}`,
    });
    persist();
    renderFloor();
    renderWaitlist();
    switchTab("floor");
    toast(`${entry.name} seated at ${unit.joined ? "tables " : ""}${unit.label}`);
  }

  function promptSeat(entry) {
    openModal(`Seat ${entry.name} — party of ${entry.party}`, (body, close) => {
      const options = seatableUnits(entry.party);
      if (!options.length) {
        body.appendChild(el("p", { class: "muted" }, ["No clean tables open right now."]));
      } else {
        body.appendChild(el("p", { class: "muted", style: "font-size:12.5px" }, [
          "Pick a table — the ones that fit the party are listed first.",
        ]));
        const picker = el("div", { class: "table-picker" });
        options.forEach(({ unit, layout }) => {
          const fits = unit.seats >= entry.party;
          picker.appendChild(el("button", {
            class: "picker-item" + (fits ? "" : " short"),
            type: "button",
            onclick: () => { seatEntryAt(entry, unit, layout.id); close(); },
          }, [
            el("span", { class: "pi-label" }, [unit.label]),
            el("span", { class: "pi-sub" }, [
              `${layout.label} · seats ${unit.seats}${unit.joined ? " · joined" : ""}`,
            ]),
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
    const longest = state.waitlist.reduce((max, w) => Math.max(max, now - Time.ms(w.addedAt)), 0);
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

  // A party's details change while they wait — two more showed up, they left a
  // better number, they'd rather have a booth. Editing never touches addedAt,
  // so the quote clock keeps running from when they actually walked in.
  function openWaitEditor(entry) {
    openModal("Edit party", (body, close) => {
      const draft = {
        name: entry.name,
        phone: entry.phone || "",
        party: entry.party,
        notes: entry.notes || "",
      };

      const nameInput = el("input", { type: "text", value: draft.name, oninput: (e) => (draft.name = e.target.value) });
      const phoneInput = el("input", { type: "tel", value: draft.phone, oninput: (e) => (draft.phone = e.target.value) });
      const partyInput = el("input", { type: "number", min: "1", step: "1", value: String(draft.party), oninput: (e) => (draft.party = e.target.value) });
      const notesInput = el("input", { type: "text", value: draft.notes, oninput: (e) => (draft.notes = e.target.value) });

      const form = el("form", {}, [
        el("div", { class: "tp-party" }, [
          el("div", {}, [`Added ${fmtTimeOfDay(entry.addedAt)}`]),
          el("div", { class: "muted" }, [`Waiting ${fmtMinutes(Time.since(entry.addedAt))} — editing doesn't restart the clock.`]),
        ]),
        // Same three-across layout as the Add Party form, so the host isn't
        // hunting for a field they just used.
        el("div", { class: "field-row" }, [
          el("div", { class: "field" }, [el("label", {}, ["Name"]), nameInput]),
          el("div", { class: "field" }, [el("label", {}, ["Phone"]), phoneInput]),
          el("div", { class: "field field-narrow" }, [el("label", {}, ["Party Size"]), partyInput]),
        ]),
        el("div", { class: "field" }, [el("label", {}, ["Notes"]), notesInput]),
        el("div", { class: "form-actions" }, [
          el("button", { type: "button", class: "btn btn-ghost", onclick: close }, ["Cancel"]),
          el("button", { type: "submit", class: "btn btn-primary" }, ["Save Changes"]),
        ]),
      ]);

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = draft.name.trim();
        if (!name) { toast("Name is required"); nameInput.focus(); return; }
        const before = { party: entry.party };
        entry.name = name;
        entry.phone = draft.phone.trim();
        entry.party = Math.max(1, parseInt(draft.party, 10) || 1);
        entry.notes = draft.notes.trim();
        Audit.record(Audit.ACTIONS.WAITLIST_EDITED, {
          entity: "waitlist_entry", entityId: entry.id,
          summary: `${entry.name} edited`, before: before, after: { party: entry.party },
        });
        persist();
        renderWaitlist();
        close();
        toast(`${entry.name} updated`);
      });

      body.appendChild(form);
      nameInput.focus();
    });
  }

  function waitNode(entry) {
    const waited = Time.since(entry.addedAt);
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
        el("div", { class: "elapsed " + tone, "data-since": String(Time.ms(entry.addedAt)) }, [fmtClock(waited)]),
        el("div", { class: "quoted" }, ["waiting"]),
      ]),
      el("div", { class: "wait-actions" }, [
        el("button", {
          class: "btn btn-primary btn-sm",
          onclick: () => promptSeat(entry),
        }, ["Seat"]),
        el("button", {
          class: "btn btn-sm",
          onclick: () => openWaitEditor(entry),
        }, ["Edit"]),
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
            Audit.record(Audit.ACTIONS.SHIFT_CLEARED, { entity: "shift", summary: "End of shift — floor and waitlist cleared" });
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
    state = FloorStorage.load();
    // So an export reflects what this tool is holding right now.
    Portability.registerSource("floor", () => state);
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
        addedAt: Time.now(),
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
    // Counted in units so a joined run reads as the one table it has become.
    const all = FloorStorage.LAYOUTS.flatMap((l) => unitsFor(l.id));
    const seated = all.filter((u) => u.status === "seated");
    const now = Date.now();
    const waits = state.waitlist.map((w) => now - Time.ms(w.addedAt));
    return {
      tables: all.length,
      seated: seated.length,
      dirty: all.filter((u) => u.status === "dirty").length,
      clean: all.filter((u) => u.status === "clean").length,
      joined: all.filter((u) => u.joined).length,
      guests: seated.reduce((s, u) => s + u.guests, 0),
      seats: all.reduce((s, u) => s + u.seats, 0),
      waiting: state.waitlist.length,
      longestWaitMs: waits.length ? Math.max(...waits) : 0,
      quotedParties: state.waitlist.slice(0, 3).map((w) => ({ name: w.name, party: w.party, waitedMs: now - Time.ms(w.addedAt) })),
    };
  }

  // A plain-data view of the room as it stands, for the Ask tab.
  function snapshot() {
    const now = Date.now();
    const layouts = FloorStorage.LAYOUTS.map((l) => ({
      layout: l.label,
      // Units, not raw tables: tables pushed together are reported as the one
      // table they now are, at their combined seat count.
      tables: unitsFor(l.id).map((u) => ({
        table: u.label,
        joined: u.joined || undefined,
        joinedFrom: u.joined ? u.tables.length : undefined,
        seats: u.seats,
        status: FloorStorage.STATUS_LABELS[u.status] || u.status,
        guests: u.guests,
        seatedFor: u.seatedAt ? fmtMinutes(now - Time.ms(u.seatedAt)) : null,
        lastTurn: u.tables.map((t) => t.lastTurnMs).filter(Boolean).sort((a, b) => b - a)[0]
          ? fmtMinutes(u.tables.map((t) => t.lastTurnMs).filter(Boolean).sort((a, b) => b - a)[0])
          : null,
        notes: u.tables.map((t) => t.notes).filter(Boolean).join(" · ") || null,
      })),
    }));
    return {
      activeLayout: layoutLabel(state.activeLayout),
      layouts,
      waitlist: state.waitlist.map((w, i) => ({
        position: i + 1,
        name: w.name,
        party: w.party,
        waiting: fmtMinutes(now - w.addedAt),
        addedAt: fmtTimeOfDay(w.addedAt),
        notes: w.notes || null,
      })),
    };
  }

  return { init, summary, snapshot, switchTab, fmtMinutes, get state() { return state; } };
})();
