```javascript
const ALLOWED_ORIGIN = "https://amr-1-one.github.io";
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Upload-Url, X-Upload-Offset, X-Upload-Finalize",
      "Vary": "Origin"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Upload-Url, X-Upload-Offset, X-Upload-Finalize",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "StudyAI API",
        keyConfigured: Boolean(env.GEMINI_API_KEY)
      });
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "GEMINI_API_KEY is not configured" }, 500);
    }

    try {
      if (url.pathname === "/upload/start" && request.method === "POST") {
        const body = await request.json();
        const { name, size, mimeType } = body;

        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_SIZE) {
          return json({ error: "حجم الفيديو غير صالح أو أكبر من الحد المسموح." }, 413```javascript
const ALLOWED_ORIGIN = "https://amr-1-one.github.io";
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Upload-Url, X-Upload-Offset, X-Upload-Finalize",
      "Vary": "Origin"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Upload-Url, X-Upload-Offset, X-Upload-Finalize",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "StudyAI API",
        keyConfigured: Boolean(env.GEMINI_API_KEY)
      });
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "GEMINI_API_KEY is not configured" }, 500);
    }

    try {
      if (url.pathname === "/upload/start" && request.method === "POST") {
        const body = await request.json();
        const { name, size, mimeType } = body;

        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_SIZE) {
          return json({ error: "حجم الفيديو غير صالح أو أكبر من الحد المسموح." }, 413
