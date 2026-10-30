import { readJson, readProjectPayload, requireRevision, withProjectApi } from "../../../../src/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return withProjectApi(request, async (store, owner) => Response.json({ project: await store.get(owner, (await context.params).id) }));
}

export async function PUT(request: Request, context: Context) {
  return withProjectApi(request, async (store, owner) => {
    const body = await readJson(request);
    const { name, document } = readProjectPayload(body);
    return Response.json({ project: await store.save(owner, (await context.params).id, requireRevision(body.expectedRevision), name, document) });
  });
}

export async function DELETE(request: Request, context: Context) {
  return withProjectApi(request, async (store, owner) => {
    const body = await readJson(request);
    await store.delete(owner, (await context.params).id, requireRevision(body.expectedRevision));
    return new Response(null, { status: 204 });
  });
}
