/* floor/demo.js — a busy Friday night, roughly 7:45 service.

   Times are relative to whenever this is loaded, so every seat timer and wait
   is live rather than frozen at the minute the data was written. Applied over
   the tables already on the floor, so a room arranged to match the real Harbor
   Hotel keeps its layout — only statuses, counts, notes and the waitlist are
   replaced. */

const FloorDemo = (function () {
  const MIN = 60000;

  // [status, guests, minutes since seated, notes, party seated off the waitlist]
  const DINING = {
    d_w1: ["seated", 2, 34, "", { name: "Ferris", notes: "Window request" }],
    d_w2: ["seated", 2, 12, ""],
    d_w3: ["dirty", 2, 71, "Bus tub needed"],
    d_w4: ["seated", 2, 4, "Allergy: shellfish — kitchen carded"],
    d_w5: ["clean"],
    d_b1: ["seated", 4, 58, "Split check x4"],
    d_b2: ["seated", 3, 22, "", { name: "Okonkwo", notes: "Booth requested" }],
    d_b3: ["dirty", 4, 95, "Campers — reset before the 8:30 quote"],
    d_b4: ["seated", 6, 41, "Two highchairs"],
    d_10: ["seated", 4, 16, ""],
    d_11: ["seated", 4, 67, "Check dropped, waiting on the card"],
    d_12: ["clean"],
    d_13: ["seated", 2, 8, "", { name: "Whitcomb", notes: "Anniversary — dessert plate fired" }],
    d_14: ["seated", 4, 31, ""],
    d_15: ["dirty", 4, 84, "Reset for the 8:15 six-top"],
    d_20: ["seated", 6, 49, "Wine club — sommelier notified"],
    d_21: ["seated", 5, 27, "", { name: "Bhatt", notes: "Called ahead" }],
    d_22: ["seated", 8, 73, "Birthday at 9 — candles going out with pastry"],
  };

  const BAR = {
    b_s1: ["seated", 1, 18, ""],
    b_s2: ["seated", 1, 18, "Together with S1 — one check"],
    b_s3: ["seated", 1, 52, "Regular — tab open"],
    b_s4: ["clean"],
    b_s5: ["seated", 1, 6, ""],
    b_s6: ["seated", 1, 6, ""],
    b_s7: ["dirty", 1, 41, "Glassware to the well"],
    b_s8: ["seated", 1, 33, ""],
    b_s9: ["seated", 1, 33, ""],
    b_s10: ["clean"],
    b_h1: ["seated", 4, 24, "", { name: "Nakamura", notes: "Holding here until 12 opens up" }],
    b_h2: ["seated", 3, 11, ""],
    b_h3: ["dirty", 4, 62, ""],
    b_h4: ["seated", 4, 39, "Pre-theater — out by 8:40"],
    b_l1: ["seated", 2, 15, ""],
    b_l2: ["clean"],
    b_l3: ["seated", 4, 44, "Drinks only"],
    b_l4: ["seated", 2, 7, "", { name: "Okafor", notes: "" }],
    b_c1: ["seated", 9, 55, "Rehearsal dinner overflow"],
  };

  // [name, phone, party size, notes, minutes ago]
  const WAITLIST = [
    ["Delgado", "(607) 555-0134", 5, "Booth if possible", 38],
    ["Marchetti", "(607) 555-0192", 2, "Bar is fine", 26],
    ["Sorenson", "(607) 555-0117", 4, "Two highchairs", 21],
    ["Agyeman", "(607) 555-0163", 6, "Called ahead for 8:00", 14],
    ["Petrakis", "(607) 555-0148", 2, "Waiting at the bar", 9],
    ["Vance", "(607) 555-0175", 3, "", 4],
    ["Ruiz", "(607) 555-0129", 8, "Large party — happy to split across two tables", 2],
  ];

  function applyScript(tables, script, now) {
    (tables || []).forEach((table) => {
      const row = script[table.id];
      table.status = "clean";
      table.guests = 0;
      table.notes = "";
      table.party = null;
      table.seatedAt = null;
      table.lastTurnMs = null;
      if (!row || row[0] === "clean") return;
      table.status = row[0];
      table.guests = row[1];
      table.seatedAt = now - row[2] * MIN;
      table.notes = row[3] || "";
      table.party = row[4] || null;
    });
  }

  // Fills a state in place. Table positions are left untouched.
  function apply(state) {
    const now = Date.now();
    applyScript(state.layouts.dining, DINING, now);
    applyScript(state.layouts.bar, BAR, now);
    state.waitlist = WAITLIST.map(([name, phone, party, notes, minsAgo], i) => ({
      id: "demo_" + i,
      name,
      phone,
      party,
      notes,
      addedAt: now - minsAgo * MIN,
    }));
    return state;
  }

  return { apply };
})();
