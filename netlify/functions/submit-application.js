const { jsonResponse, getApplicationsStore } = require("./_utils");

function sanitizeValue(value) {
  if (typeof value === "string") return value.trim();
  return value;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const now = new Date();
  const submission = {
    id: `app_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    submitted_at: now.toISOString(),
  };

  Object.keys(payload || {}).forEach((key) => {
    submission[key] = sanitizeValue(payload[key]);
  });

  const store = getApplicationsStore();
  const existing = await store.get("submissions.json", { type: "json" });
  const list = Array.isArray(existing) ? existing : [];
  list.unshift(submission);

  await store.set("submissions.json", JSON.stringify(list), {
    contentType: "application/json",
  });

  return jsonResponse(200, { ok: true });
};
