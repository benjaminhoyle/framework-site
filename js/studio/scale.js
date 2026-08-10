/**
 * The scale figure — one implementation, shared by both studios.
 *
 * A photograph of a shelf carries no size. A model shown one will make a
 * bookcase or a spice rack out of it with equal confidence, so before anything
 * is generated somebody has to say how tall the thing actually is. Two ways of
 * saying it are combined here, because on their own neither works:
 *
 *   - **A number.** "180 cm" in the prompt. Precise, and routinely ignored —
 *     the model has no way to relate it to the pixels it is looking at.
 *   - **A figure.** A 180 cm human silhouette composited into the reference at
 *     the measured pixels-per-centimetre. The model does not have to believe
 *     the number; the proportion is in front of it.
 *
 * So the flow is: click the bottom of the shelf, click the top, type its height
 * in centimetres — that fixes pixels-per-centimetre — then click where the
 * figure should stand. From then on the figure can be dragged.
 *
 * The scene studio has worked this way for a long time. The catalogue studio
 * grew its own half of it (measure, but no figure) and the two drifted, which
 * is what this file ends. Everything either studio needs is here: the geometry,
 * the composite, the state machine, the React glue and the words on screen.
 * Neither page keeps a private copy of any of it.
 *
 * What lives here and what does not:
 *
 *   - **Here:** the in-progress session, the drag, the maths, the panel.
 *   - **Not here:** where the finished scale record and the composited image
 *     are *stored*. The scene studio hangs them off a node in its pipeline; the
 *     catalogue studio hangs them off a row. That difference is real, so this
 *     module hands the result back through callbacks and keeps no opinion.
 *
 * The prompt sentence is deliberately only half-shared: `figureNote()` is the
 * one line both studios must agree on (the figure is a measuring stick, not
 * content). The rest of each SCALE line stays with its own page, because a
 * scene prompt and a catalogue-set prompt are asking for different things and
 * quietly merging their wording would change what both of them generate.
 */
