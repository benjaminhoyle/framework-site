/**
 * Minimal WebGL renderer for the shelving builder.
 *
 * Deliberately not three.js. The whole scene is static geometry under a locked
 * isometric camera, which needs one shader, one draw call per module per
 * colour, and no scene graph -- about 20KB of code against roughly 460KB of
 * library, on phones where JS parse time is a real cost. It also means the
 * quantised vertex formats from the .fwm bundles go to the GPU untouched.
 *
 * Coordinates are Rhino millimetres throughout (x = width, y = depth,
 * z = height, floor at z = 0), the same space the placement engine works in, so
 * nothing has to be converted between the two.
 *
 * Frames are drawn on demand. A configurator is static between interactions and
 * a permanent requestAnimationFrame loop would drain a battery for nothing.
 */
window.FrameworkDesignerRenderer = (function () {
  "use strict";

  // Viewing direction: from front-right-above, the standard isometric quarter
  // view. Locked -- the brief is pan and auto-fit only, no orbit.
  const VIEW_DIRECTION = normalise([1, -1, 0.82]);
  const WORLD_UP = [0, 0, 1];
  // Enough margin that the shelf never runs under the stage's own controls or
  // the "+" affordances that hang off its edges.
  const FIT_PADDING = 1.2;

  const ROLE_FOOT = 2;
  const ROLE_PAPER = 3;
  const FOOT_COLOR = "#15181a";
  const PAPER_COLOR = "#f6f1e6";

  const VERTEX_SHADER = [
    "attribute vec3 aPosition;",
    "attribute vec3 aNormal;",
    "uniform mat4 uModelViewProjection;",
    "uniform mat3 uNormalMatrix;",
    "varying vec3 vNormal;",
    "void main() {",
    "  vNormal = uNormalMatrix * aNormal;",
    "  gl_Position = uModelViewProjection * vec4(aPosition, 1.0);",
    "}"
  ].join("\n");

  // Two soft directional terms plus a sky/ground gradient. Enough to separate
  // a shelf top from its front edge without the cost or the shadow-acne risk
  // of anything physically based.
  const FRAGMENT_SHADER = [
    "precision mediump float;",
    "uniform vec3 uColor;",
    "uniform float uAlpha;",
    "varying vec3 vNormal;",
    "void main() {",
    "  vec3 n = normalize(vNormal);",
    "  float key = max(dot(n, vec3(0.42, -0.55, 0.72)), 0.0);",
    "  float rim = max(dot(n, vec3(-0.60, 0.35, 0.25)), 0.0);",
    "  float sky = 0.5 + 0.5 * n.z;",
    "  float light = 0.62 + 0.26 * key + 0.07 * rim + 0.12 * sky;",
    "  gl_FragColor = vec4(uColor * light, uAlpha);",
    "}"
  ].join("\n");

  // ---- vector / matrix helpers --------------------------------------------

  function normalise(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  /** out = a * b, both column-major. */
  function multiply(out, a, b) {
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
        out[column * 4 + row] = sum;
      }
    }
    return out;
  }

  function hexToRgb(hex) {
    const value = parseInt(String(hex).replace("#", ""), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  // ---- renderer ------------------------------------------------------------

  function create(canvas, options) {
    const settings = options || {};
    const attributes = {
      alpha: false,
      antialias: settings.antialias !== false,
      depth: true,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false
    };
    const gl = canvas.getContext("webgl", attributes) || canvas.getContext("experimental-webgl", attributes);
    if (!gl) return null;

    const meshProgram = buildProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!meshProgram) return null;

    const state = {
      gl,
      canvas,
      meshProgram,
      uploads: new Map(), // moduleId -> GPU batches
      geometry: new Map(), // moduleId -> expanded CPU geometry (bbox etc.)
      instances: [],
      ghost: null,
      palette: null,
      target: [500, 130, 400],
      halfHeight: 900,
      pixelRatio: 1,
      width: 1,
      height: 1,
      cssWidth: 1,
      cssHeight: 1,
      frameQueued: false,
      contextLost: false,
      onFrame: settings.onFrame || null
    };

    canvas.addEventListener("webglcontextlost", (event) => {
      // Without preventDefault the context never comes back. Mid-range Android
      // browsers drop contexts on background/foreground fairly readily.
      event.preventDefault();
      state.contextLost = true;
      state.uploads.forEach((batches) => batches.forEach((batch) => { batch.disposed = true; }));
      state.uploads.clear();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      state.contextLost = false;
      state.meshProgram = buildProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
      requestFrame(state);
    });

    // Measure once up front so overlay projection is correct before the first
    // frame has been drawn.
    resize(state);

    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);
    // Mirrored parts (recovered instancing) reverse winding, so culling would
    // punch holes in exactly the legs and feet it was meant to speed up.
    gl.disable(gl.CULL_FACE);

    return api(state);
  }

  function buildProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("shader link failed:", gl.getProgramInfoLog(program));
      return null;
    }
    return {
      program,
      attributes: {
        position: gl.getAttribLocation(program, "aPosition"),
        normal: gl.getAttribLocation(program, "aNormal")
      },
      uniforms: {
        modelViewProjection: gl.getUniformLocation(program, "uModelViewProjection"),
        normalMatrix: gl.getUniformLocation(program, "uNormalMatrix"),
        color: gl.getUniformLocation(program, "uColor"),
        alpha: gl.getUniformLocation(program, "uAlpha")
      }
    };
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function upload(state, moduleId, geometry) {
    if (state.uploads.has(moduleId) || state.contextLost) return;
    const gl = state.gl;
    const batches = geometry.batches.map((batch) => {
      const entry = {
        role: batch.role,
        indexCount: batch.indexCount,
        positions: gl.createBuffer(),
        normals: gl.createBuffer(),
        indices: gl.createBuffer()
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
      gl.bufferData(gl.ARRAY_BUFFER, batch.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.normals);
      gl.bufferData(gl.ARRAY_BUFFER, batch.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
      return entry;
    });
    state.uploads.set(moduleId, batches);
    state.geometry.set(moduleId, geometry);
  }

  /**
   * Model matrix for one placed instance, with dequantisation folded in so the
   * shader reads raw uint16 vertex data:
   *   translate(pivot) . rotateZ . translate(-pivot) . translate(placement)
   *     . translate(quantOffset) . scale(quantScale)
   */
  function modelMatrix(instance, geometry) {
    const radians = ((instance.rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const px = instance.pivotMm ? instance.pivotMm[0] : 0;
    const py = instance.pivotMm ? instance.pivotMm[1] : 0;
    const t = instance.translation;
    const s = geometry.quantScale;
    const o = geometry.quantOffset;

    // Point in module space: p = R * (t + o + s*v - pivot) + pivot
    const bx = t[0] + o[0] - px;
    const by = t[1] + o[1] - py;
    const bz = t[2] + o[2];
    return new Float32Array([
      cos * s, sin * s, 0, 0,
      -sin * s, cos * s, 0, 0,
      0, 0, s, 0,
      cos * bx - sin * by + px, sin * bx + cos * by + py, bz, 1
    ]);
  }

  function normalMatrix(instance) {
    const radians = ((instance.rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
  }

  /** Orthographic view-projection for the locked isometric camera. */
  function viewProjection(state) {
    const aspect = state.width / Math.max(1, state.height);
    const halfHeight = state.halfHeight;
    const halfWidth = halfHeight * aspect;
    const forward = [-VIEW_DIRECTION[0], -VIEW_DIRECTION[1], -VIEW_DIRECTION[2]];
    const right = normalise(cross(forward, WORLD_UP));
    const up = cross(right, forward);
    // Depth range sized to the shelf, not to some arbitrary large number. A
    // 400m range over millimetre geometry leaves a 16-bit depth buffer with
    // ~6mm of precision, which z-fights across every stacked shelf board.
    const reach = (state.sceneRadius || 1500) + halfHeight * 2 + 500;
    const eye = [
      state.target[0] - forward[0] * reach,
      state.target[1] - forward[1] * reach,
      state.target[2] - forward[2] * reach
    ];
    const view = new Float32Array([
      right[0], up[0], -forward[0], 0,
      right[1], up[1], -forward[1], 0,
      right[2], up[2], -forward[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
      forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2],
      1
    ]);
    const near = 1;
    const far = reach * 2;
    const projection = new Float32Array([
      1 / halfWidth, 0, 0, 0,
      0, 1 / halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1
    ]);
    return {
      matrix: multiply(new Float32Array(16), projection, view),
      right,
      up,
      forward,
      eye
    };
  }

  function resize(state) {
    const rect = state.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const width = Math.max(1, Math.round(cssWidth * state.pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * state.pixelRatio));
    if (state.canvas.width !== width || state.canvas.height !== height) {
      state.canvas.width = width;
      state.canvas.height = height;
    }
    state.width = width;
    state.height = height;
    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;
  }

  function requestFrame(state) {
    if (state.frameQueued) return;
    state.frameQueued = true;
    window.requestAnimationFrame(() => {
      state.frameQueued = false;
      draw(state);
    });
  }

  function drawBatches(state, camera, instance, geometry, batches, alpha, overrideColor) {
    const gl = state.gl;
    const mesh = state.meshProgram;
    const model = modelMatrix(instance, geometry);
    const mvp = multiply(new Float32Array(16), camera.matrix, model);

    gl.useProgram(mesh.program);
    gl.uniformMatrix4fv(mesh.uniforms.modelViewProjection, false, mvp);
    gl.uniformMatrix3fv(mesh.uniforms.normalMatrix, false, normalMatrix(instance));
    gl.uniform1f(mesh.uniforms.alpha, alpha);
    gl.enableVertexAttribArray(mesh.attributes.position);
    gl.enableVertexAttribArray(mesh.attributes.normal);

    for (const batch of batches) {
      const color = overrideColor || state.palette[batch.role] || state.palette[0];
      gl.uniform3fv(mesh.uniforms.color, color);
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.positions);
      gl.vertexAttribPointer(mesh.attributes.position, 3, gl.UNSIGNED_SHORT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.normals);
      gl.vertexAttribPointer(mesh.attributes.normal, 3, gl.BYTE, true, 4, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.indices);
      gl.drawElements(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(mesh.attributes.normal);
  }

  function draw(state) {
    if (state.contextLost || !state.palette) return;
    const gl = state.gl;
    resize(state);
    gl.viewport(0, 0, state.width, state.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const camera = viewProjection(state);
    state.camera = camera;

    gl.disable(gl.BLEND);
    for (const instance of state.instances) {
      const batches = state.uploads.get(instance.moduleId);
      const geometry = state.geometry.get(instance.moduleId);
      if (!batches || !geometry) continue;
      drawBatches(state, camera, instance, geometry, batches, 1, instance.highlight ? state.highlightColor : null);
    }

    if (state.ghost) {
      const batches = state.uploads.get(state.ghost.moduleId);
      const geometry = state.geometry.get(state.ghost.moduleId);
      if (batches && geometry) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        drawBatches(state, camera, state.ghost, geometry, batches, 0.45, state.ghostColor);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }

    if (state.onFrame) state.onFrame();
  }

  /** World bounds of every placed instance, in Rhino mm. */
  function sceneBounds(state) {
    if (!state.instances.length) return null;
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const instance of state.instances) {
      const box = instance.boundsMm;
      if (!box) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        if (box[axis] < bounds[axis]) bounds[axis] = box[axis];
        if (box[axis + 3] > bounds[axis + 3]) bounds[axis + 3] = box[axis + 3];
      }
    }
    return Number.isFinite(bounds[0]) ? bounds : null;
  }

  function api(state) {
    return {
      isReady: () => !state.contextLost,

      setPixelRatio(ratio) {
        state.pixelRatio = Math.max(1, Math.min(ratio, 2));
        requestFrame(state);
      },

      setPalette(palette) {
        state.palette = {
          0: hexToRgb(palette.steel),
          1: hexToRgb(palette.surface),
          [ROLE_FOOT]: hexToRgb(FOOT_COLOR),
          [ROLE_PAPER]: hexToRgb(PAPER_COLOR)
        };
        state.ghostColor = hexToRgb(palette.ghost || "#2f8f6f");
        state.highlightColor = hexToRgb(palette.highlight || "#f0932b");
        requestFrame(state);
      },

      addModule: (moduleId, geometry) => upload(state, moduleId, geometry),
      hasModule: (moduleId) => state.uploads.has(moduleId),

      setInstances(instances) {
        state.instances = instances;
        const bounds = sceneBounds(state);
        state.sceneRadius = bounds
          ? Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) * 0.5 + 200
          : 1500;
        requestFrame(state);
      },

      setGhost(ghost) {
        state.ghost = ghost;
        requestFrame(state);
      },

      /** Frame the given bounds (or the current scene) with a little margin. */
      fit(boundsMm) {
        const bounds = boundsMm || sceneBounds(state);
        resize(state);
        if (!bounds) {
          state.target = [400, 130, 300];
          state.halfHeight = 700;
          requestFrame(state);
          return;
        }
        state.target = [
          (bounds[0] + bounds[3]) / 2,
          (bounds[1] + bounds[4]) / 2,
          (bounds[2] + bounds[5]) / 2
        ];
        const camera = viewProjection(state);
        let halfWidth = 0;
        let halfHeight = 0;
        for (const x of [bounds[0], bounds[3]]) {
          for (const y of [bounds[1], bounds[4]]) {
            for (const z of [bounds[2], bounds[5]]) {
              const dx = x - state.target[0];
              const dy = y - state.target[1];
              const dz = z - state.target[2];
              halfWidth = Math.max(halfWidth, Math.abs(camera.right[0] * dx + camera.right[1] * dy + camera.right[2] * dz));
              halfHeight = Math.max(halfHeight, Math.abs(camera.up[0] * dx + camera.up[1] * dy + camera.up[2] * dz));
            }
          }
        }
        const aspect = state.width / Math.max(1, state.height);
        state.halfHeight = Math.max(halfHeight, halfWidth / aspect, 120) * FIT_PADDING;
        requestFrame(state);
      },

      /** Pan by a screen-space delta in CSS pixels. */
      panByPixels(dx, dy) {
        const camera = state.camera || viewProjection(state);
        const perPixel = (state.halfHeight * 2) / Math.max(1, state.cssHeight || state.height);
        for (let axis = 0; axis < 3; axis += 1) {
          state.target[axis] -= camera.right[axis] * dx * perPixel;
          state.target[axis] += camera.up[axis] * dy * perPixel;
        }
        requestFrame(state);
      },

      /** Zoom about a screen point so pinch and wheel feel anchored. */
      zoomBy(factor, clientX, clientY) {
        const previous = state.halfHeight;
        const next = Math.max(120, Math.min(12000, previous / factor));
        if (next === previous) return;
        if (clientX != null && clientY != null) {
          const rect = state.canvas.getBoundingClientRect();
          const camera = state.camera || viewProjection(state);
          const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
          const ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
          const aspect = state.width / Math.max(1, state.height);
          const shift = previous - next;
          for (let axis = 0; axis < 3; axis += 1) {
            state.target[axis] += camera.right[axis] * ndcX * shift * aspect;
            state.target[axis] += camera.up[axis] * ndcY * shift;
          }
        }
        state.halfHeight = next;
        requestFrame(state);
      },

      getHalfHeight: () => state.halfHeight,

      /**
       * Is every corner of these bounds inside the current view?
       *
       * Used to decide whether an edit needs a re-frame. Re-fitting on every
       * change would yank the view out from under someone who has zoomed in to
       * look at a detail; never re-fitting leaves a just-added unit off-screen.
       */
      containsBounds(boundsMm) {
        if (!boundsMm) return true;
        const camera = state.camera || viewProjection(state);
        const aspect = state.width / Math.max(1, state.height);
        for (const x of [boundsMm[0], boundsMm[3]]) {
          for (const y of [boundsMm[1], boundsMm[4]]) {
            for (const z of [boundsMm[2], boundsMm[5]]) {
              const dx = x - state.target[0];
              const dy = y - state.target[1];
              const dz = z - state.target[2];
              const across = camera.right[0] * dx + camera.right[1] * dy + camera.right[2] * dz;
              const up = camera.up[0] * dx + camera.up[1] * dy + camera.up[2] * dz;
              if (Math.abs(across) > state.halfHeight * aspect || Math.abs(up) > state.halfHeight) return false;
            }
          }
        }
        return true;
      },

      /** Project a world point (mm) to CSS pixels relative to the canvas. */
      project(pointMm) {
        const camera = state.camera || viewProjection(state);
        const clip = camera.matrix;
        const x = clip[0] * pointMm[0] + clip[4] * pointMm[1] + clip[8] * pointMm[2] + clip[12];
        const y = clip[1] * pointMm[0] + clip[5] * pointMm[1] + clip[9] * pointMm[2] + clip[13];
        const width = state.cssWidth || state.width;
        const height = state.cssHeight || state.height;
        return { x: (x + 1) * 0.5 * width, y: (1 - y) * 0.5 * height };
      },

      /**
       * Nearest instance under a canvas-relative point.
       *
       * Ray/box against each instance's world bounds. A configurator's modules
       * are separated slabs, so box precision is indistinguishable from mesh
       * precision here, and it costs a few microseconds instead of a GPU
       * readback stall.
       */
      pick(clientX, clientY) {
        const rect = state.canvas.getBoundingClientRect();
        const camera = state.camera || viewProjection(state);
        const aspect = state.width / Math.max(1, state.height);
        const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
        const origin = [0, 0, 0];
        for (let axis = 0; axis < 3; axis += 1) {
          origin[axis] = state.target[axis]
            + camera.right[axis] * ndcX * state.halfHeight * aspect
            + camera.up[axis] * ndcY * state.halfHeight
            - camera.forward[axis] * 200000;
        }
        const direction = camera.forward;

        let best = null;
        for (const instance of state.instances) {
          const box = instance.boundsMm;
          if (!box) continue;
          let enter = -Infinity;
          let exit = Infinity;
          let hit = true;
          for (let axis = 0; axis < 3 && hit; axis += 1) {
            const d = direction[axis];
            const min = box[axis];
            const max = box[axis + 3];
            if (Math.abs(d) < 1e-9) {
              if (origin[axis] < min || origin[axis] > max) hit = false;
              continue;
            }
            let t0 = (min - origin[axis]) / d;
            let t1 = (max - origin[axis]) / d;
            if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
            if (t0 > enter) enter = t0;
            if (t1 < exit) exit = t1;
            if (enter > exit) hit = false;
          }
          if (!hit || exit < 0) continue;
          if (!best || enter < best.distance) best = { instanceId: instance.id, distance: enter };
        }
        return best ? best.instanceId : null;
      },

      invalidate: () => requestFrame(state),
      resize() {
        resize(state);
        requestFrame(state);
      },

      dispose() {
        const gl = state.gl;
        state.uploads.forEach((batches) => {
          batches.forEach((batch) => {
            gl.deleteBuffer(batch.positions);
            gl.deleteBuffer(batch.normals);
            gl.deleteBuffer(batch.indices);
          });
        });
        state.uploads.clear();
        state.geometry.clear();
      }
    };
  }

  return { create, VIEW_DIRECTION };
})();
