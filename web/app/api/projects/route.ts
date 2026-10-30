import { readJson, readProjectPayload, withProjectApi } from "../../../src/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withProjectApi(request, async (store, owner) => Response.json({ projects: await store.list(owner) }));
}

export async function POST(request: Request) {
  return withProjectApi(request, async (store, owner) => {
    const { name, document } = readProjectPayload(await readJson(request));
    return Response.json({ project: await store.create(owner, name, document) }, { status: 201 });
  });
}
