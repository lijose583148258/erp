async function loginApi(page, appUrl, username, password) {
  const response = await page.request.post(`${appUrl}api/auth/login`, {
    data: { username, password },
  });
  if (!response.ok()) {
    throw new Error(`login failed for ${username}: ${response.status()}`);
  }
  const json = await response.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user) {
    throw new Error(`empty login payload for ${username}`);
  }
  return { token, user };
}

async function apiFetch(page, appUrl, endpoint, options = {}, token) {
  const response = await page.request.fetch(`${appUrl}api${endpoint}`, {
    ...options,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok(), status: response.status(), json };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

module.exports = {
  apiFetch,
  loginApi,
  unwrapList,
};
