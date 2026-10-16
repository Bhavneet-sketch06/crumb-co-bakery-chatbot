/**
 * SALES DESK CHAT WIDGET
 * Add to any website (HTML, WordPress, Wix custom code) before </body>:
 *
 *   <script>
 *     window.SalesDeskConfig = { endpoint: "https://YOUR-WORKER.workers.dev/chat" };
 *   </script>
 *   <script src="chat-widget.js"></script>
 *
 * Optional settings: title, subtitle, greeting, quickReplies, launcherLabel,
 * fallbackContact (phone/email shown if the chat fails), enquiryNextStep (text on
 * the enquiry card, e.g. "The team will reply within 24 hours."),
 * showStructuredData (true = show the data the owner receives;
 * good for class demos). Colours follow these CSS variables if the site sets them:
 * --sd-accent, --sd-accent-ink, --sd-bg, --sd-surface, --sd-ink, --sd-muted, --sd-rule
 *
 * Other scripts on the page can call SalesDesk.open() or SalesDesk.open("message").
 */
(function () {
  "use strict";
  if (window.SalesDesk) return;

  var cfg = Object.assign({
    endpoint: "",
    title: "Sales desk",
    subtitle: "Automated assistant. Enquiries go to our team.",
    greeting: "Hello. I can help you find parts, explain our terms, or send a quote request to our team. What are you looking for?",
    quickReplies: ["Browse products", "Wholesale and export terms", "Office hours and location", "Request a quote"],
    launcherLabel: "Chat with sales",
    fallbackContact: "",
    enquiryNextStep: "The team will reply, usually within 24 working hours.",
    showStructuredData: false,
    storageKey: "salesdesk"
  }, window.SalesDeskConfig || {});

  // ---------- storage (fails safely) ----------
  function load(key, fallback) {
    try { var v = sessionStorage.getItem(cfg.storageKey + ":" + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { sessionStorage.setItem(cfg.storageKey + ":" + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---------- session + ad tracking ----------
  var sessionId = load("session", null);
  if (!sessionId) {
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    save("session", sessionId);
  }
  var utm = load("utm", null);
  if (!utm) {
    var q = new URLSearchParams(location.search);
    utm = {};
    ["source", "medium", "campaign", "content", "term"].forEach(function (k) {
      var v = q.get("utm_" + k); if (v) utm[k] = v;
    });
    save("utm", utm); // first visit's source is kept for the whole session
  }
  var firstReferrer = load("referrer", null);
  if (firstReferrer === null) { firstReferrer = document.referrer || ""; save("referrer", firstReferrer); }

  // items: {type:"msg", role, content} | {type:"note", content} | {type:"enquiry", data}
  var items = load("items", []);
  var busy = false;

  // ---------- DOM ----------
  var host = document.createElement("div");
  host.id = "sales-desk";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<style>' + css() + '</style>' +
    '<button class="launcher" type="button" aria-expanded="false" aria-controls="sd-panel">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<span>' + esc(cfg.launcherLabel) + '</span>' +
    '</button>' +
    '<section class="panel" id="sd-panel" role="dialog" aria-label="' + esc(cfg.title) + '" hidden>' +
      '<header><div><h2>' + esc(cfg.title) + '</h2><p>' + esc(cfg.subtitle) + '</p></div>' +
        '<button class="close" type="button" aria-label="Close chat">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
        '</button></header>' +
      '<div class="log" role="log" aria-live="polite"></div>' +
      '<div class="chips"></div>' +
      '<form class="composer">' +
        '<label class="sr" for="sd-input">Your message</label>' +
        '<textarea id="sd-input" rows="1" maxlength="1500" placeholder="Type your message"></textarea>' +
        '<button type="submit" class="send" aria-label="Send message">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
      '</form>' +
      '<p class="fine">Replies are automated. Details you share go only to our sales team.</p>' +
    '</section>';

  var $ = function (s) { return root.querySelector(s); };
  var launcher = $(".launcher"), panel = $(".panel"), log = $(".log"),
      chips = $(".chips"), form = $(".composer"), input = $("textarea");

  function mount() { document.body.appendChild(host); render(); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  // ---------- rendering ----------
  function render() {
    log.innerHTML = "";
    addBubble("assistant", cfg.greeting);
    items.forEach(drawItem);
    var userHasSpoken = items.some(function (i) { return i.type === "msg" && i.role === "user"; });
    chips.innerHTML = "";
    chips.hidden = userHasSpoken;
    if (!userHasSpoken) {
      cfg.quickReplies.forEach(function (text) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = text;
        b.addEventListener("click", function () { send(text); });
        chips.appendChild(b);
      });
    }
    scrollDown();
  }

  function drawItem(i) {
    if (i.type === "msg") addBubble(i.role, i.content);
    else if (i.type === "note") addNote(i.content);
    else if (i.type === "enquiry") addEnquiry(i.data);
  }

  function addBubble(role, text) {
    var d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "user" : "bot");
    d.innerHTML = role === "user" ? "<p>" + esc(text).replace(/\n/g, "<br>") + "</p>" : format(text);
    log.appendChild(d);
  }

  function addNote(text) {
    var d = document.createElement("p");
    d.className = "note"; d.textContent = text;
    log.appendChild(d);
  }

  function addEnquiry(e) {
    var titles = {
      sent: "Enquiry sent to our team",
      demo: "Enquiry captured (demo: no delivery channel set)",
      failed: "Enquiry not delivered automatically"
    };
    var next = e.status === "failed"
      ? "Please contact us directly" + (cfg.fallbackContact ? ": " + cfg.fallbackContact : "") + ", quoting this reference."
      : cfg.enquiryNextStep;
    var d = document.createElement("div");
    d.className = "card " + e.status;
    d.setAttribute("role", "status");
    d.innerHTML =
      '<p class="card-title">' + esc(titles[e.status] || titles.sent) + '</p>' +
      '<dl><dt>Reference</dt><dd class="ref">' + esc(e.ref) + '</dd>' +
      (e.summary ? '<dt>Summary</dt><dd>' + esc(e.summary) + '</dd>' : '') +
      '<dt>Next step</dt><dd>' + esc(next) + '</dd></dl>' +
      (cfg.showStructuredData && e.data
        ? '<details><summary>What the team receives</summary><pre>' + esc(JSON.stringify(e.data, null, 2)) + '</pre></details>'
        : '');
    log.appendChild(d);
  }

  function showTyping(on) {
    var t = log.querySelector(".typing");
    if (on && !t) {
      t = document.createElement("div");
      t.className = "msg bot typing";
      t.setAttribute("aria-label", "Assistant is typing");
      t.innerHTML = "<span></span><span></span><span></span>";
      log.appendChild(t); scrollDown();
    } else if (!on && t) t.remove();
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  // Minimal safe formatting: paragraphs, lists and **bold**. Everything is escaped first.
  function format(text) {
    var inline = function (s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); };
    var html = "", inList = false;
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      var m = line.match(/^(?:[-*\u2022]|\d+[.)])\s+(.*)$/);
      if (m) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inline(m[1]) + "</li>"; return; }
      if (inList) { html += "</ul>"; inList = false; }
      if (line) html += "<p>" + inline(line) + "</p>";
    });
    if (inList) html += "</ul>";
    return html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function push(item) { items.push(item); save("items", items.slice(-60)); drawItem(item); chips.hidden = true; scrollDown(); }

  // ---------- talking to the backend ----------
  function history() {
    return items.filter(function (i) { return i.type === "msg"; })
      .map(function (i) { return { role: i.role, content: i.content }; });
  }
  // Reference numbers already sent, so the bot doesn't send the same enquiry twice.
  function enquiriesSent() {
    return items.filter(function (i) { return i.type === "enquiry" && i.data && i.data.ref; })
      .map(function (i) { return i.data.ref; });
  }

  function send(text) {
    text = String(text || "").trim().slice(0, 1500);
    if (!text || busy) return;
    push({ type: "msg", role: "user", content: text });
    if (!cfg.endpoint) {
      push({ type: "note", content: "This chat isn't connected to a backend yet. Set endpoint in SalesDeskConfig." });
      return;
    }
    busy = true; showTyping(true);
    fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history(),
        meta: { sessionId: sessionId, page: location.href.split("#")[0], referrer: firstReferrer, utm: utm, enquiriesSent: enquiriesSent() }
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
          return data;
        });
      })
      .then(function (data) {
        showTyping(false);
        if (data.reply) push({ type: "msg", role: "assistant", content: data.reply });
        if (data.enquiry) push({ type: "enquiry", data: data.enquiry });
      })
      .catch(function (err) {
        console.error("Sales desk:", err);
        showTyping(false);
        push({ type: "note", content: "Sorry, the chat couldn't reply just now. " +
          (cfg.fallbackContact ? "You can reach the team at " + cfg.fallbackContact + "." : "Please try again in a moment.") });
      })
      .finally(function () { busy = false; });
  }

  // ---------- interactions ----------
  function open(prefill) {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    host.classList.add("is-open");
    launcher.hidden = true;
    scrollDown();
    if (prefill) send(prefill); else input.focus();
  }
  function close() {
    panel.hidden = true;
    host.classList.remove("is-open");
    launcher.hidden = false;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  launcher.addEventListener("click", function () { open(); });
  $(".close").addEventListener("click", close);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  form.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value; input.value = ""; grow(); send(v); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); }
  });
  function grow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }
  input.addEventListener("input", grow);

  window.SalesDesk = { open: open, close: close, send: function (t) { open(); send(t); } };

  // ---------- styles ----------
  function css() {
    return [
      ":host{--a:var(--sd-accent,#2E5B4E);--ai:var(--sd-accent-ink,#fff);--bg:var(--sd-bg,#fff);--sf:var(--sd-surface,#F2F3F0);",
      "--ink:var(--sd-ink,#1B232C);--mu:var(--sd-muted,#56616B);--ru:var(--sd-rule,#D3D8DA);",
      "position:fixed;z-index:2147483000;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));",
      "font-size:15px;line-height:1.5;font-family:inherit;color:var(--ink)}",
      "*{box-sizing:border-box}",
      ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}",
      "button{font:inherit;cursor:pointer}",
      ":focus-visible{outline:2px solid var(--a);outline-offset:2px}",
      ".launcher{display:flex;align-items:center;gap:10px;padding:13px 20px 13px 16px;border:0;border-radius:999px;background:var(--a);color:var(--ai);font-weight:600;letter-spacing:.01em;box-shadow:0 6px 20px -8px rgba(20,30,40,.45)}",
      ".launcher:hover{filter:brightness(1.08)}.launcher[hidden]{display:none}",
      ".panel{width:min(390px,calc(100vw - 32px));height:min(640px,calc(100dvh - 40px));display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--ru);border-radius:6px;overflow:hidden;box-shadow:0 24px 60px -24px rgba(20,30,40,.5)}",
      ".panel[hidden]{display:none}",
      "header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 16px 14px 20px;border-bottom:1px solid var(--ru)}",
      "h2{margin:0;font-size:16px;font-weight:700;font-stretch:115%}",
      "header p{margin:2px 0 0;font-size:13px;color:var(--mu)}",
      ".close{border:0;background:none;color:var(--mu);padding:6px;border-radius:4px}.close:hover{color:var(--ink);background:var(--sf)}",
      ".log{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}",
      ".msg{max-width:86%;padding:10px 14px;border-radius:14px;overflow-wrap:anywhere}",
      ".msg p{margin:0}.msg p+p,.msg p+ul,.msg ul+p{margin-top:8px}.msg ul{margin:6px 0 0;padding-left:18px}.msg li+li{margin-top:2px}",
      ".bot{align-self:flex-start;background:var(--sf);border-bottom-left-radius:4px}",
      ".user{align-self:flex-end;background:var(--a);color:var(--ai);border-bottom-right-radius:4px}",
      ".note{align-self:center;margin:4px 0;max-width:92%;font-size:13px;color:var(--mu);text-align:center}",
      ".typing{display:flex;gap:4px;padding:14px}",
      ".typing span{width:6px;height:6px;border-radius:50%;background:var(--mu);animation:b 1.2s infinite ease-in-out}",
      ".typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}",
      "@keyframes b{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}",
      ".card{align-self:stretch;border:1px solid var(--ru);border-left:4px solid var(--a);border-radius:4px;padding:12px 14px;background:var(--bg)}",
      ".card.failed{border-left-color:#B4432F}.card.demo{border-left-style:dashed}",
      ".card-title{margin:0 0 8px;font-weight:700}",
      ".card dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13.5px}",
      ".card dt{color:var(--mu)}.card dd{margin:0}.ref{font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.03em}",
      ".card details{margin-top:10px;font-size:13px}.card summary{color:var(--a);cursor:pointer}",
      ".card pre{margin:8px 0 0;max-height:220px;overflow:auto;padding:10px;background:var(--sf);border-radius:4px;font-size:11.5px;line-height:1.45;white-space:pre}",
      ".chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px}.chips[hidden]{display:none}",
      ".chips button{border:1px solid var(--ru);background:var(--bg);color:var(--ink);padding:7px 12px;border-radius:999px;font-size:13.5px}",
      ".chips button:hover{border-color:var(--a);color:var(--a)}",
      ".composer{display:flex;gap:8px;align-items:flex-end;padding:12px 12px 8px 16px;border-top:1px solid var(--ru)}",
      "textarea{flex:1;resize:none;border:1px solid var(--ru);border-radius:8px;padding:10px 12px;font:inherit;color:var(--ink);background:var(--bg);max-height:120px}",
      "textarea:focus{outline:none;border-color:var(--a)}",
      ".send{flex:none;width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:8px;background:var(--a);color:var(--ai)}",
      ".fine{margin:0;padding:0 16px 12px;font-size:11.5px;color:var(--mu)}",
      "@media (max-width:480px){:host(.is-open){inset:0;right:0;bottom:0}",
      ":host(.is-open) .panel{width:100vw;height:100dvh;border:0;border-radius:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}",
      "@media (prefers-reduced-motion:reduce){.typing span{animation:none;opacity:.6}}"
    ].join("");
  }
})();
