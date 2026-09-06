import type { Locator, Page } from '@playwright/test';

export interface ContrastMeasurement {
  color: string;
  foreground: [number, number, number];
  background: [number, number, number];
  fontSize: number;
  fontWeight: number;
  contrast: number;
  threshold: number;
  passes: boolean;
  layers: Array<{ tag: string; className: string; color: string }>;
}

export interface PixelContrastMeasurement {
  color: string;
  foreground: [number, number, number];
  background: [number, number, number]; // Minimum contrast pixel background
  fontSize: number;
  fontWeight: number;
  contrast: number; // Minimum contrast ratio across sampled background
  threshold: number;
  passes: boolean;
  sampleBox: { x: number; y: number; width: number; height: number };
  paletteSample: Array<[number, number, number]>;
}

/**
 * Standard relative luminance calculation according to WCAG 2.x
 */
export function calculateLuminance(value: [number, number, number]): number {
  const weights = [0.2126, 0.7152, 0.0722] as const;
  return value
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, i) => sum + channel * (weights[i] ?? 0), 0);
}

/**
 * Standard WCAG 2.x contrast ratio
 */
export function calculateContrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const l1 = calculateLuminance(foreground);
  const l2 = calculateLuminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Measures the WCAG contrast ratio of an element's text against its
 * composited ancestor backgrounds using standard canvas color decoding
 * and relative luminance calculations.
 * Measures the locator element itself directly.
 */
export async function measureTextContrast(locator: Locator): Promise<ContrastMeasurement> {
  return locator.evaluate((el) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Missing color decoder context');

    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const r = data[0] ?? 0;
      const g = data[1] ?? 0;
      const b = data[2] ?? 0;
      const a = (data[3] ?? 255) / 255;
      return [r, g, b, a];
    };

    const over = (
      foreground: [number, number, number, number],
      background: [number, number, number],
    ): [number, number, number] => [
      foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
      foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
      foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
    ];

    const ancestors: HTMLElement[] = [];
    for (let current = el as HTMLElement | null; current; current = current.parentElement) {
      ancestors.push(current);
    }

    let background: [number, number, number] = [255, 255, 255];
    const layers: Array<{ tag: string; className: string; color: string }> = [];

    // Reverse ancestors so we composite from topmost ancestor down to the parent of el
    // Ancestors includes el itself. For background compositing:
    // Any backgroundColor on el or its ancestors layers behind el's text.
    for (const current of ancestors.reverse()) {
      const style = getComputedStyle(current);
      if (style.backgroundImage !== 'none') {
        throw new Error('Gradient/image requires a separate pixel measurement');
      }
      if (Number(style.opacity) !== 1) {
        throw new Error('Unexpected ancestor opacity');
      }
      const color = rgba(style.backgroundColor);
      background = over(color, background);
      if (color[3] !== 0) {
        layers.push({
          tag: current.tagName,
          className: current.className,
          color: style.backgroundColor,
        });
      }
    }

    if (!el.textContent?.trim()) {
      throw new Error('Missing visible label text');
    }

    const style = getComputedStyle(el);
    const foreground = over(rgba(style.color), background);

    const weights = [0.2126, 0.7152, 0.0722] as const;
    const luminance = (value: [number, number, number]) =>
      value
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce((sum, channel, i) => sum + channel * (weights[i] ?? 0), 0);

    const l1 = luminance(foreground);
    const l2 = luminance(background);
    const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number(style.fontWeight);
    const threshold = fontSize >= 24 || (fontSize >= 18.6667 && fontWeight >= 700) ? 3 : 4.5;

    return {
      color: style.color,
      foreground,
      background,
      fontSize,
      fontWeight,
      contrast,
      threshold,
      passes: contrast >= threshold,
      layers,
    };
  });
}

/**
 * Measures contrast by sampling real rendered pixel colors beneath text or on translucent overlays
 * (e.g. paused overlay over canvas, or buttons with gradient/canvas backgrounds).
 * Rejects unsupported ancestor opacity for enabled WCAG calculations.
 * Composites foreground text with text alpha.
 * Eliminates color transitions and text-shadow contamination during pixel capture.
 * Evaluates the minimum contrast across the entire actual text background region.
 */
