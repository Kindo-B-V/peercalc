import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { calculateProject, validateProject } from "../../../../src/domain";
import { readJson } from "../../../../src/server/http";
import { ApiError } from "../../../../src/server/projects";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!await getChatGPTUser()) throw new ApiError(401, "Sign in to export WPCalc files");
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Cross-origin writes are not allowed");
    const config = env as typeof env & { CALC_CONVERTER_URL?: string; CALC_CONVERTER_TOKEN?: string };
    if (!config.CALC_CONVERTER_URL || !config.CALC_CONVERTER_TOKEN) throw new ApiError(503, "WPCalc export converter is not configured");
    const body = await readJson(request);
    let project;
    try { validateProject(body.document); project = calculateProject(body.document); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid native document"); }
    let response: Response;
    try {
      response = await fetch(new URL("/export", config.CALC_CONVERTER_URL), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.CALC_CONVERTER_TOKEN}` },
        body: JSON.stringify(project),
        signal: AbortSignal.timeout(60_000),
      });
    } catch { throw new ApiError(503, "WPCalc converter is unavailable; the native document has not been changed"); }
    if (!response.ok) {
      let message = "WPCalc conversion failed; the native document has not been changed";
      if (response.status === 422) {
        const detail = await response.json().catch(() => null) as { error?: string; code?: string } | null;
        if (typeof detail?.error === "string") message = detail.error;
        if (detail?.code === "SOURCE_INDEX_UNSUPPORTED") throw new ApiError(422, message, detail.code);
      }
      throw new ApiError(response.status === 422 ? 422 : 503, message);
    }
    const name = project.schedule.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "begroting";
    return new Response(response.body, { headers: { "Content-Type": "application/vnd.ms-access", "Content-Disposition": `attachment; filename="${name}.calc"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("WPCalc export failed", error);
    return Response.json({ error: error instanceof ApiError ? error.message : "WPCalc export failed", ...(error instanceof ApiError && error.code ? { code: error.code } : {}) }, { status: error instanceof ApiError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
