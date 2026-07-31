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
  const WITNESS = "#c3ccc8";
  const FONT = "'Red Hat Display', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  // The module list. One row per module type with a quantity, so a 30-unit run
  // of three parts is three rows -- which is why 25 is a ceiling a real design
  // never reaches, and truncating past it is safe.
  const MAX_LIST_ROWS = 25;
  const LIST_SINGLE_COLUMN_MAX = 7; // beyond this it splits into two columns
  const LIST_GUTTER = 44;
  const LIST_ROW_MAX = 40;
  const LIST_FONT_MAX = 26;
  const LIST_FONT_MIN = 13;

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
   * Where the snapshot lands inside the art box: scaled to fit, centred.
   *
   * The snapshot is rendered at the art box's own aspect so this is normally a
   * straight halving of a 2x render, but a shelf far wider than the box still
   * lands centred rather than stretched. Exported because the caller needs the
   * same mapping to put a dimension overlay over the picture.
   */
  function artTransform(snapshot) {
    const scale = Math.min(WIDTH / snapshot.width, ART_HEIGHT / snapshot.height);
    return {
      scale,
      offsetX: (WIDTH - snapshot.width * scale) / 2,
      offsetY: (ART_HEIGHT - snapshot.height * scale) / 2
    };
  }

  function drawArt(context, snapshot) {
    const source = document.createElement("canvas");
    source.width = snapshot.width;
    source.height = snapshot.height;
    source.getContext("2d").putImageData(toImageData(source.getContext("2d"), snapshot), 0, 0);

    const { scale, offsetX, offsetY } = artTransform(snapshot);
    context.drawImage(source, offsetX, offsetY, snapshot.width * scale, snapshot.height * scale);
  }

  /**
   * The dimension overlay, already projected into this canvas's pixels by the
   * caller (it owns the drafting maths and the camera; see dimensionGeometry in
   * app.js). Nothing here knows what a shelf is -- it strokes segments and
   * centres numbers.
   */
  function drawDimensions(context, dimensions) {
    if (!dimensions) return;
    context.save();
    context.lineCap = "butt";
    for (const line of dimensions.lines) {
      context.strokeStyle = line.witness ? WITNESS : MUTED;
      context.lineWidth = line.witness ? 2 : 2.4;
      context.beginPath();
      context.moveTo(line.x1, line.y1);
      context.lineTo(line.x2, line.y2);
      context.stroke();
    }
    // Numbers last, each knocked out of whatever it lands on, the way the live
    // overlay paints them. The size comes with the geometry so the two stay in
    // proportion.
    const fontPx = dimensions.fontPx || 23;
    context.font = `700 ${fontPx}px ${FONT}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.strokeStyle = "#ffffff";
    context.lineWidth = fontPx * 0.3;
    for (const label of dimensions.labels) {
      context.strokeText(label.text, label.x, label.y);
    }
    context.fillStyle = INK;
    for (const label of dimensions.labels) {
      context.fillText(label.text, label.x, label.y);
    }
    context.restore();
  }

  /** Cut a label down until it fits, with an ellipsis to say that it was cut. */
  function fitText(context, value, maxWidth) {
    if (context.measureText(value).width <= maxWidth) return value;
    let text = value;
    while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) {
      text = text.slice(0, -1);
    }
    return `${text}…`;
  }

  /** What a row says on its right: the unit price, or that there is not one. */
  function amountText(line) {
    if (line.amount == null) return "on request";
    // The unit price, not the line total: at two columns there is no room for
    // both, and the unit price is the one a client asks about.
    return line.quantity > 1 ? `${line.amount} each` : line.amount;
  }

  /**
   * The largest type size at which every row fits its column on one line.
   *
   * Canvas text width scales linearly with the font size, so measuring once at a
   * reference size gives the answer directly rather than by trying sizes until
   * one fits.
   */
  const LIST_REFERENCE_PX = 100;

  function fittingFontSize(context, lines, columnWidth) {
    let widest = 0;
    for (const line of lines) {
      context.font = `700 ${LIST_REFERENCE_PX}px ${FONT}`;
      const count = context.measureText(`${line.quantity} ×`).width;
      context.font = `500 ${LIST_REFERENCE_PX}px ${FONT}`;
      const rest = context.measureText(line.label).width + context.measureText(amountText(line)).width;
      // The two gaps in the row, at the same reference size.
      widest = Math.max(widest, count + rest + LIST_REFERENCE_PX * 1.2);
    }
    return widest > 0 ? (columnWidth * LIST_REFERENCE_PX) / widest : LIST_FONT_MAX;
  }

  /**
   * The module list, between `top` and `bottom`.
   *
   * Sized to fit rather than capped, in both directions: the rows are counted
   * first, split into two columns once there are more than a handful, and then
   * given whatever type size the band's height AND the column's width both
   * allow. A long design gets smaller type instead of a "+ 9 more pieces" line
   * standing in for the half of it that would not fit, and a long piece name
   * shrinks the list rather than being cut short while the column sits half
   * empty.
   */
  function drawBreakdown(context, allLines, top, bottom) {
    const lines = allLines.slice(0, MAX_LIST_ROWS);
    const hidden = allLines.length - lines.length;
    const rowCount = lines.length + (hidden > 0 ? 1 : 0);
    if (!rowCount) return;

    const columns = rowCount > LIST_SINGLE_COLUMN_MAX ? 2 : 1;
    const perColumn = Math.ceil(rowCount / columns);
    const rowHeight = Math.min(LIST_ROW_MAX, (bottom - top) / perColumn);
    const columnWidth = (WIDTH - PAD * 2 - LIST_GUTTER * (columns - 1)) / columns;
    const fontSize = Math.max(LIST_FONT_MIN, Math.min(
      LIST_FONT_MAX,
      rowHeight * 0.66,
      fittingFontSize(context, lines, columnWidth)
    ));
    // Centred in the band rather than pinned to its top, so a three-piece design
    // sits between its two rules instead of leaving a hole above the total.
    const listTop = top + Math.max(0, (bottom - top) - rowHeight * perColumn) / 2;

    context.save();
    context.textBaseline = "middle";
    lines.forEach((line, index) => {
      const column = Math.floor(index / perColumn);
      const left = PAD + column * (columnWidth + LIST_GUTTER);
      const right = left + columnWidth;
      const middle = listTop + (index % perColumn) * rowHeight + rowHeight / 2;

      context.font = `700 ${fontSize}px ${FONT}`;
      const count = `${line.quantity} ×`;
      const countWidth = context.measureText(count).width;
      context.fillStyle = MUTED;
      context.textAlign = "left";
      context.fillText(count, left, middle);

      context.font = `500 ${fontSize}px ${FONT}`;
      const amount = amountText(line);
      const amountWidth = context.measureText(amount).width;
      context.fillStyle = line.amount == null ? FAINT : INK;
      context.textAlign = "right";
      context.fillText(amount, right, middle);

      context.fillStyle = INK;
      context.textAlign = "left";
      const labelLeft = left + countWidth + fontSize * 0.5;
      context.fillText(
        fitText(context, line.label, right - amountWidth - fontSize * 0.7 - labelLeft),
        labelLeft,
        middle
      );
    });

    if (hidden > 0) {
      const column = Math.floor(lines.length / perColumn);
      const left = PAD + column * (columnWidth + LIST_GUTTER);
      const middle = listTop + (lines.length % perColumn) * rowHeight + rowHeight / 2;
      context.font = `500 ${fontSize}px ${FONT}`;
      context.fillStyle = FAINT;
      context.textAlign = "left";
      context.fillText(`+ ${hidden} more piece${hidden === 1 ? "" : "s"}`, left, middle);
    }
    context.restore();
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
   *     finishName, code, codeHome, dimensions }
   *
   * `dimensions` is optional and already in this canvas's pixels; see
   * drawDimensions.
   */
  function compose(snapshot, content, logo) {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawArt(context, snapshot);
    drawDimensions(context, content.dimensions);

    // Rule between the shelf and the details.
    context.fillStyle = RULE;
    context.fillRect(PAD, ART_HEIGHT, WIDTH - PAD * 2, 1);

    let y = ART_HEIGHT + 58;

    // Size and finish on one line: the two things a client asks first. A very
    // wide run and a shelf built from three colours can both make their side
    // long, so the finish yields -- the size is the headline.
    let sizeWidth = 0;
    if (content.sizeLabel) {
      sizeWidth = text(context, content.sizeLabel, PAD, y, { size: 40, weight: 700 });
    }
    if (content.finishName) {
      context.save();
      context.font = `500 30px ${FONT}`;
      const room = WIDTH - PAD * 2 - sizeWidth - 32;
      const finish = fitText(context, content.finishName, room);
      context.restore();
      text(context, finish, WIDTH - PAD, y, { size: 30, weight: 500, color: MUTED, align: "right" });
    }
    text(context, "width × depth × height", PAD, y + 30, { size: 22, weight: 400, color: FAINT });
    y += 74;

    context.fillStyle = RULE;
    context.fillRect(PAD, y, WIDTH - PAD * 2, 1);

    // Total, pinned to the bottom so its position never moves between images.
    // The module list gets the whole band between the two, at whatever size it
    // needs to fill it without running past.
    const totalY = HEIGHT - 118;
    const totalRuleY = totalY - 54;
    drawBreakdown(context, content.lines, y + 20, totalRuleY - 22);

    context.fillStyle = RULE;
    context.fillRect(PAD, totalRuleY, WIDTH - PAD * 2, 1);
    text(context, "Total", PAD, totalY, { size: 30, weight: 500, color: MUTED });
    text(context, content.totalLabel, WIDTH - PAD, totalY, { size: 48, weight: 700, align: "right" });
    if (content.totalNote) {
      text(context, content.totalNote, WIDTH - PAD, totalY + 30, { size: 21, weight: 400, color: FAINT, align: "right" });
    }

    // Footer: the mark, then the design's own address, written as one URL so it
    // is obvious that it is one. One size throughout, with the code in bold
    // against a muted path -- mixing sizes made it read as two separate things,
    // which is the fault the earlier "framework.co.ke/builder · 1JALY1R"
    // had in the first place.
    const footerY = HEIGHT - 46;
    const logoWidth = drawLogo(context, logo, PAD, footerY - 28, 34);
    let x = PAD + (logoWidth ? logoWidth + 18 : 0);
    if (content.code) {
      x += text(context, content.codeHome, x, footerY, { size: 26, weight: 500, color: MUTED });
      text(context, content.code, x, footerY, { size: 26, weight: 700, color: INK });
    } else {
      text(context, "framework.co.ke", x, footerY, { size: 26, weight: 700, color: MUTED });
    }

    return canvas;
  }

  return { compose, artTransform, WIDTH, HEIGHT, ART_HEIGHT };
})();
