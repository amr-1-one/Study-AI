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

function error(message, status = 400) {
  return { error: message, status };
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
          return json({ error: "حجم الفيديو غير صالح أو أكبر من الحد المسموح." }, 413);
        }

        if (!/^video\/(mp4|mpeg|quicktime|x-msvideo|x-flv|webm|x-ms-wmv|3gpp)$/.test(mimeType || "")) {
          return json({ error: "صيغة الفيديو غير مدعومة." }, 400);
        }

        const response = await fetch(
          "https://generativelanguage.googleapis.com/upload/v1beta/files",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": env.GEMINI_API_KEY,
              "X-Goog-Upload-Protocol": "resumable",
              "X-Goog-Upload-Command": "start",
              "X-Goog-Upload-Header-Content-Length": String(size),
              "X-Goog-Upload-Header-Content-Type": mimeType,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              file: {
                display_name: String(name || "study-video").slice(0, 200)
              }
            })
          }
        );

        if (!response.ok) {
          return json({
            error: "تعذر بدء رفع الفيديو إلى Gemini.",
            details: (await response.text()).slice(0, 1000)
          }, 502);
        }

        const uploadUrl = response.headers.get("x-goog-upload-url");

        if (!uploadUrl) {
          return json({ error: "Gemini لم يُرجع رابط الرفع." }, 502);
        }

        return json({
          ok: true,
          uploadUrl,
          chunkSize: CHUNK_SIZE,
          maxSize: MAX_VIDEO_SIZE
        });
      }

      if (url.pathname === "/upload/chunk" && request.method === "POST") {
        const uploadUrl = request.headers.get("X-Upload-Url");
        const offset = Number(request.headers.get("X-Upload-Offset"));
        const finalize = request.headers.get("X-Upload-Finalize") === "true";

        let target;

        try {
          target = new URL(uploadUrl);
        } catch {
          return json({ error: "رابط الرفع غير صالح." }, 400);
        }

        if (
          target.protocol !== "https:" ||
          target.hostname !== "generativelanguage.googleapis.com" ||
          !target.pathname.startsWith("/upload/")
        ) {
          return json({ error: "رابط الرفع غير مسموح." }, 400);
        }

        if (!Number.isSafeInteger(offset)
