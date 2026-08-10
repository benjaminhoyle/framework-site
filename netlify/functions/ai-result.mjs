import { refuse } from "./_auth.mjs";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "ai-jobs";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(jobId)) {
    return json(400, { state: "error", error: "Invalid job id" });
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const job = await store.get(jobId, { type: "json" });

  if (!job) {
    return json(200, { state: "pending" });
  }

  return json(200, job);
};

export const config = { path: "/api/ai-result" };
