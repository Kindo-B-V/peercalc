import { withProjectApi } from "../../../../../src/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withProjectApi(request, async (store, owner) => Response.json({ versions: await store.versions(owner, (await context.params).id) }));
}
