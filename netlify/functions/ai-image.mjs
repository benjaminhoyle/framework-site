import { refuse } from "./_auth.mjs";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "ai-jobs";

function validJobId(jobId) {
  return /^[a-zA-Z0-9_-]{12,80}$/.test(jobId || "");
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("id") || "";
  const index = Number.parseInt(url.searchParams.get("n") || "0", 10);

  if (!validJobId(jobId) || !Number.isInteger(index) || index < 0 || index > 20) {
    return new Response("Invalid image id", { status: 400 });
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const entry = await store.getWithMetadata(`${jobId}:image:${index}`, { type: "stream" });

  if (!entry?.data) {
    return new Response("Image not found", { status: 404 });
  }

  return new Response(entry.data, {
    status: 200,
    headers: {
      "Content-Type": entry.metadata?.mimeType || "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
};

export const config = { path: "/api/ai-image" };
