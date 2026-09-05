/**
 * Putting a rendered shelf into a room.
 *
 * A thin driver over the same background-job endpoints the scene studio uses:
 * `/api/ai-start` queues the work and `/api/ai-result` is polled until it comes
 * back. The prompt is built by js/studio/scene-prompt.js — the scene studio's
 * own assembly, lifted out so there is one of it — from a preset in
 * js/design-lab/scene-presets.js.
 *
 * What this file adds is only the plumbing: the render as a reference image,
 * the polling, and a cap.
 *
 * **The cap is the point.** Every one of these costs money, and the studio flow
 * fires them off the back of renders that are themselves fired off the back of
 * a keypress. Something has to stop, and a number that has to be raised
 * deliberately is a better stop than remembering to look.
 */
window.FrameworkSceneJobs = (function () {
  "use strict";

  const START_URL = "/api/ai-start";
  const RESULT_URL = "/api/ai-result";
  const PROVIDER = "gemini";
  const POLL_START_MS = 1800;
  const POLL_MAX_MS = 4500;
  const GIVE_UP_MS = 8 * 60 * 1000;

  function jobId() {
    return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  /** The gate holds the key; nothing here ever sees it. */
  function send(url, options) {
    const gate = window.FrameworkGate;
    return gate && String(url).startsWith("/api/") ? gate.fetch(url, options) : fetch(url, options);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /**
   * Start one image job and wait for it.
   *
   * The reference image is labelled the way the scene studio labels it, because
   * the prompt's VIEWPOINT LOCK refers to "REFERENCE IMAGE 1" by name and a
   * differently worded label would leave that instruction pointing at nothing.
   */
  async function generate(options) {
    const { prompt, imageBase64, mimeType, onState } = options;
    if (!prompt) throw new Error("a scene needs a prompt");
    if (!imageBase64) throw new Error("a scene needs a render to work from");

    const id = jobId();
    const payload = {
      jobId: id,
      action: "image",
      provider: PROVIDER,
      prompt,
      geminiContents: [{
        parts: [
          { text: prompt },
          { text: "REFERENCE IMAGE 1: GEOMETRY AND VIEWPOINT MASTER - copy the shelf's exact silhouette, tier count, board endpoints, tube and post positions, overhangs, colour, material, joints, and the vantage it is seen from. Do not copy its room or styling." },
          { inlineData: { mimeType: mimeType || "image/png", data: imageBase64 } }
        ]
      }]
    };

    const started = await send(START_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (![200, 202].includes(started.status)) {
      throw new Error(`could not start the scene job (${started.status}): ${(await started.text()).slice(0, 200)}`);
    }
    if (onState) onState("queued");

    const from = Date.now();
    let interval = POLL_START_MS;
    let last = "";
    while (Date.now() - from < GIVE_UP_MS) {
      await wait(interval);
      interval = Math.min(POLL_MAX_MS, interval + 350);
      const response = await send(`${RESULT_URL}?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
        headers: { Accept: "application/json" }
      });
      const raw = await response.text();
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(`scene job returned non-JSON (${response.status}): ${raw.slice(0, 160)}`);
      }
      if (body.state && body.state !== last) {
        last = body.state;
        if (onState) onState(body.state);
      }
      if (body.state === "done" || body.state === "complete" || body.result) {
        const inline = firstImage(body);
        if (inline) return { jobId: id, dataUrl: inline };
        /*
         * No picture in the envelope does not mean no picture.
         *
         * ai-background stores every image in Blobs and only *copies* it into
         * the result when its base64 is under four megabytes. A scene at the
         * size this asks for never is — so a finished, paid-for job arrives
         * carrying a `url` and nothing else, and reading only the envelope
         * reported it as "finished without an image". Every scene the studio
         * ever asked for failed this way.
         */
        const stored = imageUrl(body);
        if (stored) return { jobId: id, dataUrl: await fetchImage(stored) };
        throw new Error("the scene job finished without an image");
      }
      if (body.state === "error" || body.error) {
        throw new Error(String(body.error || "the scene job failed"));
      }
    }
    throw new Error(`the scene job did not finish in ${Math.round(GIVE_UP_MS / 60000)} minutes`);
  }

  /**
   * Find the picture in whatever shape came back.
   *
   * The result envelope has changed shape before and these jobs are expensive
   * to repeat, so this looks in the places an image has been rather than
   * insisting on one.
   *
   * An image is a string (a data URL, or bare base64) or an object carrying
   * one. The object form is what the background job actually returns today —
   * `result.images[0]` is `{ mimeType, url, base64 }`, with no `dataUrl` on it
   * — and reading only `.dataUrl` there is how a finished, paid-for scene came
   * back as "the scene job finished without an image".
   */
  function asDataUrl(candidate) {
    if (!candidate) return null;
    if (typeof candidate === "string") {
      if (candidate.startsWith("data:")) return candidate;
      // A bare base64 payload. Short strings are ids and urls, not pictures.
      return candidate.length > 256 ? `data:image/jpeg;base64,${candidate}` : null;
    }
    if (typeof candidate !== "object") return null;
    if (typeof candidate.dataUrl === "string") return asDataUrl(candidate.dataUrl);
    if (typeof candidate.base64 === "string" && candidate.base64.length > 256) {
      return `data:${candidate.mimeType || "image/png"};base64,${candidate.base64}`;
    }
    if (typeof candidate.inlineData === "object" && candidate.inlineData) {
      return asDataUrl({
        mimeType: candidate.inlineData.mimeType,
        base64: candidate.inlineData.data
      });
    }
    return null;
  }

  function firstImage(body) {
    const images = [
      body.result && Array.isArray(body.result.images) ? body.result.images : [],
      Array.isArray(body.images) ? body.images : []
    ];
    const candidates = [
      body.dataUrl,
      body.image,
      body.result && body.result.dataUrl,
      body.result && body.result.image,
      ...images[0],
      ...images[1]
    ];
    for (const candidate of candidates) {
      const dataUrl = asDataUrl(candidate);
      if (dataUrl) return dataUrl;
    }
    // Last resort: a raw Gemini envelope.
    const parts = body.raw && body.raw.candidates && body.raw.candidates[0]
      && body.raw.candidates[0].content && body.raw.candidates[0].content.parts;
    for (const part of parts || []) {
      const dataUrl = asDataUrl(part);
      if (dataUrl) return dataUrl;
    }
    return null;
  }

  /** Where the finished picture is kept, when it was too big to come with. */
  function imageUrl(body) {
    const images = [
      ...(body.result && Array.isArray(body.result.images) ? body.result.images : []),
      ...(Array.isArray(body.images) ? body.images : [])
    ];
    for (const image of images) {
      if (image && typeof image.url === "string" && image.url) return image.url;
    }
    return null;
  }

  /** Fetch it, through the gate, and hand it back as a data URL. */
  async function fetchImage(url) {
    const response = await send(url, { headers: { Accept: "image/*" } });
    if (!response.ok) {
      throw new Error(`the finished scene is stored at ${url} but could not be read (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error(`the finished scene at ${url} came back empty`);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // firstImage and imageUrl are exported for the test that pins the result
  // envelope: what shape a finished job comes back in is the one thing here
  // that has moved under the page's feet, and it is not worth another paid job
  // to find out.
  return { generate, firstImage, imageUrl };
})();
