/* ============================================================
   sheet.js — a living, playable D&D 5e character sheet.
   ------------------------------------------------------------
   Renders window.SHEET (see schema in ../README.md) into #sheet and
   wires clickable d20 / damage rolls through Dice.roll (dice.js).
   Play-state that changes at the table — current HP, temp HP, spent
   spell slots, spent hit dice, expended feature uses, conditions —
   persists to localStorage under "agm:play:<id>" so a reload keeps
   your place. "Rest" / "Reset" restore from the sheet's defaults.

   Rules: SRD 5.1 as extended by Historica Arcanum: The City of
   Crescent (magic origins, professions, spell rebound). This engine
   only tracks and rolls; it does not enforce build legality.
   ============================================================ */
(function () {
  "use strict";

  var BASE_ID = (window.SHEET || {}).id || (window.SHEET || {}).name || "unknown";
  var SHEET_KEY = "agm:sheet:" + BASE_ID;   // uploaded-sheet override (persists a swapped/edited character)
  function loadSheetOverride() { try { var r = localStorage.getItem(SHEET_KEY); if (r) return JSON.parse(r); } catch (e) {} return null; }

  // ---- edition-bound sheets ----------------------------------------------
  // A page may bake a single window.SHEET, OR a window.SHEETS map keyed by
  // edition ("2014" = 5e, "2024" = 5.5e) — each a whole character sheet sourced
  // from that edition's rules corpus. When the map is present the Rules toggle
  // swaps the entire active sheet, not just per-item ed-tagged rows.
  var SHEETS = (window.SHEETS && typeof window.SHEETS === "object") ? window.SHEETS : null;
  function baseSheetFor(ed) {
    if (SHEETS) return SHEETS[ed] || SHEETS["2014"] || SHEETS[Object.keys(SHEETS)[0]] || {};
    return window.SHEET || {};
  }
  // edition persisted with play-state (read before S/PS exist, so peek the raw store)
  function persistedEdition() {
    try { var raw = localStorage.getItem("agm:play:" + BASE_ID); if (raw) { var o = JSON.parse(raw); if (o && o.edition) return o.edition; } } catch (e) {}
    return null;
  }
  var _initEd = persistedEdition() || (window.SHEET || {}).defaultEdition || (SHEETS && SHEETS["2014"] ? "2014" : (SHEETS ? Object.keys(SHEETS)[0] : "2014"));
  var S = loadSheetOverride() || baseSheetFor(_initEd) || {};
  var ABILS = ["str", "dex", "con", "int", "wis", "cha"];
  var ABIL_NAME = { str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
  var SKILLS = {
    acrobatics: "dex", "animal handling": "wis", arcana: "int", athletics: "str",
    deception: "cha", history: "int", insight: "wis", intimidation: "cha",
    investigation: "int", medicine: "wis", nature: "int", perception: "wis",
    performance: "cha", persuasion: "cha", religion: "int",
    "sleight of hand": "dex", stealth: "dex", survival: "wis"
  };

  // ---- math helpers -------------------------------------------------------
  function mod(score) { return Math.floor(((score || 10) - 10) / 2); }
  function sgn(n) { return (n >= 0 ? "+" : "−") + Math.abs(n); }
  function profBonus() {
    if (S.proficiencyBonus != null) return S.proficiencyBonus;
    return 2 + Math.floor(((S.level || 1) - 1) / 4);
  }
  function abilMod(a) { return mod((S.abilities || {})[a]); }
  function titleCase(s) { return (s || "").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  // ---- persistent play-state ---------------------------------------------
  var KEY = "som:play:" + BASE_ID;   // NOTE(season-of-magic): namespace changed from
  // "agm:play:" when this engine was lifted from a-gibbous-moon. Keep this edit if the
  // engine is ever re-synced upstream.   // play-state, keyed to the page slot (not the swapped sheet)
  var PS = loadState();
  function defaultState() {
    var slots = {};
    var sc = S.spellcasting || {};
    Object.keys(sc.slots || {}).forEach(function (lv) { slots[lv] = 0; });
    var hd = {};
    (S.hitDice || []).forEach(function (d, i) { hd[i] = d.used || 0; });
    var uses = {};
    (S.features || []).forEach(function (f, i) { if (f.uses) uses[i] = f.uses.used || 0; });
    return {
      hp: (S.hp && S.hp.current != null) ? S.hp.current : ((S.hp && S.hp.max) || 0),
      temp: (S.hp && S.hp.temp) || 0,
      slots: slots, hitDice: hd, uses: uses, conditions: (S.conditions || []).slice(),
      death: { s: 0, f: 0 },   // NOTE(season-of-magic): death saves, empty by default
      inspiration: 0,          // NOTE(season-of-magic): Heroic Inspiration, empty by default
      edition: S.defaultEdition || "2014",
      econ: { open: 0, phase: "pre", used: { reaction: 0, action: 0, bonus: 0, move: 0 } }
    };
  }
  function loadState() {
    var d = defaultState();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k in saved) if (saved.hasOwnProperty(k)) d[k] = saved[k];
      }
    } catch (e) {}
    if (!d.econ || !d.econ.used) d.econ = { open: 0, phase: "pre", used: { reaction: 0, action: 0, bonus: 0, move: 0 } };
    if (!d.death || typeof d.death !== "object") d.death = { s: 0, f: 0 };
    if (d.inspiration == null) d.inspiration = 0;
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(PS)); } catch (e) {} }

  // ---- download / upload a character snapshot ----------------------------
  function downloadJSON() {
    var payload = { format: "agm-character", version: 1, id: BASE_ID,
      name: S.name || BASE_ID, sheet: S, state: PS };
    var blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = BASE_ID + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setMsg("Downloaded", BASE_ID + ".json", "⭳");
  }
  function looksLikeSheet(o) { return o && (o.abilities || o.spellcasting || o.attacks || o.features); }
  function looksLikeState(o) { return o && (o.hp != null || o.slots || o.hitDice || o.econ); }
  function handleUpload(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { alert("That file isn't valid JSON."); return; }
      var sheet = null, state = null;
      if (data && data.format === "agm-character") { sheet = data.sheet || null; state = data.state || null; }
      else if (looksLikeSheet(data)) { sheet = data; }
      else if (looksLikeState(data)) { state = data; }
      if (!sheet && !state) { alert("Unrecognized file — expected a character or play-state JSON."); return; }
      var msg = sheet ? ("Replace this character's sheet" + (state ? " and play-state" : "") + "?")
                      : "Restore the saved play-state?";
      if (!confirm(msg + "\n\nThis overwrites what's loaded here (your download is unaffected).")) return;
      if (sheet) { try { localStorage.setItem(SHEET_KEY, JSON.stringify(sheet)); } catch (e) {} S = sheet; }
      if (state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} PS = loadState(); }
      else if (sheet) { try { localStorage.removeItem(KEY); } catch (e) {} PS = defaultState(); save(); }
      render();
      setMsg("Loaded", file.name, "⭱");
    };
    reader.readAsText(file);
  }

  var activeSpellTab = null; // which spell level tab is showing (persists across re-renders)
  var activeFeatTab = null;  // which feature category tab is showing
  var activeAtkTab = null;   // which Attacks & Actions tab is showing
  function featCat(f) {
    if (f && f.category) return f.category; // explicit override
    var s = ((f && f.source) || "").toLowerCase();
    var name = ((f && f.name) || "").toLowerCase();
    if (s.indexOf("class") !== -1) return "Class";
    if (s.indexOf("racial") !== -1 || s.indexOf("race") !== -1 || s.indexOf("species") !== -1) return "Racial";
    if (/^(apprentice|journeyman|expert|master) |accomplished chemist|bounty hunter|antiquarian|arch[ae]ologist|\bprofession\b/.test(name)) return "Profession";
    return "General";
  }
  // ---- ruleset edition (5e / 5.5e) toggle --------------------------------
  // Items tagged with an `ed` ("2014" | "2024") show only in that edition; untagged show in both.
  function curEd() { return (PS && PS.edition) || S.defaultEdition || "2014"; }
  function inEd(x) { return !x || !x.ed || x.ed === curEd(); }
  function hasEditions() {
    if (SHEETS && Object.keys(SHEETS).length >= 2) return true;
    var arr = [].concat(S.features || [], S.attacks || [], ((S.spellcasting || {}).spells) || []);
    return arr.some(function (x) { return x && x.ed; });
  }

  // action-economy cost of an ability: "action" | "bonus" | "reaction" | "move" | "none"
  function spellCost(sp) {
    if (sp.cast) return sp.cast;
    var t = (sp.castTime || sp.text || "").toLowerCase();
    if (/casting time:\s*1\s*reaction/.test(t)) return "reaction";
    if (/1\s*bonus action/.test(t)) return "bonus";
    if (/1\s*action/.test(t)) return "action";
    return "action"; // most spells/cantrips
  }
  function featCost(f) {
    if (f.action) return f.action;
    var s = ((f.name || "") + " " + (f.text || "")).toLowerCase();
    if (/\breaction\b/.test(s)) return "reaction";
    if (/bonus action/.test(s)) return "bonus";
    if (/\bas an action\b|\bas a magic action\b|\baction to\b|\btake the [a-z ]*action\b/.test(s)) return "action";
    return "none"; // passive / always-on
  }

  // ---- dice tray ----------------------------------------------------------
  var advMode = 0; // -1 dis, 0 normal, +1 adv
  var tray, trayDice, trayMsg, trayLog;
  function buildTray() {
    if (tray) return;               // build once; survives re-renders so rolls persist
    tray = el("div", "roll-tray");
    tray.innerHTML =
      '<div class="tray-inner">' +
        '<div class="adv-toggle" role="group" aria-label="Advantage">' +
          '<button data-adv="-1" title="Disadvantage">Dis</button>' +
          '<button data-adv="0" class="on" title="Normal">—</button>' +
          '<button data-adv="1" title="Advantage">Adv</button>' +
        '</div>' +
        '<div class="tray-dice"></div>' +
        '<div class="tray-msg"><span class="tm-title">Tap a stat to roll</span></div>' +
        '<div class="tray-log" aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(tray);
    trayDice = tray.querySelector(".tray-dice");
    trayMsg = tray.querySelector(".tray-msg");
    trayLog = tray.querySelector(".tray-log");
    tray.querySelectorAll(".adv-toggle button").forEach(function (b) {
      b.addEventListener("click", function () {
        advMode = parseInt(b.getAttribute("data-adv"), 10);
        tray.querySelectorAll(".adv-toggle button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
      });
    });
  }

  function d20() { return 1 + Math.floor(Math.random() * 20); }

  // Roll a d20 check/save/attack. modParts: [{label, value}]. opts.forceNormal
  // skips advantage (e.g. damage, hit dice). Returns nothing; renders to tray.
  function rollCheck(title, flatMod, opts) {
    opts = opts || {};
    var useAdv = opts.forceNormal ? 0 : advMode;
    var r1 = d20(), r2 = d20();
    var kept, dropped;
    if (useAdv > 0) { kept = Math.max(r1, r2); dropped = Math.min(r1, r2); }
    else if (useAdv < 0) { kept = Math.min(r1, r2); dropped = Math.max(r1, r2); }
    else { kept = r1; dropped = null; }
    var total = kept + flatMod;

    var dice = [{ sides: 20, value: kept, shape: "d20", tag: tagFor(kept), keep: true }];
    if (dropped != null) dice.push({ sides: 20, value: dropped, shape: "d20", tag: tagFor(dropped) + " low" });

    Dice.roll({
      mount: trayDice, dice: dice, duration: 560, stagger: 70,
      classify: function (die) { return die.keep ? "high" : ""; }
    });
    var natTxt = kept === 20 ? " · Natural 20!" : (kept === 1 ? " · Natural 1" : "");
    var advTxt = useAdv > 0 ? " (adv)" : (useAdv < 0 ? " (dis)" : "");
    setMsg(title + advTxt, "d20" + natTxt + "  " + sgn(flatMod) + "  =", total);
    logLine(title + ": " + total + (natTxt ? natTxt.replace(" · ", " — ") : ""));
  }
  function tagFor(v) { return v === 20 ? "d20 nat20" : (v === 1 ? "d20 nat1" : "d20"); }

  // Roll damage: spec like "2d6+3" (or array of specs). forceNormal always.
  function rollDamage(title, spec) {
    var parts = parseDamage(spec);
    var dice = [], total = 0, breakdown = [];
    parts.forEach(function (p) {
      if (p.sides) {
        for (var i = 0; i < p.count; i++) {
          var v = 1 + Math.floor(Math.random() * p.sides);
          total += v; dice.push({ sides: p.sides, value: v, tag: "dmg" });
        }
        breakdown.push(p.count + "d" + p.sides);
      } else {
        total += p.flat; dice.push({ sides: 1, value: p.flat, tag: "mod" });
        breakdown.push(sgn(p.flat));
      }
    });
    Dice.roll({ mount: trayDice, dice: dice, duration: 520, stagger: 55 });
    setMsg(title, breakdown.join(" ") + "  =", total);
    logLine(title + ": " + total);
  }
  function parseDamage(spec) {
    if (Array.isArray(spec)) return spec;
    var out = [], re = /([+-]?)\s*(\d*)d(\d+)|([+-]?\s*\d+)/gi, m;
    while ((m = re.exec(spec))) {
      if (m[3]) {
        var count = parseInt(m[2] || "1", 10);
        out.push({ count: count, sides: parseInt(m[3], 10) });
      } else if (m[4]) {
        out.push({ flat: parseInt(m[4].replace(/\s/g, ""), 10) });
      }
    }
    return out;
  }

  function setMsg(title, formula, total) {
    trayMsg.innerHTML = '<span class="tm-title">' + esc(title) + '</span>' +
      '<span class="tm-formula">' + esc(formula) + '</span>' +
      '<span class="tm-total">' + total + '</span>';
    tray.classList.add("live");
  }
  function logLine(txt) {
    var d = el("div", "log-line"); d.textContent = txt;
    trayLog.insertBefore(d, trayLog.firstChild);
    while (trayLog.children.length > 6) trayLog.removeChild(trayLog.lastChild);
  }

  // ---- tiny DOM helpers ---------------------------------------------------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }

  // ---- section builders ---------------------------------------------------
  function render() {
    var root = document.getElementById("sheet");
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(header());
    if (S.scaffold2024 && curEd() === "2024") {
      root.appendChild(el("div", "ed-scaffold-note",
        '⚠ <strong>2024 (5.5e) conversion in progress.</strong> This sheet carries the ' +
        'character’s 5e build across unchanged; spell, feature and item rules text is drawn ' +
        'from the D&amp;D 5.5e + Historica Arcanum corpus where an entry was matched (others keep ' +
        'their 5e text, tagged below). The build itself has <em>not</em> yet been re-verified ' +
        'against 2024 rules — pending a fresh 2024 build.'));
    }
    root.appendChild(vitals());
    var body = el("div", "sheet-body");
    body.appendChild(colLeft());
    body.appendChild(colMid());
    body.appendChild(colRight());
    root.appendChild(body);
    buildTray();
    wireHandlers(root);
    applyEcon();
  }

  function classLine() {
    var cs = S.classes || (S.className ? [{ name: S.className, subclass: S.subclass, level: S.level }] : []);
    return cs.map(function (c) {
      return c.name + (c.subclass ? " (" + c.subclass + ")" : "") + (c.level ? " " + c.level : "");
    }).join(" / ") || ("Level " + (S.level || 1));
  }

  function header() {
    var h = el("header", "sheet-head");
    var port = S.portrait
      ? '<div class="sh-portrait"><img src="' + esc(S.portrait) + '" alt="' + esc(S.name) + '" onerror="this.parentNode.style.display=\'none\'"></div>'
      : "";
    var chips = [];
    if (S.race) chips.push('<span class="chip teal">' + esc(S.race) + '</span>');
    if (S.background) chips.push('<span class="chip">' + esc(S.background) + '</span>');
    if (S.origin) chips.push('<span class="chip olive">' + esc(typeof S.origin === "string" ? S.origin : S.origin.name) + '</span>');
    if (S.profession) chips.push('<span class="chip">' + esc(typeof S.profession === "string" ? S.profession : S.profession.name) + '</span>');
    if (S.alignment) chips.push('<span class="chip">' + esc(S.alignment) + '</span>');
    var ed = curEd();
    var edToggle = hasEditions()
      ? '<div class="ed-toggle" title="Switch rules edition — 2014 (5e) vs 2024 (5.5e)">' +
          '<span class="ed-lbl">Rules</span>' +
          '<button class="ed-btn' + (ed === "2014" ? " active" : "") + '" data-ed="2014">5e</button>' +
          '<button class="ed-btn' + (ed === "2024" ? " active" : "") + '" data-ed="2024">5.5e</button>' +
        '</div>'
      : '';
    h.innerHTML = port +
      '<div class="sh-id">' +
        // NOTE(season-of-magic): Reset and the JSON import/export live up here,
        // across from the class line — they are setup, not things reached for
        // mid-turn, and down in the vitals they were costing a whole row.
        '<div class="sh-tools">' +
          '<button class="btn-reset" title="Revert to the shipped character and clear all play-state">Reset</button>' +
          '<button class="btn-io btn-dl" title="Download this character + current state as a JSON file">\u2B73 JSON</button>' +
          '<button class="btn-io btn-ul" title="Upload a character or saved play-state JSON">\u2B71 JSON</button>' +
          '<input type="file" id="agm-upload" accept="application/json,.json" style="display:none">' +
        '</div>' +
        '<div class="sh-eyebrow">' + esc(classLine()) + '</div>' +
        '<h1>' + esc(S.name || "Unnamed") + '</h1>' +
        (S.player ? '<div class="sh-player">played by ' + esc(S.player) + '</div>' : '') +
        '<div class="tagrow">' + chips.join("") + edToggle + '</div>' +
      '</div>';
    return h;
  }

  function vitals() {
    var v = el("div", "vitals");
    var pb = profBonus();
    var init = (S.initiative != null ? S.initiative : abilMod("dex"));
    var hp = S.hp || { max: 0 };
    var iv = stat("Initiative", sgn(init));
    iv.classList.add("rollable", "econ-toggle"); iv.setAttribute("title", "Open the turn tracker");
    v.appendChild(iv);
    v.appendChild(stat("Armor Class", S.ac != null ? S.ac : "—"));
    v.appendChild(stat("Speed", (S.speed != null ? S.speed + " ft" : "—")));
    v.appendChild(rollStat("Prof. Bonus", sgn(pb), null));
    // HP block
    var hpBlock = el("div", "vstat hp-block");
    hpBlock.innerHTML =
      '<b>Hit Points</b>' +
      '<div class="hp-controls">' +
        '<button class="hp-dmg" title="Take damage">−</button>' +
        '<span class="hp-cur">' + PS.hp + '</span>' +
        '<span class="hp-sep">/</span>' +
        '<span class="hp-max">' + (hp.max || 0) + '</span>' +
        '<button class="hp-heal" title="Heal">+</button>' +
      '</div>' +
      '<div class="hp-temp">temp <button class="tmp-dn">−</button> <span class="tmp-val">' + PS.temp + '</span> <button class="tmp-up">+</button></div>';
    v.appendChild(hpBlock);
    // Hit dice
    if (S.hitDice && S.hitDice.length) {
      var hdBlock = el("div", "vstat hd-block");
      hdBlock.innerHTML = '<b>Hit Dice</b><div class="hd-rows"></div>';
      var rows = hdBlock.querySelector(".hd-rows");
      S.hitDice.forEach(function (d, i) {
        var used = PS.hitDice[i] || 0, avail = (d.total || 0) - used;
        var r = el("div", "hd-row");
        r.innerHTML = '<button class="hd-roll" data-hd="' + i + '" title="Spend one ' + d.size + ' to heal">' +
          d.size + '</button> <span class="hd-avail">' + avail + '</span><span class="hd-slash">/' + (d.total || 0) + '</span>';
        rows.appendChild(r);
      });
      v.appendChild(hdBlock);
    }
    // Death saves — NOTE(season-of-magic)
    var ds = el("div", "vstat death-block");
    function dsPips(kind, filled) {
      var out = "";
      for (var k = 0; k < 3; k++) {
        out += '<button class="ds-pip ' + kind + (k < filled ? " on" : "") +
               '" data-ds="' + kind + '" data-idx="' + k + '" title="' +
               (kind === "s" ? "Success" : "Failure") + ' ' + (k + 1) + '"></button>';
      }
      return out;
    }
    ds.innerHTML = '<b>Death Saves</b>' +
      '<div class="ds-rows">' +
        '<div class="ds-row"><span class="ds-lbl">Succ</span>' + dsPips("s", PS.death.s) + '</div>' +
        '<div class="ds-row"><span class="ds-lbl">Fail</span>' + dsPips("f", PS.death.f) + '</div>' +
      '</div>' +
      '<button class="ds-roll" title="Roll a death saving throw">Roll</button>';
    v.appendChild(ds);

    // Heroic Inspiration — NOTE(season-of-magic)
    var insp = el("div", "vstat insp-block" + (PS.inspiration ? " on" : ""));
    insp.innerHTML = '<b>Heroic Inspiration</b>' +
      '<button class="insp-toggle" title="Toggle Heroic Inspiration">' +
      (PS.inspiration ? "✦" : "◇") + '</button>';
    v.appendChild(insp);

    // Rests — NOTE(season-of-magic): senses moved under the skills card and the
    // Reset/JSON buttons into the header, so the vitals fit on a single row.
    var rest = el("div", "vstat rest-block");
    rest.innerHTML = '<button class="btn-short" title="Restore short-rest features &amp; pact slots; spend Hit Dice to heal">Short Rest</button>' +
      '<button class="btn-rest" title="Restore HP, slots, hit-dice &amp; uses to full">Long Rest</button>';
    v.appendChild(rest);
    v.appendChild(econPanel(init));
    return v;
  }
  function econPanel(init) {
    var e = PS.econ, used = e.used;
    var p = el("div", "vstat wide econ-panel" + (e.open ? " open" : ""));
    var btns = '<button class="econ-roll rollable roll-init" title="Roll Initiative">Roll Init ' + sgn(init) + '</button>';
    if (e.phase === "pre") {
      btns += '<button class="econ-b take" data-econ-btn="take">Take Turn</button>' +
              '<button class="econ-b' + (used.reaction ? " spent" : "") + '" data-econ-btn="reaction">Reaction</button>';
    } else {
      btns += '<button class="econ-b' + (used.action ? " spent" : "") + '" data-econ-btn="action">Action</button>' +
              '<button class="econ-b' + (used.bonus ? " spent" : "") + '" data-econ-btn="bonus">Bonus Action</button>' +
              '<button class="econ-b' + (used.move ? " spent" : "") + '" data-econ-btn="move">Movement</button>' +
              '<button class="econ-b end" data-econ-btn="end">End Turn</button>';
    }
    p.innerHTML = '<b>Turn</b><div class="econ-btns">' + btns + '</div>';
    return p;
  }
  function stat(label, val) {
    var s = el("div", "vstat");
    s.innerHTML = '<b>' + esc(label) + '</b><span class="v">' + val + '</span>';
    return s;
  }
  function rollStat(label, val, cls) {
    var s = el("div", "vstat rollable" + (cls ? " " + cls : ""));
    s.innerHTML = '<b>' + esc(label) + '</b><span class="v">' + val + '</span>';
    return s;
  }

  function colLeft() {
    var c = el("div", "sheet-col left");
    c.appendChild(abilitiesBlock());
    c.appendChild(skillsBlock());
    c.appendChild(profBlock());
    if (S.notes) c.appendChild(notesBlock());
    return c;
  }
  // NOTE(season-of-magic): three columns, so a landscape tablet shows abilities,
  // what you do on your turn, and your features/gear side by side without scrolling.
  function colMid() {
    var c = el("div", "sheet-col mid");
    if ((S.attacks && S.attacks.length) || S.spellcasting) c.appendChild(attacksBlock());
    if (S.spellcasting) c.appendChild(spellsBlock());
    return c;
  }
  function colRight() {
    var c = el("div", "sheet-col right");
    if (S.features && S.features.length) c.appendChild(featuresBlock());
    if (S.feats && S.feats.length) c.appendChild(featsBlock());
    if (S.equipment && S.equipment.length || S.currency) c.appendChild(gearBlock());
    return c;
  }

  function abilitiesBlock() {
    var b = card("Abilities");
    var grid = el("div", "abil-grid");
    var pb = profBonus();
    var saveProf = (S.saveProf || S.savingThrows || []);
    ABILS.forEach(function (a) {
      var m = abilMod(a);
      var prof = saveProf.indexOf(a) !== -1;
      var saveMod = m + (prof ? pb : 0);
      var box = el("div", "abil");
      box.innerHTML =
        '<div class="abil-name">' + a.toUpperCase() + '</div>' +
        '<button class="abil-mod rollable" data-check="' + a + '" title="Roll a ' + ABIL_NAME[a] + ' check">' + sgn(m) + '</button>' +
        '<div class="abil-score">' + ((S.abilities || {})[a] != null ? S.abilities[a] : "—") + '</div>' +
        '<button class="save-row rollable' + (prof ? " prof" : "") + '" data-save="' + a + '" title="Roll a ' + ABIL_NAME[a] + ' saving throw">' +
          '<span class="dot"></span>Save <b>' + sgn(saveMod) + '</b></button>';
      grid.appendChild(box);
    });
    b.appendChild(grid);
    return b;
  }

  function skillsBlock() {
    var b = card("Skills");
    var pb = profBonus();
    var chosen = S.skills || {};
    var list = el("div", "skill-list");
    Object.keys(SKILLS).forEach(function (sk) {
      var abil = SKILLS[sk];
      var rank = chosen[sk] || 0; // 0 none, 1 prof, 2 expertise
      var total = abilMod(abil) + (rank ? pb * rank : 0);
      var row = el("button", "skill rollable" + (rank ? " prof" : "") + (rank === 2 ? " expert" : ""));
      row.setAttribute("data-skill", sk);
      row.setAttribute("data-mod", total);
      row.innerHTML = '<span class="dot"></span><span class="sk-name">' + titleCase(sk) + '</span>' +
        '<span class="sk-ab">' + abil + '</span><span class="sk-mod">' + sgn(total) + '</span>';
      list.appendChild(row);
    });
    b.appendChild(list);
    var pp = 10 + abilMod("wis") + ((chosen["perception"] || 0) ? pb * chosen["perception"] : 0);
    b.appendChild(el("div", "passive", "Passive Perception <b>" + pp + "</b>"));
    // NOTE(season-of-magic): senses/size read here, under the skills they belong with
    if (S.senses) b.appendChild(el("div", "senses-line", esc(S.senses)));
    return b;
  }

  function attackRow(atk) {
    var pb = profBonus(), abil = atk.ability || "str";
    var atkBonus = (atk.bonus != null ? atk.bonus : 0) + abilMod(abil) + (atk.proficient === false ? 0 : pb);
    var dmgSpec = (atk.damage || "").replace(/MOD/gi, (abilMod(abil) >= 0 ? "+" : "") + abilMod(abil));
    var row = el("div", "attack");
    row.setAttribute("data-econ", atk.action || "action");
    row.innerHTML =
      '<button class="atk-name rollable" data-atk-bonus="' + atkBonus + '" data-atk-name="' + esc(atk.name) + '">' + esc(atk.name) + '</button>' +
      '<span class="atk-bonus">' + sgn(atkBonus) + ' to hit</span>' +
      (dmgSpec ? '<button class="atk-dmg rollable" data-dmg="' + esc(dmgSpec) + '" data-dmg-name="' + esc(atk.name) + '">' + esc(dmgSpec) + (atk.damageType ? " " + esc(atk.damageType) : "") + '</button>' : '') +
      (atk.range ? '<span class="atk-meta">' + esc(atk.range) + '</span>' : '') +
      (atk.mastery ? '<span class="atk-mastery" title="' + esc(atk.mastery.text || "") + '">Mastery: ' + esc(atk.mastery.name) + '</span>' : '') +
      (atk.notes ? '<div class="atk-notes">' + nl2br(atk.notes) + '</div>' : '') +
      (atk.mastery && atk.mastery.text ? '<div class="atk-mastery-text"><strong>' + esc(atk.mastery.name) + '.</strong> ' + esc(atk.mastery.text) + '</div>' : '');
    return row;
  }
  // Attacks & Actions — no title, just tabs by action-economy type
  function attacksBlock() {
    var sc = S.spellcasting || {}, spells = sc.spells || [], pb = profBonus();
    spells.forEach(function (sp, i) { sp._idx = i; });
    var buckets = { "Attack": [], "Action": [], "Bonus Action": [], "Reaction": [] };
    if (sc.ability || (sc.slots && Object.keys(sc.slots).length)) {
      var sabil = sc.ability || "int";
      var satk = sc.attackBonus != null ? sc.attackBonus : pb + abilMod(sabil);
      var sdc = sc.saveDC != null ? sc.saveDC : 8 + pb + abilMod(sabil);
      var sr = el("div", "attack spell-atk-row");
      sr.innerHTML = '<button class="atk-name rollable" data-spell-atk="' + satk + '">Spell Attack</button>' +
        '<span class="atk-bonus">' + sgn(satk) + ' to hit</span><span class="atk-meta">Save DC ' + sdc + ' · ' + ABIL_NAME[sabil] + '</span>';
      buckets["Attack"].push(sr);
    }
    (S.attacks || []).forEach(function (a) { if (inEd(a)) buckets["Attack"].push(attackRow(a)); });
    spells.forEach(function (sp) {
      if (!inEd(sp)) return;
      if (sp.attack) { buckets["Attack"].push(spellRow(sp)); return; }
      var c = spellCost(sp);
      buckets[c === "bonus" ? "Bonus Action" : c === "reaction" ? "Reaction" : "Action"].push(spellRow(sp));
    });
    (S.features || []).forEach(function (f, i) {
      if (!inEd(f)) return;
      var c = featCost(f); if (c === "none") return;
      // NOTE(season-of-magic): action:"attack" puts a feature in the Attack tab —
      // for riders applied to a weapon attack, e.g. the Arcane Shot options.
      if (c === "attack") { buckets["Attack"].push(featureRow(f, i)); return; }
      buckets[c === "bonus" ? "Bonus Action" : c === "reaction" ? "Reaction" : "Action"].push(featureRow(f, i));
    });
    var order = ["Attack", "Action", "Bonus Action", "Reaction"];
    var cats = order.filter(function (c) { return buckets[c].length; });
    var b = el("section", "sheet-card atk-card");
    if (!cats.length) return b;
    if (activeAtkTab == null || cats.indexOf(activeAtkTab) === -1) activeAtkTab = cats[0];
    var tabs = el("div", "atk-tabs");
    cats.forEach(function (c) {
      var tb = el("button", "atk-tab" + (c === activeAtkTab ? " active" : ""), c);
      tb.setAttribute("data-atk-tab", c); tabs.appendChild(tb);
    });
    b.appendChild(tabs);
    cats.forEach(function (c) {
      var list = el("div", "atk-list" + (c === activeAtkTab ? " active" : ""));
      list.setAttribute("data-atk-cat", c);
      buckets[c].forEach(function (row) { list.appendChild(row); });
      b.appendChild(list);
    });
    return b;
  }

  function spellRow(sp) {
    var canCast = (sp.level || 0) === 0 || hasSlotFor(sp.level || 0);
    var badges = (sp.concentration ? '<span class="sp-badge" title="Concentration">C</span>' : "") +
                 (sp.ritual ? '<span class="sp-badge" title="Ritual">R</span>' : "") +
                 // on the pending 2024 scaffold, mark spells whose text is still 5e (no 5.5e match)
                 ((S.scaffold2024 && curEd() === "2024" && sp.text2024 === false)
                    ? '<span class="sp-badge ed5e" title="No 5.5e entry matched — rules text shown is 5e, pending 2024 conversion">5e text</span>' : "");
    var it = el("div", "spell" + (sp.prepared === false ? " unprepared" : ""));
    it.setAttribute("data-econ", spellCost(sp));
    // a roll button for damage / healing / dice-pool spells (MOD -> spellcasting mod)
    var rollSpec = sp.damage || sp.heal || sp.dice, rollBtn = "";
    if (rollSpec) {
      var scMod = abilMod((S.spellcasting || {}).ability || "int");
      var spec = String(rollSpec).replace(/MOD/gi, (scMod >= 0 ? "+" : "") + scMod);
      var lbl = sp.heal ? "Heal" : "Roll";
      rollBtn = '<div class="sp-actions"><button class="sp-dmg rollable" data-dmg="' + esc(spec) + '" data-dmg-name="' + esc(sp.name) + '">' + lbl + " " + esc(spec) + '</button></div>';
    }
    // slot-level stepper: default = lowest available >= base; bump up/down through available higher/lower slots
    var base = sp.level || 0, stepper = "";
    if (base > 0 && slotLevels().length) {
      var tgt = targetLevel(sp._idx, base), av = availLevels(base);
      var canUp = tgt != null && av.some(function (l) { return l > tgt; });
      var canDown = tgt != null && av.some(function (l) { return l < tgt; });
      var bumped = castSel[sp._idx] != null && castSel[sp._idx] !== base;
      stepper = '<span class="sp-lv' + (bumped ? " bumped" : "") + '" title="Slot level to cast at (bump to upcast)">' +
        '<button class="lvstep" data-cast-down="' + sp._idx + '"' + (canDown ? '' : ' disabled') + '>▾</button>' +
        '<span class="lvnum">' + (tgt != null ? "L" + tgt : "L" + base) + '</span>' +
        '<button class="lvstep" data-cast-up="' + sp._idx + '"' + (canUp ? '' : ' disabled') + '>▴</button>' +
      '</span>';
    }
    it.innerHTML =
      '<div class="sp-row">' +
        '<button class="sp-name" data-sp-expand="' + sp._idx + '" title="Show details">' + esc(sp.name) + '</button>' +
        badges +
        (sp.save ? '<span class="sp-save">' + esc(sp.save) + '</span>' : '') +
        stepper +
        '<button class="sp-cast' + (sp.attack ? ' atkspell' : '') + '" data-sp-cast="' + sp._idx + '"' + (canCast ? '' : ' disabled') + ' title="Cast this spell">Cast</button>' +
      '</div>' +
      (sp.notes ? '<div class="sp-notes">' + esc(sp.notes) + '</div>' : '') +
      '<div class="sp-body">' +
        (sp.text ? nl2br(sp.text) : '<em class="sp-nodesc">No description on file.</em>') + rollBtn +
      '</div>';
    return it;
  }
  function spellsBlock() {
    var sc = S.spellcasting;
    var b = card("Spellcasting");
    var abil = sc.ability || "int";
    var pb = profBonus();
    var dc = sc.saveDC != null ? sc.saveDC : 8 + pb + abilMod(abil);
    var atk = sc.attackBonus != null ? sc.attackBonus : pb + abilMod(abil);
    b.appendChild(el("div", "spell-head",
      'Ability <b>' + ABIL_NAME[abil] + '</b><span class="ssep">·</span>Save DC <b>' + dc + '</b>' +
      '<span class="ssep">·</span>Spell Atk <button class="rollable spell-atk" data-spell-atk="' + atk + '"><b>' + sgn(atk) + '</b></button>'));
    // slot trackers
    if (sc.slots && Object.keys(sc.slots).length) {
      var slotWrap = el("div", "slots");
      Object.keys(sc.slots).sort(function (a, c) { return a - c; }).forEach(function (lv) {
        var info = sc.slots[lv]; var total = info.total || 0; var used = PS.slots[lv] || 0;
        var row = el("div", "slot-row");
        var pips = "";
        for (var i = 0; i < total; i++) pips += '<button class="pip' + (i < (total - used) ? "" : " spent") + '" data-slot="' + lv + '" data-idx="' + i + '"></button>';
        row.innerHTML = '<span class="slot-lv">Lvl ' + lv + '</span><span class="pips">' + pips + '</span>';
        slotWrap.appendChild(row);
      });
      b.appendChild(slotWrap);
    }
    // spell list — tabbed by level, each spell expandable with a Cast button
    var spells = sc.spells || [];
    if (spells.length) {
      var byLevel = {};
      spells.forEach(function (sp, i) { sp._idx = i; if (!inEd(sp)) return; (byLevel[sp.level || 0] = byLevel[sp.level || 0] || []).push(sp); });
      var levels = Object.keys(byLevel).sort(function (a, c) { return a - c; });
      if (activeSpellTab == null || levels.indexOf(String(activeSpellTab)) === -1) activeSpellTab = levels[0];
      var tabs = el("div", "spell-tabs");
      levels.forEach(function (lv) {
        var tb = el("button", "spell-tab" + (String(lv) === String(activeSpellTab) ? " active" : ""),
                    lv == 0 ? "Cantrips" : "Lvl " + lv);
        tb.setAttribute("data-spell-tab", lv);
        tabs.appendChild(tb);
      });
      b.appendChild(tabs);
      levels.forEach(function (lv) {
        var ul = el("div", "spell-list" + (String(lv) === String(activeSpellTab) ? " active" : ""));
        ul.setAttribute("data-spell-level", lv);
        byLevel[lv].forEach(function (sp) { ul.appendChild(spellRow(sp)); });
        b.appendChild(ul);
      });
    }
    if (sc.rebound) b.appendChild(el("div", "rebound", '<b>Spell Rebound:</b> ' + nl2br(sc.rebound)));
    return b;
  }

  function featureRow(f, i) {
    var it = el("div", "feature");
    var econ = featCost(f);
    it.setAttribute("data-econ", econ === "attack" ? "action" : econ);
    it.setAttribute("data-cat", featCat(f));
    var usesHtml = "";
    if (f.uses) {
      var total = f.uses.max || 0, used = PS.uses[i] || 0, pips = "";
      for (var k = 0; k < total; k++) pips += '<button class="pip' + (k < (total - used) ? "" : " spent") + '" data-use="' + i + '" data-idx="' + k + '"></button>';
      usesHtml = '<span class="use-pips" title="' + esc((f.uses.per || "") + " uses") + '">' + pips + '</span>';
    }
    // Trigger (feature analogue of Cast) — only for activatable features
    var activatable = !!(f.uses || featCost(f) !== "none" || f.roll || f.damage || f.heal);
    var canTrig = !f.uses || (PS.uses[i] || 0) < (f.uses.max || 0);
    var trig = activatable ? '<button class="feat-trigger" data-feat-trigger="' + i + '"' + (canTrig ? '' : ' disabled') + ' title="Use this feature">Trigger</button>' : '';
    it.innerHTML = '<div class="feat-h">' +
      '<button class="feat-name" data-feat-expand="' + i + '" title="Show details">' + esc(f.name) + '</button>' +
      (f.source ? '<span class="feat-src">' + esc(f.source) + '</span>' : '') + usesHtml + trig + '</div>' +
      // NOTE(season-of-magic): compact stat line for features that hit or force a save
      ((f.damage || f.save || f.range)
        ? '<div class="feat-meta">' +
            (f.damage ? '<button class="feat-dmg rollable" data-dmg="' + esc(f.damage) + '" data-dmg-name="' +
               esc(f.name) + '">' + esc(f.damage) + (f.damageType ? " " + esc(f.damageType) : "") + '</button>' : '') +
            (f.save ? '<span class="feat-save">' + esc(f.save) + '</span>' : '') +
            (f.range ? '<span class="feat-range">' + esc(f.range) + '</span>' : '') +
          '</div>'
        : '') +
      (f.text ? '<div class="feat-body">' + nl2br(f.text) + '</div>' : '');
    return it;
  }
  function featuresBlock() {
    var b = card("Features &amp; Traits");
    var order = ["Class", "Racial", "General", "Profession"];
    var groups = { Class: [], Racial: [], General: [], Profession: [] };
    S.features.forEach(function (f, i) { if (inEd(f)) groups[featCat(f)].push({ f: f, i: i }); });
    var cats = order.filter(function (c) { return groups[c].length; });
    if (activeFeatTab == null || cats.indexOf(activeFeatTab) === -1) activeFeatTab = cats[0];
    if (cats.length > 1) {
      var tabs = el("div", "feat-tabs");
      cats.forEach(function (c) {
        var tb = el("button", "feat-tab" + (c === activeFeatTab ? " active" : ""), c);
        tb.setAttribute("data-feat-tab", c);
        tabs.appendChild(tb);
      });
      b.appendChild(tabs);
    }
    cats.forEach(function (c) {
      var active = (cats.length === 1) || (c === activeFeatTab);
      var list = el("div", "feat-list" + (active ? " active" : ""));
      list.setAttribute("data-feat-cat", c);
      groups[c].forEach(function (o) { list.appendChild(featureRow(o.f, o.i)); });
      b.appendChild(list);
    });
    return b;
  }

  function featsBlock() {
    var b = card("Feats");
    S.feats.forEach(function (f) {
      var it = el("div", "feature");
      it.innerHTML = '<div class="feat-h"><span class="feat-name">' + esc(f.name || f) + '</span></div>' +
        (f.text ? '<div class="feat-text">' + nl2br(f.text) + '</div>' : '');
      b.appendChild(it);
    });
    return b;
  }

  function profBlock() {
    var p = S.proficiencies || {};
    if (!p.armor && !p.weapons && !p.tools && !p.languages) return el("div");
    var b = card("Proficiencies &amp; Languages");
    [["Armor", p.armor], ["Weapons", p.weapons], ["Tools", p.tools], ["Languages", p.languages]].forEach(function (row) {
      if (row[1]) b.appendChild(el("div", "prof-row", '<b>' + row[0] + '</b> ' + esc(row[1])));
    });
    return b;
  }

  function gearBlock() {
    var b = card("Inventory");
    if (S.currency) {
      var c = S.currency, parts = [];
      ["pp", "gp", "ep", "sp", "cp"].forEach(function (k) { if (c[k]) parts.push('<span class="coin ' + k + '">' + c[k] + ' ' + k + '</span>'); });
      if (parts.length) b.appendChild(el("div", "currency", parts.join("")));
    }
    (S.equipment || []).forEach(function (g) {
      var it = el("div", "gear");
      it.innerHTML = '<span class="g-name">' + esc(g.name) + (g.qty > 1 ? ' <span class="g-qty">×' + g.qty + '</span>' : '') + '</span>' +
        (g.notes ? '<div class="g-notes">' + nl2br(g.notes) + '</div>' : '');
      b.appendChild(it);
    });
    return b;
  }

  function notesBlock() {
    var b = card("Notes");
    b.appendChild(el("div", "notes-text", nl2br(S.notes)));
    return b;
  }

  function card(title) {
    var c = el("section", "sheet-card");
    c.appendChild(el("h2", null, title));
    return c;
  }

  // ---- interaction --------------------------------------------------------
  var handlersWired = false;
  function wireHandlers(root) {
    if (handlersWired) return;   // #sheet persists across renders — wire once
    handlersWired = true;
    root.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.id === "agm-upload" && t.files && t.files[0]) { handleUpload(t.files[0]); t.value = ""; }
    });
    root.addEventListener("click", function (e) {
      var t = e.target.closest("button, .rollable");
      if (!t) return;
      // checks
      if (t.hasAttribute("data-check")) { var a = t.getAttribute("data-check"); rollCheck(ABIL_NAME[a] + " Check", abilMod(a)); return; }
      if (t.hasAttribute("data-save")) { var s = t.getAttribute("data-save"); var pb = profBonus(); var prof = (S.saveProf || []).indexOf(s) !== -1; rollCheck(ABIL_NAME[s] + " Save", abilMod(s) + (prof ? pb : 0)); return; }
      if (t.hasAttribute("data-skill")) { rollCheck(titleCase(t.getAttribute("data-skill")) + " (" + SKILLS[t.getAttribute("data-skill")] + ")", parseInt(t.getAttribute("data-mod"), 10)); return; }
      if (t.classList.contains("roll-init")) { rollCheck("Initiative", (S.initiative != null ? S.initiative : abilMod("dex"))); return; }
      if (t.hasAttribute("data-atk-bonus")) { rollCheck("Attack — " + t.getAttribute("data-atk-name"), parseInt(t.getAttribute("data-atk-bonus"), 10)); return; }
      if (t.hasAttribute("data-dmg")) { rollDamage("Damage — " + t.getAttribute("data-dmg-name"), t.getAttribute("data-dmg")); return; }
      if (t.hasAttribute("data-spell-atk")) { rollCheck("Spell Attack", parseInt(t.getAttribute("data-spell-atk"), 10)); return; }
      // hp
      if (t.classList.contains("hp-dmg")) { adjustHp(-1, e.shiftKey ? 5 : 1); return; }
      if (t.classList.contains("hp-heal")) { adjustHp(1, e.shiftKey ? 5 : 1); return; }
      if (t.classList.contains("tmp-up")) { PS.temp++; save(); refreshHp(); return; }
      if (t.classList.contains("tmp-dn")) { PS.temp = Math.max(0, PS.temp - 1); save(); refreshHp(); return; }
      // hit dice
      if (t.hasAttribute("data-hd")) { spendHitDie(parseInt(t.getAttribute("data-hd"), 10)); return; }
      // slot pips
      if (t.hasAttribute("data-slot")) { toggleSlot(t.getAttribute("data-slot")); return; }
      // feature use pips
      if (t.hasAttribute("data-use")) { toggleUse(parseInt(t.getAttribute("data-use"), 10)); return; }
      // death saves — NOTE(season-of-magic)
      if (t.hasAttribute("data-ds")) {
        var kind = t.getAttribute("data-ds"), idx = parseInt(t.getAttribute("data-idx"), 10);
        // clicking pip n sets the count to n+1, or clears back to n when it was already on
        PS.death[kind] = (PS.death[kind] === idx + 1) ? idx : idx + 1;
        save(); render(); return;
      }
      if (t.classList.contains("ds-roll")) { rollDeathSave(); return; }
      if (t.classList.contains("insp-toggle")) {
        PS.inspiration = PS.inspiration ? 0 : 1; save(); render();
        setMsg("Heroic Inspiration", PS.inspiration ? "gained" : "spent", PS.inspiration ? "✦" : "—");
        return;
      }
      // spell tabs — switch visible level without a full re-render
      if (t.hasAttribute("data-spell-tab")) {
        var lv = t.getAttribute("data-spell-tab"); activeSpellTab = lv;
        var cardEl = t.closest(".sheet-card");
        cardEl.querySelectorAll(".spell-tab").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-spell-tab") === lv); });
        cardEl.querySelectorAll(".spell-list").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-spell-level") === lv); });
        return;
      }
      // feature category tabs
      if (t.hasAttribute("data-feat-tab")) {
        var fc = t.getAttribute("data-feat-tab"); activeFeatTab = fc;
        var fcard = t.closest(".sheet-card");
        fcard.querySelectorAll(".feat-tab").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-feat-tab") === fc); });
        fcard.querySelectorAll(".feat-list").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-feat-cat") === fc); });
        return;
      }
      // Attacks & Actions tabs
      if (t.hasAttribute("data-atk-tab")) {
        var ac = t.getAttribute("data-atk-tab"); activeAtkTab = ac;
        var acard = t.closest(".sheet-card");
        acard.querySelectorAll(".atk-tab").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-atk-tab") === ac); });
        acard.querySelectorAll(".atk-list").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-atk-cat") === ac); });
        return;
      }
      // turn tracker (Initiative opens it; buttons drive the action economy)
      if (t.classList.contains("econ-toggle")) { PS.econ.open = PS.econ.open ? 0 : 1; save(); render(); return; }
      if (t.hasAttribute("data-econ-btn")) { econBtn(t.getAttribute("data-econ-btn")); return; }
      // feature name — expand/collapse rules text; Trigger — use the feature
      if (t.hasAttribute("data-feat-expand")) { var ft = t.closest(".feature"); if (ft) ft.querySelector(".feat-body").classList.toggle("open"); return; }
      if (t.hasAttribute("data-feat-trigger")) { triggerFeature(parseInt(t.getAttribute("data-feat-trigger"), 10)); return; }
      // spell name — expand/collapse the full description
      if (t.hasAttribute("data-sp-expand")) { var sp = t.closest(".spell"); if (sp) sp.querySelector(".sp-body").classList.toggle("open"); return; }
      // upcast stepper — bump the chosen slot level up/down through available slots
      if (t.hasAttribute("data-cast-up") || t.hasAttribute("data-cast-down")) {
        var up = t.hasAttribute("data-cast-up");
        var ci = parseInt(t.getAttribute(up ? "data-cast-up" : "data-cast-down"), 10);
        var csp = ((S.spellcasting || {}).spells || [])[ci]; if (!csp) return;
        var cbase = csp.level || 0, cav = availLevels(cbase); if (!cav.length) return;
        var cur = targetLevel(ci, cbase);
        var higher = cav.filter(function (l) { return l > cur; });
        var lower = cav.filter(function (l) { return l < cur; });
        if (up && higher.length) castSel[ci] = higher[0];
        else if (!up && lower.length) castSel[ci] = lower[lower.length - 1];
        render(); return;
      }
      // cast — consume a slot (chosen level, else lowest available >= level) and roll the spell attack if relevant
      if (t.hasAttribute("data-sp-cast")) { castSpell(parseInt(t.getAttribute("data-sp-cast"), 10)); return; }
      // rest / reset
      if (t.classList.contains("btn-short")) { shortRest(); return; }
      if (t.classList.contains("btn-rest")) { longRest(); return; }
      if (t.classList.contains("ed-btn")) {
        var ne = t.getAttribute("data-ed");
        if (ne && ne !== curEd()) {
          PS.edition = ne;
          // whole-sheet swap when the page baked a per-edition sheet map (an
          // uploaded override still wins and is shown under both editions)
          if (SHEETS && !loadSheetOverride()) S = baseSheetFor(ne);
          save(); render();
        }
        return;
      }
      if (t.classList.contains("btn-dl")) { downloadJSON(); return; }
      if (t.classList.contains("btn-ul")) { var inp = document.getElementById("agm-upload"); if (inp) inp.click(); return; }
      if (t.classList.contains("btn-reset")) { if (confirm("Revert to the shipped character and clear all play-state?")) { try { localStorage.removeItem(KEY); localStorage.removeItem(SHEET_KEY); } catch (e) {} S = baseSheetFor(curEd()); PS = defaultState(); render(); } return; }
    });
  }

  function adjustHp(dir, amt) {
    if (dir < 0) {
      var dmg = amt;
      if (PS.temp > 0) { var absorbed = Math.min(PS.temp, dmg); PS.temp -= absorbed; dmg -= absorbed; }
      PS.hp = Math.max(0, PS.hp - dmg);
    } else {
      var wasDown = PS.hp <= 0;
      PS.hp = Math.min((S.hp && S.hp.max) || PS.hp + amt, PS.hp + amt);
      // NOTE(season-of-magic): any healing off 0 clears the death-save track
      if (wasDown && PS.hp > 0 && (PS.death.s || PS.death.f)) {
        PS.death = { s: 0, f: 0 }; save(); render(); return;
      }
    }
    save(); refreshHp();
  }
  // NOTE(season-of-magic): 10+ succeeds; a nat 20 pops you back up on 1 HP,
  // a nat 1 costs two failures. Three of either ends it.
  function rollDeathSave() {
    var v = d20();
    var note;
    if (v === 20) {
      PS.death = { s: 0, f: 0 }; PS.hp = Math.max(1, PS.hp);
      note = "Natural 20 — conscious at 1 HP";
    } else if (v === 1) {
      PS.death.f = Math.min(3, PS.death.f + 2); note = "Natural 1 — two failures";
    } else if (v >= 10) {
      PS.death.s = Math.min(3, PS.death.s + 1); note = "Success";
    } else {
      PS.death.f = Math.min(3, PS.death.f + 1); note = "Failure";
    }
    if (PS.death.s >= 3) note += " — stable";
    if (PS.death.f >= 3) note += " — dead";
    save(); render();
    setMsg("Death Save", note, v);
    logLine("Death save: " + v + " — " + note);
  }

  function refreshHp() {
    var cur = document.querySelector(".hp-cur"); if (cur) cur.textContent = PS.hp;
    var tmp = document.querySelector(".tmp-val"); if (tmp) tmp.textContent = PS.temp;
    var block = document.querySelector(".hp-block");
    if (block) block.classList.toggle("bloodied", PS.hp <= ((S.hp && S.hp.max) || 0) / 2);
    if (block) block.classList.toggle("down", PS.hp <= 0);
  }
  function spendHitDie(i) {
    var d = S.hitDice[i]; var used = PS.hitDice[i] || 0;
    if (used >= (d.total || 0)) { setMsg("No " + d.size + " hit dice left", "", "—"); return; }
    PS.hitDice[i] = used + 1; save();
    var sides = parseInt(d.size.replace("d", ""), 10);
    var conMod = abilMod("con");
    var v = 1 + Math.floor(Math.random() * sides);
    var heal = Math.max(0, v + conMod);
    PS.hp = Math.min((S.hp && S.hp.max) || (PS.hp + heal), PS.hp + heal);
    save();
    Dice.roll({ mount: trayDice, dice: [{ sides: sides, value: v, tag: "dmg" }, { sides: 1, value: conMod, tag: "mod" }], duration: 500 });
    setMsg("Hit Die " + d.size, "1" + d.size + " " + sgn(conMod) + " CON  =", heal + " healed");
    logLine("Spent " + d.size + ": healed " + heal);
    render(); // refresh availability & hp
  }
  function toggleSlot(lv) {
    var total = (S.spellcasting.slots[lv] || {}).total || 0;
    var used = PS.slots[lv] || 0;
    PS.slots[lv] = used >= total ? 0 : used + 1; // cast; wraps to restore-all when full
    save(); render();
  }
  function toggleUse(i) {
    var total = (S.features[i].uses || {}).max || 0;
    var used = PS.uses[i] || 0;
    PS.uses[i] = used >= total ? 0 : used + 1;
    save(); render();
  }
  function longRest() {
    PS.hp = (S.hp && S.hp.max) || PS.hp;
    PS.temp = 0;
    PS.death = { s: 0, f: 0 };   // NOTE(season-of-magic)
    Object.keys(PS.slots).forEach(function (k) { PS.slots[k] = 0; });
    Object.keys(PS.uses).forEach(function (k) { PS.uses[k] = 0; });
    // hit dice: recover half of total (5e), rounded down, min 1
    (S.hitDice || []).forEach(function (d, i) {
      var recover = Math.max(1, Math.floor((d.total || 0) / 2));
      PS.hitDice[i] = Math.max(0, (PS.hitDice[i] || 0) - recover);
    });
    save(); render();
    setMsg("Long Rest", "HP, slots &amp; uses restored", "✓");
  }
  function shortRest() {
    // features that recharge on a Short Rest (per text contains "Short")
    (S.features || []).forEach(function (f, i) {
      if (f.uses && /short/i.test(f.uses.per || "")) PS.uses[i] = 0;
    });
    // spell slots that recharge on a Short Rest (e.g. Warlock Pact Magic: slots[lv].recharge = "short")
    var slots = (S.spellcasting || {}).slots || {};
    Object.keys(slots).forEach(function (lv) { if (/short/i.test(slots[lv].recharge || "")) PS.slots[lv] = 0; });
    save(); render();
    setMsg("Short Rest", "short-rest features &amp; pact slots restored — spend Hit Dice to heal", "✓");
  }

  // ---- spells: availability + casting -------------------------------------
  var castSel = {}; // spell idx -> chosen slot level to cast at (transient, not persisted)
  function hasSlotFor(level) {
    var slots = (S.spellcasting || {}).slots || {};
    return Object.keys(slots).some(function (lv) {
      return parseInt(lv, 10) >= level && ((slots[lv].total || 0) - (PS.slots[lv] || 0)) > 0;
    });
  }
  function slotLevels() {
    return Object.keys((S.spellcasting || {}).slots || {}).map(Number).sort(function (a, c) { return a - c; });
  }
  function freeAt(lv) {
    var s = ((S.spellcasting || {}).slots || {})[lv] || {};
    return (s.total || 0) - (PS.slots[lv] || 0) > 0;
  }
  function availLevels(base) { return slotLevels().filter(function (l) { return l >= base && freeAt(l); }); }
  // level a spell will cast at: the player's bumped choice if still valid, else the lowest available >= base
  function targetLevel(idx, base) {
    if (castSel[idx] != null && castSel[idx] >= base && freeAt(castSel[idx])) return castSel[idx];
    var a = availLevels(base);
    return a.length ? a[0] : null;
  }
  function castSpell(idx) {
    var sc = S.spellcasting || {}; var sp = (sc.spells || [])[idx]; if (!sp) return;
    // spells with a choice of effect (e.g. Nazar the Evil Eye) prompt first
    var choice = null;
    if (sp.choices && sp.choices.length) {
      var menu = sp.choices.map(function (c, i) { return (i + 1) + ") " + c.label + (c.save ? "  [" + c.save + "]" : ""); }).join("\n");
      var pick = prompt("Choose an effect for " + sp.name + ":\n\n" + menu + "\n\nEnter 1–" + sp.choices.length + ":", "1");
      if (pick === null) return; // cancelled — no slot spent
      choice = sp.choices[(parseInt(pick, 10) || 1) - 1] || sp.choices[0];
    }
    var lvl = sp.level || 0, usedLv = null;
    if (lvl > 0) {
      usedLv = targetLevel(idx, lvl); // player's bump if chosen & valid, else lowest available >= base
      if (usedLv == null) { setMsg("Cast — " + sp.name, "no spell slot available", "—"); logLine("Cannot cast " + sp.name + " — no slot"); return; }
      PS.slots[usedLv] = (PS.slots[usedLv] || 0) + 1; castSel[idx] = null; save();
    }
    render(); // update slot pips & cast-button availability (tray + its roll persist)
    var slotTxt = usedLv ? " (Lvl " + usedLv + ")" : "";
    if (sp.attack) {
      var abil = sc.ability || "int";
      var atk = sc.attackBonus != null ? sc.attackBonus : profBonus() + abilMod(abil);
      rollCheck("Spell Attack — " + sp.name + slotTxt, atk);
    } else if (choice) {
      setMsg("Cast — " + sp.name, choice.label + (choice.save ? " · " + choice.save : ""), "✓");
      logLine("Cast " + sp.name + ": " + choice.label + slotTxt);
    } else {
      setMsg("Cast — " + sp.name, usedLv ? "Lvl " + usedLv + " slot spent" : "cantrip", "✓");
      logLine("Cast " + sp.name + (usedLv ? " (Lvl " + usedLv + " slot)" : ""));
    }
  }
  function triggerFeature(i) {
    var f = (S.features || [])[i]; if (!f) return;
    if (f.uses) {
      var used = PS.uses[i] || 0;
      if (used >= (f.uses.max || 0)) { setMsg("Trigger — " + f.name, "no uses left", "—"); logLine("No uses left: " + f.name); return; }
      PS.uses[i] = used + 1; save();
    }
    render(); // update use pips (tray + its roll persist)
    var roll = f.roll || f.damage || f.heal;
    if (roll) {
      rollDamage((f.heal ? "Heal — " : "Trigger — ") + f.name, String(roll).replace(/MOD/gi, ""));
    } else {
      var left = f.uses ? Math.max(0, (f.uses.max || 0) - (PS.uses[i] || 0)) + " left" : "";
      setMsg("Trigger — " + f.name, left, "✓");
      logLine("Triggered " + f.name);
    }
  }
  function econBtn(k) {
    var e = PS.econ;
    if (k === "take") { e.phase = "turn"; e.used.action = 0; e.used.bonus = 0; e.used.move = 0; }
    else if (k === "end") { e.phase = "pre"; e.used.reaction = 0; }
    else { e.used[k] = e.used[k] ? 0 : 1; } // toggle, so a mis-click can be undone
    save(); render();
  }
  function applyEcon() {
    var used = (PS.econ || {}).used || {};
    ["reaction", "action", "bonus", "move"].forEach(function (c) {
      var spent = !!used[c];
      document.querySelectorAll('[data-econ="' + c + '"]').forEach(function (elm) { elm.classList.toggle("econ-spent", spent); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
