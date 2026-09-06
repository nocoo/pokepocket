import type { Locator } from '@playwright/test';

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
    // Notice current is the ancestors in reverse: [html, body, ..., parent, el]
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
