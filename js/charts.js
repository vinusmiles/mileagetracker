// A small dependency-free SVG bar chart for monthly fuel spend.
// The chart is decorative for screen readers; the same numbers are in a
// visually hidden list right after it.

import { esc } from './ui.js';

/**
 * @param bars  [{ label, value, valueLabel, current }]
 * @param title accessible title
 */
export function barChart(bars, title) {
  const W = 320;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = W / bars.length;
  const bw = Math.min(34, slot * 0.56);
  const plotH = H - top - bottom;

  const rects = bars.map((b, i) => {
    const h = b.value > 0 ? Math.max(2, (b.value / max) * plotH) : 0;
    const x = i * slot + (slot - bw) / 2;
    const y = top + plotH - h;
    const cx = i * slot + slot / 2;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="${b.current ? 'bar bar-now' : 'bar'}"/>
      ${b.value > 0 ? `<text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" class="bar-val">${esc(b.short)}</text>` : ''}
      <text x="${cx.toFixed(1)}" y="${H - 6}" class="bar-lbl">${esc(b.label)}</text>`;
  }).join('');

  const list = bars.map((b) => `<li>${esc(b.label)}: ${esc(b.valueLabel)}</li>`).join('');
  return `
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <line x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}" class="axis"/>
        ${rects}
      </svg>
      <figcaption class="sr-only">${esc(title)}<ul>${list}</ul></figcaption>
    </figure>`;
}

/** ₹12,345 -> "12.3k", ₹950 -> "950" for labels above bars. */
export function shortMoney(n) {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
