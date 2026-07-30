/**
 * Composes the "Present" share image.
 *
 * One layout, whichever interface the design came from: the shelf, its size, its
 * price, what is in it, and the Framework mark. Drawn on a 2D canvas over a
 * snapshot of the WebGL view.
 *
 * Sized 1080x1350 -- WhatsApp's portrait format, which it shows large in a chat
 * without cropping the preview, and 1080 wide is the most it keeps before
 * re-encoding. The shelf always gets the same box and is always re-fitted into
 * it, so a design never inherits wherever the live view happened to be panned.
 */
window.FrameworkDesignerPresent = (function () {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  // The shelf's box. The rest is the information panel; a wide run letterboxes
  // inside it rather than shrinking the panel, so every image is the same shape.
  const ART_HEIGHT = 812;
  const PAD = 56;

  const INK = "#202424";
  const MUTED = "#68726f";
  const FAINT = "#9aa5a1";
  const RULE = "#e2e7e4";
  const FONT = "'Red Hat Display', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  /** GL rows come back bottom-up; flip them into an ImageData. */
  function toImageData(context, snapshot) {
    const image = context.createImageData(snapshot.width, snapshot.height);
    const rowBytes = snapshot.width * 4;
    for (let row = 0; row < snapshot.height; row += 1) {
      const from = (snapshot.height - 1 - row) * rowBytes;
      image.data.set(snapshot.pixels.subarray(from, from + rowBytes), row * rowBytes);
    }
    return image;
  }

  function text(context, value, x, y, options) {
    const settings = options || {};
    context.save();
    context.fillStyle = settings.color || INK;
    context.font = `${settings.weight || 500} ${settings.size || 28}px ${FONT}`;
    context.textAlign = settings.align || "left";
    context.textBaseline = settings.baseline || "alphabetic";
    context.fillText(value, x, y);
    const width = context.measureText(value).width;
    context.restore();
    return width;
  }

  /**
   * Draw the shelf snapshot into the art box, scaled to fit and centred.
   *
   * The snapshot is rendered at the art box's own aspect so this is normally 1:1,
   * but a shelf far wider than the box still lands centred rather than stretched.
   */
  function drawArt(context, snapshot) {
    const source = document.createElement("canvas");
    source.width = snapshot.width;
    source.height = snapshot.height;
    source.getContext("2d").putImageData(toImageData(source.getContext("2d"), snapshot), 0, 0);

    const scale = Math.min(WIDTH / snapshot.width, ART_HEIGHT / snapshot.height);
    const drawWidth = snapshot.width * scale;
    const drawHeight = snapshot.height * scale;
    context.drawImage(
      source,
      (WIDTH - drawWidth) / 2,
      (ART_HEIGHT - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
  }

  function drawLogo(context, logo, x, y, height) {
    if (!logo || !logo.width) return 0;
    const width = (logo.width / logo.height) * height;
    context.drawImage(logo, x, y, width, height);
    return width;
  }

  /**
   * `content` is everything the image says:
   *   { sizeLabel, totalLabel, totalNote, lines: [{label, quantity, amount}],
   *     finishName, code, codeUrl }
   */
  function compose(snapshot, content, logo) {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawArt(context, snapshot);

    // Rule between the shelf and the details.
    context.fillStyle = RULE;
    context.fillRect(PAD, ART_HEIGHT, WIDTH - PAD * 2, 1);

    let y = ART_HEIGHT + 62;

    // Size and finish on one line: the two things a client asks first.
    if (content.sizeLabel) {
      text(context, content.sizeLabel, PAD, y, { size: 40, weight: 700 });
    }
    if (content.finishName) {
      text(context, content.finishName, WIDTH - PAD, y, { size: 30, weight: 500, color: MUTED, align: "right" });
    }
    text(context, "width × depth × height", PAD, y + 30, { size: 22, weight: 400, color: FAINT });
    y += 78;

    context.fillStyle = RULE;
    context.fillRect(PAD, y, WIDTH - PAD * 2, 1);
    y += 44;

    // What is in it. Capped so a very long list cannot overflow the panel; the
    // remainder is summarised rather than silently dropped.
    const maxRows = 6;
    const rows = content.lines.slice(0, maxRows);
    const hidden = content.lines.length - rows.length;
    for (const line of rows) {
      text(context, `${line.quantity} ×`, PAD, y, { size: 26, weight: 700, color: MUTED });
      text(context, line.label, PAD + 58, y, { size: 26, weight: 500 });
      text(context, line.amount == null ? "on request" : line.amount, WIDTH - PAD, y, {
        size: 26, weight: 500, color: line.amount == null ? FAINT : INK, align: "right"
      });
      y += 40;
    }
    if (hidden > 0) {
      text(context, `+ ${hidden} more piece${hidden === 1 ? "" : "s"}`, PAD, y, { size: 24, weight: 500, color: FAINT });
      y += 40;
    }

    // Total, pinned to the bottom so its position never moves between images.
    const totalY = HEIGHT - 118;
    context.fillStyle = RULE;
    context.fillRect(PAD, totalY - 54, WIDTH - PAD * 2, 1);
    text(context, "Total", PAD, totalY, { size: 30, weight: 500, color: MUTED });
    text(context, content.totalLabel, WIDTH - PAD, totalY, { size: 48, weight: 700, align: "right" });
    if (content.totalNote) {
      text(context, content.totalNote, WIDTH - PAD, totalY + 30, { size: 21, weight: 400, color: FAINT, align: "right" });
    }

    // Footer: the mark, and the design's reference. The reference is small and
    // grey on purpose -- it is not clickable in a chat, it is there so we can
    // tell later which designs a client was shown.
    const footerY = HEIGHT - 46;
    const logoWidth = drawLogo(context, logo, PAD, footerY - 28, 34);
    text(context, "framework.co.ke", PAD + (logoWidth ? logoWidth + 16 : 0), footerY, {
      size: 24, weight: 700, color: MUTED
    });
    if (content.codeUrl) {
      text(context, content.codeUrl, WIDTH - PAD, footerY, { size: 20, weight: 400, color: FAINT, align: "right" });
    }

    return canvas;
  }

  return { compose, WIDTH, HEIGHT, ART_HEIGHT };
})();
