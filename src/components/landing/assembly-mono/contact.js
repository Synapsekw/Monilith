import * as Core from "./core";
function create({
  container,
  request,
  reconnect,
  checkDelivery,
  setBusy,
  onChange,
  onState,
  isActive,
}) {
  const section = document.createElement("section");
  section.className = "mono-contact";
  section.hidden = true;
  section.setAttribute("aria-label", "Contact request");
  container.append(section);
  let ready = false,
    working = false,
    requestId = "",
    latestDraft = null,
    reviewed = null,
    receipt = null,
    rejection = null,
    disposed = false;
  const fields = [
    ["name", "Your name", 100, "name"],
    ["phone", "Phone with country code", 40, "tel"],
    ["email", "Email", 254, "email"],
    ["reason", "What would you like to discuss?", 1000, "off"],
    ["company", "Company", 120, "organization"],
    ["preferred_time", "Preferred time", 160, "off"],
    ["timezone", "Time zone", 80, "off"],
  ];
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action, className = "mono-contact-secondary") {
    const b = el("button", text, className);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  }
  function heading(title, description) {
    section.replaceChildren();
    section.hidden = false;
    const h = el("h3", title);
    h.tabIndex = -1;
    section.append(h);
    if (description) section.append(el("p", description, "mono-contact-intro"));
    return h;
  }
  function reveal(focus) {
    onChange();
    container.scrollTop = 0;
    if (isActive()) focus?.focus({ preventScroll: true });
  }
  function hide() {
    if (working) return;
    section.hidden = true;
    onChange();
    onState("idle");
  }
  function open(draft = latestDraft || {}) {
    if (working || disposed) return;
    if (rejection) {
      showRejection(rejection);
      return;
    }
    if (!ready) return;
    if (receipt?.delivery === "unknown") {
      showReceipt(receipt);
      return;
    }
    requestId = "";
    reviewed = null;
    receipt = null;
    heading(
      "Let’s connect.",
      "Add your details, then review everything before it is sent.",
    );
    const form = el("form");
    form.className = "mono-contact-form";
    form.noValidate = true;
    const optional = el("details");
    optional.append(el("summary", "Company & preferred time (optional)"));
    const initial = Core.contactDraft(draft) || {};
    for (const [key, label, max, autocomplete] of fields) {
      const wrap = el("div", null, "mono-contact-field"),
        lab = el("label", label),
        id = "mono-contact-" + key;
      lab.htmlFor = id;
      const field = el(key === "reason" ? "textarea" : "input");
      field.id = id;
      field.name = key;
      field.maxLength = max;
      field.autocomplete = autocomplete;
      field.dir = "auto";
      if (key === "reason") field.rows = 3;
      else
        field.type =
          key === "email" ? "email" : key === "phone" ? "tel" : "text";
      field.value = initial[key] || "";
      if (["name", "reason"].includes(key)) field.required = true;
      if (key === "phone") field.placeholder = "+971 …";
      if (key === "preferred_time")
        field.placeholder = "For example, weekday afternoons";
      if (key === "timezone") field.placeholder = "For example, Dubai (UTC+4)";
      field.addEventListener("focus", () => onState("listening"));
      wrap.append(lab, field);
      (["company", "preferred_time", "timezone"].includes(key)
        ? optional
        : form
      ).append(wrap);
      if (key === "email")
        form.append(
          el("p", "Add a phone number, email, or both.", "mono-contact-note"),
        );
    }
    form.append(optional);
    const error = el("p", null, "mono-contact-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.append(error);
    const actions = el("div", null, "mono-contact-actions"),
      review = el("button", "Review request", "mono-contact-primary");
    review.type = "submit";
    actions.append(review, button("Back to chat", hide));
    form.append(actions);
    section.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const checked = Core.validateContact(
        Object.fromEntries(new FormData(form)),
      );
      if (checked.error) {
        error.textContent = checked.error;
        error.hidden = false;
        form.elements.namedItem(checked.field)?.focus();
        onState("needsyou");
        return;
      }
      reviewed = checked.lead;
      requestId = crypto.randomUUID();
      showReview();
    });
    reveal(form.elements.namedItem("name"));
  }
  function showReview() {
    const h = heading(
      "Everything look right?",
      "These contact details will be shared with the Monolith team through its private assistant.",
    );
    const list = el("dl", null, "mono-contact-review");
    for (const [key, label] of fields)
      if (reviewed[key]) list.append(el("dt", label), el("dd", reviewed[key]));
    section.append(list);
    const consent = el("label", null, "mono-contact-consent"),
      check = el("input");
    check.type = "checkbox";
    consent.append(
      check,
      el("span", "Send these details to Monolith so the team can contact me."),
    );
    section.append(consent);
    section.append(
      el(
        "p",
        "Your preferred time is a request, not a confirmed booking.",
        "mono-contact-note",
      ),
    );
    const feedback = el("p", null, "mono-contact-error");
    feedback.setAttribute("role", "alert");
    feedback.hidden = true;
    section.append(feedback);
    const actions = el("div", null, "mono-contact-actions");
    const send = button(
      "Confirm & send",
      async () => {
        if (!check.checked || working || !ready || disposed) return;
        working = true;
        setBusy(true);
        send.disabled = true;
        edit.disabled = true;
        back.disabled = true;
        check.disabled = true;
        send.textContent = "Sending…";
        feedback.hidden = true;
        onState("thinking");
        try {
          const result = Core.contactReceipt(
            await request(reviewed, requestId),
          );
          if (disposed) return;
          if (!result)
            throw new Error(
              "Delivery could not be confirmed. Check this request before submitting another.",
            );
          receipt = { ...result, request_id: result.request_id || requestId };
          if (receipt.delivery === "failed") {
            feedback.textContent = receipt.reply;
            feedback.hidden = false;
            send.textContent = "Retry sending";
            onState("needsyou");
          } else {
            showReceipt(receipt);
            onState(receipt.delivery === "accepted" ? "done" : "needsyou");
          }
        } catch (error) {
          if (disposed) return;
          // These endpoint rejections occur before dispatch. A conflict, 5xx,
          // invalid receipt or network failure can involve a delivered request.
          if ([400, 403, 415, 429].includes(error?.status)) {
            showRejection(error.status);
          } else {
            receipt = {
              delivery: "unknown",
              reply:
                "We couldn’t confirm delivery. Check this request before submitting another.",
              reference: "",
              request_id: requestId,
            };
            showReceipt(receipt);
          }
          onState("needsyou");
        } finally {
          working = false;
          if (!disposed) {
            setBusy(false);
            check.disabled = false;
            send.disabled = !check.checked || !ready;
            edit.disabled = false;
            back.disabled = false;
          }
        }
      },
      "mono-contact-primary",
    );
    const edit = button("Edit details", () => open(reviewed)),
      back = button("Back to chat", hide);
    send.disabled = true;
    check.addEventListener(
      "change",
      () => (send.disabled = !check.checked || !ready || working),
    );
    actions.append(send, edit, back);
    section.append(actions);
    reveal(h);
  }
  function showRejection(status) {
    rejection = status;
    receipt = null;
    latestDraft = reviewed;
    const h = heading(
      "Request not sent.",
      status === 403
        ? "Your session expired or could not be verified. Reconnect, then review and confirm your saved details again."
        : status === 429
          ? "Mono is receiving too many contact requests. Wait a little, then review and confirm your saved details again."
          : "Mono could not accept this request. Review your saved details and make any corrections before confirming again.",
    );
    const feedback = el("p", null, "mono-contact-error");
    feedback.setAttribute("role", "alert");
    feedback.hidden = true;
    const actions = el("div", null, "mono-contact-actions");
    const retry = button(
      status === 403 ? "Reconnect & review" : "Review and retry",
      async () => {
        if (working || disposed) return;
        working = true;
        retry.disabled = true;
        back.disabled = true;
        feedback.hidden = true;
        setBusy(true);
        onState("thinking");
        try {
          if (status === 403) await reconnect();
          if (disposed) return;
          rejection = null;
          requestId = crypto.randomUUID();
          // Rebuild the review with fresh, unchecked consent. Never resend here.
          showReview();
          onState("idle");
        } catch {
          if (!disposed) {
            feedback.textContent =
              "Couldn’t reconnect. Your details are saved here. Please try again.";
            feedback.hidden = false;
            onState("needsyou");
          }
        } finally {
          working = false;
          if (!disposed) {
            setBusy(false);
            retry.disabled = false;
            back.disabled = false;
          }
        }
      },
      "mono-contact-primary",
    );
    const back = button("Back to chat", hide);
    actions.append(retry, back);
    section.append(feedback, actions);
    reveal(h);
  }
  function showReceipt(result) {
    receipt = result;
    const h = heading(
      result.delivery === "accepted"
        ? "Request submitted."
        : result.delivery === "failed"
          ? "Request not delivered."
          : "Delivery not confirmed.",
      result.reply,
    );
    if (result.reference || result.request_id)
      section.append(
        el(
          "p",
          "Reference: " + (result.reference || result.request_id),
          "mono-contact-reference",
        ),
      );
    if (result.delivery === "accepted")
      section.append(
        el(
          "p",
          "The request was submitted for the team to review. A call or meeting has not been booked.",
          "mono-contact-note",
        ),
      );
    const actions = el("div", null, "mono-contact-actions");
    if (result.delivery === "unknown") {
      section.append(
        el(
          "p",
          "Checking delivery does not send another contact request.",
          "mono-contact-note",
        ),
      );
      const feedback = el("p", null, "mono-contact-error");
      feedback.setAttribute("role", "status");
      feedback.hidden = true;
      section.append(feedback);
      const check = button(
        "Check delivery",
        async () => {
          if (working || disposed) return;
          working = true;
          check.disabled = true;
          setBusy(true);
          onState("thinking");
          try {
            const value = Core.contactReceipt(
              await checkDelivery(result.request_id),
            );
            if (disposed) return;
            if (!value || value.request_id !== result.request_id) {
              feedback.textContent =
                "No confirmed delivery update is available yet. You can check again later.";
              feedback.hidden = false;
              onState("needsyou");
            } else {
              showReceipt(value);
              onState(value.delivery === "accepted" ? "done" : "needsyou");
            }
          } catch {
            if (!disposed) {
              feedback.textContent =
                "Delivery status is unavailable. Please check again later.";
              feedback.hidden = false;
              onState("needsyou");
            }
          } finally {
            working = false;
            if (!disposed) {
              setBusy(false);
              check.disabled = false;
            }
          }
        },
        "mono-contact-primary",
      );
      actions.append(check);
    }
    if (result.delivery === "failed" && reviewed)
      actions.append(
        button("Review and retry", showReview, "mono-contact-primary"),
      );
    actions.append(button("Back to chat", hide));
    section.append(actions);
    reveal(h);
  }
  const api = {
    open,
    offer(draft, article) {
      const normalized = Core.contactDraft(draft);
      if (!normalized) return;
      // Both entry points can reuse details already collected in this conversation.
      latestDraft = normalized;
      article.append(
        button("Review contact details", () => open(), "mono-contact-offer"),
      );
    },
    setReady(value) {
      ready = !!value;
    },
    restore(value) {
      const normalized = Core.contactReceipt(value);
      if (normalized) {
        rejection = null;
        receipt = normalized;
        requestId = normalized.request_id;
        if (!working) showReceipt(normalized);
      }
    },
    reset() {
      if (api.unresolved) return;
      receipt = null;
      rejection = null;
      requestId = "";
      latestDraft = null;
      reviewed = null;
      section.hidden = true;
      section.replaceChildren();
      onChange();
    },
    destroy() {
      disposed = true;
      section.remove();
      latestDraft = null;
      reviewed = null;
      receipt = null;
      rejection = null;
    },
    get visible() {
      return !section.hidden;
    },
    get unresolved() {
      return receipt?.delivery === "unknown";
    },
    get recoverable() {
      return rejection !== null;
    },
    get delivery() {
      return receipt?.delivery || null;
    },
  };
  return api;
}
export { create };
