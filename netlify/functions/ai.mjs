import { refuse } from "./_auth.mjs";
const OPENAI_API = "https://api.openai.com/v1";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_TIMEOUT_MS = 240_000;
const GEMINI_TEXT_TIMEOUT_MS = 60_000;

const PROVIDERS = {
  gemini: {
    generateModel: "gemini-3-pro-image-preview",
    generateModels: [
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview",
      "gemini-2.5-flash-image",
    ],
    validateModel: "gemini-3.5-flash",
    validateModels: [
      "gemini-3.5-flash",
      "gemini-2.5-flash",
    ],
    keyEnv: "GEMINI_API_KEY",
  },
  openai: {
    generateModel: "gpt-image-2",
    imageModels: [
      "gpt-image-2",
      "gpt-image-1.5",
      "gpt-image-1",
    ],
    validateModel: "gpt-4.1-mini",
    keyEnv: "OPENAI_API_KEY",
  },
};

function normalizeGemini(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) throw new Error("No candidates returned");
  const parts = candidate.content?.parts || [];
  return {
    text: parts.filter((part) => part.text).map((part) => part.text).join("\n"),
    images: parts
      .filter((part) => part.inlineData)
      .map((part) => ({
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      })),
    allParts: [],
    finish: candidate.finishReason,
  };
}

function normalizeOpenAIText(response) {
  return { text: response.output_text || "" };
}

function normalizeOpenAIImage(response, options = {}) {
  const image = response?.data?.[0];
  const base64 = image?.b64_json;
  if (!base64) throw new Error("No image returned from OpenAI");
  const format = (response.output_format || options.outputFormat || "jpeg").replace("jpg", "jpeg");
  const mimeType = `image/${format}`;
  return {
    images: [{ base64, mimeType }],
    allParts: [],
    revisedPrompt: image?.revised_prompt || null,
    usage: response.usage || null,
  };
}

