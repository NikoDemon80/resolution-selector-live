import { app } from "../../scripts/app.js";

const READOUT_HEIGHT = 24;
const MP_MIN = 0.1;
const MP_MAX = 16.0;
const MP_STEP = 0.01;

function ratioFrom(value) {
  const m = typeof value === "string" ? /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(value) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Matches Python's round() (round half to even), so results equal the node's output.
function pyRound(x) {
  const f = Math.floor(x);
  return x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
}

function sizeFor(ratio, mp, mult) {
  const scale = Math.sqrt((mp * 1024 * 1024) / (ratio[0] * ratio[1]));
  return [pyRound((ratio[0] * scale) / mult) * mult, pyRound((ratio[1] * scale) / mult) * mult];
}

// For a ratio and multiple, list one megapixel value per distinct output resolution.
// Each value is that resolution's own MP rounded to 2 decimals, provided it maps back
// to the same resolution; otherwise the closest 2-decimal value that does.
const validCache = new Map();
function validMegapixels(ratio, mult) {
  const key = `${ratio[0]}:${ratio[1]}@${mult}`;
  if (validCache.has(key)) return validCache.get(key);
  const groups = new Map();
  const steps = Math.round((MP_MAX - MP_MIN) / MP_STEP);
  for (let i = 0; i <= steps; i++) {
    const mp = Math.round((MP_MIN + i * MP_STEP) * 100) / 100;
    const [w, h] = sizeFor(ratio, mp, mult);
    if (w <= 0 || h <= 0) continue;
    const k = `${w}x${h}`;
    if (!groups.has(k)) groups.set(k, { w, h, mps: [] });
    groups.get(k).mps.push(mp);
  }
  const values = [];
  for (const { w, h, mps } of groups.values()) {
    const actual = (w * h) / 1048576;
    const rounded = Math.round(actual * 100) / 100;
    if (mps.includes(rounded)) {
      values.push(rounded);
    } else {
      values.push(mps.reduce((best, mp) => (Math.abs(mp - actual) < Math.abs(best - actual) ? mp : best)));
    }
  }
  values.sort((a, b) => a - b);
  validCache.set(key, values);
  return values;
}

function nearest(values, v) {
  let best = values[0];
  for (const x of values) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}

// One step up or down (arrows, slow drag) jumps to the next valid value in that direction.
// Anything bigger (typed value, fast drag) snaps to the nearest valid value.
function snap(values, oldV, newV) {
  if (!values.length) return newV;
  const delta = newV - oldV;
  if (oldV != null && Math.abs(delta) > 1e-9 && Math.abs(delta) <= MP_STEP * 1.5) {
    if (delta > 0) return values.find((x) => x > oldV + 1e-9) ?? values[values.length - 1];
    for (let i = values.length - 1; i >= 0; i--) if (values[i] < oldV - 1e-9) return values[i];
    return values[0];
  }
  return nearest(values, newV);
}

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function currentSettings(node) {
  const ratio = ratioFrom(getWidget(node, "aspect_ratio")?.value);
  const mult = getWidget(node, "multiple")?.value;
  return ratio && mult > 0 ? { ratio, mult } : null;
}

function setMp(node, mpWidget, value) {
  mpWidget.value = value;
  mpWidget._rslLast = value;
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "ResolutionSelectorLive.readout",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ResolutionSelectorLive") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      const node = this;
      try {
        const mpWidget = getWidget(node, "megapixels");
        if (!mpWidget) return result;
        mpWidget._rslLast = mpWidget.value;

        // Megapixel changes: snap to a value with a valid resolution.
        const mpCallback = mpWidget.callback;
        mpWidget.callback = function (value) {
          const s = currentSettings(node);
          if (s) {
            const snapped = snap(validMegapixels(s.ratio, s.mult), mpWidget._rslLast, mpWidget.value);
            setMp(node, mpWidget, snapped);
          }
          return mpCallback?.call(this, mpWidget.value);
        };

        // Ratio or multiple changes: move megapixels to the nearest valid value for the new setting.
        for (const name of ["aspect_ratio", "multiple"]) {
          const w = getWidget(node, name);
          if (!w) continue;
          const cb = w.callback;
          w.callback = function () {
            const r = cb?.apply(this, arguments);
            const s = currentSettings(node);
            if (s) setMp(node, mpWidget, nearest(validMegapixels(s.ratio, s.mult), mpWidget.value));
            return r;
          };
        }
      } catch (e) {
        console.warn("[ResolutionSelectorLive] snapping setup error", e);
      }
      return result;
    };

    // Keep the last-known value in sync after a workflow loads.
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const mpWidget = getWidget(this, "megapixels");
      if (mpWidget) mpWidget._rslLast = mpWidget.value;
      return r;
    };

    // Classic canvas readout. (In Nodes 2.0 mode the built-in preview widget shows the size.)
    const origComputeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const size = origComputeSize ? origComputeSize.apply(this, arguments) : [220, 100];
      size[1] += READOUT_HEIGHT;
      return size;
    };

    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      onDrawForeground?.apply(this, arguments);
      if (this.flags?.collapsed) return;
      try {
        const linked = ["aspect_ratio", "megapixels", "multiple"].some((n) =>
          this.inputs?.some((i) => i.name === n && i.link != null)
        );
        let text = "—";
        if (linked) {
          text = "size set by a linked input";
        } else {
          const s = currentSettings(this);
          const mp = getWidget(this, "megapixels")?.value;
          if (s && mp > 0) {
            const [w, h] = sizeFor(s.ratio, mp, s.mult);
            text = `${w} × ${h}   (${((w * h) / 1048576).toFixed(2)} MP)`;
          }
        }
        ctx.save();
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = "#9fd39f";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, this.size[0] / 2, this.size[1] - READOUT_HEIGHT / 2);
        ctx.restore();
      } catch (e) {
        console.warn("[ResolutionSelectorLive] readout error", e);
      }
    };
  },
});
