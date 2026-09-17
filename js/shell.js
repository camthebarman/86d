/* shell.js — the house layer: the section bar across the top and the combined
   dashboard that sits in front of all three tools.

   The dashboard never reaches into a tool's state. Each tool exposes a
   summary() of its own numbers, which is the only thing this file reads —
   so a tool can change how it stores anything without breaking this page. */

(function () {
  const el = Core.el;
  const MODULES = ["dashboard", "food", "bev", "floor", "agent"];

  // ---------- section switching ----------
  function showModule(name) {
    MODULES.forEach((m) => {
      const node = document.getElementById("mod-" + m);
      if (node) node.classList.toggle("active", m === name);
    });
    document.querySelectorAll(".section-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.module === name);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "agent") AgentApp.focusInput();
    window.scrollTo({ top: 0 });
  }

  // ---------- the clock in the masthead ----------
  function renderClock() {
    const now = new Date();
    document.getElementById("house-clock").innerHTML = "";
    document.getElementById("house-clock").append(
      el("strong", {}, [now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })]),
      el("span", {}, [now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })])
    );
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  function pct(n) {
    return (Number(n) || 0).toFixed(1) + "%";
  }
  function minutes(ms) {
    return Math.floor((Number(ms) || 0) / 60000) + "m";
  }

  function statCard(label, value, sub) {
    return el("div", { class: "stat-card" }, [
      el("div", { class: "label" }, [label]),
      el("div", { class: "value" }, [String(value)]),
      sub ? el("div", { class: "muted small-note" }, [sub]) : null,
    ]);
  }

  function toolCard(opts) {
    return el("button", { class: "tool-card", style: `--card-accent:${opts.accent}`, onclick: () => showModule(opts.module) }, [
      el("div", { class: "tool-card-head" }, [
        el("span", { class: "mark" }, [opts.mark]),
        el("div", {}, [
          el("h3", {}, [opts.title]),
          el("div", { class: "sub" }, [opts.sub]),
        ]),
      ]),
      el(
        "div",
        { class: "tool-metrics" },
        opts.metrics.map((m) =>
          el("div", { class: "tool-metric" }, [
            el("div", { class: "label" }, [m[0]]),
            el("div", { class: "value" }, [String(m[1])]),
          ])
        )
      ),
      el("div", { class: "open-link" }, ["Open " + opts.title + " →"]),
    ]);
  }

  // Everything a manager would want flagged before service, in one list,
  // regardless of which tool noticed it.
  function alertsCard(food, bev, floor) {
    const rows = [];
    food.eightySixed.forEach((n) => rows.push(["Kitchen", `86 — ${n} can't be made with what's counted in`, "bad"]));
    bev.eightySixed.forEach((n) => rows.push(["Bar", `86 — ${n} can't be poured with what's counted in`, "bad"]));
    if (floor.dirty) rows.push(["Floor", `${floor.dirty} table${floor.dirty === 1 ? "" : "s"} sitting dirty`, "warn"]);
    if (floor.longestWaitMs > 35 * 60 * 1000) {
      rows.push(["Floor", `Longest wait is ${minutes(floor.longestWaitMs)} — past the 35 minute quote`, "bad"]);
    } else if (floor.longestWaitMs > 20 * 60 * 1000) {
      rows.push(["Floor", `Longest wait is ${minutes(floor.longestWaitMs)}`, "warn"]);
    }
    if (food.belowPar.length) {
      rows.push(["Kitchen", `${food.belowPar.length} below par: ${food.belowPar.slice(0, 4).join(", ")}${food.belowPar.length > 4 ? "…" : ""}`, "warn"]);
    }
    if (bev.belowPar.length) {
      rows.push(["Bar", `${bev.belowPar.length} below par: ${bev.belowPar.slice(0, 4).join(", ")}${bev.belowPar.length > 4 ? "…" : ""}`, "warn"]);
    }

    const card = el("div", { class: "card" }, [
      el("div", { class: "card-head-row" }, [
        el("h3", {}, ["Needs Attention"]),
        el("span", { class: "muted small-note" }, ["Pulled live from all three tools"]),
      ]),
    ]);
    if (!rows.length) {
      card.append(el("div", { class: "empty-state" }, ["Nothing flagged — the floor is clean, nothing is 86'd, and every count is at par."]));
      return card;
    }
    const list = el("ul", { class: "alert-list" });
    rows.forEach(([where, what, tone]) => {
      list.append(
        el("li", {}, [
          el("span", { class: "where" }, [where]),
          el("span", { class: "what" }, [what]),
          el("span", { class: "pill " + tone }, [tone === "bad" ? "Act now" : "Watch"]),
        ])
      );
    });
    card.append(list);
    return card;
  }

  // ---------- the dashboard ----------
  function renderDashboard() {
    const panel = document.getElementById("mod-dashboard");
    const food = FoodApp.summary();
    const bev = BevApp.summary();
    const floor = FloorApp.summary();

    panel.innerHTML = "";
    panel.append(
      el("div", { class: "hero" }, [
        el("h2", {}, ["Tonight at Generic Bar & Grill"]),
        el("p", { class: "sub" }, [
          "Every number below is live from the three tools behind this page — the kitchen's counts, the bar's counts, and the room as the host stand has it right now.",
        ]),
      ])
    );

    // Front of house first: it's the only thing that changes minute to minute.
    const occupancy = floor.seats ? (floor.guests / floor.seats) * 100 : 0;
    panel.append(
      el("div", { class: "grid grid-4" }, [
        statCard("Tables Seated", `${floor.seated} / ${floor.tables}`, `${floor.clean} clean · ${floor.dirty} dirty`),
        statCard("Guests In", floor.guests, `${pct(occupancy)} of ${floor.seats} seats`),
        statCard("On The Waitlist", floor.waiting, floor.waiting ? `Longest ${minutes(floor.longestWaitMs)}` : "Nobody waiting"),
        statCard("Inventory On Hand", money(food.inventoryValue + bev.inventoryValue), `Kitchen ${money(food.inventoryValue)} · Bar ${money(bev.inventoryValue)}`),
      ])
    );

    panel.append(
      el("div", { class: "tool-grid" }, [
        toolCard({
          module: "food",
          accent: "#2f7d4f",
          mark: "🍽️",
          title: "Food",
          sub: "Plate costs, counts, catering",
          metrics: [
            ["Dishes", food.dishes],
            ["Avg Food Cost", food.avgFoodCostPct ? pct(food.avgFoodCostPct) : "—"],
            ["Below Par", food.belowPar.length],
            ["Inventory", money(food.inventoryValue)],
          ],
        }),
        toolCard({
          module: "bev",
          accent: "#b3541e",
          mark: "🍸",
          title: "Beverage",
          sub: "Pour costs, preps, bar counts",
          metrics: [
            ["Drinks", bev.drinks],
            ["Avg Pour Cost", bev.avgPourCostPct ? pct(bev.avgPourCostPct) : "—"],
            ["Below Par", bev.belowPar.length],
            ["Nightly Sales", money(bev.nightlySales)],
          ],
        }),
        toolCard({
          module: "floor",
          accent: "#1d6b60",
          mark: "🪑",
          title: "Front of House",
          sub: "Floor plan and waitlist",
          metrics: [
            ["Seated", floor.seated],
            ["Dirty", floor.dirty],
            ["Waiting", floor.waiting],
            ["Longest Wait", floor.waiting ? minutes(floor.longestWaitMs) : "—"],
          ],
        }),
      ])
    );

    panel.append(alertsCard(food, bev, floor));

    // Who's next through the door, so the dashboard is useful to a host too.
    if (floor.quotedParties.length) {
      const card = el("div", { class: "card" }, [el("h3", {}, ["Next Up"])]);
      const list = el("ul", { class: "breakdown-list" });
      floor.quotedParties.forEach((p) => {
        list.append(
          el("li", {}, [
            el("span", {}, [`${p.name} — party of ${p.party}`]),
            el("span", { class: "muted" }, [`waiting ${minutes(p.waitedMs)}`]),
          ])
        );
      });
      card.append(list);
      card.append(
        el("div", { style: "margin-top:12px" }, [
          el("button", { class: "btn btn-sm", onclick: () => { showModule("floor"); FloorApp.switchTab("waitlist"); } }, ["Open the waitlist"]),
        ])
      );
      panel.append(card);
    }
  }

  // ---------- boot ----------
  Core.ready(function () {
    Core.init();

    document.getElementById("section-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".section-btn");
      if (btn) showModule(btn.dataset.module);
    });

    FoodApp.init();
    BevApp.init();
    FloorApp.init();
    AgentApp.init();

    renderClock();
    setInterval(renderClock, 30000);

    // The floor moves on its own timers, so the dashboard re-reads it while
    // it's the page you're looking at.
    setInterval(() => {
      if (document.getElementById("mod-dashboard").classList.contains("active")) renderDashboard();
    }, 15000);

    renderDashboard();
  });
})();
