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

  /*
   * The optional second view: standing in front of the shelf, at eye height,
   * looking at it. Fixed -- there is no orbit here either, it is a presentation
   * viewpoint rather than a way to inspect the model.
   */
  const EYE_HEIGHT_MM = 1700;
  const PERSPECTIVE_FOV_DEG = 38;
  const PERSPECTIVE_PADDING = 1.24;

  const ROLE_FOOT = 2;
  const ROLE_PAPER = 3;
  const ROLE_CORD = 4;
  const FOOT_COLOR = "#15181a";
  // A warm paper cream. The first pass was a near-grey off-white, which read as
  // drab next to the finishes; this is the same lightness family with the hue
  // pulled towards orange and rather more of it.
  const PAPER_COLOR = "#fdf3e3";
  const CORD_COLOR = "#4c5254";

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

  /**
   * World point (mm) -> pixels, against an explicit camera and viewport.
   *
   * Taken as arguments rather than read off the live state because the share
   * image projects through the snapshot's camera and size, which only exist
   * inside snapshot().
   */
  function projectWith(clip, width, height, pointMm) {
    const x = clip[0] * pointMm[0] + clip[4] * pointMm[1] + clip[8] * pointMm[2] + clip[12];
    const y = clip[1] * pointMm[0] + clip[5] * pointMm[1] + clip[9] * pointMm[2] + clip[13];
    // w is 1 under the orthographic camera and the perspective divide under the
    // other, so this covers both.
    const w = clip[3] * pointMm[0] + clip[7] * pointMm[1] + clip[11] * pointMm[2] + clip[15];
    const divisor = Math.abs(w) > 1e-6 ? w : 1;
    return { x: (x / divisor + 1) * 0.5 * width, y: (1 - y / divisor) * 0.5 * height };
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
      palettes: new Map(), // per-instance colour overrides, hex pair -> role map
      target: [500, 130, 400],
      halfHeight: 900,
      viewMode: "iso",
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
  function isometricProjection(state) {
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
    const near = 1;
    const far = reach * 2;
    const projection = new Float32Array([
      1 / halfWidth, 0, 0, 0,
      0, 1 / halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1
    ]);
    return {
      matrix: multiply(new Float32Array(16), projection, viewMatrix(right, up, forward, eye)),
      right,
      up,
      forward,
      eye,
      perspective: false
    };
  }

  function viewMatrix(right, up, forward, eye) {
    return new Float32Array([
      right[0], up[0], -forward[0], 0,
      right[1], up[1], -forward[1], 0,
      right[2], up[2], -forward[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
      forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2],
      1
    ]);
  }

  /**
   * Standing in front of the shelf at eye height, far enough back that it fills
   * the frame.
   *
   * The distance comes from the design's bounding sphere and the narrower of the
   * two field-of-view angles, so it fits on both axes without having to solve the
   * box projection: over-estimating slightly is exactly what "breathing room"
   * wants anyway.
   */
  function perspectiveProjection(state) {
    const aspect = state.width / Math.max(1, state.height);
    const bounds = sceneBounds(state) || [0, 0, 0, 1000, 300, 800];
    const centre = [
      (bounds[0] + bounds[3]) / 2,
      (bounds[1] + bounds[4]) / 2,
      (bounds[2] + bounds[5]) / 2
    ];
    const halfWidth = Math.max(60, (bounds[3] - bounds[0]) / 2);
    const halfHeight = Math.max(60, (bounds[5] - bounds[2]) / 2);
    const halfDepth = Math.max(30, (bounds[4] - bounds[1]) / 2);
    const radius = Math.max(120, Math.hypot(halfWidth, halfHeight, halfDepth));

    const halfV = (PERSPECTIVE_FOV_DEG * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    // Fit the box itself, not a sphere around it: a shelf run is wide and flat,
    // and the enclosing sphere is far bigger than the shelf, which left it
    // filling about 60% of the frame instead of most of it. Whichever axis needs
    // more room sets the distance; the near face gets cleared on top of that.
    const distance = PERSPECTIVE_PADDING * (halfDepth + Math.max(
      halfHeight / Math.tan(halfV),
      halfWidth / Math.tan(halfH)
    ));

    // Eye height is fixed, so only the horizontal stand-off is free. If the
    // design is so tall that eye height alone already exceeds the needed range,
    // keep a minimum stand-off rather than ending up inside it.
    const rise = EYE_HEIGHT_MM - centre[2];
    const horizontal = Math.max(radius * 0.6, Math.sqrt(Math.max(0, distance * distance - rise * rise)));
    // In front of the shelf: front is the low-depth side.
    const eye = [centre[0], centre[1] - horizontal, EYE_HEIGHT_MM];

    const forward = normalise([centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]]);
    const right = normalise(cross(forward, WORLD_UP));
    const up = cross(right, forward);

    const near = Math.max(50, distance - radius * 2);
    const far = distance + radius * 4;
    const focal = 1 / Math.tan(halfV);
    const projection = new Float32Array([
      focal / aspect, 0, 0, 0,
      0, focal, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ]);
    return {
      matrix: multiply(new Float32Array(16), projection, viewMatrix(right, up, forward, eye)),
      right,
      up,
      forward,
      eye,
      perspective: true
    };
  }

  function viewProjection(state) {
    return state.viewMode === "perspective" ? perspectiveProjection(state) : isometricProjection(state);
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

  /**
   * The role -> colour table an instance paints with.
   *
   * The design's own palette unless the piece was given a colour of its own, in
   * which case only steel and surface move: a rubber foot, a paper shade and a
   * lamp flex are the colours of the materials themselves, not of the finish.
   *
   * Cached by the hex pair, because this runs once per instance per frame and a
   * design rarely holds more than a handful of distinct colours.
   */
  function paletteFor(state, palette) {
    if (!palette) return state.palette;
    const key = `${palette.steel}|${palette.surface}`;
    let resolved = state.palettes.get(key);
    if (!resolved) {
      resolved = Object.assign({}, state.palette, {
        0: hexToRgb(palette.steel),
        1: hexToRgb(palette.surface)
      });
      state.palettes.set(key, resolved);
    }
    return resolved;
  }

  function drawBatches(state, camera, instance, geometry, batches, alpha, overrideColor) {
    const gl = state.gl;
    const mesh = state.meshProgram;
    const palette = paletteFor(state, instance.palette);
    const model = modelMatrix(instance, geometry);
    const mvp = multiply(new Float32Array(16), camera.matrix, model);

    gl.useProgram(mesh.program);
    gl.uniformMatrix4fv(mesh.uniforms.modelViewProjection, false, mvp);
    gl.uniformMatrix3fv(mesh.uniforms.normalMatrix, false, normalMatrix(instance));
    gl.uniform1f(mesh.uniforms.alpha, alpha);
    gl.enableVertexAttribArray(mesh.attributes.position);
    gl.enableVertexAttribArray(mesh.attributes.normal);

    for (const batch of batches) {
      const color = overrideColor || palette[batch.role] || palette[0];
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
          [ROLE_PAPER]: hexToRgb(PAPER_COLOR),
          [ROLE_CORD]: hexToRgb(CORD_COLOR)
        };
        // Per-instance palettes are derived from this one, so they go with it.
        state.palettes.clear();
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
      fit(boundsMm, padding) {
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
        state.halfHeight = Math.max(halfHeight, halfWidth / aspect, 120) * (padding || FIT_PADDING);
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
        return projectWith(camera.matrix, state.cssWidth || state.width, state.cssHeight || state.height, pointMm);
      },

      getViewMode: () => state.viewMode,

      /**
       * The world point of these instances that sits highest on screen.
       *
       * Bounding boxes cannot answer this. Under this camera the top of the
       * picture is not the greatest z, and a lamp shows why twice over: its box
       * is inflated by a shade that hangs out to one side and well below the
       * arm, and even its true highest point -- the far end of the arm, over the
       * shade -- is not what the eye reads as the top, because the elbow where
       * the arm meets the post is nearer the viewer and so sits higher up the
       * picture.
       *
       * The screen axes are linear in world position here, so this is a plain
       * maximum over the vertices: no projection, and the answer holds at any
       * pan or zoom. Callers pass one stack's worth of instances, which is a
       * couple of thousand vertices.
       */
      highestOnScreen(instanceIds) {
        const camera = state.camera || viewProjection(state);
        const wanted = new Set(instanceIds);
        const up = camera.up;
        let best = null;
        let bestHeight = -Infinity;
        for (const instance of state.instances) {
          if (!wanted.has(instance.id)) continue;
          const geometry = state.geometry.get(instance.moduleId);
          if (!geometry) continue;
          // Dequantisation is folded into the model matrix, so the raw uint16
          // vertex data reads here exactly as it does in the shader.
          const m = modelMatrix(instance, geometry);
          for (const batch of geometry.batches) {
            const positions = batch.positions;
            for (let i = 0; i < positions.length; i += 3) {
              const vx = positions[i];
              const vy = positions[i + 1];
              const vz = positions[i + 2];
              const x = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
              const y = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
              const z = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
              const height = up[0] * x + up[1] * y + up[2] * z;
              if (height > bestHeight) {
                bestHeight = height;
                best = [x, y, z];
              }
            }
          }
        }
        return best;
      },

      /**
       * Draw one frame at an arbitrary size and hand back its pixels.
       *
       * Used by the Present view to compose a share image. The canvas is resized,
       * framed and drawn, then read and put straight back, all without returning
       * to the event loop: the context is created without preserveDrawingBuffer,
       * so the pixels are only there until the browser next composites. That is
       * also why this reads with readPixels rather than toDataURL.
       *
       * Rows come back bottom-up, the way GL stores them.
       */
      snapshot(options) {
        const settings = options || {};
        const width = Math.max(1, Math.round(settings.width || 1080));
        const height = Math.max(1, Math.round(settings.height || 1080));
        const saved = {
          width: state.width,
          height: state.height,
          cssWidth: state.cssWidth,
          cssHeight: state.cssHeight,
          canvasWidth: state.canvas.width,
          canvasHeight: state.canvas.height,
          target: state.target.slice(),
          halfHeight: state.halfHeight
        };

        state.canvas.width = width;
        state.canvas.height = height;
        state.width = width;
        state.height = height;
        state.cssWidth = width;
        state.cssHeight = height;

        // Always framed from the design, never from wherever the live view has
        // been panned or zoomed to.
        const bounds = settings.boundsMm || sceneBounds(state);
        if (bounds && state.viewMode !== "perspective") {
          state.target = [
            (bounds[0] + bounds[3]) / 2,
            (bounds[1] + bounds[4]) / 2,
            (bounds[2] + bounds[5]) / 2
          ];
          const camera = viewProjection(state);
          let halfAcross = 0;
          let halfUp = 0;
          for (const x of [bounds[0], bounds[3]]) {
            for (const y of [bounds[1], bounds[4]]) {
              for (const z of [bounds[2], bounds[5]]) {
                const dx = x - state.target[0];
                const dy = y - state.target[1];
                const dz = z - state.target[2];
                halfAcross = Math.max(halfAcross, Math.abs(camera.right[0] * dx + camera.right[1] * dy + camera.right[2] * dz));
                halfUp = Math.max(halfUp, Math.abs(camera.up[0] * dx + camera.up[1] * dy + camera.up[2] * dz));
              }
            }
          }
          state.halfHeight = Math.max(halfUp, halfAcross / (width / height), 120) * (settings.padding || FIT_PADDING);
        }

        const gl = state.gl;
        gl.viewport(0, 0, width, height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const camera = viewProjection(state);
        state.camera = camera;
        gl.disable(gl.BLEND);
        for (const instance of state.instances) {
          const batches = state.uploads.get(instance.moduleId);
          const geometry = state.geometry.get(instance.moduleId);
          if (!batches || !geometry) continue;
          drawBatches(state, camera, instance, geometry, batches, 1, null);
        }
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        state.canvas.width = saved.canvasWidth;
        state.canvas.height = saved.canvasHeight;
        state.width = saved.width;
        state.height = saved.height;
        state.cssWidth = saved.cssWidth;
        state.cssHeight = saved.cssHeight;
        state.target = saved.target;
        state.halfHeight = saved.halfHeight;
        requestFrame(state);
        // The camera and size that framed these pixels are gone by the time the
        // caller sees them, so hand back a projector holding on to both. It is
        // what lets the share image put a dimension overlay over the snapshot.
        return {
          width,
          height,
          pixels,
          project: (pointMm) => projectWith(camera.matrix, width, height, pointMm)
        };
      },

      /**
       * Switch between the isometric and the fixed front perspective view. The
       * perspective camera derives everything from the design, so there is
       * nothing to pan or zoom -- it is a viewpoint, not a way to inspect.
       */
      setViewMode(mode) {
        const next = mode === "perspective" ? "perspective" : "iso";
        if (next === state.viewMode) return;
        state.viewMode = next;
        requestFrame(state);
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
