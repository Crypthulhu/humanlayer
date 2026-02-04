import { jsonResponse, verifyPassword, buildToken } from "./_utils.mjs";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const { ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_SALT } = process.env;
  if (!ADMIN_PASSWORD_HASH || !ADMIN_PASSWORD_SALT) {
    return jsonResponse(500, { error: "Admin credentials not configured" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const { password } = payload;
  if (!password) {
    return jsonResponse(400, { error: "Password required" });
  }

  const ok = verifyPassword(password, ADMIN_PASSWORD_SALT, ADMIN_PASSWORD_HASH);
  if (!ok) {
    return jsonResponse(401, { error: "Invalid credentials" });
  }

  const token = buildToken();
  return jsonResponse(200, { token });
};
