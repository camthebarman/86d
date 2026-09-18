/* floor/geometry.js — where tables are, and what that means.

   Pure geometry and pure arithmetic: no DOM, no storage, no rendering. The
   floor plan's hardest logic — deciding that two tables pushed together are
   now one table — lives here so it can be tested without a browser and reused
   by anything that needs to reason about the room (the dashboard, the Ask tab,
   and eventually a server deciding whether a party fits).

   The floor is a 16:10 box. x and w are percentages of its width, y a
   percentage of its height, and each shape has a fixed width:height ratio. To
   compare distances on both axes they must be in the same unit, so everything
   here works in percent-of-floor-WIDTH. */

const FloorGeometry = (function () {
  const FLOOR_ASPECT = 16 / 10;
  const SHAPE_ASPECT = { round: 1, stool: 1, square: 1, booth: 2, communal: 3 };
  // How close two edges must be to count as touching, in percent-of-width:
  // roughly a finger's width of slack at a normal floor size.
  const JOIN_TOLERANCE = 1.0;

  function box(t) {
    const w = Number(t.w) || 0;
    const h = w / (SHAPE_ASPECT[t.shape] || 1);
    const cx = Number(t.x) || 0;
    const cy = (Number(t.y) || 0) / FLOOR_ASPECT;
    return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
  }

  function touch(a, b, tolerance) {
    const tol = tolerance == null ? JOIN_TOLERANCE : tolerance;
    return (
      a.left - tol < b.right && b.left - tol < a.right &&
      a.top - tol < b.bottom && b.top - tol < a.bottom
    );
  }

  // A run is seated if any part of it is and dirty if any part still needs
  // bussing — you cannot seat a new party at half of it.
  function rollUpStatus(tables) {
    if (tables.some((t) => t.status === "seated")) return "seated";
    if (tables.some((t) => t.status === "dirty")) return "dirty";
    return "clean";
  }

  function makeGroup(members) {
    const sorted = members
      .slice()
      .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
    const boxes = sorted.map(box);
    return {
      tables: sorted,
      ids: sorted.map((t) => t.id),
      label: sorted.map((t) => t.label).join(" + "),
      seats: sorted.reduce((s, t) => s + (Number(t.seats) || 0), 0),
      guests: sorted.reduce((s, t) => s + (Number(t.guests) || 0), 0),
      status: rollUpStatus(sorted),
      seatedAt: sorted.reduce((earliest, t) => {
        const at = t.seatedAt;
        if (!at) return earliest;
        if (!earliest) return at;
        return (Time.ms(at) || 0) < (Time.ms(earliest) || 0) ? at : earliest;
      }, null),
      box: {
        left: Math.min.apply(null, boxes.map((b) => b.left)),
        right: Math.max.apply(null, boxes.map((b) => b.right)),
        top: Math.min.apply(null, boxes.map((b) => b.top)),
        bottom: Math.max.apply(null, boxes.map((b) => b.bottom)),
      },
    };
  }

  // Every run of touching tables, as connected components.
  function groups(tables, tolerance) {
    const list = tables || [];
    const boxes = list.map(box);
    const seen = new Array(list.length).fill(false);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (seen[i]) continue;
      seen[i] = true;
      const stack = [i];
      const members = [];
      while (stack.length) {
        const k = stack.pop();
        members.push(list[k]);
        for (let j = 0; j < list.length; j++) {
          if (!seen[j] && touch(boxes[k], boxes[j], tolerance)) {
            seen[j] = true;
            stack.push(j);
          }
        }
      }
      if (members.length > 1) out.push(makeGroup(members));
    }
    return out;
  }

  function single(table) {
    return {
      group: null, tables: [table], label: table.label,
      seats: Number(table.seats) || 0, guests: Number(table.guests) || 0,
      status: table.status, seatedAt: table.seatedAt, joined: false,
    };
  }

  function fromGroup(g) {
    return {
      group: g, tables: g.tables, label: g.label,
      seats: g.seats, guests: g.guests, status: g.status, seatedAt: g.seatedAt, joined: true,
    };
  }

  // What the floor is actually made of once joins are taken into account: a
  // joined run counts once, an unjoined table counts once.
  function units(tables, tolerance) {
    const gs = groups(tables, tolerance);
    const claimed = new Set();
    gs.forEach((g) => g.ids.forEach((id) => claimed.add(id)));
    return gs.map(fromGroup).concat((tables || []).filter((t) => !claimed.has(t.id)).map(single));
  }

  function unitFor(table, tables, tolerance) {
    const g = groups(tables, tolerance).find((x) => x.ids.indexOf(table.id) !== -1);
    return g ? fromGroup(g) : single(table);
  }

  // Fills each table to its own seat count before spilling into the next, so a
  // 6-top and a 4-top pushed together read as 6 and 2 rather than 5 and 5. Any
  // excess beyond the run's capacity lands on the last table.
  function distributeGuests(tables, total) {
    let left = Math.max(0, Number(total) || 0);
    return (tables || []).map((t, i) => {
      const take = i === tables.length - 1 ? left : Math.min(left, Number(t.seats) || 0);
      left -= take;
      return take;
    });
  }

  // The host's usual choice: things that fit, tightest first; then things that
  // don't, biggest first.
  function rankForParty(units_, partySize) {
    return (units_ || []).slice().sort((a, b) => {
      const aFits = a.seats >= partySize;
      const bFits = b.seats >= partySize;
      if (aFits !== bFits) return aFits ? -1 : 1;
      return aFits ? a.seats - b.seats : b.seats - a.seats;
    });
  }

  return {
    FLOOR_ASPECT, SHAPE_ASPECT, JOIN_TOLERANCE,
    box, touch, groups, units, unitFor, single, fromGroup,
    rollUpStatus, distributeGuests, rankForParty,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { FloorGeometry };
