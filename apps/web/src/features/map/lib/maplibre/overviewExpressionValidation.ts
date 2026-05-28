/**
 * Lightweight MapLibre expression checks for overview layers (no MapLibre runtime).
 */
import type { LayerSpecification } from 'maplibre-gl';

const COLOR_PAINT_KEYS = new Set(['fill-color', 'line-color', 'text-color', 'text-halo-color']);

function isExpression(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

/** Numeric stop inputs from a `step` expression (indices 3, 5, 7, …). */
export function getStepStopValues(expr: unknown[]): number[] {
  const stops: number[] = [];
  for (let i = 3; i < expr.length; i += 2) {
    const stop = expr[i];
    if (typeof stop === 'number') stops.push(stop);
  }
  return stops;
}

/** `step` must be: ["step", input, default, stop, output, ...] — odd arg count after input. */
export function validateStepExpression(expr: unknown[], path: string): string | null {
  if (expr[0] !== 'step' || expr.length < 4) {
    return `${path}: step needs input, default, and stop/output pairs`;
  }
  const tail = expr.length - 2;
  if (tail % 2 === 0) {
    return `${path}: step has ${tail} stops/outputs after input — expected odd count (default + pairs)`;
  }
  const stops = getStepStopValues(expr);
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i] <= stops[i - 1]) {
      return `${path}: step stops must be strictly ascending (got ${stops.join(', ')})`;
    }
  }
  return null;
}

/** Collect every nested `step` expression under `root`. */
export function collectStepExpressions(root: unknown): { path: string; expr: unknown[] }[] {
  const found: { path: string; expr: unknown[] }[] = [];

  function walk(node: unknown, path: string): void {
    if (!isExpression(node)) return;
    if (node[0] === 'step') {
      found.push({ path, expr: node });
    }
    for (let i = 1; i < node.length; i += 1) {
      walk(node[i], `${path}[${i}]`);
    }
  }

  walk(root, 'root');
  return found;
}

/** `match` must be: ["match", input, label, output, ..., default] — even labels+outputs after input. */
export function validateMatchExpression(expr: unknown[], path: string): string | null {
  if (expr[0] !== 'match' || expr.length < 4) {
    return `${path}: match needs input, labels, outputs, and default`;
  }
  const tail = expr.length - 2;
  if (tail % 2 !== 0) {
    return `${path}: match has ${tail} args after input — expected even count`;
  }
  return null;
}

function walkExpression(expr: unknown, path: string, issues: string[]): void {
  if (!isExpression(expr)) return;

  if (expr[0] === 'step') {
    const err = validateStepExpression(expr, path);
    if (err) issues.push(err);
  } else if (expr[0] === 'match') {
    const err = validateMatchExpression(expr, path);
    if (err) issues.push(err);
  }

  for (let i = 1; i < expr.length; i += 1) {
    walkExpression(expr[i], `${path}[${i}]`, issues);
  }
}

/** MapLibre requires `["zoom"]` only as input to a top-level `step` or `interpolate`. */
export function validateZoomAtPaintRoot(value: unknown, path: string): string | null {
  if (!isExpression(value)) return null;
  const head = value[0];
  if (head === 'interpolate' || head === 'step') return null;
  if (JSON.stringify(value).includes('"zoom"')) {
    return `${path}: zoom must be top-level interpolate/step, not nested`;
  }
  return null;
}

function validateColorPaint(value: unknown, path: string): string | null {
  if (typeof value === 'string') return null;
  if (!isExpression(value)) {
    return `${path}: fill-color must be a color string or expression`;
  }
  const head = value[0];
  const allowed = new Set(['interpolate', 'step', 'case', 'match', 'rgb', 'rgba', 'to-rgba', 'hsl', 'hsla']);
  if (!allowed.has(String(head))) {
    return `${path}: unsupported color expression operator "${String(head)}"`;
  }
  if (head === 'hsl' || head === 'hsla') {
    return `${path}: hsl/hsla is not used in overview fills (use interpolate/rgb or a hex string)`;
  }
  return null;
}

function collectLayerExpressions(layer: LayerSpecification): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  if ('filter' in layer && layer.filter !== undefined) {
    out.push({ path: `${layer.id}.filter`, value: layer.filter });
  }
  if ('paint' in layer && layer.paint && typeof layer.paint === 'object') {
    for (const [key, val] of Object.entries(layer.paint)) {
      if (COLOR_PAINT_KEYS.has(key) || key.endsWith('-color')) {
        out.push({ path: `${layer.id}.paint.${key}`, value: val });
      }
    }
  }
  return out;
}

/** Returns human-readable issues for overview layer filters and color paints. */
export function validateOverviewLayerExpressions(layers: LayerSpecification[]): string[] {
  const issues: string[] = [];

  for (const layer of layers) {
    for (const { path, value } of collectLayerExpressions(layer)) {
      if (path.includes('.paint.fill-color')) {
        const colorErr = validateColorPaint(value, path);
        if (colorErr) issues.push(colorErr);
      }
      if (path.endsWith('.line-opacity') || path.endsWith('.line-width')) {
        const zoomErr = validateZoomAtPaintRoot(value, path);
        if (zoomErr) issues.push(zoomErr);
      }
      walkExpression(value, path, issues);
    }
  }

  return issues;
}
