import { requireRevision, withProjectApi } from "../../../../../../src/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; revision: string }> }) {
  return withProjectApi(request, async (store, owner) => {
    const { id, revision } = await context.params;
    return Response.json({ version: await store.version(owner, id, requireRevision(Number(revision))) });
  });
}
