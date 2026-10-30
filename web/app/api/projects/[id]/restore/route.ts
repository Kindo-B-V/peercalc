import { readJson, requireRevision, withProjectApi } from "../../../../../src/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withProjectApi(request, async (store, owner) => {
    const body = await readJson(request);
    return Response.json({ project: await store.restore(owner, (await context.params).id, requireRevision(body.expectedRevision), requireRevision(body.revision)) });
  });
}