async function callGemini(key, model, contents, wantImage, options = {}) {
  const timeoutMs = wantImage ? GEMINI_IMAGE_TIMEOUT_MS : GEMINI_TEXT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents,
        generationConfig: wantImage ? geminiGenerationConfig(model, options) : {},
      }),
    });
  } catch (error) {
    const wrapped = new Error(`Gemini ${model} ${wantImage ? "image" : "text"} request failed: ${error?.name === "AbortError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : error?.message || "fetch failed"}`);
    wrapped.status = error?.name === "AbortError" ? 504 : 503;
    wrapped.model = model;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Gemini ${model} ${response.status}: ${body.slice(0, 500)}`);
    error.status = response.status;
    error.model = model;
    throw error;
  }
  return response.json();
}

function modelCandidates(config, listKey, singleKey) {
  const list = Array.isArray(config?.[listKey]) ? config[listKey].filter(Boolean) : [];
  if (list.length) return list;
  return config?.[singleKey] ? [config[singleKey]] : [];
}

function shortError(error) {
  return String(error?.message || error || "Unknown error").replace(/\s+/g, " ").slice(0, 220);
}

function base64ToBytes(base64) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function base64ToBlob(base64, mimeType = "image/jpeg") {
  return new Blob([base64ToBytes(base64)], { type: mimeType });
}

function openAIImageSize(aspect = "4:3", model = "gpt-image-2") {
  if (aspect === "1:1") return "1024x1024";
  if (aspect === "4:5" || aspect === "9:16") return "1024x1536";
  return "1536x1024";
}

function geminiGenerationConfig(model, options = {}) {
  const image = { aspectRatio: options.aspect || "4:3" };
  if (model === "gemini-3-pro-image-preview" || model === "gemini-3.1-flash-image-preview") {
    image.imageSize = options.imageSize || "2K";
  }
  return {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: image,
  };
}

function shouldTryNextGemini(error) {
  const retryStatuses = new Set([404, 408, 409, 429, 500, 502, 503, 504]);
  if (retryStatuses.has(error?.status)) return true;
  return /fetch failed|network|overloaded|busy|capacity|unavailable|resource_exhausted|deadline|timeout|timed out|not found|model/i.test(shortError(error));
}

function shouldTryNextOpenAI(error) {
  const retryStatuses = new Set([400, 404, 408, 409, 429, 500, 502, 503, 504]);
  if (retryStatuses.has(error?.status)) {
    return /model|not found|does not exist|unsupported|invalid|rate|limit|busy|overload|capacity|timeout|deadline|unavailable/i.test(shortError(error));
  }
  return /model|not found|does not exist|unsupported|rate|limit|busy|overload|capacity|timeout|deadline|unavailable/i.test(shortError(error));
}

async function callGeminiImageWithFallback(key, config, contents, options = {}) {
  const models = modelCandidates(config, "generateModels", "generateModel");
  const errors = [];

  for (const [index, model] of models.entries()) {
    try {
      const modelOptions = { ...options, imageSize: model === "gemini-2.5-flash-image" ? null : options.imageSize || "2K" };
      const normalized = normalizeGemini(await callGemini(key, model, contents, true, modelOptions));
      if (!normalized.images.length) {
        const error = new Error(`No image from ${model}: ${normalized.text || normalized.finish || "empty response"}`);
        error.status = 502;
        throw error;
      }
      return { ...normalized, modelUsed: model, fallbackUsed: index > 0, fallbackErrors: index > 0 ? [...errors] : [] };
    } catch (error) {
      errors.push(`${model}: ${shortError(error)}`);
      if (index === models.length - 1 || !shouldTryNextGemini(error)) {
        throw new Error(errors.length > 1 ? `Gemini fallback failed: ${errors.join(" | ")}` : shortError(error));
      }
    }
  }

  throw new Error("No Gemini image models configured");
}

async function callGeminiTextWithFallback(key, config, contents) {
  const models = modelCandidates(config, "validateModels", "validateModel");
  const errors = [];

  for (const [index, model] of models.entries()) {
    try {
      return { ...normalizeGemini(await callGemini(key, model, contents, false)), modelUsed: model, fallbackUsed: index > 0, fallbackErrors: index > 0 ? [...errors] : [] };
    } catch (error) {
      errors.push(`${model}: ${shortError(error)}`);
      if (index === models.length - 1 || !shouldTryNextGemini(error)) {
        throw new Error(errors.length > 1 ? `Gemini text fallback failed: ${errors.join(" | ")}` : shortError(error));
      }
    }
  }

  throw new Error("No Gemini text models configured");
}

async function callOpenAIText(key, model, partsOrText) {
  const content = Array.isArray(partsOrText)
    ? partsOrText.map((part) =>
        part.inlineData
          ? { type: "input_image", image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
          : { type: "input_text", text: part.text || "" },
      )
    : [{ type: "input_text", text: String(partsOrText || "") }];

  const response = await fetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    const error = new Error(`OpenAI ${model} ${response.status}: ${(await response.text()).slice(0, 500)}`);
    error.status = response.status;
    error.model = model;
    throw error;
  }
  return response.json();
}

async function callOpenAIImage(key, model, prompt, imageBase64, imageBase64s = null, options = {}) {
  const images = (Array.isArray(imageBase64s) && imageBase64s.length ? imageBase64s : [imageBase64]).filter(Boolean);
  const size = openAIImageSize(options.aspect, model);
  const quality = options.quality || "high";
  const outputFormat = options.outputFormat || "jpeg";
  let response;

  if (images.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", outputFormat);
    if (model !== "gpt-image-2") form.append("input_fidelity", "high");
    images.forEach((image, index) => {
      const mimeType = options.imageMimeTypes?.[index] || "image/jpeg";
      const ext = mimeType.includes("png") ? "png" : "jpg";
      form.append("image[]", base64ToBlob(image, mimeType), `reference-${index + 1}.${ext}`);
    });
    response = await fetch(`${OPENAI_API}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } else {
    response = await fetch(`${OPENAI_API}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt, size, quality, output_format: outputFormat }),
    });
  }

  if (!response.ok) {
    const error = new Error(`OpenAI ${model} ${response.status}: ${(await response.text()).slice(0, 500)}`);
    error.status = response.status;
    error.model = model;
    throw error;
  }
  return response.json();
}

async function callOpenAIImageWithFallback(key, config, prompt, imageBase64, imageBase64s = null, options = {}) {
  const models = modelCandidates(config, "imageModels", "generateModel");
  const errors = [];

  for (const [index, model] of models.entries()) {
    try {
      return {
        ...normalizeOpenAIImage(await callOpenAIImage(key, model, prompt, imageBase64, imageBase64s, options), options),
        modelUsed: model,
        fallbackUsed: index > 0,
        fallbackErrors: index > 0 ? [...errors] : [],
      };
    } catch (error) {
      error.model = error.model || model;
      errors.push(`${model}: ${shortError(error)}`);
      if (index === models.length - 1 || !shouldTryNextOpenAI(error)) {
        throw new Error(errors.length > 1 ? `OpenAI image fallback failed: ${errors.join(" | ")}` : shortError(error));
      }
    }
  }

  throw new Error("No OpenAI image models configured");
}

export async function runAction(body) {
  const provider = PROVIDERS[body.provider] ? body.provider : "gemini";
  const config = PROVIDERS[provider];
  const key = process.env[config.keyEnv];
  if (!key) return { status: 500, body: { error: `${config.keyEnv} is not configured` } };

  if (body.action === "image") {
    if (provider === "openai") {
      return {
        status: 200,
        body: await callOpenAIImageWithFallback(key, config, body.prompt, body.imageBase64, body.imageBase64s, body.openaiOptions || {}),
      };
    }
    return { status: 200, body: await callGeminiImageWithFallback(key, config, body.geminiContents, body.geminiOptions || {}) };
  }

  if (body.action === "text") {
    if (provider === "openai") {
      return { status: 200, body: normalizeOpenAIText(await callOpenAIText(key, config.validateModel, body.partsOrText)) };
    }
    return { status: 200, body: await callGeminiTextWithFallback(key, config, [{ parts: body.partsOrText }]) };
  }

  return { status: 400, body: { error: "Unknown action" } };
}

function streamingJson(handler) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(" \n"));
        }, 5000);

        controller.enqueue(encoder.encode(" \n"));

        try {
          const { status, body } = await handler();
          clearInterval(keepAlive);
          controller.enqueue(encoder.encode(JSON.stringify({ status, ...body })));
        } catch (error) {
          clearInterval(keepAlive);
          controller.enqueue(encoder.encode(JSON.stringify({ status: 500, error: error.message || "Unexpected function error" })));
        } finally {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return streamingJson(() => runAction(body));
};

export const config = { path: "/api/ai" };
