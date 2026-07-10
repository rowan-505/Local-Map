/**
 * Shared canvas pin renderer for selected POI + transport markers (MapLibre `addImage`, not DOM).
 */

export type SelectedPinGlyph = 'default' | 'bus' | 'terminal';

export type SelectedPinImageOptions = {
  readonly fillColor: string;
  readonly glyph?: SelectedPinGlyph;
};

/** Teardrop map-pin silhouette used by POI and transport selected symbols. */
export function drawSelectedMapPinPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(22, 48);
  ctx.bezierCurveTo(20, 43, 7, 31, 7, 19);
  ctx.bezierCurveTo(7, 10, 13.2, 4.5, 22, 4.5);
  ctx.bezierCurveTo(30.8, 4.5, 37, 10, 37, 19);
  ctx.bezierCurveTo(37, 31, 24, 43, 22, 48);
  ctx.closePath();
}

export function createSelectedMapPinImage(
  options: SelectedPinImageOptions,
): ImageData | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 88;
  canvas.height = 104;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(2, 2);
  ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;

  drawSelectedMapPinPath(ctx);
  ctx.fillStyle = options.fillColor;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  drawSelectedMapPinPath(ctx);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  drawSelectedMapPinPath(ctx);
  ctx.fillStyle = options.fillColor;
  ctx.fill();

  drawSelectedPinGlyph(ctx, options.glyph ?? 'default');

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawSelectedPinGlyph(ctx: CanvasRenderingContext2D, glyph: SelectedPinGlyph): void {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (glyph) {
    case 'bus':
      drawBusGlyph(ctx);
      break;
    case 'terminal':
      drawTerminalGlyph(ctx);
      break;
    case 'default':
    default:
      drawDefaultDotGlyph(ctx);
      break;
  }

  ctx.restore();
}

function drawDefaultDotGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.arc(22, 18, 5.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBusGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 13, 16, 13);
  ctx.beginPath();
  ctx.moveTo(14, 18);
  ctx.lineTo(30, 18);
  ctx.moveTo(18, 26);
  ctx.lineTo(16, 29);
  ctx.moveTo(26, 26);
  ctx.lineTo(28, 29);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, 23, 1, 0, Math.PI * 2);
  ctx.arc(26, 23, 1, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerminalGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(13, 25);
  ctx.lineTo(31, 25);
  ctx.moveTo(15, 16);
  ctx.lineTo(29, 16);
  ctx.moveTo(22, 11);
  ctx.lineTo(31, 16);
  ctx.lineTo(13, 16);
  ctx.closePath();
  ctx.moveTo(17, 16);
  ctx.lineTo(17, 25);
  ctx.moveTo(22, 16);
  ctx.lineTo(22, 25);
  ctx.moveTo(27, 16);
  ctx.lineTo(27, 25);
  ctx.stroke();
}
