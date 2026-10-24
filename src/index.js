
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
      "Access-Control-Allow-Headers": "Content-Type",
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
          "Access-Control-Allow-Headers": "Content-Type",
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
              file: { display_name: String(name || "study-video").slice(0, 200) }
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

        if (!Number.isSafeInteger(offset) || offset < 0) {
          return json({ error: "موضع الجزء غير صالح." }, 400);
        }

        const chunk = await request.arrayBuffer();

        if (!chunk.byteLength || chunk.byteLength > CHUNK_SIZE) {
          return json({ error: "حجم جزء الفيديو غير صالح." }, 413);
        }

        const response = await fetch(target.toString(), {
          method: "POST",
          headers: {
            "Content-Length": String(chunk.byteLength),
            "X-Goog-Upload-Offset": String(offset),
            "X-Goog-Upload-Command": finalize ? "upload, finalize" : "upload"
          },
          body: chunk
        });

        const text = await response.text();

        if (!response.ok) {
          return json({
            error: "فشل رفع جزء من الفيديو.",
            details: text.slice(0, 1000)
          }, 502);
        }

        let result = {};
        try {
          result = text ? JSON.parse(text) : {};
        } catch {}

        return json({
          ok: true,
          finalized: finalize,
          file: result.file || null
        });
      }

      if (url.pathname === "/analyze" && request.method === "POST") {
        const body = await request.json();
        const { fileUri, mimeType } = body;

        if (
          typeof fileUri !== "string" ||
          !fileUri.startsWith("https://generativelanguage.googleapis.com/") ||
          !/^video\//.test(mimeType || "")
        ) {
          return json({ error: "بيانات الفيديو غير صالحة." }, 400);
        }

        const prompt = `
حلّل الفيديو الدراسي المرفق باللغة العربية، وأنشئ JSON فقط بهذه المفاتيح:
title: عنوان مناسب.
summary: ملخص واضح ومفيد.
keyPoints: مصفوفة من أهم النقاط.
article: مقال تعليمي منظم يشرح محتوى الفيديو.
quiz: مصفوفة من 5 إلى 10 أسئلة اختيار من متعدد.

كل عنصر في quiz يجب أن يحتوي:
question: نص السؤال.
options: أربع إجابات محتملة.
answerIndex: رقم الإجابة الصحيحة، يبدأ من صفر.
explanation: شرح موجز لسبب صحة الإجابة.

اعتمد على محتوى الفيديو فقط. لا تخترع معلومات غير موجودة فيه.
أعد JSON صالحًا دون علامات Markdown.
`;

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": env.GEMINI_API_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  { fileData: { mimeType, fileUri } },
                  { text: prompt }
                ]
              }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.3
              }
            })
          }
        );

        const resultText = await response.text();
        let result;

        try {
          result = JSON.parse(resultText);
        } catch {
          return json({ error: "رد Gemini غير صالح." }, 502);
        }

        if (!response.ok) {
          return json({
            error: "تعذر تحليل الفيديو باستخدام Gemini.",
            details: result.error?.message || "خطأ غير معروف"
          }, 502);
        }

        const generated = result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!generated) {
          return json({ error: "Gemini لم يُرجع نتيجة تحليل." }, 502);
        }

        let data;
        try {
          data = JSON.parse(generated);
        } catch {
          return json({ error: "نتيجة التحليل ليست JSON صالحًا." }, 502);
        }

        if (
          typeof data.summary !== "string" ||
          !Array.isArray(data.keyPoints) ||
          typeof data.article !== "string" ||
          !Array.isArray(data.quiz)
        ) {
          return json({ error: "نتيجة التحليل ناقصة." }, 502);
        }

        return json({ ok: true, ...data });
      }

      if (url.pathname === "/" && request.method === "GET") {
        return json({ ok: true, service: "StudyAI API" });
      }

      return json({ error: "Route not found" }, 404);
    } catch (err) {
      return json({
        error: "حدث خطأ أثناء معالجة الطلب.",
        details: String(err?.message || err).slice(0, 500)
      }, 500);
    }
  }
};
