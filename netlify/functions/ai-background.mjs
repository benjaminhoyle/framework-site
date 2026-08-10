import { refuse } from "./_auth.mjs";
import { getStore } from "@netlify/blobs";
import { runAction } from "./ai.mjs";

const STORE_NAME = "ai-jobs";
const INLINE_IMAGE_BASE64_LIMIT = 4_000_000;

async function writeJob(jobId, data) {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  await store.setJSON(jobId, {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

function base64ToBytes(base64) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function storeImages(jobId, result) {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const images = result.images || [];
  const storedImages = [];

  for (const [index, image] of images.entries()) {
    const key = `${jobId}:image:${index}`;
    const mimeType = image.mimeType || "image/png";
    await store.set(key, base64ToBytes(image.base64), {
      metadata: { mimeType },
    });
    storedImages.push({
      mimeType,
      url: `/api/ai-image?id=${encodeURIComponent(jobId)}&n=${index}`,
      ...(image.base64 && image.base64.length <= INLINE_IMAGE_BASE64_LIMIT ? { base64: image.base64 } : {}),
    });
  }

  return {
    ...result,
    images: storedImages,
  };
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  if (request.method !== "POST") return new Response(null, { status: 405 });

  let invocation;
  try {
    invocation = await request.json();
  } catch {
    return;
  }

  const jobId = invocation.jobId;
  if (!jobId || !/^[a-zA-Z0-9_-]{12,80}$/.test(jobId)) return;

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const body = await store.get(`${jobId}:request`, { type: "json" });
  if (!body) {
    await writeJob(jobId, {
      state: "error",
      error: "Missing stored job request",
    });
    return;
  }

  await writeJob(jobId, {
    state: "processing",
    provider: body.provider || "gemini",
  });

  try {
    const { status, body: result } = await runAction({ ...body, action: "image" });
    if (status >= 400) {
      await writeJob(jobId, {
        state: "error",
        error: result?.error || `Function ${status}`,
        provider: body.provider || "gemini",
      });
      return;
    }

    const storedResult = await storeImages(jobId, result);

    await writeJob(jobId, {
      state: "done",
      provider: body.provider || "gemini",
      result: storedResult,
    });
  } catch (error) {
    await writeJob(jobId, {
      state: "error",
      provider: body.provider || "gemini",
      error: error.message || "Unexpected background function error",
    });
  }
};
