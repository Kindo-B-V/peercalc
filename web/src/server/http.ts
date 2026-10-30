import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { validateProject } from "../domain";
import { ApiError, ProjectStore, type ProjectDatabase, type DocumentBucket } from "./projects";

export const MAX_BODY_BYTES = 20 * 1024 * 1024;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "Content-Type must be application/json");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new ApiError(413, "Project request exceeds the 20 MiB cloud limit");
  if (!request.body) throw new ApiError(400, "A JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, "Project request exceeds the 20 MiB cloud limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "Invalid JSON request"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "A JSON object is required");
  return value as Record<string, unknown>;
}

export function requireRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new ApiError(400, "A positive integer revision is required");
  return value;
}

export function readProjectPayload(body: Record<string, unknown>): { name: string; document: unknown } {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200) throw new ApiError(400, "Project name must contain 1 to 200 characters");
  try { validateProject(body.document); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid project document"); }
  return { name: body.name.trim(), document: body.document };
}

export async function withProjectApi(request: Request, operation: (store: ProjectStore, owner: string) => Promise<Response>): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new ApiError(401, "Sign in to access cloud projects");
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin writes are not allowed");
      if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Cross-origin writes are not allowed");
    }
    if (!env.DB || !env.BUCKET) throw new ApiError(503, "Cloud storage is not configured");
    const response = await operation(new ProjectStore(env.DB as unknown as ProjectDatabase, env.BUCKET as unknown as DocumentBucket), user.userId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("Project request failed", error);
    return Response.json({ error: error instanceof ApiError ? error.message : "Cloud storage request failed" }, { status: error instanceof ApiError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