(function(){
  "use strict";

  /** The silhouette is exactly this tall, which is what makes it a ruler. */
  const FIGURE_HEIGHT_CM = 180;

  /** Traced human outline, drawn into the reference at 45% opacity. */
  const FIGURE_SVG = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/Pgo8IURPQ1RZUEUgc3ZnIFBVQkxJQyAiLS8vVzNDLy9EVEQgU1ZHIDIwMDEwOTA0Ly9FTiIKICJodHRwOi8vd3d3LnczLm9yZy9UUi8yMDAxL1JFQy1TVkctMjAwMTA5MDQvRFREL3N2ZzEwLmR0ZCI+CjxzdmcgdmVyc2lvbj0iMS4wIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciCiB3aWR0aD0iMTI4MC4wMDAwMDBwdCIgaGVpZ2h0PSIxMjgwLjAwMDAwMHB0IiB2aWV3Qm94PSIwIDAgMTI4MC4wMDAwMDAgMTI4MC4wMDAwMDAiCiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ij4KPG1ldGFkYXRhPgpDcmVhdGVkIGJ5IHBvdHJhY2UgMS4xNSwgd3JpdHRlbiBieSBQZXRlciBTZWxpbmdlciAyMDAxLTIwMTcKPC9tZXRhZGF0YT4KPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMC4wMDAwMDAsMTI4MC4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiCmZpbGw9IiMwMDAwMDAiIHN0cm9rZT0ibm9uZSI+CjxwYXRoIGQ9Ik02MjQwIDEyMTg3IGMtMTMwIC00MSAtMjI3IC04NyAtMjYxIC0xMjQgLTE1IC0xNSAtNjMgLTEwNiAtMTA4Ci0yMDIgbC04MSAtMTc0IDEwIC05NSBjNiAtNTMgMjAgLTEzNSAzMSAtMTg0IDE3IC03NCAxOSAtOTcgMTAgLTEzMyAtMTQgLTU3Ci0xNCAtMjEwIDAgLTIzOCA3IC0xMiAzMyAtNDkgNTkgLTgyIDQ2IC01OCA0NyAtNjMgNTkgLTE2MyAxMSAtOTQgMTYgLTExMCA1NwotMTc3IDM2IC02MCA0NCAtODEgNDQgLTEyMSAwIC04NSAtMiAtODcgLTExOCAtMTM0IC0xNDggLTU5IC0zNTEgLTE2MiAtNDUyCi0yMjggLTQ3IC0zMSAtMTI4IC05OSAtMTgwIC0xNTEgLTgwIC04MSAtMTA0IC0xMTIgLTE0NyAtMTk2IC0yOCAtNTUgLTY4Ci0xNDUgLTg4IC0yMDAgbC0zOCAtMTAwIC05IC0zMzAgLTkgLTMzMCAtMzUgLTEyNSBjLTQ1IC0xNjQgLTgwIC0zNDcgLTk5Ci01MjggLTkgLTgxIC0yMCAtMTc0IC0yNSAtMjA3IC0zOCAtMjUwIC01MCAtNDE1IC00OSAtNjkzIDAgLTE1OCA0IC0zMjMgOAotMzY3IGw4IC04MCAtMzAgLTI5IGMtMzYgLTM1IC02MyAtOTQgLTcyIC0xNTcgLTYgLTM5IC0yIC01OCAyNCAtMTE3IDI5IC02NgozMiAtODEgMzUgLTIwNyBsNCAtMTM2IC02NSAtMTUyIGMtMTAyIC0yMzYgLTk5IC0yODkgMjkgLTQ3NCA0NSAtNjQgNjEgLTgwCjEwOCAtMTAyIDQ3IC0yMiA2OSAtMjUgMTU1IC0yNiA1NSAwIDExMSAzIDEyNSA3IGwyNSA3IDEgLTI0MiBjMSAtMTMzIDkgLTM0NQoxNyAtNDcyIDMxIC00NDggMzkgLTYyMiAzMiAtNzUyIGwtNiAtMTMzIDc3IC0xNDcgYzYxIC0xMTcgOTAgLTE2MiAxNDAgLTIxMwo1MyAtNTQgNjYgLTc2IDgzIC0xMzAgMTEgLTM2IDQ5IC0xNjYgODYgLTI4OSA4NiAtMjg5IDE2MiAtNDQxIDMyMCAtNjM5IDM5Ci00OCA2NSAtMTI0IDY1IC0xODggMCAtNDUgOCAtNTEgOTQgLTcwIDQwIC05IDQwIC05IDczIC0xMDUgNjMgLTE4MyA2NyAtMzIzCjE0IC00NzIgLTQzIC0xMjIgLTYwIC0xNTIgLTE4OSAtMzM3IC05NiAtMTM2IC0xMTggLTE3NSAtMTMwIC0yMjUgLTIwIC04NyAtOQotMTU5IDI4IC0xODUgNjcgLTQ4IDE5NCAtNDYgMzcyIDYgMjMgNyAtOTYgLTI5MSAtMTUyIC0zODAgbC00MiAtNjYgMTcgLTUwCmM5IC0yOSAyNiAtNTYgMzggLTYzIDE1IC04IDczIC0xMiAxODIgLTEyIDI3MCAwIDUyOSA1MCA1ODcgMTEzIDMyIDM1IDgzIDEyMAoxMTQgMTkxIDE0IDMxIDQ5IDgxIDc4IDExMSA3OCA4MSA4MiAxMDcgNDcgMjU1IC00MCAxNjYgLTQ1IDIyMCAtMjYgMjc1IDkgMjUKMTkgNzEgMjIgMTA0IDYgNTcgNyA2MCA1NCA4OSA0MyAyNiA0OSAzNSA2MCA4MiAxMSA0OCAxMCA1NSAtMTEgODMgLTM3IDUwCi00MSA5MSAtMTMgMTMwIDMyIDQzIDUzIDk1IDYzIDE1NiA4IDQ4IDUgNTYgLTM4IDEzOCBsLTQ1IDg2IDIxIDQ5IGMyNCA1NSA0OAoxODIgNTcgMjk4IDMgNDQgMTUgMTU5IDI2IDI1NSAyNCAyMTIgMzkgNDcxIDQwIDY3NyBsMSAxNTMgLTQyIDcxIC00MiA3MiAxMQo3MCBjNiAzOCAxNiA3OCAyMSA4OCAxOCAzMiAxMiAxNDYgLTEwIDE4OSAtMTEgMjEgLTI0IDQxIC0zMCA0NSAtMTYgMTAgLTEyCjQ1IDkgNzkgMTEgMTcgMzAgNjkgNDQgMTE2IDIyIDc0IDI4IDEyMyA0MiAzODAgOCAxNjIgMTggMzI2IDIyIDM2MyBsNiA2OCA1MwozNCBjMzYgMjMgNjAgNDggNzUgNzcgMjkgNTggNzMgMTIwIDEyMyAxNzcgNDEgNDYgNDIgNDkgNTUgMTU2IDcgNjEgMjEgMTQ0CjMxIDE4NSAxMCA0MSAyNiAxMTUgMzQgMTYzIDE2IDk0IDI4IDExOCAxNDYgMzA5IDUyIDgyIDcwIDEyMSA3OSAxNzAgMTEgNTgKOTAgMzk0IDE2NCA2OTggbDMxIDEyNSAzIDYzNSBjNCA1MzkgMiA2NTIgLTExIDc0NSAtOSA2MSAtMjUgMjE4IC0zNiAzNTAgLTMwCjM3NCAtNjEgNTIwIC0xNTQgNzE2IC0yOSA2MyAtNzEgMTY0IC05MSAyMjQgLTIxIDYxIC00NSAxMTcgLTU1IDEyNSAtOSA4Ci0xODcgMTEzIC0zOTYgMjMzIGwtMzc5IDIxOSAtNzYgMTAyIC03NiAxMDIgMTggOTkgYzEwIDU1IDE4IDEyMiAxOSAxNDkgMCA0NAo1IDU0IDQ0IDk2IDM1IDM3IDQ2IDU5IDU2IDEwNiAxNCA2NSA4IDE2NSAtMTEgMjA4IC0xMCAyMiAtOSAzNiA0IDgwIDkgMjkgMTcKNjUgMTcgODAgMCAxNSAxMCA3NSAyMSAxMzMgMjAgOTYgMjEgMTE1IDEwIDE4NiAtMTQgOTAgLTc1IDIzNCAtMTE5IDI4MSAtMzQKMzYgLTE1MSAxMjMgLTIxNiAxNjEgLTQ3IDI4IC01NCAyOSAtMjEwIDMyIC0xNTkgMyAtMTYyIDMgLTI2NiAtMzB6IG0tOTM5Ci01Nzg0IGMtMyAtMTI1IC0xNSAtMjEwIC00NiAtMzM0IC0yNCAtOTQgLTU1IC0zMTQgLTU1IC0zOTEgMCAtNjIgLTcgLTcwIC00MwotNDcgLTE4IDEwIC00MCAxOSAtNDkgMTkgLTEwIDAgLTE4IDYgLTE4IDEzIDAgNiAtNCA1MCAtMTAgOTYgLTggNjggLTcgODggNgoxMTIgOCAxNyAyMCA4MSAyNiAxNDQgOCA4NSAxNSAxMTUgMjUgMTE1IDE4IDAgMjcgMjYgNTIgMTUwIDE5IDkzIDUxIDE5MCA3NAoyMjggNiA4IDE0IDkgMjUgMyAxMyAtOCAxNiAtMjUgMTMgLTEwOHogbTEwOTkgLTE2NDMgYzIwIC0xMDkgMzAgLTE5OSAzMAotMjYyIDAgLTUyIDUgLTEyMCAxMiAtMTQ5IDcgLTMwIDEyIC04NSAxMyAtMTI0IDAgLTM4IDkgLTEwOCAxOSAtMTU1IDE0IC02NAoxNyAtMTA1IDEyIC0xNzAgLTcgLTg5IDE1IC0yMzUgNDggLTMyOSAxOSAtNTMgMjEgLTE5NCA1IC01MDEgLTEyIC0yMzggLTI2Ci0zNDEgLTI4IC0yMDYgLTEgNzggLTIgODIgLTgyIDI0NSAtMTcwIDM0NiAtMjA3IDQyNyAtMjIwIDQ3NiAtNyAyOCAtMjMgNzUKLTM2IDEwNSAtMjEgNDcgLTI0IDY0IC0xOCAxMjAgMyAzNiAxMCAxNjQgMTUgMjg1IDUgMTIxIDE2IDI3MCAyNCAzMzAgOCA2MQoyMCAxNTMgMjYgMjA1IDcgNTEgMTkgMTEyIDI3IDEzNSA3IDIyIDI3IDk0IDQ0IDE1OSA0MyAxNzIgNDkgMTc5IDY2IDgxIDcKLTQ0IDI3IC0xNTQgNDMgLTI0NXoiLz4KPC9nPgo8L3N2Zz4K";

  /** Room left around the expanded edge so the figure is not flush to it. */
  const EXPAND_MARGIN_PX = 10;

  /** How far outside the figure's box a grab still counts, as a fraction of its width. */
  const GRAB_PADDING = 0.3;

  const UNSET = {status:"unset"};
  const SKIPPED = {status:"skipped"};

  const isSet = scale => scale?.status === "set";
  const hasFigure = scale => isSet(scale) && Number.isFinite(scale.fx) && Number.isFinite(scale.fy);

  // ─── Geometry ───────────────────────────────────────────────────────────

  /**
   * Where in the image a mouse event landed, in the image's own pixels.
   *
   * `object-fit: contain` letterboxes the image inside its element, so the
   * element's box is not the image's box and the difference has to come out.
   * Natural dimensions are read off the element rather than passed in: when a
   * frame has been expanded the displayed image is wider than the original, and
   * a caller passing the original's width would be quietly wrong.
   */
  function pointFromEvent(event, imgEl){
    const rect = imgEl.getBoundingClientRect();
    const natW = imgEl.naturalWidth || imgEl.width || rect.width;
    const natH = imgEl.naturalHeight || imgEl.height || rect.height;
    const naturalAspect = natW / natH;
    const elementAspect = rect.width / rect.height;
    let renderW, renderH, offsetX, offsetY;
    if(naturalAspect > elementAspect){
      renderW = rect.width;
      renderH = rect.width / naturalAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    }else{
      renderH = rect.height;
      renderW = rect.height * naturalAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    }
    return {
      x: Math.max(0, Math.min(natW, (event.clientX - rect.left - offsetX) * (natW / renderW))),
      y: Math.max(0, Math.min(natH, (event.clientY - rect.top - offsetY) * (natH / renderH))),
      renderW,
      renderH
    };
  }

  /** The figure's box in image pixels. `fx,fy` is the point between its feet. */
  function figureBox(pxCm, fx, fy){
    const h = FIGURE_HEIGHT_CM * pxCm;
    return {x: fx - h/2, y: fy - h, w: h, h};
  }

  /** Whether a click is close enough to the figure to count as grabbing it. */
  function hitsFigure(scale, point){
    if(!hasFigure(scale) || !scale.pxCm) return false;
    const box = figureBox(scale.pxCm, scale.fx, scale.fy);
    const pad = box.w * GRAB_PADDING;
    return point.x >= box.x - pad && point.x <= box.x + box.w + pad
        && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
  }

  /** Pixels per centimetre from two clicked points and a stated height. */
  function pxPerCm(points, shelfH){
    const [a, b] = points;
    return Math.hypot(b.x - a.x, b.y - a.y) / shelfH;
  }

  // ─── The composite ──────────────────────────────────────────────────────

  /**
   * Draw the figure into the photograph and hand back the result.
   *
   * With `expandFrame` on, a figure that would fall off the left or right edge
   * widens the canvas instead of being clipped — the added strip is flat grey
   * and the prompt tells the model to fill it. `offsetX` is how far the original
   * photograph moved right to make room, and every caller needs it to keep
   * mapping display coordinates back onto the original.
   */
  function composite(dataUrl, width, height, pxCm, fx, fy, expandFrame){
    return new Promise((resolve, reject) => {
      const box = figureBox(pxCm, fx, fy);
      let canvasW = width, offsetX = 0, expandedSide = null;
      if(expandFrame){
        if(box.x < 0){
          const extra = Math.abs(box.x) + EXPAND_MARGIN_PX;
          canvasW += extra; offsetX = extra; expandedSide = "left";
        }else if(box.x + box.w > width){
          canvasW += (box.x + box.w) - width + EXPAND_MARGIN_PX; expandedSide = "right";
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if(expandedSide){ ctx.fillStyle = "#e0e0e0"; ctx.fillRect(0, 0, canvasW, height); }
      const photo = new Image();
      photo.onerror = () => reject(new Error("Could not read the source image"));
      photo.onload = () => {
        ctx.drawImage(photo, offsetX, 0);
        const figure = new Image();
        figure.onerror = () => reject(new Error("Could not read the scale figure"));
        figure.onload = () => {
          ctx.globalAlpha = .45;
          ctx.drawImage(figure, box.x + offsetX, box.y, box.w, box.h);
          ctx.globalAlpha = 1;
          const out = canvas.toDataURL("image/jpeg", .9);
          resolve({
            dataUrl: out,
            base64: out.split(",")[1],
            width: canvasW,
            height,
            offsetX,
            expandedSide
          });
        };
        figure.src = FIGURE_SVG;
      };
      photo.src = dataUrl;
    });
  }

  // ─── The session, as a value ────────────────────────────────────────────
  //
  // Every step returns a new session rather than mutating one, so a studio can
  // hold it in whatever state container it already has.

  const PHASES = ["bottom", "top", "height", "figure"];

  function begin(targetId, seed){
    return {
      targetId,
      phase: "bottom",
      points: [],
      heightCm: seed?.heightCm != null ? String(seed.heightCm) : "",
      expandFrame: Boolean(seed?.expandFrame),
      pxCm: null,
      shelfH: null
    };
  }

  /** Advance a measuring session by one clicked point. Returns null if it ignores the click. */
  function addPoint(session, point){
    if(!session) return null;
    if(session.phase === "bottom") return {...session, phase:"top", points:[point]};
    if(session.phase === "top") return {...session, phase:"height", points:[...session.points, point]};
    return null;
  }

  /**
   * Turn two points and a typed height into pixels-per-centimetre.
   * Returns `{error}` rather than throwing, so a studio can log it its own way.
   */
  function confirmHeight(session){
    if(!session || session.points.length !== 2) return {error:"Click the bottom and top of the shelf first."};
    const shelfH = Number(String(session.heightCm).trim());
    if(!Number.isFinite(shelfH) || shelfH < 10 || shelfH > 500){
      return {error:"Shelf height must be between 10 and 500 cm."};
    }
    const perCm = pxPerCm(session.points, shelfH);
    if(!Number.isFinite(perCm) || perCm <= 0){
      return {error:"Those two points are the same. Click the bottom and top of the shelf again."};
    }
    return {session:{...session, phase:"figure", shelfH, pxCm:perCm}};
  }

  /** The finished record, once the figure has been stood somewhere. */
  function place(session, fx, fy, extra){
    return {
      status: "set",
      shelfH: session.shelfH,
      pxCm: session.pxCm,
      expandFrame: Boolean(session.expandFrame),
      fx, fy,
      expandedSide: extra?.expandedSide || null,
      offsetX: extra?.offsetX || 0
    };
  }

  // ─── Words ──────────────────────────────────────────────────────────────

  /** The one line on screen, wherever we are in the flow. Identical in both studios. */
  function hint(session, scale){
    if(session){
      if(session.phase === "bottom") return "Click the bottom of the shelf.";
      if(session.phase === "top") return "Click the top of the shelf.";
      if(session.phase === "height") return "Enter the shelf height in centimetres.";
      if(session.phase === "figure") return "Click where the figure should stand.";
    }
    if(hasFigure(scale)) return `Scale set: shelf ${scale.shelfH} cm. Drag the figure to move it.`;
    if(isSet(scale)) return `Scale set: shelf ${scale.shelfH} cm.`;
    if(scale?.status === "skipped") return "Scale skipped. Generation will use approximate proportions.";
    return "Set the scale, or skip it, before generating.";
  }

  /**
   * The sentence both studios owe the model once a figure is in the reference.
   *
   * It is a measuring stick, not a person in the shot, and every prompt that
   * ships the composited image has to say so or the figure comes back in the
   * output. This is the part of the prompt that must not differ between the two
   * pages; the rest of each SCALE line is that page's own business.
   */
  function figureNote(scale){
    if(!hasFigure(scale)) return "";
    const extended = scale.expandedSide
      ? ` The reference was extended on the ${scale.expandedSide}; fill the whole frame.`
      : "";
    return ` A ${FIGURE_HEIGHT_CM} cm human silhouette is composited into the reference for scale only`
      + ` — do not reproduce it, or any person, mannequin, silhouette or measurement marker, in the output.${extended}`;
  }

  // ─── Styles ─────────────────────────────────────────────────────────────

  const CSS = `
.fw-scale{margin-top:10px;border:1px solid #3a403e;border-radius:8px;background:#111313;padding:10px}
.fw-scale.is-active{border-color:#6a4519;background:#201a0d}
.fw-scale-hint{font-size:12px;line-height:1.45;color:#cdd5cf}
.fw-scale.is-active .fw-scale-hint{color:#ffd08d;font-weight:800}
.fw-scale-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:8px}
.fw-scale-row:empty{display:none}
.fw-scale-input{width:96px}
.fw-scale.is-active .fw-scale-input{border-color:#d88a26}
.fw-scale-check{display:flex;align-items:center;gap:5px;font-size:12px;color:#c5bba8;cursor:pointer}
`;
  let stylesInjected = false;
  function injectStyles(){
    if(stylesInjected || typeof document === "undefined") return;
    // The panel's buttons and field come from the shared chrome, so that this
    // is not a third button vocabulary on pages that already have one.
    if(window.FrameworkStudio) window.FrameworkStudio.injectStyles();
    stylesInjected = true;
    const el = document.createElement("style");
    el.setAttribute("data-framework-scale", "");
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ─── React glue ─────────────────────────────────────────────────────────

  /**
   * Everything the flow needs, minus the storage.
   *
   * `image` is always the *original* photograph — never the composited one.
   * The composite is regenerated from the original on every move, so a drag
   * cannot pile figures on top of each other.
   *
   * Both `onPlaced` and `onReset` are how a studio learns anything happened.
   * `onPlaced(scale, image)` gets the record and the composited image together,
   * because a record without its image is a scale nobody can see.
   */
  function useScaleTool(opts){
    const React = window.React;
    const {useState, useCallback, useEffect, useRef} = React;
    const {image, scale, imgRef, onPlaced, onReset, onSkip, log} = opts;

    const [session, setSession] = useState(null);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef(null);

    const say = useCallback((level, message) => {
      if(typeof log === "function") log(level, message);
    }, [log]);

    // A session belongs to one target. Changing target abandons it rather than
    // silently measuring the wrong photograph.
    const targetId = opts.targetId ?? null;
    useEffect(() => {
      setSession(current => (current && current.targetId !== targetId) ? null : current);
    }, [targetId]);

    const recomposite = useCallback(async (pxCm, fx, fy, expandFrame) => {
      return composite(image.dataUrl, image.width, image.height, pxCm, fx, fy, expandFrame);
    }, [image]);

    const beginSession = useCallback(() => {
      injectStyles();
      setSession(begin(targetId, {
        heightCm: scale?.shelfH || opts.fallbackCm || "",
        expandFrame: scale?.expandFrame
      }));
    }, [targetId, scale, opts.fallbackCm]);

    const cancel = useCallback(() => setSession(null), []);

    const reset = useCallback(() => {
      setSession(null);
      setDragging(false);
      if(typeof onReset === "function") onReset();
    }, [onReset]);

    const skip = useCallback(() => {
      setSession(null);
      if(typeof onSkip === "function") onSkip();
    }, [onSkip]);

    const setHeightText = useCallback(text => {
      setSession(current => current ? {...current, heightCm:String(text).replace(/[^\d.]/g, "")} : current);
    }, []);

    const setExpandFrame = useCallback(value => {
      setSession(current => current ? {...current, expandFrame:Boolean(value)} : current);
    }, []);

    const confirm = useCallback(() => {
      setSession(current => {
        if(!current) return current;
        const result = confirmHeight(current);
        if(result.error){ say("error", result.error); return current; }
        say("info", `${result.session.shelfH} cm — click where the figure should stand`);
        return result.session;
      });
    }, [say]);

    /** A click on the image: either a measuring point, or where the figure goes. */
    const handleClick = useCallback(event => {
      if(!session || !image || !imgRef.current) return;
      const point = pointFromEvent(event, imgRef.current);
      if(session.phase === "figure"){
        // The displayed image may be a widened composite; the record is kept in
        // the original photograph's coordinates.
        const fx = point.x - (scale?.offsetX || 0);
        (async () => {
          try{
            const out = await recomposite(session.pxCm, fx, point.y, session.expandFrame);
            const record = place(session, fx, point.y, out);
            setSession(null);
            if(typeof onPlaced === "function") onPlaced(record, out);
            say("success", `Scale figure placed — shelf ${record.shelfH} cm`);
          }catch(error){
            say("error", `Scale figure failed: ${error?.message || error}`);
          }
        })();
        return;
      }
      const next = addPoint(session, point);
      if(next) setSession(next);
    }, [session, image, imgRef, scale, recomposite, onPlaced, say]);

    /** Grabbing the placed figure. */
    const handleMouseDown = useCallback(event => {
      if(session || !hasFigure(scale) || !image || !imgRef.current) return;
      const point = pointFromEvent(event, imgRef.current);
      const local = {x: point.x - (scale.offsetX || 0), y: point.y};
      if(!hitsFigure(scale, local)) return;
      event.preventDefault();
      dragRef.current = {
        fx: scale.fx, fy: scale.fy,
        startX: event.clientX, startY: event.clientY,
        scaleX: image.width / point.renderW,
        scaleY: image.height / point.renderH
      };
      setDragging(true);
    }, [session, scale, image, imgRef]);

    // The drag listens on the window, so the pointer can leave the image without
    // the figure sticking to wherever it last was inside it. The composite is
    // only redrawn on release — it is a canvas round trip per frame otherwise,
    // and the figure is being positioned by eye against a photograph that has
    // not moved.
    useEffect(() => {
      if(!dragging) return;
      const start = dragRef.current;
      if(!start) return;
      const move = event => {
        start.movedX = (event.clientX - start.startX) * start.scaleX;
        start.movedY = (event.clientY - start.startY) * start.scaleY;
      };
      const up = async () => {
        setDragging(false);
        if(!start.movedX && !start.movedY) return;
        const fx = start.fx + start.movedX;
        const fy = start.fy + start.movedY;
        try{
          const out = await recomposite(scale.pxCm, fx, fy, scale.expandFrame);
          if(typeof onPlaced === "function"){
            onPlaced({...scale, fx, fy, expandedSide:out.expandedSide, offsetX:out.offsetX}, out);
          }
        }catch(error){
          say("error", `Scale figure failed: ${error?.message || error}`);
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
    }, [dragging, scale, recomposite, onPlaced, say]);

    const active = Boolean(session);
    const cursor = active ? "crosshair" : (hasFigure(scale) ? (dragging ? "grabbing" : "grab") : "default");

    return {
      session,
      active,
      phase: session?.phase || null,
      dragging,
      hint: hint(session, scale),
      begin: beginSession,
      cancel, reset, skip, confirm,
      setHeightText, setExpandFrame,
      imageProps: {onClick: handleClick, onMouseDown: handleMouseDown, style: {cursor}},
      panelProps: {
        session, scale, active,
        onBegin: beginSession, onCancel: cancel, onReset: reset, onSkip: skip,
        onConfirm: confirm, onHeightText: setHeightText, onExpandFrame: setExpandFrame
      }
    };
  }

  /**
   * The panel, identical on both pages.
   *
   * It is one component rather than two sets of markup because "same wording"
   * is not a thing two copies stay at. Its styles are injected by this module
   * so neither page has to carry them.
   */
  function Panel(props){
    injectStyles();
    const React = window.React;
    const h = React.createElement;
    const {session, scale, active, canSkip = true,
           onBegin, onCancel, onReset, onSkip, onConfirm, onHeightText, onExpandFrame} = props;

    const controls = [];
    if(session?.phase === "height"){
      controls.push(h("input", {
        key: "cm", className: "input input-small fw-scale-input", autoFocus: true, inputMode: "decimal",
        placeholder: "cm", value: session.heightCm,
        onChange: e => onHeightText(e.target.value),
        onKeyDown: e => { if(e.key === "Enter") onConfirm(); }
      }));
      controls.push(h("label", {key: "exp", className: "fw-scale-check"},
        h("input", {type: "checkbox", checked: session.expandFrame, onChange: e => onExpandFrame(e.target.checked)}),
        "Expand frame"
      ));
      controls.push(h("button", {
        key: "set", className: "btn btn-small btn-primary",
        onClick: onConfirm, disabled: !parseFloat(session.heightCm)
      }, "Set"));
    }
    if(active){
      controls.push(h("button", {key: "cancel", className: "btn btn-small", onClick: onCancel}, "Cancel"));
    }else{
      controls.push(h("button", {key: "begin", className: "btn btn-small btn-soft", onClick: onBegin},
        isSet(scale) ? "Set scale again" : "Set scale"));
      if(canSkip && scale?.status !== "skipped"){
        controls.push(h("button", {key: "skip", className: "btn btn-small", onClick: onSkip}, "Skip scale"));
      }
      if(isSet(scale) || scale?.status === "skipped"){
        controls.push(h("button", {key: "reset", className: "btn btn-small", onClick: onReset}, "Reset"));
      }
    }

    return h("div", {className: `fw-scale${active ? " is-active" : ""}`},
      h("div", {className: "fw-scale-hint"}, hint(session, scale)),
      h("div", {className: "fw-scale-row"}, controls)
    );
  }

  window.FrameworkScale = {
    FIGURE_HEIGHT_CM, FIGURE_SVG,
    UNSET, SKIPPED, PHASES,
    isSet, hasFigure,
    pointFromEvent, figureBox, hitsFigure, pxPerCm,
    composite,
    begin, addPoint, confirmHeight, place,
    hint, figureNote,
    injectStyles, useScaleTool, Panel
  };
})();
