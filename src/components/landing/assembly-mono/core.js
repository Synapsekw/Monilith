function safeHref(value, base, allowedOrigins = []) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, base),
      origin = new URL(base).origin;
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (url.origin !== origin && !allowedOrigins.includes(url.origin))
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function normalizeReply(value) {
  if (!value || typeof value.reply !== "string" || !value.reply.trim())
    throw new Error("Mono could not read that reply. Please try again.");
  return {
    reply: value.reply.trim().slice(0, 8000),
    links: (Array.isArray(value.links) ? value.links : [])
      .slice(0, 5)
      .filter(
        (x) => x && typeof x.label === "string" && typeof x.href === "string",
      )
      .map((x) => ({
        label: x.label.slice(0, 120),
        href: x.href.slice(0, 2048),
      })),
    contact_request: contactDraft(value.contact_request),
  };
}
const contactFields = {
  name: 100,
  phone: 40,
  email: 254,
  reason: 1000,
  company: 120,
  preferred_time: 160,
  timezone: 80,
};
function contactDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = {};
  for (const [key, max] of Object.entries(contactFields))
    draft[key] =
      typeof value[key] === "string" ? value[key].trim().slice(0, max) : "";
  return draft;
}
function validateContact(value) {
  const lead = contactDraft(value);
  if (!lead || !lead.name || !lead.reason)
    return {
      error: "Add your name and what you would like to discuss.",
      field: !lead?.name ? "name" : "reason",
    };
  if (!lead.phone && !lead.email)
    return {
      error: "Add a phone number or email so the team can reach you.",
      field: "phone",
    };
  if (
    lead.phone &&
    !/^\+[1-9][0-9]{6,14}$/.test(lead.phone.replace(/[\s().-]/g, ""))
  )
    return {
      error: "Include your country code, for example +971 50 123 4567.",
      field: "phone",
    };
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email))
    return { error: "Enter a valid email address.", field: "email" };
  return { lead };
}
function contactReceipt(value) {
  if (
    !value ||
    !["accepted", "failed", "unknown"].includes(value.delivery) ||
    typeof value.reply !== "string" ||
    !value.reply.trim()
  )
    return null;
  return {
    delivery: value.delivery,
    reply: value.reply.trim().slice(0, 2000),
    reference:
      typeof value.reference === "string" ? value.reference.slice(0, 160) : "",
    request_id:
      typeof value.request_id === "string"
        ? value.request_id.slice(0, 160)
        : "",
  };
}
function preparedReply(message, links = {}) {
  const text = String(message).toLowerCase();
  const link = (label, key) =>
    links[key] ? [{ label, href: links[key] }] : [];
  if (/\b(price|pricing|cost|plan|trial|subscription)\b/.test(text))
    return {
      reply:
        "You can compare Monolith’s current plans and trial terms on the pricing page. Choose the plan around the way your team works and the AI capabilities you need.",
      links: link("Explore plans", "pricing"),
    };
  if (/\b(agent|agents|ai|mcp|claude|gpt|automation)\b/.test(text))
    return {
      reply:
        "Monolith brings people and compatible AI tools into the same work. Through MCP, agents can help create projects, assign work and update tasks within the access you authorize. Explore the agent section to see the approach.",
      links: link("Explore agent access", "agents"),
    };
  if (/\b(start|sign.?up|account|join)\b/.test(text))
    return {
      reply:
        "Start by creating your Monolith workspace. The signup page will guide you through the current setup and trial terms.",
      links: link("Create your workspace", "signup"),
    };
  if (
    /\b(board|workspace|product|project|task|team|tour|organize|work)\b/.test(
      text,
    )
  )
    return {
      reply:
        "Keep projects, people and the context around each task together. Explore the product tour to see the board, task details and agent dock in one connected workspace.",
      links: link("Explore the workspace", "product"),
    };
  if (/^(hi|hello|hey|thanks|thank you)[!. ]*$/.test(text))
    return {
      reply:
        "Hi, I’m Mono. What shall we put in order? I can show you the workspace, explain agent access or help you find the plans.",
      links: [
        ...link("Explore the workspace", "product"),
        ...link("See agent access", "agents"),
      ],
    };
  return {
    reply:
      "I can help you explore the workspace, understand agent access or find the right page to get started. This site guide currently uses prepared answers.",
    links: [
      ...link("Explore the workspace", "product"),
      ...link("See agent access", "agents"),
      ...link("Compare plans", "pricing"),
    ],
  };
}
function createHttpTransport({
  endpoint = "/api/mono",
  fetch: fetcher = globalThis.fetch,
  base = globalThis.location?.href || "http://localhost/",
  tokenHeader = "X-Mono-Token",
} = {}) {
  const url = new URL(endpoint, base);
  if (
    url.origin !== new URL(base).origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Mono requires a same-origin chat endpoint.");
  if (typeof fetcher !== "function") throw new Error("Fetch is unavailable.");
  let token = "",
    ready = false;
  async function request(action, body, signal) {
    const target = new URL(url);
    target.searchParams.set("action", action);
    const response = await fetcher(target.href, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", [tokenHeader]: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 403) {
      token = "";
      ready = false;
    }
    let result;
    try {
      result = await response.json();
    } catch {
      const error = new Error("Mono could not connect. Please try again.");
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      if (response.status === 403) {
        token = "";
        ready = false;
      }
      const error = new Error(
        typeof result.error === "string"
          ? result.error.slice(0, 500)
          : "Mono could not complete that request. Please try again.",
      );
      error.status = response.status;
      throw error;
    }
    return result;
  }
  return {
    async connect({ signal } = {}) {
      const data = await request("status", undefined, signal);
      ready =
        data.mode === "live" && typeof data.token === "string" && !!data.token;
      token = ready ? data.token : "";
      return {
        ...data,
        mode: ready ? "live" : data.mode === "preview" ? "guide" : "offline",
      };
    },
    async respond(message, { signal, requestId, page } = {}) {
      if (!ready)
        throw new Error("Reconnect to Mono before sending another message.");
      return request("chat", { message, request_id: requestId, page }, signal);
    },
    async callback(lead, { signal, requestId, page } = {}) {
      if (!ready)
        throw new Error("Reconnect to Mono before sending your request.");
      const checked = validateContact(lead);
      if (checked.error) throw new Error(checked.error);
      if (typeof requestId !== "string" || !requestId)
        throw new Error("This contact request needs a reference.");
      return request(
        "callback",
        { request_id: requestId, confirmed: true, lead: checked.lead, page },
        signal,
      );
    },
    async reset({ signal } = {}) {
      if (!ready) throw new Error("Reconnect to Mono before starting again.");
      const data = await request("reset", {}, signal);
      if (typeof data.token !== "string" || !data.token) {
        ready = false;
        token = "";
        throw new Error(
          "Mono could not start a new conversation. Please reconnect.",
        );
      }
      token = data.token;
      return data;
    },
    get ready() {
      return ready;
    },
  };
}
export {
  safeHref,
  normalizeReply,
  preparedReply,
  createHttpTransport,
  contactDraft,
  validateContact,
  contactReceipt,
};
