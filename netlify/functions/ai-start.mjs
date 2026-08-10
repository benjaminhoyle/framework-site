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

function validJobId(jobId) {
  return /^[a-zA-Z0-9_-]{12,80}$/.test(jobId || "");
}

async function writeJob(store, jobId, data) {
  await store.setJSON(jobId, {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON request" });
  }

  const jobId = body.jobId;
  if (!validJobId(jobId)) return json(400, { error: "Invalid job id" });

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const requestKey = `${jobId}:request`;

  await writeJob(store, jobId, {
    state: "queued",
    createdAt: new Date().toISOString(),
    provider: body.provider || "gemini",
  });
  await store.setJSON(requestKey, body);

  const backgroundUrl = new URL("/.netlify/functions/ai-background", request.url);
  const response = await fetch(backgroundUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Forwarded so the background hop is authorised exactly as this one was.
      "x-framework-key": request.headers.get("x-framework-key") || "",
    },
    body: JSON.stringify({ jobId }),
  });

  if (![200, 202].includes(response.status)) {
    const text = await response.text();
    await writeJob(store, jobId, {
      state: "error",
      provider: body.provider || "gemini",
      error: `Could not queue background job (${response.status}): ${text.slice(0, 220)}`,
    });
    return json(500, { error: `Could not queue background job (${response.status})`, jobId });
  }

  return json(202, { jobId, state: "queued" });
};

export const config = { path: "/api/ai-start" };
