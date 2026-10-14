import * as Core from "./core";
import * as MonoAvatar from "./avatar";
import * as MonoContact from "./contact";
import { widgetStyles } from "./styles";
let current = null;
function mount(options = {}) {
  if (current) return current;
  const host = document.createElement("div");
  host.id = "mono-widget";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = widgetStyles;
  root.append(style);
  const ui = document.createElement("div");
  ui.innerHTML = `<button class="mono-launcher" aria-label="Ask Mono, Monolith’s site guide" aria-haspopup="dialog" aria-expanded="false" aria-controls="mono-panel"><span class="mono-avatar"></span><span class="mono-hint">Ask Mono</span></button>
      <dialog id="mono-panel" class="mono-panel" aria-labelledby="mono-title" aria-describedby="mono-disclosure">
        <header class="mono-header"><span class="mono-avatar mono-header-avatar" aria-hidden="true"></span><div class="mono-identity"><h2 id="mono-title">Mono</h2><p>Your Monolith guide</p></div><button class="mono-icon mono-motion" type="button" aria-label="Pause Mono’s animation" aria-pressed="false">Ⅱ</button><button class="mono-icon mono-close" type="button" aria-label="Close Mono">×</button></header>
        <div class="mono-scroll"><div class="mono-welcome"><span class="mono-eyebrow">A LITTLE ORDER. A LITTLE HELP.</span><h3>What shall we<br>put in order?</h3><p>I’m Mono. Let’s find your way around Monolith.</p><div class="mono-prompts"><button class="mono-prompt" data-prompt="Show me the workspace">Show me the workspace <span aria-hidden="true">↗</span></button><button class="mono-prompt" data-prompt="How do AI agents work?">How do AI agents work? <span aria-hidden="true">↗</span></button><button class="mono-prompt" data-prompt="Help me explore pricing">Help me explore plans <span aria-hidden="true">↗</span></button></div></div><div class="mono-messages" role="log" aria-label="Conversation with Mono" aria-live="polite" aria-relevant="additions"></div><p class="mono-thinking" role="status" hidden>Mono is finding a little order…</p><div class="mono-notice" role="alert" hidden><p></p><button type="button">Try again</button></div></div>
        <footer class="mono-footer"><div class="mono-toolbar"><span class="mono-mode">Site guide</span><div class="mono-toolbar-actions"><button class="mono-contact-open" type="button" hidden>Contact the team</button><button class="mono-reset" type="button">New conversation</button></div></div><form class="mono-form"><label class="mono-sr" for="mono-input">Ask Mono about Monolith</label><textarea id="mono-input" rows="1" maxlength="2000" placeholder="Ask about Monolith…" enterkeyhint="send"></textarea><button class="mono-send" type="submit" aria-label="Send message" disabled>↑</button></form><p class="mono-disclosure" id="mono-disclosure">Prepared answers. Messages stay in this page.</p></footer>
      </dialog>`;
  root.append(ui);
  (options.container || document.body).append(host);
  const $ = (s) => root.querySelector(s);
  const launcher = $(".mono-launcher"),
    panel = $(".mono-panel"),
    input = $("textarea"),
    send = $(".mono-send"),
    form = $("form"),
    scroll = $(".mono-scroll"),
    messages = $(".mono-messages"),
    welcome = $(".mono-welcome"),
    thinking = $(".mono-thinking"),
    notice = $(".mono-notice"),
    noticeText = notice.querySelector("p"),
    retry = notice.querySelector("button"),
    reset = $(".mono-reset"),
    motionButton = $(".mono-motion"),
    contactButton = $(".mono-contact-open");
  const launcherEl = launcher.querySelector(".mono-avatar"),
    headerEl = $(".mono-header-avatar");
  function createAvatar(el, motion) {
    const avatar = MonoAvatar.create(el, { motion });
    // The original artwork is only needed when the canvas renderer is unavailable.
    if (avatar.getStatus().renderer === "artwork" && options.fallbackImage) {
      const img = document.createElement("img");
      img.src = options.fallbackImage;
      img.alt = "";
      img.className = "mono-artwork";
      el.append(img);
    }
    return avatar;
  }
  const transport = options.transport || null;
  const links = {
    product: "#product",
    agents: "#agents",
    pricing: "#pricing",
    signup: "/signup",
    ...options.links,
  };
  const allowedOrigins = [
    "https://www.monolith.works",
    "https://monolith.works",
    ...(options.allowedOrigins || []),
  ];
  const mobile = matchMedia("(max-width:620px)"),
    reduced = matchMedia("(prefers-reduced-motion:reduce)");
  const cleanup = [];
  let opened = false,
    destroyed = false,
    busy = false,
    connecting = false,
    connected = !transport,
    mode = transport ? "offline" : "guide",
    callbacksEnabled = false,
    reportingEnabled = false;
  let globalMotion = options.motionAllowed !== false,
    userMotion = true,
    headerAvatar = null,
    restoreFocus = null,
    bodyOverflow = null,
    operation = 0,
    controller = null,
    retryAction = null,
    pending = null,
    activity = Date.now(),
    ritualAt = Date.now() + 23000,
    dozing = false;
  const launcherAvatar = createAvatar(launcherEl, globalMotion);
  const contactFlow = MonoContact.create({
    container: scroll,
    isActive: () => opened && !destroyed,
    onState: expression,
    async request(lead, requestId) {
      const result = await run((signal) =>
        transport.callback(lead, {
          signal,
          requestId,
          page: location.pathname + location.hash,
        }),
      );
      if (result.error?.status === 403) {
        connected = false;
        mode = "offline";
        syncMode();
      }
      if (result.error || result.stale)
        throw result.error || new Error("Request interrupted");
      return result.value;
    },
    async reconnect() {
      const result = await run((signal) => transport.connect({ signal }));
      if (result.error || result.stale)
        throw result.error || new Error("Connection interrupted");
      applyStatus(result.value, { hydrate: false });
      syncMode();
      if (!callbacksEnabled)
        throw new Error("Contact requests are not available yet.");
    },
    async checkDelivery() {
      const result = await run((signal) => transport.connect({ signal }));
      if (result.error || result.stale)
        throw result.error || new Error("Status interrupted");
      applyStatus(result.value, { hydrate: false });
      syncMode();
      return result.value.callback_receipt;
    },
    setBusy(value) {
      busy = value;
      syncControls();
    },
    onChange() {
      const visible = contactFlow.visible;
      messages.hidden = visible;
      form.hidden = visible;
      welcome.hidden = visible || !!messages.childElementCount;
      clearNotice();
      syncControls();
      if (!visible && !connected)
        showError(
          new Error("Reconnect to Mono to continue."),
          connect,
          "Reconnect",
        );
      if (!visible && opened) input.focus({ preventScroll: true });
    },
  });
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanup.push(() => target.removeEventListener(type, fn, opts));
  }
  function expression(state) {
    (opened ? headerAvatar : launcherAvatar)?.setState(state);
  }
  function syncMotion() {
    const enabled = globalMotion && userMotion;
    launcherAvatar.setMotion(enabled);
    headerAvatar?.setMotion(enabled);
    motionButton.textContent = userMotion ? "Ⅱ" : "▷";
    motionButton.setAttribute("aria-pressed", String(!userMotion));
    motionButton.setAttribute(
      "aria-label",
      userMotion ? "Pause Mono’s animation" : "Resume Mono’s animation",
    );
    motionButton.disabled = !globalMotion || reduced.matches;
    motionButton.title = reduced.matches
      ? "Reduced motion is enabled"
      : !globalMotion
        ? "Site motion is paused"
        : "";
  }
  function syncControls() {
    send.disabled = busy || connecting || !connected || !input.value.trim();
    reset.disabled =
      busy ||
      connecting ||
      contactFlow.unresolved ||
      contactFlow.visible ||
      (!messages.childElementCount && connected);
    input.disabled = busy || connecting || !connected;
    retry.disabled = busy || connecting;
    root
      .querySelectorAll(".mono-prompt")
      .forEach((b) => (b.disabled = busy || connecting || !connected));
    contactButton.hidden =
      ((!callbacksEnabled || mode !== "live") && !contactFlow.recoverable) ||
      contactFlow.visible;
    contactButton.disabled = busy || connecting;
    contactFlow.setReady(
      callbacksEnabled && mode === "live" && connected && !busy && !connecting,
    );
  }
  function syncMode() {
    $(".mono-mode").textContent = connecting
      ? "Connecting…"
      : mode === "live"
        ? "AI assistant"
        : mode === "guide"
          ? "Site guide"
          : "Offline";
    $(".mono-disclosure").textContent =
      mode === "live"
        ? "Powered by OpenAI. AI can make mistakes. Messages are processed by OpenAI." +
          (reportingEnabled
            ? " Summaries and recent messages are shared with the Monolith team."
            : "")
        : transport && mode !== "guide"
          ? "Connect to Mono to start a conversation."
          : "Prepared answers. Messages stay in this page.";
    syncControls();
  }
  function lockScroll() {
    if (mobile.matches && bodyOverflow === null) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
  }
  function unlockScroll() {
    if (bodyOverflow !== null) {
      document.body.style.overflow = bodyOverflow;
      bodyOverflow = null;
    }
  }
  function viewport() {
    const v = window.visualViewport;
    host.style.setProperty(
      "--mono-viewport",
      (v ? v.height : innerHeight) + "px",
    );
    host.style.setProperty(
      "--mono-keyboard",
      Math.max(0, innerHeight - (v ? v.height + v.offsetTop : innerHeight)) +
        "px",
    );
  }
  function showPanel() {
    if (mobile.matches) {
      panel.showModal();
      lockScroll();
    } else panel.show();
  }
  function open() {
    if (destroyed || opened) return;
    opened = true;
    restoreFocus =
      document.activeElement === host
        ? root.activeElement
        : document.activeElement;
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "true");
    launcherAvatar.setVisible(false);
    showPanel();
    viewport();
    if (!headerAvatar)
      headerAvatar = createAvatar(headerEl, globalMotion && userMotion);
    headerAvatar.setVisible(true);
    headerAvatar.setState(busy ? "thinking" : "hello");
    syncMotion();
    $(".mono-close").focus({ preventScroll: true });
    if (transport && !connected && !connecting) connect();
  }
  function finishClose() {
    if (!opened) return;
    opened = false;
    unlockScroll();
    launcher.hidden = false;
    launcher.setAttribute("aria-expanded", "false");
    headerAvatar?.setVisible(false);
    launcherAvatar.setVisible(true);
    launcherAvatar.setState("done");
    activity = Date.now();
    dozing = false;
    const focusTarget = restoreFocus?.isConnected ? restoreFocus : launcher;
    if (!destroyed) focusTarget.focus({ preventScroll: true });
  }
  function close() {
    if (!opened) return;
    panel.close();
    finishClose();
  }
  function clearNotice() {
    notice.hidden = true;
    retryAction = null;
  }
  function showError(error, action, label = "Try again") {
    noticeText.textContent =
      error instanceof Error
        ? error.message
        : "Mono couldn’t complete that request. Please try again.";
    retry.textContent = label;
    retryAction = action;
    notice.hidden = false;
    expression("needsyou");
    scroll.scrollTop = scroll.scrollHeight;
  }
  function message(role, text, replyLinks = [], draft = null) {
    welcome.hidden = true;
    const item = document.createElement("div");
    item.className =
      "mono-message " + (role === "user" ? "is-user" : "is-mono");
    item.setAttribute("aria-label", role === "user" ? "You" : "Mono");
    const p = document.createElement("p");
    p.textContent = text;
    item.append(p);
    for (const link of replyLinks) {
      const href = Core.safeHref(link.href, location.href, allowedOrigins);
      if (!href) continue;
      const a = document.createElement("a");
      a.href = href;
      a.textContent = link.label + " ↗";
      a.addEventListener("click", (event) => {
        const url = new URL(href);
        if (
          url.origin === location.origin &&
          url.pathname === location.pathname &&
          url.search === location.search &&
          url.hash
        ) {
          let target;
          try {
            target = document.getElementById(
              decodeURIComponent(url.hash.slice(1)),
            );
          } catch {}
          if (target) {
            event.preventDefault();
            close();
            target.scrollIntoView({
              behavior:
                globalMotion && userMotion && !reduced.matches
                  ? "smooth"
                  : "instant",
              block: "start",
            });
            if (!target.hasAttribute("tabindex")) {
              target.setAttribute("tabindex", "-1");
              target.addEventListener(
                "blur",
                () => target.removeAttribute("tabindex"),
                { once: true },
              );
            }
            target.focus({ preventScroll: true });
            history.replaceState(null, "", url.hash);
            return;
          }
        }
        close();
      });
      item.append(a);
    }
    if (role !== "user" && callbacksEnabled && mode === "live")
      contactFlow.offer(draft, item);
    messages.append(item);
    while (messages.childElementCount > 48) messages.firstElementChild.remove();
    scroll.scrollTop = scroll.scrollHeight;
    return item;
  }
  async function run(work) {
    controller?.abort();
    const ownController = new AbortController();
    controller = ownController;
    const version = ++operation;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          "Mono took too long to reply. Please try again.",
        );
        ownController.abort(error);
        reject(error);
      }, 35000);
    });
    // Route cleanup must release the deadline even if a transport ignores abort.
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => {
        clearTimeout(timer);
        reject(ownController.signal.reason);
      };
      ownController.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => work(ownController.signal)),
        timeout,
        interrupted,
      ]);
      if (destroyed || version !== operation) return { stale: true };
      return { value };
    } catch (error) {
      if (destroyed || version !== operation) return { stale: true };
      return { error };
    } finally {
      clearTimeout(timer);
      ownController.signal.removeEventListener("abort", onAbort);
      if (controller === ownController) controller = null;
    }
  }
  function hydrate(items, lastRequestId) {
    messages.replaceChildren();
    for (const item of (Array.isArray(items) ? items : []).slice(-48)) {
      if (
        !item ||
        !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" ||
        !item.content.trim()
      )
        continue;
      if (item.role === "user") message("user", item.content.slice(0, 2000));
      else {
        const reply = Core.normalizeReply({
          reply: item.content,
          links: item.links,
          contact_request: item.contact_request,
        });
        message("mono", reply.reply, reply.links, reply.contact_request);
      }
    }
    if (pending) {
      if (lastRequestId === pending.id) {
        pending = null;
        input.value = "";
      } else {
        const last = messages.lastElementChild;
        pending.node =
          last?.classList.contains("is-user") &&
          last.querySelector("p")?.textContent === pending.text
            ? last
            : message("user", pending.text);
        const label = document.createElement("span");
        label.className = "mono-delivery";
        label.textContent = "Ready to retry";
        pending.node.append(label);
      }
    }
    welcome.hidden = contactFlow.visible || !!messages.childElementCount;
  }
  function applyStatus(value, { hydrate: restoreHistory = true } = {}) {
    if (!["live", "guide"].includes(value?.mode))
      throw new Error("Mono is not connected yet. Please try again later.");
    connected = true;
    mode = value.mode;
    callbacksEnabled =
      mode === "live" &&
      value.callbacks_enabled === true &&
      typeof transport?.callback === "function";
    reportingEnabled = mode === "live" && value.reporting_enabled === true;
    if (restoreHistory && mode === "live" && Array.isArray(value.history))
      hydrate(value.history, value.last_request_id);
    if (value.callback_receipt && !contactFlow.visible)
      contactFlow.restore(value.callback_receipt);
  }
  async function connect() {
    if (connecting || destroyed) return;
    connecting = true;
    clearNotice();
    syncMode();
    expression("thinking");
    const result = await run((signal) => transport.connect({ signal }));
    if (result.stale) return;
    connecting = false;
    if (result.error || !["live", "guide"].includes(result.value?.mode)) {
      connected = false;
      mode = "offline";
      showError(
        result.error ||
          new Error("Mono is not connected yet. Please try again later."),
        connect,
        "Reconnect",
      );
    } else {
      applyStatus(result.value);
      expression("done");
    }
    syncMode();
  }
  function newId() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
    );
  }
  async function submit(text, { retrying = false } = {}) {
    text = String(text || "")
      .trim()
      .slice(0, 2000);
    if (
      !text ||
      busy ||
      connecting ||
      !connected ||
      destroyed ||
      contactFlow.visible
    )
      return;
    if (pending && pending.text === text) retrying = true;
    if (!retrying) {
      if (pending?.node) {
        const old = pending.node.querySelector(".mono-delivery");
        if (old) old.textContent = "Not delivered";
      }
      pending = { text, id: newId(), node: message("user", text) };
    }
    const entry = pending;
    if (!entry) return;
    entry.node.querySelector(".mono-delivery")?.remove();
    busy = true;
    clearNotice();
    input.value = "";
    resizeInput();
    syncControls();
    thinking.hidden = false;
    expression("thinking");
    scroll.scrollTop = scroll.scrollHeight;
    const result = await run(async (signal) => {
      if (mode === "guide") return Core.preparedReply(entry.text, links);
      return transport.respond(entry.text, {
        signal,
        requestId: entry.id,
        page: location.pathname + location.hash,
      });
    });
    if (result.stale) return;
    busy = false;
    thinking.hidden = true;
    let reply;
    if (!result.error) {
      try {
        reply = Core.normalizeReply(result.value);
      } catch (error) {
        result.error = error;
      }
    }
    if (result.error) {
      const label = document.createElement("span");
      label.className = "mono-delivery";
      label.textContent = "Not delivered";
      entry.node.append(label);
      input.value = entry.text;
      resizeInput();
      if (result.error.status === 403) {
        connected = false;
        mode = "offline";
        showError(
          result.error,
          async () => {
            await connect();
            if (connected && pending?.id === entry.id)
              await submit(entry.text, { retrying: true });
          },
          "Reconnect and retry",
        );
      } else if (result.error.status === 409) {
        showError(
          result.error,
          /^Start a new conversation/.test(result.error.message)
            ? startAgain
            : connect,
          /^Start a new conversation/.test(result.error.message)
            ? "New conversation"
            : "Check conversation",
        );
      } else
        showError(result.error, () => submit(entry.text, { retrying: true }));
    } else {
      message("mono", reply.reply, reply.links, reply.contact_request);
      pending = null;
      expression("done");
    }
    syncMode();
  }
  async function startAgain() {
    if (
      busy ||
      connecting ||
      destroyed ||
      contactFlow.unresolved ||
      contactFlow.visible
    )
      return;
    if (transport && mode === "live" && typeof transport.reset === "function") {
      busy = true;
      clearNotice();
      syncControls();
      const result = await run((signal) => transport.reset({ signal }));
      if (result.stale) return;
      busy = false;
      if (result.error) {
        if (result.error.status === 403) {
          connected = false;
          mode = "offline";
          showError(result.error, connect, "Reconnect");
        } else showError(result.error, startAgain);
        syncMode();
        return;
      }
    }
    messages.replaceChildren();
    welcome.hidden = false;
    pending = null;
    input.value = "";
    contactFlow.reset();
    if (connected) clearNotice();
    resizeInput();
    syncControls();
    expression("hello");
  }
  function resizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  }
  on(launcher, "click", open);
  on($(".mono-close"), "click", close);
  on(panel, "cancel", (event) => {
    event.preventDefault();
    close();
  });
  on(panel, "close", () => {
    if (!panel.open) finishClose();
  });
  on(panel, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  on(panel, "click", (event) => {
    if (event.target === panel && mobile.matches) {
      const r = panel.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        close();
    }
  });
  on(mobile, "change", () => {
    if (opened) {
      const focused = root.activeElement;
      panel.close();
      unlockScroll();
      showPanel();
      focused?.focus({ preventScroll: true });
    }
    viewport();
  });
  on(form, "submit", (event) => {
    event.preventDefault();
    submit(input.value);
  });
  on(input, "keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit(input.value);
    }
  });
  on(input, "input", () => {
    resizeInput();
    syncControls();
  });
  on(input, "focus", () => {
    if (!busy && !connecting) expression("listening");
  });
  on(input, "blur", () => {
    if (!busy && !connecting) expression("idle");
  });
  root
    .querySelectorAll(".mono-prompt")
    .forEach((button) =>
      on(button, "click", () => submit(button.dataset.prompt)),
    );
  on(retry, "click", () => retryAction?.());
  on(reset, "click", startAgain);
  on(contactButton, "click", () => contactFlow.open());
  on(motionButton, "click", () => {
    userMotion = !userMotion;
    syncMotion();
  });
  on(reduced, "change", syncMotion);
  on(launcher, "pointerenter", () => {
    activity = Date.now();
    launcherAvatar.setState(dozing ? "wake" : "ribbon");
    dozing = false;
  });
  on(launcher, "focus", () => {
    activity = Date.now();
    if (dozing) {
      dozing = false;
      launcherAvatar.setState("wake");
    }
  });
  on(
    document,
    "pointerdown",
    () => {
      activity = Date.now();
      if (dozing && !opened) {
        dozing = false;
        launcherAvatar.setState("wake");
      }
    },
    { passive: true },
  );
  on(
    document,
    "keydown",
    () => {
      activity = Date.now();
      if (dozing && !opened) {
        dozing = false;
        launcherAvatar.setState("wake");
      }
    },
    { passive: true },
  );
  on(global, "resize", viewport);
  if (window.visualViewport) {
    on(window.visualViewport, "resize", viewport);
    on(window.visualViewport, "scroll", viewport);
  }
  const idleTimer = setInterval(() => {
    if (
      destroyed ||
      opened ||
      document.hidden ||
      !globalMotion ||
      !userMotion ||
      reduced.matches
    )
      return;
    const now = Date.now();
    if (now - activity > 65000 && !dozing) {
      dozing = true;
      launcherAvatar.setState("dozing");
    } else if (!dozing && now > ritualAt) {
      launcherAvatar.setState("ritual");
      ritualAt = now + 38000;
    }
  }, 1000);
  const api = {
    element: host,
    open,
    close,
    setMotionAllowed(value) {
      globalMotion = !!value;
      syncMotion();
    },
    setBottom(value) {
      const n = Number(value);
      if (Number.isFinite(n))
        host.style.setProperty(
          "--mono-bottom",
          Math.max(0, Math.min(240, n)) + "px",
        );
    },
    getStatus() {
      return {
        open: opened,
        mode,
        busy,
        connecting,
        connected,
        messages: messages.childElementCount,
        destroyed,
        motionAllowed: globalMotion,
        userMotion,
        callbacksEnabled,
        reportingEnabled,
        contact: {
          visible: contactFlow.visible,
          delivery: contactFlow.delivery,
        },
        launcher: launcherAvatar.getStatus(),
        header: headerAvatar?.getStatus() || null,
      };
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      operation++;
      controller?.abort();
      clearInterval(idleTimer);
      cleanup.forEach((fn) => fn());
      contactFlow.destroy();
      launcherAvatar.destroy();
      headerAvatar?.destroy();
      host.remove();
      current = null;
    },
  };
  current = api;
  viewport();
  syncMotion();
  syncMode();
  launcherAvatar.setState("hello");
  return api;
}
export { mount };
export { createHttpTransport } from "./core";