export async function measurePixelTextContrast(
  page: Page,
  locator: Locator,
): Promise<PixelContrastMeasurement> {
  const metadata = await locator.evaluate((el) => {
    // 1. Ancestor opacity verification: reject unsupported opacity < 1
    for (let cur: HTMLElement | null = el as HTMLElement; cur; cur = cur.parentElement) {
      const op = Number(getComputedStyle(cur).opacity);
      if (op !== 1) {
        throw new Error(`Unsupported ancestor opacity on <${cur.tagName.toLowerCase()}>: ${op}`);
      }
    }

    const style = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Missing color decoder context');
    ctx.fillStyle = style.color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const r = data[0] ?? 0;
    const g = data[1] ?? 0;
    const b = data[2] ?? 0;
    const a = (data[3] ?? 255) / 255;
    const fgRgba: [number, number, number, number] = [r, g, b, a];

    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number(style.fontWeight);
    const threshold = fontSize >= 24 || (fontSize >= 18.6667 && fontWeight >= 700) ? 3 : 4.5;

    const originalInlineStyle = (el as HTMLElement).getAttribute('style');

    // Confirm entire text range is fully inside the viewport before screenshot clipping
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > window.innerWidth ||
      rect.bottom > window.innerHeight
    ) {
      throw new Error(
        `Measured text range is not fully inside viewport: [left: ${rect.left}, top: ${rect.top}, right: ${rect.right}, bottom: ${rect.bottom}, width: ${rect.width}, height: ${rect.height}] (viewport: ${window.innerWidth}x${window.innerHeight}) for element <${(el as HTMLElement).tagName.toLowerCase()}>`,
      );
    }

    return {
      color: style.color,
      fgRgba,
      fontSize,
      fontWeight,
      threshold,
      originalInlineStyle,
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      },
    };
  });

  // Temporarily mask text color, eliminate color transitions and remove text-shadow to avoid contamination
  await locator.evaluate((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.setProperty('color', 'transparent', 'important');
    htmlEl.style.setProperty('text-shadow', 'none', 'important');
    htmlEl.style.setProperty('transition', 'none', 'important');
  });

  let pixelSamples: Array<[number, number, number]>;
  try {
    const screenshotBuffer = await page.screenshot({
      clip: metadata.box,
    });

    pixelSamples = await page.evaluate(async (dataBase64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${dataBase64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create 2d canvas context');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const samples: Array<[number, number, number]> = [];
      // Collect every pixel RGB
      for (let i = 0; i < imgData.length; i += 4) {
        samples.push([imgData[i] ?? 0, imgData[i + 1] ?? 0, imgData[i + 2] ?? 0]);
      }
      return samples;
    }, screenshotBuffer.toString('base64'));
  } finally {
    // Exact inline style restoration
    await locator.evaluate((el, original) => {
      const htmlEl = el as HTMLElement;
      if (original !== null) {
        htmlEl.setAttribute('style', original);
      } else {
        htmlEl.removeAttribute('style');
      }
    }, metadata.originalInlineStyle);
  }

  if (pixelSamples.length === 0) {
    throw new Error('No pixel samples collected across text bounding region');
  }

  // Find minimum contrast across the entire sampled background region
  let minContrast = Number.POSITIVE_INFINITY;
  let worstBg: [number, number, number] = pixelSamples[0] ?? [0, 0, 0];
  let worstFg: [number, number, number] = [0, 0, 0];

  for (const bg of pixelSamples) {
    // Composite foreground text over this background pixel using text alpha:
    const alpha = metadata.fgRgba[3];
    const compositedFg: [number, number, number] = [
      Math.round(metadata.fgRgba[0] * alpha + bg[0] * (1 - alpha)),
      Math.round(metadata.fgRgba[1] * alpha + bg[1] * (1 - alpha)),
      Math.round(metadata.fgRgba[2] * alpha + bg[2] * (1 - alpha)),
    ];
    const ratio = calculateContrastRatio(compositedFg, bg);
    if (ratio < minContrast) {
      minContrast = ratio;
      worstBg = bg;
      worstFg = compositedFg;
    }
  }

  // Sample a compact representative palette (unique colors, up to 16 samples)
  const uniqueSamples = Array.from(new Set(pixelSamples.map((p) => p.join(','))))
    .slice(0, 16)
    .map((str) => str.split(',').map(Number) as [number, number, number]);

  return {
    color: metadata.color,
    foreground: worstFg,
    background: worstBg,
    fontSize: metadata.fontSize,
    fontWeight: metadata.fontWeight,
    contrast: minContrast,
    threshold: metadata.threshold,
    passes: minContrast >= metadata.threshold,
    sampleBox: metadata.box,
    paletteSample: uniqueSamples,
  };
}
