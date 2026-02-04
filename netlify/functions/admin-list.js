const { jsonResponse, requireAuth, getApplicationsStore } = require("./_utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const user = requireAuth(event);
  if (!user) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const store = getApplicationsStore();
  const existing = await store.get("submissions.json", { type: "json" });
  const list = Array.isArray(existing) ? existing : [];

  return jsonResponse(200, { submissions: list });
};
