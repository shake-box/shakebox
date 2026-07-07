/* ============================================================================
   Shakebox — app.js  (zero-build vanilla, no framework)
   Behavior/architecture per shakebox-build-spec.md (binding).
   Visuals per the design doc (reproduced in styles.css).
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "shakebox.v1";
  var DATA_VERSION = 1;
  var PIN_LENGTH = 4;
  var UNDO_MS = 5000;

  var seed = window.SHAKEBOX_SEED || { CATEGORIES: [], STARTER_TOYS: [], EMOJI_KEYWORDS: [] };

  var app = document.getElementById("app");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ============================= storage module ============================= */
  var storageOK = true; // flips false if localStorage throws (private Safari)
  var mem = null;        // in-memory blob when storage unavailable

  function freshBlob() {
    return {
      version: DATA_VERSION,
      settings: { pin: null, soundOn: true },
      toys: [],
      mutationsSinceExport: 0,
      lastExportAt: null,
      hints: { manageToysShown: false },
    };
  }

  function loadData() {
    // returns { data, wasFresh }
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOK = false;
      console.warn("Shakebox: localStorage unavailable — running in memory.", e);
      mem = freshBlob();
      return { data: mem, wasFresh: true };
    }
    if (raw == null) {
      return { data: freshBlob(), wasFresh: true };
    }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    if (!parsed || parsed.version !== DATA_VERSION || !Array.isArray(parsed.toys)) {
      // Unknown/unrecognized: keep a backup, start fresh (never wipe silently).
      try {
        window.localStorage.setItem(STORAGE_KEY + ".backup-" + Date.now(), raw || "");
        console.info("Shakebox: unrecognized save kept as a backup key; starting fresh.");
      } catch (e) {}
      return { data: freshBlob(), wasFresh: true };
    }
    // Fill any missing fields defensively.
    if (!parsed.settings) parsed.settings = { pin: null, soundOn: true };
    if (typeof parsed.settings.soundOn !== "boolean") parsed.settings.soundOn = true;
    if (!("pin" in parsed.settings)) parsed.settings.pin = null;
    if (typeof parsed.mutationsSinceExport !== "number") parsed.mutationsSinceExport = 0;
    if (!("lastExportAt" in parsed)) parsed.lastExportAt = null;
    if (!parsed.hints || typeof parsed.hints !== "object") parsed.hints = { manageToysShown: false };
    if (typeof parsed.hints.manageToysShown !== "boolean") parsed.hints.manageToysShown = false;
    return { data: parsed, wasFresh: false };
  }

  function save() {
    if (!storageOK) { mem = data; return; }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      storageOK = false;
      mem = data;
      console.warn("Shakebox: save failed — continuing in memory.", e);
      render();
    }
  }

  /* ============================== app data/state ============================== */
  var loaded = loadData();
  var data = loaded.data;

  var state = {
    view: "idle",       // idle|motion|shaking|reveal|empty|welcome|pin|vault|settings
    revealed: null,     // toy object currently revealed
    // parent/pin
    pinBuffer: "",
    pinShake: false,
    pinSetBuffer: "",   // used when setting a new PIN in settings
    settingPin: false,
    // vault
    vaultSearch: "",
    editingId: null,
    rowMenuId: null,
    undo: null,         // { toy, index, timer }
    // add sheet
    addOpen: false,
    addQuery: "",
    addSession: {},     // key(lowername) -> true for toys added during this sheet session
    addNet: 0,          // net toys added this session (for the counter)
    customEmoji: null,  // override for the typed-custom emoji
    emojiPickerOpen: false,
  };

  function id() { return "t_" + Math.random().toString(36).slice(2, 8); }
  function nowKey() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }
  function activeToys() { return data.toys.filter(function (t) { return t.active; }); }
  function bumpMutations(n) {
    data.mutationsSinceExport += (n || 1);
  }

  /* ================================ dom helpers ================================ */
  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;      // safe text (used for toy names)
        else if (k === "html") e.innerHTML = v;         // ONLY for trusted static icon markup
        else if (k === "onclick") e.addEventListener("click", v);
        else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
        else if (k === "style") e.setAttribute("style", v);
        else e.setAttribute(k, v);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null || c === false) return;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  // Trusted static icons (no user data ever flows here).
  var ICON = {
    soundOn: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"></path><path d="M16 8.5a5 5 0 0 1 0 7"></path></svg>',
    soundOff: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"></path><path d="M17 9l5 5M22 9l-5 5"></path></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.5-4.5"></path></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>',
    del: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5H8L2 12l6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"></path><path d="M14 9l-4 6M10 9l4 6"></path></svg>',
    chevron: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>',
  };
  function icon(name) { return h("span", { class: "ico", html: ICON[name], style: "display:flex" }); }

  function ball(opts) {
    opts = opts || {};
    var cls = "ball";
    if (opts.tap) cls += " tap";
    if (opts.breathe) cls += " breathe";
    if (opts.wobbling) cls += " wobbling";
    if (opts.motion) cls += " motion";
    if (opts.empty) cls += " empty-ball";
    var winChildren;
    if (opts.empty) {
      winChildren = h("div", { class: "empty-tri" }, h("span", { text: "Ask a grown-up to load the toy vault" }));
    } else {
      winChildren = h("span", { class: "ball__eight" }, "8");
    }
    var attrs = { class: cls };
    if (opts.tap) {
      attrs.role = "button";
      attrs.tabindex = "0";
      attrs["aria-label"] = "Shake the ball";
      attrs.onclick = opts.onTap;
      attrs.onkeydown = function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); opts.onTap(); }
      };
    }
    return h("div", attrs, [
      h("div", { class: "ball__spec" }),
      h("div", { class: "ball__win" }, winChildren),
    ]);
  }

  function flashEl(elem, cls) {
    if (!elem) return;
    elem.classList.remove(cls);
    void elem.offsetWidth; // reflow so the animation restarts
    elem.classList.add(cls);
    setTimeout(function () { elem.classList.remove(cls); }, 1000);
  }

  /* ================================== audio ================================== */
  var actx = null, noiseBuf = null;
  function ensureAudio() {
    if (actx || !data.settings.soundOn) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      var len = Math.floor(actx.sampleRate * 0.5);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
  }
  function resumeAudio() { if (actx && actx.state === "suspended") actx.resume(); }

  function playRattle(durationMs) {
    if (!data.settings.soundOn || !actx || !noiseBuf) return;
    resumeAudio();
    var t0 = actx.currentTime;
    var blips = Math.max(8, Math.round(durationMs / 150));
    for (var i = 0; i < blips; i++) {
      var at = t0 + (i / blips) * (durationMs / 1000) + Math.random() * 0.02;
      var src = actx.createBufferSource();
      src.buffer = noiseBuf;
      var bp = actx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400 + Math.random() * 1600;
      bp.Q.value = 0.9;
      var g = actx.createGain();
      var peak = 0.16 + Math.random() * 0.12;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      src.connect(bp); bp.connect(g); g.connect(actx.destination);
      src.start(at); src.stop(at + 0.08);
    }
  }
  function playThunk() {
    if (!data.settings.soundOn || !actx) return;
    resumeAudio();
    var t = actx.currentTime;
    var osc = actx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.3);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g); g.connect(actx.destination);
    osc.start(t); osc.stop(t + 0.45);
  }

  /* ================================= haptics ================================= */
  function vibrate(pattern) {
    try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch (e) {}
  }

  /* ============================= shake detection ============================= */
  // iOS-family signal: DeviceMotionEvent.requestPermission is a function.
  function isIOSMotion() {
    return typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function";
  }
  var motionAttached = false;
  var lastAcc = null;
  var strongTimes = [];
  var motionCooldownUntil = 0;

  function onDeviceMotion(ev) {
    var a = ev.acceleration && (ev.acceleration.x != null)
      ? ev.acceleration
      : ev.accelerationIncludingGravity;
    if (!a) return;
    if (lastAcc) {
      var delta = Math.abs((a.x || 0) - lastAcc.x) + Math.abs((a.y || 0) - lastAcc.y) + Math.abs((a.z || 0) - lastAcc.z);
      var t = ev.timeStamp || performance.now();
      if (delta > 14) strongTimes.push(t);
      // keep only the last ~1s of strong samples
      var cutoff = t - 1000;
      while (strongTimes.length && strongTimes[0] < cutoff) strongTimes.shift();
      if (state.view === "idle" && activeToys().length > 0 &&
          strongTimes.length >= 8 && t > motionCooldownUntil) {
        strongTimes = [];
        motionCooldownUntil = t + 2500;
        doShake();
      }
    }
    lastAcc = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
  }
  function attachMotion() {
    if (motionAttached) return;
    if (typeof DeviceMotionEvent === "undefined") return;
    window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
    motionAttached = true;
  }

  /* ============================== view switching ============================== */
  function show(view) { state.view = view; render(); }

  function kidEntry() {
    return activeToys().length === 0 ? "empty" : "idle";
  }

  function openParent() {
    // ⚙︎ → vault when no PIN; PIN pad first when set.
    if (data.settings.pin) { state.pinBuffer = ""; show("pin"); }
    else { closeRowMenu(); show("vault"); }
  }

  /* ================================ kid: shake ================================ */
  function pickToy() {
    var pool = activeToys();
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function recordPick(toy) {
    var t = data.toys.find(function (x) { return x.id === toy.id; });
    if (t) { t.lastPickedAt = Date.now(); t.pickCount = (t.pickCount || 0) + 1; }
    save();
  }

  function doShake() {
    if (activeToys().length === 0) { show("empty"); return; }
    ensureAudio();
    if (reducedMotion.matches) {
      // Reduced motion: no wobble/flood/confetti — cross-fade straight to the toy.
      state.revealed = pickToy();
      recordPick(state.revealed);
      vibrate(90);
      playThunk();
      show("reveal");
      return;
    }
    show("shaking");
    vibrate([30, 80, 30, 60, 40, 40, 50, 30, 60, 20]);
    playRattle(1800);
    setTimeout(function () {
      if (state.view !== "shaking") return; // user navigated away
      state.revealed = pickToy();
      recordPick(state.revealed);
      show("reveal");
      vibrate(90);
      playThunk();
    }, 1800);
  }

  // First tap on the ball in idle.
  function onBallTap() {
    ensureAudio();
    if (isIOSMotion() && !motionAttached && sessionStorage.getItem("shakebox.motionAsked") !== "1") {
      show("motion");
      return;
    }
    doShake();
  }

  function enableShake() {
    sessionStorage.setItem("shakebox.motionAsked", "1");
    if (isIOSMotion()) {
      DeviceMotionEvent.requestPermission().then(function (res) {
        if (res === "granted") { attachMotion(); doShake(); }
        else { show(kidEntry()); }
      }).catch(function () { show(kidEntry()); });
    } else {
      attachMotion();
      doShake();
    }
  }
  function skipMotion() {
    sessionStorage.setItem("shakebox.motionAsked", "1");
    show(kidEntry());
  }

  /* ================================ toy mutations ================================ */
  function addToy(name, emoji) {
    var t = {
      id: id(),
      name: name,
      emoji: emoji,
      active: true,
      createdAt: Date.now(),
      lastPickedAt: null,
      pickCount: 0,
    };
    data.toys.push(t);
    bumpMutations();
    save();
    return t;
  }
  function findByName(name) {
    var low = name.trim().toLowerCase();
    return data.toys.find(function (t) { return t.name.trim().toLowerCase() === low; });
  }
  function removeToyById(tid) {
    var idx = data.toys.findIndex(function (t) { return t.id === tid; });
    if (idx >= 0) {
      var removed = data.toys.splice(idx, 1)[0];
      bumpMutations();
      save();
      return { toy: removed, index: idx };
    }
    return null;
  }

  /* ============================== emoji guessing ============================== */
  function guessEmoji(name) {
    var low = (name || "").toLowerCase();
    for (var i = 0; i < seed.EMOJI_KEYWORDS.length; i++) {
      if (low.indexOf(seed.EMOJI_KEYWORDS[i].word) !== -1) return seed.EMOJI_KEYWORDS[i].emoji;
    }
    return "🎁";
  }

  /* ============================== screen: chrome ============================== */
  function wordmark() { return h("div", { class: "wordmark" }, "SHAKEBOX"); }
  function gearBtn() {
    return h("button", { class: "corner-btn left", "aria-label": "Settings", onclick: openParent }, "⚙");
  }
  function soundBtn() {
    return h("button", {
      class: "corner-btn right", "aria-label": "Toggle sound",
      onclick: function () {
        data.settings.soundOn = !data.settings.soundOn;
        if (data.settings.soundOn) ensureAudio();
        save(); render();
      },
      html: (data.settings.soundOn ? ICON.soundOn : ICON.soundOff),
    });
  }

  /* ============================== screen builders ============================== */
  function screenIdle() {
    return h("div", { class: "screen on" }, [
      wordmark(), gearBtn(), soundBtn(),
      h("div", { class: "center-stack" }, [
        ball({ tap: true, breathe: true, onTap: onBallTap }),
        h("div", { class: "hint" }, "Shake it"),
      ]),
    ]);
  }

  function screenMotion() {
    return h("div", { class: "screen on" }, [
      wordmark(),
      h("div", { class: "center-stack", style: "gap:40px" }, [
        ball({ tap: true, breathe: true, motion: true, onTap: enableShake }),
        h("div", { class: "motion-card" }, [
          h("div", { class: "motion-card__title" }, "Want to really shake it?"),
          h("div", { class: "motion-card__sub" }, "Turn on motion so a real shake sets it off."),
          h("button", { class: "btn-primary", onclick: enableShake }, "Enable shake"),
          h("button", { class: "link-quiet", onclick: skipMotion }, "or just tap the ball anytime"),
        ]),
      ]),
    ]);
  }

  function screenShaking() {
    return h("div", { class: "screen on" }, [
      h("div", { class: "bgvibe", style: "position:absolute;inset:0" }, [
        wordmark(),
        h("div", { class: "center-stack" }, [
          ball({ wobbling: true }),
          h("div", { class: "hint dim" }, "Shaking…"),
        ]),
      ]),
    ]);
  }

  function screenReveal() {
    var toy = state.revealed || { emoji: "🎁", name: "" };
    var reduced = reducedMotion.matches;
    var children = [
      h("div", { class: "reveal__grain" }),
      h("div", { class: "reveal__vignette" }),
    ];
    if (!reduced) {
      children.push(h("div", { class: "reveal__confetti" }, h("div", {}, [
        h("span", { class: "conf c1" }), h("span", { class: "conf c2" }), h("span", { class: "conf c3" }),
        h("span", { class: "conf c4" }), h("span", { class: "conf c5" }), h("span", { class: "conf c6" }),
      ])));
    }
    var tokenCls = "token" + (reduced ? "" : " pop");
    var token = h("div", { class: tokenCls }, [
      h("div", { class: "token__glow" }),
      h("div", { class: "token__tri" }, [
        h("span", { class: "token__emoji", text: toy.emoji }),
        h("span", { class: "token__name", text: toy.name }),
      ]),
    ]);
    children.push(h("div", { class: "reveal__stage" }, token));
    children.push(h("div", { class: "reveal__actions" }, [
      h("button", { class: "btn-light", onclick: function () { show(kidEntry()); } }, "Go play"),
      h("button", { class: "btn-ghost", onclick: doShake }, "Shake again"),
    ]));
    var reveal = h("div", { class: "reveal " + (reduced ? "xfade" : "flood") }, children);
    if (!reduced) {
      // token floats after its spring-in completes
      setTimeout(function () { token.classList.add("float"); }, 620);
    }
    return h("div", { class: "screen on" }, reveal);
  }

  function screenEmpty() {
    return h("div", { class: "screen on" }, [
      wordmark(),
      h("button", { class: "corner-btn left", "aria-label": "Settings", onclick: openParent }, "⚙"),
      h("div", { class: "center-stack", style: "gap:36px" }, [
        ball({ empty: true, breathe: true }),
        h("div", { class: "empty__actions" }, [
          h("div", { class: "empty__sub" }, "The vault is empty."),
          h("button", { class: "link-underline", onclick: openParent }, "I'm the grown-up"),
        ]),
      ]),
    ]);
  }

  function screenWelcome() {
    return h("div", { class: "screen on" }, [
      h("div", { class: "welcome" }, [
        ball({ breathe: true }),
        h("div", { class: "welcome__brand" }, "SHAKEBOX"),
        h("div", { class: "welcome__title" }, "Load the toy vault"),
        h("div", { class: "welcome__sub" }, "Add everything, even the stuff at the back of the closet."),
      ]),
      h("div", { class: "welcome__cta" }, [
        h("button", { class: "btn-primary", onclick: function () { openAddSheet(); } }, "Start adding toys"),
        h("div", { class: "welcome__foot" }, "Pick from the starter pack — about five minutes for 25 toys."),
      ]),
    ]);
  }

  /* --------------------------------- PIN gate --------------------------------- */
  function pinPress(dgt) {
    if (state.pinBuffer.length >= PIN_LENGTH) return;
    state.pinBuffer += dgt;
    if (state.pinBuffer.length === PIN_LENGTH) {
      if (state.pinBuffer === String(data.settings.pin)) {
        state.pinBuffer = "";
        show("vault");
      } else {
        state.pinShake = true;
        render();
        setTimeout(function () { state.pinBuffer = ""; state.pinShake = false; render(); }, 450);
        return;
      }
    }
    render();
  }
  function pinDelete() { state.pinBuffer = state.pinBuffer.slice(0, -1); render(); }

  function screenPin() {
    var dots = [];
    for (var i = 0; i < PIN_LENGTH; i++) {
      dots.push(h("div", { class: "dot" + (i < state.pinBuffer.length ? " filled" : "") }));
    }
    var keys = [];
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (d) {
      keys.push(h("button", { class: "key", onclick: function () { pinPress(d); } }, d));
    });
    keys.push(h("div"));
    keys.push(h("button", { class: "key", onclick: function () { pinPress("0"); } }, "0"));
    keys.push(h("button", { class: "key key--del", "aria-label": "Delete", onclick: pinDelete, html: ICON.del }));

    var forgotArea = h("div", { class: "pin__forgot-wrap" },
      h("button", { class: "pin__forgot" }, "Forgot PIN"));
    // Hold 5s → inline "type RESET" confirm (clears only the PIN).
    wireForgot(forgotArea.firstChild, forgotArea);

    return h("div", { class: "screen on flex pin" }, [
      h("div", { class: "pin__head" },
        h("button", { class: "backbtn", "aria-label": "Back", onclick: function () { state.pinBuffer = ""; show(kidEntry()); }, html: ICON.back })),
      h("div", { class: "pin__body" }, [
        h("div", { class: "pin__brand" }, "SHAKEBOX"),
        h("div", { class: "pin__title" }, "Parents only"),
        h("div", { class: "pin__sub" }, "Enter your PIN"),
        h("div", { class: "pin__dots" + (state.pinShake ? " shake" : "") }, dots),
        h("div", { class: "pin__note" }, "This keeps kids out. It isn't a bank vault."),
      ]),
      h("div", { class: "pinpad" }, h("div", { class: "pinpad__grid" }, keys)),
      forgotArea,
    ]);
  }

  function wireForgot(btn, wrap) {
    var timer = null;
    function start() {
      timer = setTimeout(function () { showResetConfirm(wrap); }, 5000);
    }
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("pointercancel", cancel);
  }
  function showResetConfirm(wrap) {
    wrap.textContent = "";
    var input = h("input", {
      type: "text", placeholder: "Type RESET", autocapitalize: "characters",
      style: "width:180px;height:44px;border-radius:11px;border:1px solid rgba(20,22,31,.2);background:#fff;text-align:center;font-family:'Schibsted Grotesk',sans-serif;font-size:15px;letter-spacing:.1em;text-transform:uppercase;",
    });
    input.addEventListener("input", function () {
      if (input.value.trim().toUpperCase() === "RESET") {
        data.settings.pin = null; // clears only the PIN, never toys
        save();
        state.pinBuffer = "";
        show("vault");
      }
    });
    wrap.appendChild(h("div", { style: "font-size:13px;color:rgba(20,22,31,.55);margin-bottom:10px" }, "Clear the PIN? Type RESET to confirm. Your toys are safe."));
    wrap.appendChild(input);
    input.focus();
  }

  /* --------------------------------- toy vault --------------------------------- */
  function toyRow(toy) {
    if (state.editingId === toy.id) {
      var input = h("input", {
        type: "text", value: toy.name, class: "toy-edit",
        style: "flex:1;min-width:0;border:1px solid var(--oracle);border-radius:9px;height:38px;padding:0 10px;font-family:'Schibsted Grotesk',sans-serif;font-size:16px;font-weight:500;background:#fff;color:var(--ink);",
      });
      function commit() {
        var v = input.value.trim();
        if (!v) { state.editingId = null; render(); return; }
        var dup = findByName(v);
        if (dup && dup.id !== toy.id) {
          state.editingId = null; render();
          setTimeout(function () { flashRow(dup.id); }, 20);
          return;
        }
        if (v !== toy.name) { toy.name = v; bumpMutations(); save(); }
        state.editingId = null; render();
      }
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") { state.editingId = null; render(); }
      });
      input.addEventListener("blur", commit);
      var rowEdit = h("div", { class: "toy-row" }, [
        h("div", { class: "toy-row__emoji", text: toy.emoji }),
        input,
        h("button", { class: "icon-btn", "aria-label": "Save", style: "color:var(--oracle)", html: ICON.check, onclick: commit }),
      ]);
      setTimeout(function () { input.focus(); input.select(); }, 20);
      return rowEdit;
    }

    var nameWrap = h("div", { class: "toy-row__namewrap" }, [
      h("div", { class: "toy-row__name", text: toy.name }),
    ]);
    if (!toy.active) nameWrap.appendChild(h("span", { class: "badge-paused" }, "Paused"));

    var sw = h("button", {
      class: "switch" + (toy.active ? "" : " off"),
      "aria-label": toy.active ? "Pause toy" : "Activate toy",
      onclick: function () { toy.active = !toy.active; bumpMutations(); save(); render(); },
    }, h("div", { class: "switch__knob" }));

    var menuBtn = h("button", {
      class: "row-menu", "aria-label": "More", onclick: function (ev) {
        ev.stopPropagation();
        state.rowMenuId = (state.rowMenuId === toy.id ? null : toy.id);
        render();
      },
    }, "⋯");

    var row = h("div", { class: "toy-row" + (toy.active ? "" : " paused"), "data-id": toy.id }, [
      h("div", { class: "toy-row__emoji", text: toy.emoji }),
      nameWrap, sw, menuBtn,
    ]);

    if (state.rowMenuId === toy.id) {
      var pop = h("div", { class: "rowpop", style: "right:14px;margin-top:4px" }, [
        h("button", { html: ICON.edit + "<span>Edit name</span>", onclick: function () { state.rowMenuId = null; state.editingId = toy.id; render(); } }),
        h("button", { class: "danger", html: ICON.trash + "<span>Delete</span>", onclick: function () { state.rowMenuId = null; deleteWithUndo(toy.id); } }),
      ]);
      var host = h("div", { style: "position:relative" }, [row, pop]);
      return host;
    }
    return row;
  }

  function flashRow(tid) {
    var elem = app.querySelector('.toy-row[data-id="' + tid + '"]');
    flashEl(elem, "flash");
  }

  function deleteWithUndo(tid) {
    var res = removeToyById(tid);
    if (!res) return;
    if (state.undo && state.undo.timer) clearTimeout(state.undo.timer);
    state.undo = { toy: res.toy, index: res.index, timer: null };
    state.undo.timer = setTimeout(function () { state.undo = null; render(); }, UNDO_MS);
    render();
  }
  function undoDelete() {
    if (!state.undo) return;
    var u = state.undo;
    clearTimeout(u.timer);
    data.toys.splice(Math.min(u.index, data.toys.length), 0, u.toy);
    data.mutationsSinceExport = Math.max(0, data.mutationsSinceExport - 1); // undo the mutation count too
    save();
    state.undo = null;
    render();
  }

  function closeRowMenu() { state.rowMenuId = null; }

  function screenVault() {
    var toys = data.toys;
    var showSearch = toys.length > 10;
    var q = state.vaultSearch.trim().toLowerCase();
    var list = q ? toys.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }) : toys;

    var head = h("div", { class: "vault__head" },
      h("div", { class: "vault__head-row" }, [
        h("button", { class: "backbtn sm", "aria-label": "Back", onclick: function () { closeRowMenu(); show(kidEntry()); }, html: ICON.back }),
        h("div", { class: "vault__title" }, "Toy vault"),
        h("div", { class: "vault__count" }, "· " + toys.length + " " + (toys.length === 1 ? "toy" : "toys")),
        h("div", { style: "flex:1" }),
        h("button", { class: "icon-btn", "aria-label": "Settings", onclick: function () { closeRowMenu(); show("settings"); } }, "⚙"),
      ]));

    var addBtn = h("div", { class: "vault__add" },
      h("button", { class: "btn-add", onclick: function () { openAddSheet(); } }, [icon("plus"), "Add a toy"]));

    var kids = [head, addBtn];

    if (showSearch) {
      var searchInput = h("input", {
        type: "text", placeholder: "Search toys", value: state.vaultSearch,
        "aria-label": "Search toys",
      });
      searchInput.addEventListener("input", function () {
        state.vaultSearch = searchInput.value;
        renderVaultList(listWrap);
      });
      kids.push(h("div", { class: "vault__searchwrap" }, h("div", { class: "searchbar" }, [icon("search"), searchInput])));
    }

    var listWrap = h("div", { class: "vault__list" });
    kids.push(listWrap);

    var screen = h("div", { class: "screen on flex vault" }, kids);
    // render the rows into listWrap
    renderVaultListRows(listWrap, list);
    if (state.undo) screen.appendChild(undoSnackbar());
    return screen;
  }

  function renderVaultList(listWrap) {
    var toys = data.toys;
    var q = state.vaultSearch.trim().toLowerCase();
    var list = q ? toys.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }) : toys;
    renderVaultListRows(listWrap, list);
  }
  function renderVaultListRows(listWrap, list) {
    listWrap.textContent = "";
    if (list.length === 0) {
      listWrap.appendChild(h("div", { class: "vault__empty" },
        data.toys.length === 0 ? "No toys yet. Tap “Add a toy” to fill the vault." : "No toys match that search."));
      return;
    }
    list.forEach(function (t) { listWrap.appendChild(toyRow(t)); });
  }

  function undoSnackbar() {
    return h("div", { class: "snackbar" }, [
      h("span", { class: "snackbar__msg", text: "Removed " + state.undo.toy.name }),
      h("button", { class: "snackbar__btn", onclick: undoDelete }, "Undo"),
    ]);
  }

  /* -------------------------------- add-a-toy sheet -------------------------------- */
  function openAddSheet() {
    state.addOpen = true;
    state.addQuery = "";
    state.addSession = {};
    state.addNet = 0;
    state.customEmoji = null;
    state.emojiPickerOpen = false;
    if (state.view !== "vault") state.view = "vault";
    render();
    // focus the field after mount
    setTimeout(function () {
      var inp = app.querySelector(".add-search input");
      if (inp) inp.focus();
    }, 30);
  }
  function closeAddSheet() {
    state.addOpen = false;
    render();
  }

  function chipKey(name) { return name.trim().toLowerCase(); }

  function toggleStarter(item, chipEl) {
    var existing = findByName(item.name);
    if (existing) {
      // Already in the vault → tapping removes it (toggle behavior).
      removeToyById(existing.id);
      delete state.addSession[chipKey(item.name)];
      state.addNet = Math.max(0, state.addNet - 1);
    } else {
      addToy(item.name, item.emoji);
      state.addSession[chipKey(item.name)] = true;
      state.addNet += 1;
    }
    updateAddBody();
  }

  function addCustom() {
    var name = state.addQuery.trim();
    if (!name) return;
    var dup = findByName(name);
    if (dup) {
      // Don't create a second — flash the matching chip if visible.
      var el = findChipEl(name);
      if (el) flashEl(el, "flash");
      return;
    }
    var emoji = state.customEmoji || guessEmoji(name);
    addToy(name, emoji);
    state.addSession[chipKey(name)] = true;
    state.addNet += 1;
    state.addQuery = "";
    state.customEmoji = null;
    var inp = app.querySelector(".add-search input");
    if (inp) inp.value = "";
    updateAddBody();
  }

  function findChipEl(name) {
    var key = chipKey(name);
    var chips = app.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute("data-key") === key) return chips[i];
    }
    return null;
  }

  function buildAddBody() {
    var wrap = h("div", { class: "add-body" });
    fillAddBody(wrap);
    return wrap;
  }
  function updateAddBody() {
    var wrap = app.querySelector(".add-body");
    var counter = app.querySelector(".add-counter");
    if (counter) counter.textContent = state.addNet + " added";
    if (wrap) fillAddBody(wrap);
  }
  function fillAddBody(wrap) {
    wrap.textContent = "";
    var q = state.addQuery.trim().toLowerCase();
    var anyMatch = false;

    seed.CATEGORIES.forEach(function (cat) {
      var items = seed.STARTER_TOYS.filter(function (t) { return t.category === cat; });
      if (q) items = items.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; });
      if (items.length === 0) return;
      anyMatch = true;
      wrap.appendChild(h("div", { class: "chip-group__label" }, cat));
      var chips = h("div", { class: "chips" });
      items.forEach(function (item) {
        var added = !!findByName(item.name);
        var chip;
        if (added) {
          chip = h("button", { class: "chip added", "data-key": chipKey(item.name), onclick: function () { toggleStarter(item); } }, [
            h("span", { class: "chip__emoji", text: item.emoji }),
            h("span", { text: item.name }),
            h("span", { class: "chip__check", html: ICON.check }),
          ]);
        } else {
          chip = h("button", { class: "chip", "data-key": chipKey(item.name), onclick: function () { toggleStarter(item); } }, [
            h("span", { class: "chip__emoji", text: item.emoji }),
            h("span", { text: item.name }),
          ]);
        }
        chips.appendChild(chip);
      });
      wrap.appendChild(chips);
    });

    // No starter match for typed text → offer a custom add.
    if (q && !anyMatch) {
      var typed = state.addQuery.trim();
      var emoji = state.customEmoji || guessEmoji(typed);
      wrap.appendChild(h("div", { class: "chip-group__label" }, "Not in the starter pack"));
      var customBtn = h("button", { class: "add-custom__btn", onclick: addCustom }, [
        h("span", { class: "add-custom__label" }, ["Add “", document.createTextNode(typed), "”"]),
        h("span", { class: "add-custom__emoji", text: emoji }),
      ]);
      var changeBtn = h("button", { class: "add-custom__change", onclick: function (ev) { ev.stopPropagation(); openEmojiPicker(); } }, "change emoji");
      var bar = h("div", { class: "add-custom" }, [customBtn, changeBtn]);
      wrap.appendChild(bar);
      if (state.emojiPickerOpen) wrap.appendChild(emojiPicker());
    }
  }

  var PICKER_EMOJIS = ["🎁","🧸","🚗","🚂","✈️","🚀","⚽","🏀","🎨","🖍️","🧩","🎲","🃏","🤖","🦖","🐶","🐱","🦄","🎮","📱","🎸","🥁","🪀","🎯","🪁","🛹","🧱","🧲","🔧","🪆","👑","🩺","🫖","🍳","📷","🎧","⌚","🦕","🐰","🌀"];
  function openEmojiPicker() { state.emojiPickerOpen = !state.emojiPickerOpen; updateAddBody(); }
  function emojiPicker() {
    var grid = h("div", { class: "emoji-pop", style: "position:relative;margin-top:10px;width:100%;grid-template-columns:repeat(8,1fr)" });
    PICKER_EMOJIS.forEach(function (em) {
      grid.appendChild(h("button", { text: em, onclick: function () { state.customEmoji = em; state.emojiPickerOpen = false; updateAddBody(); } }));
    });
    return grid;
  }

  function addSheet() {
    var behind = h("div", { class: "sheet-overlay__behind" }); // dimmed vault peeking through (decorative)
    var scrim = h("div", { class: "sheet-scrim", onclick: closeAddSheet });

    var searchInput = h("input", { type: "text", placeholder: "Toy name or search", "aria-label": "Toy name or search", autocomplete: "off" });
    searchInput.addEventListener("input", function () {
      state.addQuery = searchInput.value;
      state.customEmoji = null;
      state.emojiPickerOpen = false;
      updateAddBody();
    });
    searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        var q = state.addQuery.trim();
        if (!q) return;
        // Enter adds: prefer an exact starter match, else custom.
        var starter = seed.STARTER_TOYS.find(function (t) { return t.name.toLowerCase() === q.toLowerCase(); });
        if (starter && !findByName(starter.name)) { toggleStarter(starter); searchInput.value = ""; state.addQuery = ""; updateAddBody(); }
        else addCustom();
      }
    });

    var top = h("div", { class: "sheet__top" }, [
      h("div", { class: "sheet__grip" }),
      h("div", { class: "sheet__titlerow" }, [
        h("div", { class: "sheet__title" }, "Add a toy"),
        h("div", { style: "flex:1" }),
        h("div", { class: "add-counter" }, state.addNet + " added"),
      ]),
      h("div", { class: "add-search" }, [icon("search"), searchInput]),
    ]);

    var footer = h("div", { class: "sheet__footer" }, h("button", { class: "btn-ink", onclick: closeAddSheet }, "Done"));

    var sheet = h("div", { class: "sheet" }, [top, buildAddBody(), footer]);
    return h("div", { class: "sheet-overlay" }, [behind, scrim, sheet]);
  }

  /* --------------------------------- settings --------------------------------- */
  function screenSettings() {
    var soundRow = h("div", { class: "row" }, [
      h("div", { class: "row__main" }, h("div", { class: "row__label" }, "Sound")),
      h("button", {
        class: "switch lg" + (data.settings.soundOn ? "" : " off"), "aria-label": "Toggle sound",
        onclick: function () { data.settings.soundOn = !data.settings.soundOn; if (data.settings.soundOn) ensureAudio(); save(); render(); },
      }, h("div", { class: "switch__knob" })),
    ]);

    var pinOn = !!data.settings.pin;
    var pinRow = h("div", { class: "row" }, [
      h("div", { class: "row__main" }, [
        h("div", { class: "row__label" }, "Parent PIN"),
        h("div", { class: "row__sub" }, "Optional — stops kids from editing the toy vault"),
      ]),
      h("button", {
        class: "switch lg" + (pinOn || state.settingPin ? "" : " off"), "aria-label": "Toggle parent PIN",
        onclick: function () {
          if (pinOn) { data.settings.pin = null; state.settingPin = false; save(); render(); }
          else { state.settingPin = !state.settingPin; state.pinSetBuffer = ""; render(); }
        },
      }, h("div", { class: "switch__knob" })),
    ]);

    var pinCard = h("div", { class: "card" }, [soundRow, pinRow]);

    if (state.settingPin && !pinOn) {
      var setInput = h("input", {
        type: "text", inputmode: "numeric", maxlength: String(PIN_LENGTH),
        placeholder: "Set a " + PIN_LENGTH + "-digit PIN", "aria-label": "New PIN",
      });
      setInput.addEventListener("input", function () {
        setInput.value = setInput.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
        state.pinSetBuffer = setInput.value;
        if (state.pinSetBuffer.length === PIN_LENGTH) {
          data.settings.pin = state.pinSetBuffer;
          state.settingPin = false; state.pinSetBuffer = "";
          save(); render();
        }
      });
      pinCard.appendChild(h("div", { class: "setpin-row" }, setInput));
      setTimeout(function () { setInput.focus(); }, 20);
    }
    if (pinOn) {
      pinCard.appendChild(h("div", { class: "pin-actions" }, [
        h("button", { class: "alt", onclick: function () { data.settings.pin = null; state.settingPin = true; state.pinSetBuffer = ""; save(); render(); } }, "Change PIN"),
        h("button", { class: "off", onclick: function () { data.settings.pin = null; save(); render(); } }, "Turn off PIN"),
      ]));
    }

    var backupCard = h("div", { class: "card" }, [
      h("div", { class: "row tappable", onclick: downloadBackup }, [
        h("div", { class: "row__main" }, [
          h("div", { class: "row__label" }, "Download backup"),
          h("div", { class: "row__sub" }, "Save the toy list as a file"),
        ]),
        h("span", { class: "chevron", html: ICON.chevron }),
      ]),
      h("div", { class: "row tappable", onclick: pickRestoreFile }, [
        h("div", { class: "row__main" }, [
          h("div", { class: "row__label" }, "Restore backup"),
          h("div", { class: "row__sub" }, "Import from a backup file"),
        ]),
        h("span", { class: "chevron", html: ICON.chevron }),
      ]),
    ]);

    var note = h("div", { class: "storage-note" },
      "Everything lives on this device only. Shakebox has no account and no server — your toy list never leaves this browser. Download a backup after big changes; one tap restores it.");

    return h("div", { class: "screen on flex settings" }, [
      h("div", { class: "settings__head" }, h("div", { class: "settings__head-row" }, [
        h("button", { class: "backbtn sm", "aria-label": "Back", onclick: function () { state.settingPin = false; show("vault"); }, html: ICON.back }),
        h("div", { class: "settings__title" }, "Settings"),
      ])),
      h("div", { class: "settings__body" }, [pinCard, backupCard, note]),
    ]);
  }

  /* --------------------------------- backup i/o --------------------------------- */
  function downloadBackup() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "shakebox-backup-" + nowKey() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    data.mutationsSinceExport = 0;
    data.lastExportAt = Date.now();
    save();
    toast("Backup downloaded");
    render();
  }
  function pickRestoreFile() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.addEventListener("change", function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || typeof parsed !== "object" || !("version" in parsed) || !Array.isArray(parsed.toys)) {
            throw new Error("shape");
          }
          var ok = parsed.toys.every(function (t) { return t && typeof t === "object" && typeof t.name === "string"; });
          if (!ok) throw new Error("toys");
          // Normalize toys so imported records are complete.
          parsed.toys = parsed.toys.map(function (t) {
            return {
              id: typeof t.id === "string" ? t.id : id(),
              name: t.name,
              emoji: typeof t.emoji === "string" && t.emoji ? t.emoji : guessEmoji(t.name),
              active: t.active !== false,
              createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
              lastPickedAt: typeof t.lastPickedAt === "number" ? t.lastPickedAt : null,
              pickCount: typeof t.pickCount === "number" ? t.pickCount : 0,
            };
          });
          if (!parsed.settings || typeof parsed.settings !== "object") parsed.settings = { pin: null, soundOn: true };
          if (typeof parsed.settings.soundOn !== "boolean") parsed.settings.soundOn = true;
          if (!("pin" in parsed.settings)) parsed.settings.pin = null;
          parsed.version = DATA_VERSION;
          parsed.mutationsSinceExport = 0;
          parsed.lastExportAt = Date.now();
          data = parsed;
          save();
          toast("Restored " + data.toys.length + " " + (data.toys.length === 1 ? "toy" : "toys"));
          render();
        } catch (e) {
          toast("That file didn't look like a Shakebox backup.", true);
        }
      };
      reader.onerror = function () { toast("Couldn't read that file.", true); };
      reader.readAsText(file);
    });
    inp.click();
  }

  /* ---------------------------------- toast ---------------------------------- */
  var toastTimer = null;
  function toast(msg, isError) {
    var existing = app.querySelector(".snackbar.toast");
    if (existing) existing.remove();
    var bar = h("div", { class: "snackbar toast", style: (isError ? "background:#8a1420" : "") },
      h("span", { class: "snackbar__msg", text: msg }));
    app.appendChild(bar);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (bar.parentNode) bar.remove(); }, 2600);
  }

  /* ============================ one-time coach mark ============================ */
  // First time on the kid screen (which, for a fresh user, is right after
  // onboarding), point out the quiet ⚙ so grown-ups can find their way back to
  // the vault. Shown once per device, then never again.
  function maybeCoachMark() {
    if (data.hints.manageToysShown) return;
    var mark = h("div", { class: "coach" }, "Add or manage toys here");
    app.appendChild(mark);
    data.hints.manageToysShown = true;
    save();
    var t;
    function dismiss() {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onTap, true);
      mark.classList.add("leaving");
      setTimeout(function () { if (mark.parentNode) mark.remove(); }, 400);
    }
    function onTap() { dismiss(); }
    t = setTimeout(dismiss, 5000);
    // delay the outside-tap listener a tick so the tap that navigated here
    // doesn't instantly close it
    setTimeout(function () { document.addEventListener("pointerdown", onTap, true); }, 60);
  }

  /* =============================== master render =============================== */
  function render() {
    app.textContent = "";
    var view = state.view;
    var screen;
    switch (view) {
      case "idle": screen = screenIdle(); break;
      case "motion": screen = screenMotion(); break;
      case "shaking": screen = screenShaking(); break;
      case "reveal": screen = screenReveal(); break;
      case "empty": screen = screenEmpty(); break;
      case "welcome": screen = screenWelcome(); break;
      case "pin": screen = screenPin(); break;
      case "vault": screen = screenVault(); break;
      case "settings": screen = screenSettings(); break;
      default: screen = screenIdle();
    }
    app.appendChild(screen);
    if (state.addOpen && (view === "vault" || view === "welcome")) {
      app.appendChild(addSheet());
    }
    if (view === "idle" || view === "empty") maybeCoachMark();
    if (!storageOK) {
      app.appendChild(h("div", { class: "storage-warn" },
        "Can't save on this device — toys will be forgotten when you close the app."));
    }
  }

  /* ============================ global click-away ============================ */
  document.addEventListener("click", function (ev) {
    // close row menu when clicking elsewhere
    if (state.rowMenuId && !ev.target.closest(".rowpop") && !ev.target.closest(".row-menu")) {
      state.rowMenuId = null; render();
    }
  }, true);

  // keep the reveal float / reduced-motion in sync if the OS setting changes mid-session
  reducedMotion.addEventListener && reducedMotion.addEventListener("change", function () {
    if (state.view === "idle" || state.view === "empty") render();
  });

  /* ================================== init ================================== */
  function init() {
    // Non-iOS: attach devicemotion directly (progressive enhancement).
    if (!isIOSMotion()) attachMotion();
    if (loaded.wasFresh && data.toys.length === 0) {
      state.view = "welcome";
    } else {
      state.view = kidEntry();
    }
    render();
  }
  init();

  // expose a tiny hook for debugging/inspection (no functional dependency)
  window.__shakebox = { get data() { return data; }, get state() { return state; } };
})();
