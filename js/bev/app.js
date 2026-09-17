/* bev/app.js — the Beverage tool: ingredients, house-made preps, glassware,
   recipes, inventory, usage and events. Renders into #mod-bev only; the modal
   and the toast are the house's, borrowed from Core. */

const BevApp = (function () {
  let state = BevStorage.load();

  const CATEGORIES = ["Spirit", "Liqueur", "Wine", "Beer", "Mixer", "Juice", "Syrup", "Ice", "Garnish", "Straw", "Dry Goods", "Other"];
  const PREP_CATEGORIES = ["Syrup", "Concentrate", "Infusion", "Mix", "Other"];

  // ---------- generic helpers ----------
  // Every lookup is scoped to this tool's own subtree, so the three tools can
  // reuse the same class names (.tab-btn, .panel) without colliding.
  const ROOT = document.getElementById("mod-bev");
  function $(sel, root) { return (root || ROOT).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || ROOT).querySelectorAll(sel)); }
  const el = Core.el;
  const openModal = Core.openModal;
  const closeModal = Core.closeModal;
  const toast = Core.toast;
  function persist() { BevStorage.save(state); }

  // Unit an item's inventory is counted in — its purchase unit unless overridden.
  function countUnit(item) { return item.countUnit || item.purchaseUnit || item.baseUnit; }

  // Inventory value of anything countable: a bought ingredient at what it was
  // purchased for, a house-made prep at what the raw ingredients in its batch
  // cost. A prep has no purchase pack, so it has to be priced through its own
  // ingredient-shaped view of itself.
  function itemValue(item) {
    if (item.yieldQty == null) return BevCalc.inventoryValue(item);
    return BevCalc.inventoryValue(
      Object.assign(BevCalc.prepAsIngredient(item, getIngredient), { onHandQty: item.onHandQty })
    );
  }

  function getIngredient(id) { return state.ingredients.find((i) => i.id === id); }
  function getGlass(id) { return state.glassSizes.find((g) => g.id === id); }
  function getRecipe(id) { return state.recipes.find((r) => r.id === id); }
  function getPrep(id) { return state.preps.find((p) => p.id === id); }

  // Resolves a recipe component's ingredientId to either a raw ingredient or,
  // if it's a house-made prep, a computed ingredient-like view of that prep
  // (batch cost spread across its yield) — so recipe cost math treats both
  // the same way without caring which one it got.
  function resolveComponent(id) {
    const ing = getIngredient(id);
    if (ing) return ing;
    const prep = getPrep(id);
    if (!prep) return null;
    return BevCalc.prepAsIngredient(prep, getIngredient);
  }

  // ---------- tabs ----------
  function switchTab(name) {
    $all(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $all(".panel").forEach((p) => p.classList.toggle("active", p.id === "bev-panel-" + name));
  }

  // ---------- header actions ----------
  function resetData() {
    if (confirm("Reset the beverage program to the built-in sample bar? This discards the counts, prices and recipe changes you've made here.")) {
      state = BevStorage.resetToDefaults();
      renderAll();
      toast("Beverage data reset to defaults.");
    }
  }

  // ================= INGREDIENTS =================
  function renderIngredients() {
    const panel = $("#bev-panel-ingredients");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Ingredients"]),
          el("div", { class: "sub" }, ["Every liquid, dry good, ice, straw, and garnish priced down to its cost-per-use."]),
        ]),
        el("button", { class: "btn btn-primary", onclick: () => openIngredientForm() }, ["+ Add Ingredient"]),
      ])
    );

    const wrap = el("div", { class: "card" });
    if (!state.ingredients.length) {
      wrap.append(el("div", { class: "empty-state" }, ["No ingredients yet. Add your first one."]));
    } else {
      const table = el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Name"]),
            el("th", {}, ["Category"]),
            el("th", {}, ["Purchased As"]),
            el("th", { class: "num" }, ["Purchase Cost"]),
            el("th", { class: "num" }, ["Cost / " + "unit"]),
            el("th", {}, [""]),
          ]),
        ]),
      ]);
      const tbody = el("tbody");
      state.ingredients
        .slice()
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
        .forEach((ing) => {
          const perUnitLabel = BevCalc.unitLabel(ing, 1);
          const purchaseUnit = BevCalc.purchaseUnitsFor(ing.baseUnit).find((u) => u.id === ing.purchaseUnit);
          const purchaseLabel = purchaseUnit && purchaseUnit.id === "each" ? BevCalc.unitLabel(ing, ing.purchaseQty) : purchaseUnit ? purchaseUnit.label : "";
          const cpu = BevCalc.costPerBaseUnit(ing);
          tbody.append(
            el("tr", {}, [
              el("td", {}, [el("strong", {}, [ing.name])]),
              el("td", {}, [el("span", { class: "pill" }, [ing.category])]),
              el("td", { class: "muted" }, [`${BevCalc.fmtQty(ing.purchaseQty)} ${purchaseLabel} for ${BevCalc.fmtMoney(ing.purchaseCost)}`]),
              el("td", { class: "num" }, [BevCalc.fmtMoney(ing.purchaseCost)]),
              el("td", { class: "num" }, [`${BevCalc.fmtMoney(cpu)} / ${perUnitLabel}`]),
              el("td", {}, [
                el("div", { class: "row-actions" }, [
                  el("button", { class: "btn btn-sm", onclick: () => openIngredientForm(ing.id) }, ["Edit"]),
                  el("button", { class: "btn btn-sm danger", onclick: () => deleteIngredient(ing.id) }, ["Delete"]),
                ]),
              ]),
            ])
          );
        });
      table.append(tbody);
      wrap.append(el("div", { class: "table-wrap" }, [table]));
    }
    panel.append(wrap);
  }

  function openIngredientForm(id) {
    const existing = id ? getIngredient(id) : null;
    openModal(existing ? "Edit Ingredient" : "Add Ingredient", (body) => {
      const draft = existing
        ? { ...existing }
        : { name: "", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: "", purchaseCost: "", onHandQty: 0, parQty: 0 };

      // On hand and par are typed in the count unit and only converted to base
      // units on commit — so commit before any re-render that changes the unit.
      function commitCounts() {
        const cUnit = countUnit(draft);
        if (draft._onHandInput != null) {
          draft.onHandQty = BevCalc.toBaseQty(draft.baseUnit, cUnit, draft._onHandInput);
          delete draft._onHandInput;
        }
        if (draft._parInput != null) {
          draft.parQty = BevCalc.toBaseQty(draft.baseUnit, cUnit, draft._parInput);
          delete draft._parInput;
        }
      }

      function render() {
        body.innerHTML = "";
        const purchaseOptions = BevCalc.purchaseUnitsFor(draft.baseUnit);
        if (!purchaseOptions.find((u) => u.id === draft.purchaseUnit)) draft.purchaseUnit = purchaseOptions[0].id;

        const form = el("form", {}, [
          field("Name", el("input", { type: "text", required: "required", value: draft.name, oninput: (e) => (draft.name = e.target.value) })),
          fieldRow([
            field("Category", selectEl(CATEGORIES, draft.category, (v) => (draft.category = v))),
            field(
              "Measured By",
              selectEl(
                Object.entries(BevCalc.BASE_UNITS).map(([id, u]) => ({ id, label: u.long })),
                draft.baseUnit,
                (v) => { commitCounts(); draft.baseUnit = v; delete draft.countUnit; render(); },
                true
              )
            ),
          ]),
          el("div", { class: "section-title" }, ["How it's purchased"]),
          fieldRow([
            field("Quantity", el("input", { type: "number", step: "any", min: "0", required: "required", value: draft.purchaseQty, oninput: (e) => (draft.purchaseQty = e.target.value) })),
            field(
              "Unit",
              selectEl(
                purchaseOptions.map((u) => ({ id: u.id, label: u.label })),
                draft.purchaseUnit,
                (v) => (draft.purchaseUnit = v),
                true
              )
            ),
            field("Total Cost ($)", el("input", { type: "number", step: "any", min: "0", required: "required", value: draft.purchaseCost, oninput: (e) => (draft.purchaseCost = e.target.value) })),
          ]),
          el("p", { class: "hint" }, [
            `≈ ${BevCalc.fmtMoney(BevCalc.costPerBaseUnit(draft))} per ${BevCalc.BASE_UNITS[draft.baseUnit].label} — this is the cost recipes will use.`,
          ]),

          el("div", { class: "section-title" }, ["Inventory on hand"]),
          fieldRow([
            field(
              "On Hand",
              el("input", {
                type: "number", step: "any", min: "0",
                value: BevCalc.fmtQty(BevCalc.fromBaseQty(draft.baseUnit, countUnit(draft), draft.onHandQty), 3),
                oninput: (e) => (draft._onHandInput = e.target.value),
              })
            ),
            field(
              "Par Level",
              el("input", {
                type: "number", step: "any", min: "0",
                value: BevCalc.fmtQty(BevCalc.fromBaseQty(draft.baseUnit, countUnit(draft), draft.parQty), 3),
                oninput: (e) => (draft._parInput = e.target.value),
              })
            ),
            field(
              "Counted In",
              selectEl(
                purchaseOptions.map((u) => ({ id: u.id, label: u.id === "each" ? BevCalc.unitLabel(draft, 2) || u.label : u.label })),
                countUnit(draft),
                (v) => { commitCounts(); draft.countUnit = v; render(); },
                true
              )
            ),
          ]),
          el("p", { class: "hint" }, ["Par is the level you want on the shelf — anything under it shows up as a reorder on the Inventory tab."]),
          el("div", { class: "form-actions" }, [
            el("button", { type: "button", class: "btn", onclick: closeModal }, ["Cancel"]),
            el("button", { type: "submit", class: "btn btn-primary" }, [existing ? "Save Changes" : "Add Ingredient"]),
          ]),
        ]);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          draft.purchaseQty = Number(draft.purchaseQty) || 0;
          draft.purchaseCost = Number(draft.purchaseCost) || 0;
          commitCounts();
          if (existing) {
            Object.assign(existing, draft);
          } else {
            draft.id = BevCalc.uid("ing");
            state.ingredients.push(draft);
          }
          persist();
          renderAll();
          closeModal();
          toast(existing ? "Ingredient updated." : "Ingredient added.");
        });
        body.append(form);
      }
      render();
    });
  }

  function deleteIngredient(id) {
    const usedInRecipes = state.recipes.filter((r) => r.components.some((c) => c.ingredientId === id));
    const usedInPreps = state.preps.filter((p) => p.components.some((c) => c.ingredientId === id));
    if (usedInRecipes.length || usedInPreps.length) {
      const names = [...usedInRecipes.map((r) => r.name), ...usedInPreps.map((p) => p.name + " (prep)")];
      alert(`Can't delete — used in: ${names.join(", ")}. Remove it from those first.`);
      return;
    }
    if (!confirm("Delete this ingredient?")) return;
    state.ingredients = state.ingredients.filter((i) => i.id !== id);
    persist();
    renderAll();
    toast("Ingredient deleted.");
  }

  // ================= PREPS (house-made syrups, concentrates, infusions) =================
  function renderPreps() {
    const panel = $("#bev-panel-preps");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Preps"]),
          el("div", { class: "sub" }, ["House-made syrups, concentrates, and infusions — batch cost spread across the yield, built from your raw ingredients."]),
        ]),
        el("button", { class: "btn btn-primary", onclick: () => openPrepForm() }, ["+ Add Prep"]),
      ])
    );

    if (!state.preps.length) {
      panel.append(el("div", { class: "card empty-state" }, ["No preps yet. Add a house-made syrup, concentrate, or infusion."]));
      return;
    }

    state.preps.forEach((prep) => panel.append(renderPrepCard(prep)));
  }

  function renderPrepCard(prep) {
    const batchCost = BevCalc.prepBatchCost(prep, getIngredient);
    const perUnit = BevCalc.prepCostPerUnit(prep, getIngredient);
    const unitLabelStr = BevCalc.unitLabel(prep, 1);

    const card = el("div", { class: "card recipe-card" }, [
      el("div", { class: "recipe-card-head" }, [
        el("div", {}, [
          el("h3", {}, [prep.name]),
          el("div", { class: "recipe-meta" }, [`${prep.category || "Prep"} · Yields ${BevCalc.fmtQty(prep.yieldQty)} ${BevCalc.unitLabel(prep, prep.yieldQty)}`]),
        ]),
        el("div", { class: "row-actions" }, [
          el("button", { class: "btn btn-sm", onclick: () => openPrepForm(prep.id) }, ["Edit"]),
          el("button", { class: "btn btn-sm danger", onclick: () => deletePrep(prep.id) }, ["Delete"]),
        ]),
      ]),
    ]);

    const bodyWrap = el("div", { class: "recipe-card-body two-col" });

    const list = el("ul", { class: "breakdown-list" });
    (prep.components || []).forEach((c) => {
      const ing = getIngredient(c.ingredientId);
      if (!ing) return;
      list.append(
        el("li", {}, [
          el("span", {}, [`${ing.name} — ${BevCalc.fmtQty(c.qty)} ${BevCalc.unitLabel(ing, c.qty)}`]),
          el("span", {}, [BevCalc.fmtMoney(BevCalc.componentCost(ing, c.qty))]),
        ])
      );
    });
    if (!prep.components || !prep.components.length) list.append(el("li", {}, [el("span", { class: "muted" }, ["No components added yet."])]));
    const left = el("div", {}, [el("div", { class: "section-title" }, ["Batch Components"]), list]);

    const right = el("div", {}, [
      el("div", { class: "section-title" }, ["Batch Cost"]),
      el("div", { class: "grid grid-2", style: "gap:10px" }, [
        statMini("Batch Cost", BevCalc.fmtMoney(batchCost)),
        statMini(`Cost / ${unitLabelStr}`, BevCalc.fmtMoney(perUnit)),
      ]),
      prep.instructions ? el("div", { class: "callout good", style: "margin-top:12px" }, [prep.instructions]) : el("span", {}),
    ]);

    bodyWrap.append(left, right);
    card.append(bodyWrap);
    return card;
  }

  function openPrepForm(id) {
    const existing = id ? getPrep(id) : null;
    openModal(existing ? "Edit Prep" : "Add Prep", (body) => {
      const draft = existing
        ? JSON.parse(JSON.stringify(existing))
        : { name: "", category: "Syrup", baseUnit: "floz", yieldQty: "", instructions: "", components: [], onHandQty: 0, parQty: 0 };

      function render() {
        body.innerHTML = "";

        const form = el("form", {});
        form.append(
          field("Prep Name", el("input", { type: "text", required: "required", value: draft.name, oninput: (e) => (draft.name = e.target.value) })),
          fieldRow([
            field("Category", selectEl(PREP_CATEGORIES, draft.category, (v) => (draft.category = v))),
            field(
              "Measured By",
              selectEl(
                Object.entries(BevCalc.BASE_UNITS).map(([id, u]) => ({ id, label: u.long })),
                draft.baseUnit,
                (v) => { draft.baseUnit = v; render(); },
                true
              )
            ),
          ]),
          field("Batch Yield", el("input", { type: "number", step: "any", min: "0", required: "required", value: draft.yieldQty, oninput: (e) => (draft.yieldQty = e.target.value) })),
          el("div", { class: "section-title" }, ["On hand"]),
          fieldRow([
            field(
              `On Hand (${BevCalc.BASE_UNITS[draft.baseUnit].label})`,
              el("input", { type: "number", step: "any", min: "0", value: draft.onHandQty || 0, oninput: (e) => (draft._onHandInput = e.target.value) })
            ),
            field(
              `Par Level (${BevCalc.BASE_UNITS[draft.baseUnit].label})`,
              el("input", { type: "number", step: "any", min: "0", value: draft.parQty || 0, oninput: (e) => (draft._parInput = e.target.value) })
            ),
          ]),
          el("p", { class: "hint" }, ["Counted in the same unit the batch yields, so one 32 fl oz batch on the shelf is 32."])
        );

        const compSection = el("div", {}, [el("div", { class: "section-title" }, ["Batch Components (built from raw ingredients)"])]);
        if (!draft.components.length) {
          compSection.append(el("p", { class: "muted" }, ["No components yet — add one below."]));
        }
        draft.components.forEach((comp, idx) => {
          const ing = getIngredient(comp.ingredientId);
          const row = el("div", { class: "component-row" }, [
            field(
              idx === 0 ? "Ingredient" : "",
              selectEl(
                state.ingredients.map((i) => ({ id: i.id, label: `${i.name} (${i.category})` })),
                comp.ingredientId,
                (v) => { comp.ingredientId = v; render(); }
              )
            ),
            field(
              `Qty (${ing ? BevCalc.unitLabel(ing, comp.qty) : "unit"})`,
              el("input", { type: "number", step: "any", min: "0", value: comp.qty, oninput: (e) => (comp.qty = e.target.value) })
            ),
            field(idx === 0 ? "Line Cost" : "", el("input", { type: "text", disabled: "disabled", value: BevCalc.fmtMoney(BevCalc.componentCost(ing, comp.qty)) })),
            el("button", { type: "button", class: "btn btn-sm danger btn-icon", title: "Remove", onclick: () => { draft.components.splice(idx, 1); render(); } }, ["✕"]),
          ]);
          compSection.append(row);
        });
        compSection.append(
          el(
            "button",
            {
              type: "button",
              class: "btn btn-sm",
              style: "margin-top:8px",
              onclick: () => {
                draft.components.push({ id: BevCalc.uid("pcomp"), ingredientId: state.ingredients[0] ? state.ingredients[0].id : "", qty: 0 });
                render();
              },
            },
            ["+ Add Component"]
          )
        );
        form.append(compSection);

        form.append(
          el("p", { class: "hint", id: "prep-cost-line" }, [costLineText()]),
          field("Instructions", el("textarea", { rows: "3", oninput: (e) => (draft.instructions = e.target.value) }, [draft.instructions || ""])),
          el("div", { class: "form-actions" }, [
            el("button", { type: "button", class: "btn", onclick: closeModal }, ["Cancel"]),
            el("button", { type: "submit", class: "btn btn-primary" }, [existing ? "Save Changes" : "Add Prep"]),
          ])
        );

        function costLineText() {
          const c = BevCalc.prepBatchCost(draft, getIngredient);
          const yieldQty = Number(draft.yieldQty) || 0;
          const perUnit = yieldQty ? c / yieldQty : 0;
          return `Batch cost: ${BevCalc.fmtMoney(c)} — cost per ${BevCalc.BASE_UNITS[draft.baseUnit].label}: ${BevCalc.fmtMoney(perUnit)}`;
        }

        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          draft.yieldQty = Number(draft.yieldQty) || 0;
          if (draft._onHandInput != null) { draft.onHandQty = Number(draft._onHandInput) || 0; delete draft._onHandInput; }
          if (draft._parInput != null) { draft.parQty = Number(draft._parInput) || 0; delete draft._parInput; }
          draft.components = draft.components
            .filter((c) => c.ingredientId)
            .map((c) => ({ ...c, qty: Number(c.qty) || 0 }));

          if (existing) {
            Object.assign(existing, draft);
          } else {
            draft.id = BevCalc.uid("prep");
            state.preps.push(draft);
          }
          persist();
          renderAll();
          closeModal();
          toast(existing ? "Prep updated." : "Prep added.");
        });

        body.append(form);
      }
      render();
    });
  }

  function deletePrep(id) {
    const usedIn = state.recipes.filter((r) => r.components.some((c) => c.ingredientId === id));
    if (usedIn.length) {
      alert(`Can't delete — used in: ${usedIn.map((r) => r.name).join(", ")}. Remove it from those recipes first.`);
      return;
    }
    if (!confirm("Delete this prep?")) return;
    state.preps = state.preps.filter((p) => p.id !== id);
    persist();
    renderAll();
    toast("Prep deleted.");
  }

  // ================= GLASSWARE =================
  function renderGlassware() {
    const panel = $("#bev-panel-glassware");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Glassware"]),
          el("div", { class: "sub" }, ["Glass sizes drive default ice and mixer volumes when you build a recipe."]),
        ]),
        el("button", { class: "btn btn-primary", onclick: () => openGlassForm() }, ["+ Add Glass"]),
      ])
    );

    const grid = el("div", { class: "grid grid-3" });
    state.glassSizes.forEach((glass) => {
      grid.append(
        el("div", { class: "card" }, [
          el("h3", {}, [glass.name]),
          el("div", { class: "muted", style: "margin-bottom:8px" }, [`${glass.volumeOz} fl oz capacity`]),
          el("ul", { class: "breakdown-list" }, [
            el("li", {}, [el("span", {}, ["Default ice (wt.)"]), el("span", {}, [`${glass.defaultIceOz} oz`])]),
            el("li", {}, [el("span", {}, ["Default straw"]), el("span", {}, [glass.defaultStraw ? "Yes" : "No"])]),
          ]),
          glass.notes ? el("p", { class: "muted", style: "margin-top:8px" }, [glass.notes]) : el("span", {}),
          el("div", { class: "row-actions", style: "margin-top:10px" }, [
            el("button", { class: "btn btn-sm", onclick: () => openGlassForm(glass.id) }, ["Edit"]),
            el("button", { class: "btn btn-sm danger", onclick: () => deleteGlass(glass.id) }, ["Delete"]),
          ]),
        ])
      );
    });
    panel.append(grid);
  }

  function openGlassForm(id) {
    const existing = id ? getGlass(id) : null;
    openModal(existing ? "Edit Glass" : "Add Glass", (body) => {
      const draft = existing ? { ...existing } : { name: "", volumeOz: "", defaultIceOz: "", defaultStraw: false, notes: "" };
      const form = el("form", {}, [
        field("Glass Name", el("input", { type: "text", required: "required", value: draft.name, oninput: (e) => (draft.name = e.target.value) })),
        fieldRow([
          field("Capacity (fl oz)", el("input", { type: "number", step: "any", min: "0", required: "required", value: draft.volumeOz, oninput: (e) => (draft.volumeOz = e.target.value) })),
          field("Default Ice (oz weight)", el("input", { type: "number", step: "any", min: "0", value: draft.defaultIceOz, oninput: (e) => (draft.defaultIceOz = e.target.value) })),
        ]),
        field(
          "",
          el("label", { class: "checkbox-field" }, [
            el("input", { type: "checkbox", checked: draft.defaultStraw ? "checked" : null, onchange: (e) => (draft.defaultStraw = e.target.checked) }),
            el("span", {}, ["Straw included by default"]),
          ])
        ),
        field("Notes", el("input", { type: "text", value: draft.notes || "", oninput: (e) => (draft.notes = e.target.value) })),
        el("div", { class: "form-actions" }, [
          el("button", { type: "button", class: "btn", onclick: closeModal }, ["Cancel"]),
          el("button", { type: "submit", class: "btn btn-primary" }, [existing ? "Save Changes" : "Add Glass"]),
        ]),
      ]);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        draft.volumeOz = Number(draft.volumeOz) || 0;
        draft.defaultIceOz = Number(draft.defaultIceOz) || 0;
        if (existing) Object.assign(existing, draft);
        else {
          draft.id = BevCalc.uid("glass");
          state.glassSizes.push(draft);
        }
        persist();
        renderGlassware();
        renderRecipes();
        closeModal();
        toast(existing ? "Glass updated." : "Glass added.");
      });
      body.append(form);
    });
  }

  function deleteGlass(id) {
    const usedIn = state.recipes.filter((r) => r.glassId === id);
    if (usedIn.length) {
      alert(`Can't delete — used in: ${usedIn.map((r) => r.name).join(", ")}.`);
      return;
    }
    if (!confirm("Delete this glass size?")) return;
    state.glassSizes = state.glassSizes.filter((g) => g.id !== id);
    persist();
    renderGlassware();
    toast("Glass deleted.");
  }

  // ================= RECIPES =================
  function renderRecipes() {
    const panel = $("#bev-panel-recipes");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Recipes"]),
          el("div", { class: "sub" }, ["Full pour cost per drink: spirits, mixers, ice, straws, and garnish."]),
        ]),
        el("button", { class: "btn btn-primary", onclick: () => openRecipeForm() }, ["+ Add Recipe"]),
      ])
    );

    if (!state.recipes.length) {
      panel.append(el("div", { class: "card empty-state" }, ["No recipes yet. Add your first one."]));
      return;
    }

    // Popularity ranking, by estimated servings/night — drives the "Best
    // Seller" / "Least Popular" badges on each card.
    const ranked = state.recipes.slice().sort((a, b) => (b.servingsPerNight || 0) - (a.servingsPerNight || 0));
    const rankById = new Map(ranked.map((r, i) => [r.id, i + 1]));
    const total = state.recipes.length;

    state.recipes.forEach((r) => panel.append(renderRecipeCard(r, rankById.get(r.id), total)));
  }

  function renderRecipeCard(recipe, rank, total) {
    const glass = getGlass(recipe.glassId);
    const cost = BevCalc.recipeCost(recipe, resolveComponent);
    const suggested = BevCalc.suggestedPrice(cost, recipe.targetPourCostPct);
    const actualPct = BevCalc.pourCostPct(cost, recipe.menuPrice);
    const profit = BevCalc.grossProfit(cost, recipe.menuPrice);

    let pillClass = "good";
    if (recipe.menuPrice) {
      if (actualPct > recipe.targetPourCostPct + 5) pillClass = "bad";
      else if (actualPct > recipe.targetPourCostPct) pillClass = "warn";
    }

    let popularityBadge = null;
    if (rank != null && total != null) {
      if (rank === 1) popularityBadge = el("span", { class: "pill good" }, ["🔥 Best Seller"]);
      else if (rank === total && total > 1) popularityBadge = el("span", { class: "pill warn" }, ["Least Popular"]);
      else popularityBadge = el("span", { class: "pill" }, [`#${rank} of ${total} by volume`]);
    }

    const card = el("div", { class: "card recipe-card" }, [
      el("div", { class: "recipe-card-head" }, [
        el("div", {}, [
          el("h3", {}, [recipe.name]),
          el("div", { class: "recipe-meta" }, [
            `${recipe.category || "Uncategorized"} · ${glass ? glass.name + " (" + glass.volumeOz + " oz)" : "No glass set"}`,
          ]),
          popularityBadge
            ? el("div", { style: "margin-top:6px; display:flex; align-items:center; gap:6px;" }, [
                popularityBadge,
                el("span", { class: "muted" }, [`${BevCalc.fmtNum(recipe.servingsPerNight || 0, 0)} / night (est.)`]),
              ])
            : el("span", {}),
        ]),
        el("div", { class: "row-actions" }, [
          el("button", { class: "btn btn-sm", onclick: () => openRecipeForm(recipe.id) }, ["Edit"]),
          el("button", { class: "btn btn-sm danger", onclick: () => deleteRecipe(recipe.id) }, ["Delete"]),
        ]),
      ]),
    ]);

    const bodyWrap = el("div", { class: "recipe-card-body two-col" });

    // Left: component breakdown
    const list = el("ul", { class: "breakdown-list" });
    recipe.components.forEach((c) => {
      const ing = resolveComponent(c.ingredientId);
      if (!ing) return;
      const lineCost = BevCalc.componentCost(ing, c.qty);
      list.append(
        el("li", {}, [
          el("span", {}, [`${ing.name} — ${BevCalc.fmtQty(c.qty)} ${BevCalc.unitLabel(ing, c.qty)}`]),
          el("span", {}, [BevCalc.fmtMoney(lineCost)]),
        ])
      );
    });
    if (!recipe.components.length) list.append(el("li", {}, [el("span", { class: "muted" }, ["No components added yet."])]));
    const left = el("div", {}, [el("div", { class: "section-title" }, ["Component Cost Breakdown"]), list]);

    // Right: cost summary
    const right = el("div", {}, [
      el("div", { class: "section-title" }, ["Pour Cost Summary"]),
      el("div", { class: "grid grid-2", style: "gap:10px" }, [
        statMini("Total Pour Cost", BevCalc.fmtMoney(cost)),
        statMini(`Suggested Price (@${recipe.targetPourCostPct}%)`, BevCalc.fmtMoney(suggested)),
        statMini("Menu Price", recipe.menuPrice ? BevCalc.fmtMoney(recipe.menuPrice) : "—"),
        statMini("Gross Profit / Drink", recipe.menuPrice ? BevCalc.fmtMoney(profit) : "—"),
      ]),
      recipe.menuPrice
        ? el("div", { class: "callout " + pillClass, style: "margin-top:12px" }, [
            `Actual pour cost: ${BevCalc.fmtPct(actualPct)} (target ${recipe.targetPourCostPct}%)`,
          ])
        : el("div", { class: "callout warn", style: "margin-top:12px" }, ["Set a menu price to see actual pour cost %."]),
    ]);

    bodyWrap.append(left, right);
    card.append(bodyWrap);
    return card;
  }

  function statMini(label, value) {
    return el("div", { class: "stat-card" }, [
      el("div", { class: "label" }, [label]),
      el("div", { class: "value small" }, [value]),
    ]);
  }

  function openRecipeForm(id) {
    const existing = id ? getRecipe(id) : null;
    openModal(existing ? "Edit Recipe" : "Add Recipe", (body) => {
      const draft = existing
        ? JSON.parse(JSON.stringify(existing))
        : {
            name: "",
            category: "",
            glassId: state.glassSizes[0] ? state.glassSizes[0].id : "",
            menuPrice: "",
            targetPourCostPct: state.settings.defaultTargetPourCostPct || 20,
            servingsPerNight: "",
            eventGuestCount: "",
            eventDrinksPerGuest: "",
            eventMixPct: "",
            components: [],
          };

      function applyGlassDefaults() {
        const glass = getGlass(draft.glassId);
        if (!glass) return;
        const hasIce = draft.components.some((c) => getIngredient(c.ingredientId)?.category === "Ice");
        const hasStraw = draft.components.some((c) => getIngredient(c.ingredientId)?.category === "Straw");
        if (!hasIce && glass.defaultIceOz > 0 && state.settings.defaultIceIngredientId) {
          draft.components.push({ id: BevCalc.uid("comp"), ingredientId: state.settings.defaultIceIngredientId, qty: glass.defaultIceOz, label: "Ice" });
        }
        if (!hasStraw && glass.defaultStraw && state.settings.defaultStrawIngredientId) {
          draft.components.push({ id: BevCalc.uid("comp"), ingredientId: state.settings.defaultStrawIngredientId, qty: 1, label: "Straw" });
        }
      }

      function render() {
        body.innerHTML = "";
        const cost = BevCalc.recipeCost(draft, resolveComponent);

        const form = el("form", {});
        form.append(
          field("Recipe Name", el("input", { type: "text", required: "required", value: draft.name, oninput: (e) => (draft.name = e.target.value) })),
          fieldRow([
            field("Category (optional)", el("input", { type: "text", value: draft.category || "", oninput: (e) => (draft.category = e.target.value) })),
            field(
              "Glass Size",
              selectEl(
                state.glassSizes.map((g) => ({ id: g.id, label: `${g.name} (${g.volumeOz} oz)` })),
                draft.glassId,
                (v) => (draft.glassId = v),
                true
              )
            ),
          ]),
          !existing
            ? el(
                "button",
                {
                  type: "button",
                  class: "btn btn-sm",
                  style: "margin-bottom:10px",
                  onclick: () => { applyGlassDefaults(); render(); },
                },
                ["Auto-add default ice / straw for this glass"]
              )
            : el("span", {})
        );

        const compSection = el("div", {}, [el("div", { class: "section-title" }, ["Components (spirits, mixers, dry goods, ice, straws, garnish, house-made preps)"])]);
        if (!draft.components.length) {
          compSection.append(el("p", { class: "muted" }, ["No components yet — add one below."]));
        }
        draft.components.forEach((comp, idx) => {
          const ing = resolveComponent(comp.ingredientId);
          const row = el("div", { class: "component-row" }, [
            field(
              idx === 0 ? "Ingredient" : "",
              componentSourceSelect(comp.ingredientId, (v) => { comp.ingredientId = v; render(); })
            ),
            field(
              `Qty (${ing ? BevCalc.unitLabel(ing, comp.qty) : "unit"})`,
              el("input", { type: "number", step: "any", min: "0", value: comp.qty, oninput: (e) => (comp.qty = e.target.value) })
            ),
            field(idx === 0 ? "Line Cost" : "", el("input", { type: "text", disabled: "disabled", value: BevCalc.fmtMoney(BevCalc.componentCost(ing, comp.qty)) })),
            el("button", { type: "button", class: "btn btn-sm danger btn-icon", title: "Remove", onclick: () => { draft.components.splice(idx, 1); render(); } }, ["✕"]),
          ]);
          compSection.append(row);
        });
        compSection.append(
          el(
            "button",
            {
              type: "button",
              class: "btn btn-sm",
              style: "margin-top:8px",
              onclick: () => {
                draft.components.push({ id: BevCalc.uid("comp"), ingredientId: state.ingredients[0] ? state.ingredients[0].id : "", qty: 0 });
                render();
              },
            },
            ["+ Add Component"]
          )
        );
        form.append(compSection);

        form.append(
          el("div", { class: "section-title" }, ["Pricing"]),
          fieldRow([
            field("Menu Price ($)", el("input", { type: "number", step: "any", min: "0", value: draft.menuPrice, oninput: (e) => (draft.menuPrice = e.target.value) })),
            field("Target Pour Cost %", el("input", { type: "number", step: "any", min: "0", max: "100", value: draft.targetPourCostPct, oninput: (e) => { draft.targetPourCostPct = e.target.value; renderCostLine(); } })),
          ]),
          el("p", { class: "hint", id: "bev-recipe-cost-line" }, [costLineText()]),

          el("div", { class: "section-title" }, ["Usage Guesstimates"]),
          field("Estimated servings / night", el("input", { type: "number", step: "any", min: "0", value: draft.servingsPerNight, oninput: (e) => (draft.servingsPerNight = e.target.value) })),
          fieldRow([
            field("Event guest count", el("input", { type: "number", step: "any", min: "0", value: draft.eventGuestCount, oninput: (e) => (draft.eventGuestCount = e.target.value) })),
            field("Avg drinks / guest", el("input", { type: "number", step: "any", min: "0", value: draft.eventDrinksPerGuest, oninput: (e) => (draft.eventDrinksPerGuest = e.target.value) })),
            field("% choosing this drink", el("input", { type: "number", step: "any", min: "0", max: "100", value: draft.eventMixPct, oninput: (e) => (draft.eventMixPct = e.target.value) })),
          ]),

          el("div", { class: "form-actions" }, [
            el("button", { type: "button", class: "btn", onclick: closeModal }, ["Cancel"]),
            el("button", { type: "submit", class: "btn btn-primary" }, [existing ? "Save Changes" : "Add Recipe"]),
          ])
        );

        function costLineText() {
          const c = BevCalc.recipeCost(draft, resolveComponent);
          const sp = BevCalc.suggestedPrice(c, draft.targetPourCostPct);
          return `Total pour cost: ${BevCalc.fmtMoney(c)} — suggested price at ${draft.targetPourCostPct || 0}% pour cost: ${BevCalc.fmtMoney(sp)}`;
        }
        function renderCostLine() {
          const line = document.getElementById("bev-recipe-cost-line");
          if (line) line.textContent = costLineText();
        }

        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          draft.menuPrice = draft.menuPrice === "" ? "" : Number(draft.menuPrice);
          draft.targetPourCostPct = Number(draft.targetPourCostPct) || 0;
          draft.servingsPerNight = Number(draft.servingsPerNight) || 0;
          draft.eventGuestCount = Number(draft.eventGuestCount) || 0;
          draft.eventDrinksPerGuest = Number(draft.eventDrinksPerGuest) || 0;
          draft.eventMixPct = Number(draft.eventMixPct) || 0;
          draft.components = draft.components
            .filter((c) => c.ingredientId)
            .map((c) => ({ ...c, qty: Number(c.qty) || 0 }));

          if (existing) {
            Object.assign(existing, draft);
          } else {
            draft.id = BevCalc.uid("rec");
            state.recipes.push(draft);
          }
          persist();
          renderAll();
          closeModal();
          toast(existing ? "Recipe updated." : "Recipe added.");
        });

        body.append(form);
      }
      render();
    });
  }

  function deleteRecipe(id) {
    if (!confirm("Delete this recipe?")) return;
    state.recipes = state.recipes.filter((r) => r.id !== id);
    persist();
    renderAll();
    toast("Recipe deleted.");
  }

  // ================= DASHBOARD =================
  function renderDashboard() {
    const panel = $("#bev-panel-dashboard");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [el("h2", {}, ["Beverage Overview"]), el("div", { class: "sub" }, ["Program-wide pour cost health, at a glance."])]),
      ])
    );

    const recipeStats = state.recipes.map((r) => {
      const cost = BevCalc.recipeCost(r, resolveComponent);
      return { r, cost, pct: r.menuPrice ? BevCalc.pourCostPct(cost, r.menuPrice) : null };
    });
    const priced = recipeStats.filter((s) => s.pct !== null);
    const avgPct = priced.length ? priced.reduce((s, x) => s + x.pct, 0) / priced.length : 0;

    const nights = state.settings.operatingNightsPerWeek || 6;
    let nightlyRevenue = 0, weeklyCost = 0, weeklyRevenue = 0;
    recipeStats.forEach((s) => {
      nightlyRevenue += (Number(s.r.menuPrice) || 0) * (s.r.servingsPerNight || 0);
      const weeklyServings = (s.r.servingsPerNight || 0) * nights;
      const proj = BevCalc.periodProjection(s.cost, s.r.menuPrice, weeklyServings);
      weeklyCost += proj.weekly.cost;
      weeklyRevenue += proj.weekly.revenue;
    });

    panel.append(
      el("div", { class: "grid grid-4" }, [
        statCard("Nightly Sales (est.)", BevCalc.fmtMoney(nightlyRevenue)),
        statCard("Avg. Pour Cost %", priced.length ? BevCalc.fmtPct(avgPct) : "—"),
        statCard("Weekly Profit (est.)", BevCalc.fmtMoney(weeklyRevenue - weeklyCost)),
        statCard("Recipes / Ingredients", `${state.recipes.length} / ${state.ingredients.length}`),
      ])
    );

    const card = el("div", { class: "card" }, [el("h3", {}, ["Recipe Pour Cost Overview"])]);
    if (!recipeStats.length) {
      card.append(el("div", { class: "empty-state" }, ["Add recipes to see pour cost analysis here."]));
    } else {
      const table = el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Recipe"]),
            el("th", { class: "num" }, ["Cost"]),
            el("th", { class: "num" }, ["Menu Price"]),
            el("th", { class: "num" }, ["Pour Cost %"]),
            el("th", {}, ["Status"]),
          ]),
        ]),
      ]);
      const tbody = el("tbody");
      recipeStats
        .slice()
        .sort((a, b) => (b.pct || 0) - (a.pct || 0))
        .forEach((s) => {
          let status = el("span", { class: "pill" }, ["No price set"]);
          if (s.pct !== null) {
            if (s.pct > s.r.targetPourCostPct + 5) status = el("span", { class: "pill bad" }, ["Over target"]);
            else if (s.pct > s.r.targetPourCostPct) status = el("span", { class: "pill warn" }, ["Slightly over"]);
            else status = el("span", { class: "pill good" }, ["On target"]);
          }
          tbody.append(
            el("tr", {}, [
              el("td", {}, [s.r.name]),
              el("td", { class: "num" }, [BevCalc.fmtMoney(s.cost)]),
              el("td", { class: "num" }, [s.r.menuPrice ? BevCalc.fmtMoney(s.r.menuPrice) : "—"]),
              el("td", { class: "num" }, [s.pct !== null ? BevCalc.fmtPct(s.pct) : "—"]),
              el("td", {}, [status]),
            ])
          );
        });
      table.append(tbody);
      card.append(el("div", { class: "table-wrap" }, [table]));
    }
    panel.append(card);
  }

  function statCard(label, value) {
    return el("div", { class: "stat-card" }, [el("div", { class: "label" }, [label]), el("div", { class: "value" }, [String(value)])]);
  }

  // ================= INVENTORY =================
  // Same idea as the kitchen's count sheet, in a bar's units: bottles, liters,
  // pounds of ice, each for garnish. Everything is stored in base units, so
  // changing what you count in never changes what you have.
  function renderInventory() {
    const panel = $("#bev-panel-inventory");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Inventory"]),
          el("div", { class: "sub" }, ["Count the well, the back bar and the walk-in, set par levels, and see how many of each drink the bar can still pour."]),
        ]),
        el("button", { class: "btn", onclick: fillAllToPar }, ["Fill All To Par"]),
      ])
    );

    const countable = state.ingredients.concat(state.preps);
    const belowPar = countable.filter(BevCalc.belowPar);
    const totalValue = countable.reduce((s, i) => s + itemValue(i), 0);
    // What it costs to get back to par: whole purchase packs for bought items,
    // whole batches for anything the bar makes itself.
    const reorderCost = belowPar.reduce((s, item) => {
      const short = (Number(item.parQty) || 0) - (Number(item.onHandQty) || 0);
      if (item.yieldQty != null) {
        const batches = item.yieldQty > 0 ? Math.ceil(short / item.yieldQty) : 0;
        return s + batches * BevCalc.prepBatchCost(item, getIngredient);
      }
      const pack = BevCalc.packBaseQty(item);
      const packs = pack > 0 ? Math.ceil(short / pack) : 0;
      return s + packs * (Number(item.purchaseCost) || 0);
    }, 0);

    panel.append(
      el("div", { class: "grid grid-4" }, [
        statCard("Inventory Value", BevCalc.fmtMoney(totalValue)),
        statCard("Items Tracked", countable.length),
        statCard("Below Par", belowPar.length),
        statCard("Est. Reorder Cost", BevCalc.fmtMoney(reorderCost)),
      ])
    );

    // What the bar can actually pour right now.
    const availCard = el("div", { class: "card" }, [
      el("h3", {}, ["Drinks Available Now"]),
      el("div", { class: "sub", style: "margin-bottom:10px" }, [
        "The most of each drink the current count could pour, and what runs out first. House-made preps are broken down into the raw ingredients they're batched from — a syrup you can still make shouldn't read as 86'd.",
      ]),
    ]);
    if (!state.recipes.length) {
      availCard.append(el("div", { class: "empty-state" }, ["Add recipes to see what the bar can cover."]));
    } else {
      const table = el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Drink"]),
            el("th", { class: "num" }, ["Servings Available"]),
            el("th", {}, ["Limited By"]),
            el("th", { class: "num" }, ["Nights of Cover"]),
            el("th", {}, ["Status"]),
          ]),
        ]),
      ]);
      const tbody = el("tbody");
      state.recipes
        .map((r) => ({ r, avail: BevCalc.maxServings(r, getIngredient, getPrep) }))
        .sort((a, b) => a.avail.servings - b.avail.servings)
        .forEach(({ r, avail }) => {
          const cover = BevCalc.nightsOfCover(avail.servings, r.servingsPerNight);
          // "Low" is either a small absolute number or less than tonight's
          // run rate — a drink that sells 30 a night is short at 16.
          const low = avail.servings < 10 || (cover != null && cover < 1);
          tbody.append(
            el("tr", { class: avail.servings <= 0 ? "row-bad" : low ? "row-warn" : "" }, [
              el("td", {}, [el("strong", {}, [r.name])]),
              el("td", { class: "num" }, [String(avail.servings)]),
              el("td", { class: "muted" }, [avail.limitedBy ? avail.limitedBy.name : "—"]),
              el("td", { class: "num" }, [cover == null ? "—" : BevCalc.fmtNum(cover, 1)]),
              el("td", {}, [
                el("span", { class: "pill " + (avail.servings <= 0 ? "bad" : low ? "warn" : "good") }, [
                  avail.servings <= 0 ? "86'd" : low ? "Running low" : "Covered",
                ]),
              ]),
            ])
          );
        });
      table.append(tbody);
      availCard.append(el("div", { class: "table-wrap" }, [table]));
    }

    // The count sheets go first: they're the thing you're here to change, and a
    // count is easier to take at the top of the page than below a long read-out.
    const countCard = el("div", { class: "card" }, [
      el("h3", {}, ["Count Sheet"]),
      el("div", { class: "sub", style: "margin-bottom:10px" }, ["Count in whatever unit you count in — bottles, liters, pounds, each. Everything else converts automatically."]),
    ]);
    if (!state.ingredients.length) {
      countCard.append(el("div", { class: "empty-state" }, ["Add ingredients to start counting."]));
      panel.append(countCard, availCard);
      return;
    }
    countCard.append(el("div", { class: "table-wrap" }, [countTable(sortedIngredients(), false)]));
    panel.append(countCard);

    if (state.preps.length) {
      const prepCard = el("div", { class: "card" }, [
        el("h3", {}, ["House-Made Preps On Hand"]),
        el("div", { class: "sub", style: "margin-bottom:10px" }, ["Batched syrups, concentrates and infusions, counted in the unit each one yields. Value is what the raw ingredients in that batch cost."]),
      ]);
      prepCard.append(el("div", { class: "table-wrap" }, [countTable(state.preps.slice().sort((a, b) => a.name.localeCompare(b.name)), true)]));
      panel.append(prepCard);
    }

    panel.append(availCard);
  }

  function sortedIngredients() {
    return state.ingredients
      .slice()
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  // One count table, used for bought ingredients and for house-made preps.
  // A prep has no purchase pack, so it's counted and valued in its own yield
  // unit instead of a case or a bottle.
  function countTable(items, isPrep) {
    const table = el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, [isPrep ? "Prep" : "Ingredient"]),
          el("th", {}, ["Category"]),
          el("th", { class: "num" }, ["On Hand"]),
          el("th", { class: "num" }, ["Par"]),
          el("th", {}, ["Unit"]),
          el("th", { class: "num" }, ["Value"]),
          el("th", {}, ["Status"]),
          el("th", {}, [""]),
        ]),
      ]),
    ]);
    const tbody = el("tbody");
    items.forEach((item) => {
      const unit = isPrep ? item.baseUnit : countUnit(item);
      const low = BevCalc.belowPar(item);
      const out = (Number(item.onHandQty) || 0) <= 0;

      tbody.append(
        el("tr", { class: out ? "row-bad" : low ? "row-warn" : "" }, [
          el("td", {}, [el("strong", {}, [item.name])]),
          el("td", {}, [el("span", { class: "pill" }, [item.category])]),
          el("td", { class: "num" }, [
            el("input", {
              class: "inline-input num", type: "number", step: "any", min: "0",
              value: BevCalc.fmtQty(BevCalc.fromBaseQty(item.baseUnit, unit, item.onHandQty), 3),
              oninput: (e) => { item.onHandQty = BevCalc.toBaseQty(item.baseUnit, unit, e.target.value); persist(); },
              onchange: () => { renderInventory(); renderDashboard(); },
            }),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              class: "inline-input num", type: "number", step: "any", min: "0",
              value: BevCalc.fmtQty(BevCalc.fromBaseQty(item.baseUnit, unit, item.parQty), 3),
              oninput: (e) => { item.parQty = BevCalc.toBaseQty(item.baseUnit, unit, e.target.value); persist(); },
              onchange: () => renderInventory(),
            }),
          ]),
          el("td", {}, [
            isPrep
              ? el("span", { class: "muted" }, [BevCalc.unitLabel(item, 2)])
              : selectEl(
                  BevCalc.purchaseUnitsFor(item.baseUnit).map((u) => ({ id: u.id, label: u.id === "each" ? BevCalc.unitLabel(item, 2) || u.label : u.label })),
                  unit,
                  (v) => { item.countUnit = v; persist(); renderInventory(); }
                ),
          ]),
          el("td", { class: "num" }, [BevCalc.fmtMoney(itemValue(item))]),
          el("td", {}, [
            out
              ? el("span", { class: "pill bad" }, ["Out"])
              : low
              ? el("span", { class: "pill warn" }, [isPrep ? "Batch more" : "Reorder"])
              : el("span", { class: "pill good" }, ["OK"]),
          ]),
          el("td", {}, [
            el("div", { class: "row-actions" }, [
              el("button", { class: "btn btn-sm", title: "Set on hand up to par", onclick: () => fillToPar(item) }, ["To Par"]),
            ]),
          ]),
        ])
      );
    });
    table.append(tbody);
    return table;
  }

  function fillToPar(item) {
    if ((Number(item.parQty) || 0) <= 0) {
      toast("Set a par level for this item first.");
      return;
    }
    if ((Number(item.onHandQty) || 0) < item.parQty) item.onHandQty = item.parQty;
    persist();
    renderInventory();
    renderDashboard();
    toast(`${item.name} topped up to par.`);
  }

  function fillAllToPar() {
    const low = state.ingredients.concat(state.preps).filter(BevCalc.belowPar);
    if (!low.length) {
      toast("Nothing is below par.");
      return;
    }
    if (!confirm(`Top ${low.length} item${low.length === 1 ? "" : "s"} up to par? Use this after a delivery is put away.`)) return;
    low.forEach((i) => (i.onHandQty = i.parQty));
    persist();
    renderInventory();
    renderDashboard();
    toast(`${low.length} item${low.length === 1 ? "" : "s"} topped up to par.`);
  }

  // ================= USAGE (nightly/weekly/monthly/annual program usage) =================
  function renderUsage() {
    const panel = $("#bev-panel-usage");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Usage"]),
          el("div", { class: "sub" }, ["Guesstimate servings per night per recipe and see the nightly/weekly/monthly/annual cost and revenue impact."]),
        ]),
        el("div", { style: "min-width:200px" }, [
          numberFieldInline("Operating nights / week", state.settings.operatingNightsPerWeek, (v) => {
            state.settings.operatingNightsPerWeek = Number(v) || 6;
            persist();
            renderUsage();
            renderDashboard();
          }),
        ]),
      ])
    );

    if (!state.recipes.length) {
      panel.append(el("div", { class: "card empty-state" }, ["Add recipes first to project usage."]));
      return;
    }

    const nights = state.settings.operatingNightsPerWeek || 6;
    let totalNightlyRevenue = 0, totalWeeklyCost = 0, totalWeeklyRevenue = 0;
    const rows = state.recipes.map((r) => {
      const cost = BevCalc.recipeCost(r, resolveComponent);
      const servingsPerNight = r.servingsPerNight || 0;
      const nightly = {
        servings: servingsPerNight,
        cost: cost * servingsPerNight,
        revenue: (Number(r.menuPrice) || 0) * servingsPerNight,
        profit: (Number(r.menuPrice) || 0) * servingsPerNight - cost * servingsPerNight,
      };
      const weekly = BevCalc.periodProjection(cost, r.menuPrice, servingsPerNight * nights);
      totalNightlyRevenue += nightly.revenue;
      totalWeeklyCost += weekly.weekly.cost;
      totalWeeklyRevenue += weekly.weekly.revenue;
      return { r, cost, nightly, weekly };
    });

    panel.append(
      el("div", { class: "grid grid-4" }, [
        statCard("Nightly Sales (est.)", BevCalc.fmtMoney(totalNightlyRevenue)),
        statCard("Weekly COGS (est.)", BevCalc.fmtMoney(totalWeeklyCost)),
        statCard("Weekly Revenue (est.)", BevCalc.fmtMoney(totalWeeklyRevenue)),
        statCard("Weekly Profit (est.)", BevCalc.fmtMoney(totalWeeklyRevenue - totalWeeklyCost)),
      ])
    );

    rows.forEach(({ r, cost, nightly, weekly }) => {
      const card = el("div", { class: "card" });
      card.append(
        el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px" }, [
          el("h3", {}, [r.name]),
          el("span", { class: "muted" }, [`Pour cost: ${BevCalc.fmtMoney(cost)} / drink`]),
        ])
      );

      card.append(numberFieldInline("Servings / night", r.servingsPerNight, (v) => { r.servingsPerNight = Number(v) || 0; persist(); renderUsage(); renderDashboard(); }));

      const table = el("table", { style: "margin-top:12px" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Period"]),
            el("th", { class: "num" }, ["Servings"]),
            el("th", { class: "num" }, ["Cost"]),
            el("th", { class: "num" }, ["Revenue"]),
            el("th", { class: "num" }, ["Profit"]),
          ]),
        ]),
      ]);
      const tbody = el("tbody", {}, [
        projRow("Nightly", nightly),
        projRow("Weekly", weekly.weekly),
        projRow("Monthly", weekly.monthly),
        projRow("Annual", weekly.annual),
      ]);
      table.append(tbody);
      card.append(el("div", { class: "table-wrap" }, [table]));
      panel.append(card);
    });
  }

  // ================= EVENTS (one-off event prep planning) =================
  function renderEvents() {
    const panel = $("#bev-panel-events");
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "panel-head" }, [
        el("div", {}, [
          el("h2", {}, ["Events"]),
          el("div", { class: "sub" }, ["Set a guest count, average drinks per guest, and % choosing each drink below, then see exactly what to prep and buy for the whole event — liquor, mixers, syrup batches, garnish. Revenue and profit are tracked too, just secondary here."]),
        ]),
      ])
    );

    if (!state.recipes.length) {
      panel.append(el("div", { class: "card empty-state" }, ["Add recipes first to project event usage."]));
      return;
    }

    let totalEventCost = 0, totalEventRevenue = 0, totalEventServings = 0;
    const rows = state.recipes.map((r) => {
      const cost = BevCalc.recipeCost(r, resolveComponent);
      const evServings = BevCalc.eventServings(r.eventGuestCount, r.eventDrinksPerGuest, r.eventMixPct);
      const event = BevCalc.eventProjection(cost, r.menuPrice, evServings);
      totalEventCost += event.cost;
      totalEventRevenue += event.revenue;
      totalEventServings += event.servings;
      return { r, cost, event };
    });

    panel.append(
      el("div", { class: "grid grid-4" }, [
        statCard("Total Drinks Needed (est.)", BevCalc.fmtNum(totalEventServings, 0)),
        statCard("Event Cost (all recipes)", BevCalc.fmtMoney(totalEventCost)),
        statCard("Event Revenue (all recipes)", BevCalc.fmtMoney(totalEventRevenue)),
        statCard("Event Profit (all recipes)", BevCalc.fmtMoney(totalEventRevenue - totalEventCost)),
      ])
    );

    panel.append(renderEventPrepList());

    const perRecipeHeading = el("div", { class: "section-title", style: "margin: 4px 2px 4px" }, ["Per-Recipe Event Assumptions"]);
    panel.append(perRecipeHeading);

    rows.forEach(({ r, cost, event }) => {
      const card = el("div", { class: "card" });
      card.append(
        el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px" }, [
          el("h3", {}, [r.name]),
          el("span", { class: "muted" }, [`Pour cost: ${BevCalc.fmtMoney(cost)} / drink`]),
        ])
      );

      card.append(
        el("div", { class: "grid grid-3" }, [
          numberFieldInline("Event guests", r.eventGuestCount, (v) => { r.eventGuestCount = Number(v) || 0; persist(); renderEvents(); }),
          numberFieldInline("Avg drinks / guest", r.eventDrinksPerGuest, (v) => { r.eventDrinksPerGuest = Number(v) || 0; persist(); renderEvents(); }),
          numberFieldInline("% choosing this drink", r.eventMixPct, (v) => { r.eventMixPct = Number(v) || 0; persist(); renderEvents(); }),
        ])
      );

      card.append(
        el("div", { class: "muted", style: "margin-top:10px" }, [
          `${BevCalc.fmtNum(event.servings, 0)} drinks est. · cost ${BevCalc.fmtMoney(event.cost)} · revenue ${BevCalc.fmtMoney(event.revenue)} · profit ${BevCalc.fmtMoney(event.profit)}`,
        ])
      );
      panel.append(card);
    });
  }

  // Combined shopping/prep list across every recipe's event guesstimate: how
  // much of each raw ingredient to buy (rounded up to whole purchase units)
  // and how many batches of each house-made prep to make ahead of time.
  function computeEventPrepList() {
    const items = new Map();
    state.recipes.forEach((r) => {
      const servings = BevCalc.eventServings(r.eventGuestCount, r.eventDrinksPerGuest, r.eventMixPct);
      if (!servings) return;
      (r.components || []).forEach((c) => {
        const source = resolveComponent(c.ingredientId);
        if (!source) return;
        const qtyNeeded = (Number(c.qty) || 0) * servings;
        if (!items.has(c.ingredientId)) {
          items.set(c.ingredientId, { id: c.ingredientId, name: source.name, category: source.category || "Other", isPrep: !!source.isPrep, totalQty: 0 });
        }
        items.get(c.ingredientId).totalQty += qtyNeeded;
      });
    });
    return Array.from(items.values()).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  function renderEventPrepList() {
    const items = computeEventPrepList();
    const card = el("div", { class: "card" }, [
      el("h3", {}, ["🧊 What To Prep & Buy"]),
      el("p", { class: "sub", style: "margin-top:-6px" }, ["Combined across every recipe below, based on its event guesstimate — everything you need to have on hand for the whole event."]),
    ]);

    if (!items.length) {
      card.append(el("div", { class: "empty-state" }, ["Set event guests / drinks-per-guest / mix % on the recipes below to build the prep list."]));
      return card;
    }

    const table = el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["Item"]),
          el("th", {}, ["Category"]),
          el("th", { class: "num" }, ["Total Needed"]),
          el("th", {}, ["Buy / Prep"]),
        ]),
      ]),
    ]);
    const tbody = el("tbody");

    items.forEach((item) => {
      let needText = "—";
      let actionText = "—";

      if (item.isPrep) {
        const prep = getPrep(item.id);
        if (prep) {
          const yieldQty = Number(prep.yieldQty) || 0;
          needText = `${BevCalc.fmtQty(item.totalQty)} ${BevCalc.unitLabel(prep, item.totalQty)}`;
          const batches = yieldQty ? Math.ceil(item.totalQty / yieldQty) : 0;
          actionText = `Prep ${batches} batch${batches === 1 ? "" : "es"} (yields ${BevCalc.fmtQty(yieldQty)} ${BevCalc.unitLabel(prep, yieldQty)} each)`;
        }
      } else {
        const ing = getIngredient(item.id);
        if (ing) {
          needText = `${BevCalc.fmtQty(item.totalQty)} ${BevCalc.unitLabel(ing, item.totalQty)}`;
          const perPurchase = BevCalc.toBaseQty(ing.baseUnit, ing.purchaseUnit, ing.purchaseQty);
          const purchaseUnit = BevCalc.purchaseUnitsFor(ing.baseUnit).find((u) => u.id === ing.purchaseUnit);
          const purchaseLabel = purchaseUnit && purchaseUnit.id === "each" ? BevCalc.unitLabel(ing, ing.purchaseQty) : purchaseUnit ? purchaseUnit.label : "";
          const count = perPurchase ? Math.ceil(item.totalQty / perPurchase) : 0;
          actionText = perPurchase ? `Buy ${count} × ${BevCalc.fmtQty(ing.purchaseQty)} ${purchaseLabel}` : "—";
        }
      }

      tbody.append(
        el("tr", {}, [
          el("td", {}, [item.name, item.isPrep ? el("span", { class: "pill good", style: "margin-left:6px" }, ["PREP"]) : el("span", {})]),
          el("td", {}, [el("span", { class: "pill" }, [item.category])]),
          el("td", { class: "num" }, [needText]),
          el("td", {}, [actionText]),
        ])
      );
    });

    table.append(tbody);
    card.append(el("div", { class: "table-wrap" }, [table]));
    return card;
  }

  function projRow(label, data) {
    return el("tr", {}, [
      el("td", {}, [label]),
      el("td", { class: "num" }, [BevCalc.fmtNum(data.servings, 0)]),
      el("td", { class: "num" }, [BevCalc.fmtMoney(data.cost)]),
      el("td", { class: "num" }, [BevCalc.fmtMoney(data.revenue)]),
      el("td", { class: "num" }, [BevCalc.fmtMoney(data.profit)]),
    ]);
  }

  function numberFieldInline(label, value, onChange) {
    return field(label, el("input", { type: "number", step: "any", min: "0", value: value, oninput: (e) => onChange(e.target.value) }));
  }

  // ---------- form field helpers ----------
  function field(label, inputEl) {
    const wrap = el("div", { class: "field" });
    if (label) wrap.append(el("label", {}, [label]));
    wrap.append(inputEl);
    return wrap;
  }
  function fieldRow(fields) { return el("div", { class: "field-row" }, fields); }
  function selectEl(options, value, onChange, required) {
    const sel = el("select", required ? { required: "required" } : {});
    options.forEach((o) => {
      const optVal = typeof o === "string" ? o : o.id;
      const optLabel = typeof o === "string" ? o : o.label;
      const opt = el("option", { value: optVal }, [optLabel]);
      if (optVal === value) opt.setAttribute("selected", "selected");
      sel.append(opt);
    });
    sel.addEventListener("change", (e) => onChange(e.target.value));
    return sel;
  }

  // Recipe-component picker: raw ingredients and house-made preps, grouped.
  function componentSourceSelect(value, onChange) {
    const sel = el("select", {});
    const ingGroup = el("optgroup", { label: "Ingredients" });
    state.ingredients.forEach((i) => {
      const opt = el("option", { value: i.id }, [`${i.name} (${i.category})`]);
      if (i.id === value) opt.setAttribute("selected", "selected");
      ingGroup.append(opt);
    });
    sel.append(ingGroup);
    if (state.preps.length) {
      const prepGroup = el("optgroup", { label: "House-Made Preps" });
      state.preps.forEach((p) => {
        const opt = el("option", { value: p.id }, [`${p.name} (${p.category})`]);
        if (p.id === value) opt.setAttribute("selected", "selected");
        prepGroup.append(opt);
      });
      sel.append(prepGroup);
    }
    sel.addEventListener("change", (e) => onChange(e.target.value));
    return sel;
  }

  // ---------- init ----------
  function renderAll() {
    renderDashboard();
    renderIngredients();
    renderPreps();
    renderGlassware();
    renderRecipes();
    renderInventory();
    renderUsage();
    renderEvents();
  }

  function init() {
    $all(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $("#bev-btn-reset").addEventListener("click", resetData);
    renderAll();
  }

  // What the house dashboard needs from the beverage program, without reaching
  // into this tool's state directly.
  function summary() {
    const countable = state.ingredients.concat(state.preps);
    const belowPar = countable.filter(BevCalc.belowPar);
    const priced = state.recipes.filter((r) => Number(r.menuPrice) > 0);
    const avgPct = priced.length
      ? priced.reduce((s, r) => s + BevCalc.pourCostPct(BevCalc.recipeCost(r, resolveComponent), r.menuPrice), 0) / priced.length
      : 0;
    const dry = state.recipes
      .filter((r) => BevCalc.maxServings(r, getIngredient, getPrep).servings <= 0)
      .map((r) => r.name);
    return {
      drinks: state.recipes.length,
      ingredients: state.ingredients.length,
      avgPourCostPct: avgPct,
      inventoryValue: countable.reduce((s, i) => s + itemValue(i), 0),
      belowPar: belowPar.map((i) => i.name),
      eightySixed: dry,
      nightlySales: state.recipes.reduce((s, r) => s + (Number(r.menuPrice) || 0) * (r.servingsPerNight || 0), 0),
    };
  }

  // A plain-data view of the whole beverage program, for the Ask tab. Same idea
  // as the food tool's: every number is already converted and costed, so a
  // reader never has to redo the math to answer a question.
  function snapshot() {
    return {
      ingredients: sortedIngredients().map((ing) => ({
        name: ing.name,
        category: ing.category,
        purchase: `${BevCalc.fmtQty(ing.purchaseQty)} ${BevCalc.purchaseUnit(ing.baseUnit, ing.purchaseUnit).label} for ${BevCalc.fmtMoney(ing.purchaseCost)}`,
        costPerUnit: round4(BevCalc.costPerBaseUnit(ing)),
        unit: BevCalc.unitLabel(ing, 1),
        onHand: BevCalc.fmtBaseQty(ing, ing.onHandQty),
        par: BevCalc.fmtBaseQty(ing, ing.parQty),
        belowPar: BevCalc.belowPar(ing),
        onHandValue: round2(itemValue(ing)),
      })),
      preps: state.preps.map((p) => ({
        name: p.name,
        category: p.category,
        batchYield: `${BevCalc.fmtQty(p.yieldQty)} ${BevCalc.BASE_UNITS[p.baseUnit].label}`,
        batchCost: round2(BevCalc.prepBatchCost(p, getIngredient)),
        onHand: `${BevCalc.fmtQty(p.onHandQty)} ${BevCalc.BASE_UNITS[p.baseUnit].label}`,
        par: `${BevCalc.fmtQty(p.parQty)} ${BevCalc.BASE_UNITS[p.baseUnit].label}`,
        belowPar: BevCalc.belowPar(p),
        builtFrom: (p.components || [])
          .map((c) => {
            const ing = getIngredient(c.ingredientId);
            return ing ? `${ing.name} ${BevCalc.fmtQty(c.qty)} ${BevCalc.unitLabel(ing, c.qty)}` : null;
          })
          .filter(Boolean),
      })),
      drinks: state.recipes.map((r) => {
        const cost = BevCalc.recipeCost(r, resolveComponent);
        const avail = BevCalc.maxServings(r, getIngredient, getPrep);
        const glass = getGlass(r.glassId);
        return {
          name: r.name,
          category: r.category,
          glass: glass ? glass.name : null,
          pourCost: round2(cost),
          menuPrice: Number(r.menuPrice) || 0,
          pourCostPct: r.menuPrice ? round2(BevCalc.pourCostPct(cost, r.menuPrice)) : null,
          profitPerDrink: r.menuPrice ? round2(Number(r.menuPrice) - cost) : null,
          servingsPerNight: Number(r.servingsPerNight) || 0,
          servingsAvailableNow: avail.servings,
          firstToRunOut: avail.limitedBy ? avail.limitedBy.name : null,
          buildsFrom: (r.components || [])
            .map((c) => {
              const src = resolveComponent(c.ingredientId);
              return src ? `${src.name} ${BevCalc.fmtQty(c.qty)} ${BevCalc.unitLabel(src, c.qty)}` : null;
            })
            .filter(Boolean),
        };
      }),
      glassware: state.glassSizes.map((g) => ({ name: g.name, volumeOz: g.volumeOz, defaultIceOz: g.defaultIceOz })),
      settings: {
        defaultPourCostPct: state.settings.defaultTargetPourCostPct,
        operatingNightsPerWeek: state.settings.operatingNightsPerWeek,
      },
    };
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function round4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

  return { init, summary, snapshot, switchTab };
})();
