
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "StudyAI API",
        keyConfigured: Boolean(env.GEMINI_API_KEY)
      });
    }

    if (url.pathname === "/") {
      return new Response("StudyAI API is running", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    return Response.json(
      { ok: false, error: "Route not found" },
      { status: 404 }
    );
  }
};
