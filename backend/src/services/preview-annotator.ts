/**
 * Client-side annotation overlay injected into pages served through the
 * workspace preview proxy. It lets the user click elements or drag areas,
 * attach notes, and reports structured annotations to the host frame
 * (PreviewPanel) via postMessage. The host drives it with `hive:*` messages.
 *
 * Written without template literals so it can be embedded verbatim below.
 */
export const ANNOTATOR_PATH = "/__hive/annotate.js";

export const ANNOTATOR_SCRIPT = `
(() => {
  "use strict";
  if (window.__hiveAnnotator) return;

  const state = { active: false, annotations: [], nextId: 1, drag: null };

  const style = document.createElement("style");
  style.textContent = [
    ".hva-hover{position:fixed;z-index:2147483640;pointer-events:none;border:1.5px solid #4f46e5;background:rgba(79,70,229,.08);border-radius:3px}",
    ".hva-hover-label{position:fixed;z-index:2147483641;pointer-events:none;background:#111827;color:#fff;font:11px/1.3 ui-monospace,monospace;padding:3px 6px;border-radius:4px;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".hva-layer{position:absolute;left:0;top:0;width:100%;z-index:2147483639;pointer-events:none}",
    ".hva-pin{position:absolute;pointer-events:auto;width:22px;height:22px;transform:translate(-50%,-50%);background:#4f46e5;color:#fff;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:bold 11px/18px -apple-system,sans-serif;text-align:center;cursor:pointer;padding:0}",
    ".hva-rect{position:absolute;pointer-events:none;border:1.5px dashed #4f46e5;background:rgba(79,70,229,.10);border-radius:3px}",
    ".hva-dragrect{position:fixed;z-index:2147483642;pointer-events:none;border:1.5px dashed #4f46e5;background:rgba(79,70,229,.12)}",
    ".hva-pulse{position:absolute;pointer-events:none;border:2px solid #4f46e5;border-radius:6px;animation:hva-pulse 1.6s ease-out forwards}",
    "@keyframes hva-pulse{0%{box-shadow:0 0 0 0 rgba(79,70,229,.55);opacity:1}100%{box-shadow:0 0 0 18px rgba(79,70,229,0);opacity:.15}}",
    ".hva-popover{position:absolute;pointer-events:auto;z-index:2147483645;background:#fff;color:#111827;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px;width:260px;font:13px -apple-system,'Segoe UI',sans-serif}",
    ".hva-popover textarea{width:100%;height:60px;border:1px solid #d1d5db;border-radius:6px;padding:6px;font:inherit;resize:vertical;box-sizing:border-box;background:#fff;color:#111827}",
    ".hva-popover .hva-row{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}",
    ".hva-popover button{border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit}",
    ".hva-save{background:#4f46e5;color:#fff}",
    ".hva-cancel{background:#f3f4f6;color:#111827}",
    ".hva-del{background:#fee2e2;color:#b91c1c;margin-right:auto}",
    ".hva-sel{font:11px ui-monospace,monospace;color:#6b7280;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "body.hva-annotating,body.hva-annotating *{cursor:crosshair!important}"
  ].join("");
  document.head.appendChild(style);

  const own = (el) => el.setAttribute("data-hive-annotator", "");
  const isOwn = (el) => el instanceof Element && el.closest("[data-hive-annotator]");

  const layer = document.createElement("div");
  layer.className = "hva-layer"; own(layer);
  const hoverBox = document.createElement("div");
  hoverBox.className = "hva-hover"; hoverBox.style.display = "none"; own(hoverBox);
  const hoverLabel = document.createElement("div");
  hoverLabel.className = "hva-hover-label"; hoverLabel.style.display = "none"; own(hoverLabel);
  const dragRect = document.createElement("div");
  dragRect.className = "hva-dragrect"; dragRect.style.display = "none"; own(dragRect);
  const mount = () => {
    document.body.appendChild(layer);
    document.body.appendChild(hoverBox);
    document.body.appendChild(hoverLabel);
    document.body.appendChild(dragRect);
  };
  if (document.body) mount(); else window.addEventListener("DOMContentLoaded", mount);

  // ── selector engine ──
  function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s; }

  function selectorFor(el) {
    if (!(el instanceof Element)) return "";
    if (el.id) return "#" + cssEscape(el.id);
    const testId = el.getAttribute("data-testid");
    if (testId) return '[data-testid="' + testId + '"]';
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + cssEscape(node.id)); break; }
      const cls = [...node.classList].filter((c) => !c.startsWith("hva-")).slice(0, 2);
      if (cls.length) part += "." + cls.map(cssEscape).join(".");
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch { return sel; }
      node = parent;
    }
    return parts.join(" > ");
  }

  // Library wrappers (Radix Primitive.div, Slot, styled/motion shims...) carry
  // no signal for the agent; keep walking up to the first app-level component.
  function isWrapperComponentName(name) {
    if (name.indexOf(".") !== -1) return true;
    return /^(Primitive|Slot|Presence|Portal|Provider|Consumer|Context|Fragment|ForwardRef|Memo|Styled|Motion|AnimatePresence|Transition)/.test(name);
  }

  function reactComponentFor(el) {
    let node = el;
    while (node) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (key) {
        let fiber = node[key];
        let fallback = null;
        while (fiber) {
          const t = fiber.type;
          const name =
            (typeof t === "function" && t.name) ||
            (typeof t === "object" && t && t.displayName) ||
            null;
          if (name) {
            if (!isWrapperComponentName(name)) return name;
            if (!fallback) fallback = name;
          }
          fiber = fiber.return;
        }
        return fallback;
      }
      node = node.parentElement;
    }
    return null;
  }

  function elementText(el) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    return t.length > 80 ? t.slice(0, 77) + "\\u2026" : t;
  }

  // ── host messaging ──
  function notify() {
    window.parent.postMessage({
      type: "hive:annotations",
      active: state.active,
      href: location.href,
      annotations: state.annotations,
    }, "*");
  }
  function notifyNav() {
    window.parent.postMessage({ type: "hive:nav", href: location.href, title: document.title }, "*");
  }

  // ── rendering ──
  function render() {
    layer.style.height = document.documentElement.scrollHeight + "px";
    layer.replaceChildren();
    for (const a of state.annotations) {
      // Annotations restored from the host may belong to another page; keep
      // them in state (and in the host chips) but only paint pins here.
      if (a.pageUrl && a.pageUrl !== location.href) continue;
      if (a.kind === "area") {
        const r = document.createElement("div");
        r.className = "hva-rect"; own(r);
        r.style.left = a.rect.x + "px"; r.style.top = a.rect.y + "px";
        r.style.width = a.rect.w + "px"; r.style.height = a.rect.h + "px";
        layer.appendChild(r);
      }
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "hva-pin"; own(pin);
      pin.textContent = String(a.id);
      pin.title = a.note || "";
      // Pin the top-right corner so the pin never covers the element content.
      const px = a.kind === "area" ? a.rect.x : a.rect.x + a.rect.w;
      const py = a.rect.y;
      pin.style.left = px + "px"; pin.style.top = py + "px";
      pin.addEventListener("click", (e) => { e.stopPropagation(); openPopover(a); });
      layer.appendChild(pin);
    }
    notify();
  }

  // ── popover ──
  let popover = null;
  function closePopover() { if (popover) popover.remove(); popover = null; }

  function openPopover(annotation) {
    closePopover();
    hoverBox.style.display = "none";
    hoverLabel.style.display = "none";
    popover = document.createElement("div");
    popover.className = "hva-popover"; own(popover);
    const desc = annotation.kind === "element" ? annotation.selector : "selected area";
    popover.innerHTML =
      '<div class="hva-sel"></div>' +
      '<textarea placeholder="Leave a note for the agent\\u2026"></textarea>' +
      '<div class="hva-row">' +
      '<button type="button" class="hva-del">Delete</button>' +
      '<button type="button" class="hva-cancel">Cancel</button>' +
      '<button type="button" class="hva-save">Save</button>' +
      "</div>";
    popover.querySelector(".hva-sel").textContent = desc;
    // Place the editor beside the annotated rect, never on top of it:
    // right of it, else left, else below.
    const rect = annotation.rect;
    const docW = document.documentElement.scrollWidth;
    let x = rect.x + rect.w + 12;
    let y = rect.y;
    if (x + 268 > docW) x = rect.x - 272;
    if (x < 8) {
      x = Math.max(8, Math.min(rect.x, docW - 268));
      y = rect.y + rect.h + 12;
    }
    popover.style.left = x + "px";
    popover.style.top = y + "px";
    layer.appendChild(popover);
    const ta = popover.querySelector("textarea");
    ta.value = annotation.note || "";
    ta.focus();

    const commit = () => {
      annotation.note = ta.value.trim();
      if (!state.annotations.includes(annotation)) state.annotations.push(annotation);
      closePopover();
      render();
    };
    const drop = () => {
      state.annotations = state.annotations.filter((a) => a !== annotation);
      closePopover();
      render();
    };
    popover.querySelector(".hva-save").addEventListener("click", commit);
    popover.querySelector(".hva-cancel").addEventListener("click", closePopover);
    popover.querySelector(".hva-del").addEventListener("click", drop);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
      if (e.key === "Escape") closePopover();
      e.stopPropagation();
    });
  }

  // ── interaction ──
  function setActive(on) {
    state.active = on;
    document.body.classList.toggle("hva-annotating", on);
    if (!on) {
      hoverBox.style.display = "none";
      hoverLabel.style.display = "none";
      dragRect.style.display = "none";
      state.drag = null;
      closePopover();
    }
    notify();
  }

  function targetAt(x, y) {
    return document.elementsFromPoint(x, y).find(
      (el) => !isOwn(el) && el !== document.documentElement && el !== document.body,
    ) || null;
  }

  document.addEventListener("mousemove", (e) => {
    if (!state.active || popover) return;
    if (state.drag) {
      state.drag.x1 = e.clientX; state.drag.y1 = e.clientY;
      if (Math.abs(state.drag.x1 - state.drag.x0) + Math.abs(state.drag.y1 - state.drag.y0) > 6) {
        state.drag.moved = true;
      }
      if (state.drag.moved) {
        hoverBox.style.display = "none"; hoverLabel.style.display = "none";
        dragRect.style.display = "block";
        dragRect.style.left = Math.min(state.drag.x0, state.drag.x1) + "px";
        dragRect.style.top = Math.min(state.drag.y0, state.drag.y1) + "px";
        dragRect.style.width = Math.abs(state.drag.x1 - state.drag.x0) + "px";
        dragRect.style.height = Math.abs(state.drag.y1 - state.drag.y0) + "px";
      }
      return;
    }
    const el = targetAt(e.clientX, e.clientY);
    if (!el) { hoverBox.style.display = "none"; hoverLabel.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    hoverBox.style.display = "block";
    hoverBox.style.left = r.left + "px"; hoverBox.style.top = r.top + "px";
    hoverBox.style.width = r.width + "px"; hoverBox.style.height = r.height + "px";
    hoverLabel.textContent = selectorFor(el);
    hoverLabel.style.display = "block";
    hoverLabel.style.left = r.left + "px";
    hoverLabel.style.top = Math.max(2, r.top - 22) + "px";
  }, true);

  document.addEventListener("mousedown", (e) => {
    if (!state.active || isOwn(e.target) || popover) return;
    e.preventDefault(); e.stopPropagation();
    state.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false };
  }, true);

  document.addEventListener("mouseup", (e) => {
    if (!state.active || !state.drag) return;
    e.preventDefault(); e.stopPropagation();
    const d = state.drag; state.drag = null;
    dragRect.style.display = "none";
    const sx = window.scrollX, sy = window.scrollY;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    if (d.moved) {
      const rect = {
        x: Math.round(Math.min(d.x0, d.x1) + sx), y: Math.round(Math.min(d.y0, d.y1) + sy),
        w: Math.round(Math.abs(d.x1 - d.x0)), h: Math.round(Math.abs(d.y1 - d.y0)),
      };
      const inArea = [...document.querySelectorAll("body *")].filter((el) => {
        if (isOwn(el) || !el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        const ex = r.left + sx, ey = r.top + sy;
        return ex >= rect.x && ey >= rect.y && ex + r.width <= rect.x + rect.w && ey + r.height <= rect.y + rect.h;
      });
      const top = inArea.filter((el) => !inArea.includes(el.parentElement));
      const ann = {
        id: state.nextId++, kind: "area", note: "", rect, viewport,
        pageUrl: location.href,
        selectorsInArea: top.slice(0, 8).map(selectorFor),
      };
      openPopover(ann);
    } else {
      const el = targetAt(e.clientX, e.clientY);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ann = {
        id: state.nextId++, kind: "element", note: "", viewport,
        pageUrl: location.href,
        selector: selectorFor(el),
        component: reactComponentFor(el) || undefined,
        elementText: elementText(el),
        rect: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) },
      };
      openPopover(ann);
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (state.active && !isOwn(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  window.addEventListener("resize", () => { if (state.annotations.length) render(); });

  // ── locate helpers (host-driven: chips and sent-message badges) ──
  function scrollToRect(rect) {
    window.scrollTo({
      top: Math.max(0, rect.y - window.innerHeight / 2 + rect.h / 2),
      left: Math.max(0, rect.x - window.innerWidth / 2 + rect.w / 2),
      behavior: "smooth",
    });
  }

  function pulseAt(rect) {
    const pulse = document.createElement("div");
    pulse.className = "hva-pulse"; own(pulse);
    pulse.style.left = (rect.x - 4) + "px";
    pulse.style.top = (rect.y - 4) + "px";
    pulse.style.width = (rect.w + 8) + "px";
    pulse.style.height = (rect.h + 8) + "px";
    layer.appendChild(pulse);
    setTimeout(() => pulse.remove(), 1700);
  }

  function focusAnnotation(id) {
    const a = state.annotations.find((x) => x.id === id);
    if (!a) return;
    scrollToRect(a.rect);
    pulseAt(a.rect);
    openPopover(a);
  }

  function flashLocation(selector, rect) {
    let target = null;
    if (selector) {
      try { target = document.querySelector(selector); } catch { target = null; }
    }
    if (target) {
      const r = target.getBoundingClientRect();
      const abs = { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
      scrollToRect(abs);
      pulseAt(abs);
    } else if (rect) {
      scrollToRect(rect);
      pulseAt(rect);
    }
  }

  // ── SPA navigation reporting ──
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) { origPush(...args); notifyNav(); };
  history.replaceState = function (...args) { origReplace(...args); notifyNav(); };
  window.addEventListener("popstate", notifyNav);
  window.addEventListener("hashchange", notifyNav);

  // ── host commands ──
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "hive:set-annotate-mode": setActive(!!msg.active); break;
      case "hive:clear-annotations": state.annotations = []; render(); break;
      case "hive:restore-annotations": {
        const list = Array.isArray(msg.annotations) ? msg.annotations : [];
        state.annotations = list;
        state.nextId = list.reduce((m, a) => Math.max(m, a.id), 0) + 1;
        render();
        break;
      }
      case "hive:remove-annotation":
        state.annotations = state.annotations.filter((a) => a.id !== msg.id);
        render();
        break;
      case "hive:focus-annotation": focusAnnotation(msg.id); break;
      case "hive:flash": flashLocation(msg.selector, msg.rect); break;
      case "hive:reload": location.reload(); break;
      case "hive:navigate":
        if (typeof msg.href === "string") location.href = msg.href;
        else if (typeof msg.delta === "number") history.go(msg.delta);
        break;
    }
  });

  window.__hiveAnnotator = { setActive, get annotations() { return state.annotations; } };
  window.parent.postMessage({ type: "hive:ready", href: location.href, title: document.title }, "*");
  notifyNav();
})();
`;
