import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const norm = (c) => String(c || "").toUpperCase().replace(/[\s-]+/g, "");
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const hex = /^#[0-9a-fA-F]{6}$/;
const MAX = 1500000;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  const action = new URL(req.url).pathname.replace(/^\/api\/cal\/?/, "");
  const code = norm(req.headers.get("x-calendar-code"));
  if (code.length < 8 || code.length > 64) return json({ error: "Access codes are at least 8 characters." }, 400);
  let body = {};
  try { body = await req.json(); } catch {}

  const store = getStore({ name: "planner-calendars", consistency: "strong" });
  const key = "cal-" + createHash("sha256").update("planner-v1:" + code).digest("hex"); // the code itself is never stored
  const cur = await store.get(key, { type: "json" });

  if (action === "create") {
    if (cur) return json({ error: "That code is already taken — choose another." }, 409);
    const cats = (Array.isArray(body.categories) ? body.categories : []).slice(0, 24)
      .map((c) => ({ id: rid(), name: String((c && c.name) || "").trim().slice(0, 40), color: hex.test(c && c.color) ? c.color : "#7A7166" }))
      .filter((c) => c.name);
    const state = { rev: 1, categories: cats.length ? cats : [{ id: rid(), name: "Work", color: "#4F7A5B" }], events: [], reflections: {} };
    await store.setJSON(key, state);
    return json({ state });
  }

  if (!cur) return json({ error: "We couldn't find a calendar with that code." }, 404);

  if (action === "open") return body.rev === cur.rev ? json({ unchanged: true, rev: cur.rev }) : json({ state: cur });

  if (action === "save") {
    if (body.baseRev !== cur.rev) return json({ error: "Updated on another device.", state: cur }, 409);
    const s = body.state || {};
    if (!Array.isArray(s.categories) || !Array.isArray(s.events) || s.categories.length < 1 || s.categories.length > 24 || s.events.length > 20000)
      return json({ error: "Invalid data." }, 400);
    const next = { rev: cur.rev + 1, categories: s.categories, events: s.events, reflections: (s.reflections && typeof s.reflections === "object") ? s.reflections : {} };
    if (JSON.stringify(next).length > MAX) return json({ error: "Calendar is too large to save." }, 413);
    await store.setJSON(key, next);
    return json({ rev: next.rev });
  }
  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/cal/*" };
