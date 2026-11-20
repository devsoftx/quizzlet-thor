// Small, dependency-free charts for the Progress page: segmented bars, stacked
// columns, a heat map, a spider (radar) chart and a Pareto chart.
//
// Each one draws at its real pixel width (so text stays readable on a phone),
// has a hover tooltip, and comes with a table twin (<ChartTable>) so no value
// is reachable only by pointing. Colors are CSS classes (styles.css,
// "Progress page"), with their own light and dark steps.

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { heatStep, niceTicks } from "../chart-scale";

// ------------------------------------------------------------------ Shared

/** The width an element really has, kept up to date as it resizes. */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface TipRow {
  /** CSS class of the series' color, for the line key. */
  tone?: string;
  value: string;
  label: string;
}

interface Tip {
  x: number;
  y: number;
  /** Near the right edge: show the tooltip to the left of the pointer. */
  flip: boolean;
  title: string;
  rows: TipRow[];
}

/**
 * A tooltip for the marks inside one chart. `bind(title, rows)` gives a mark
 * its pointer handlers. The tooltip only repeats what the table twin says, so
 * it is hidden from screen readers.
 */
function useTooltip() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const place = (event: PointerEvent, title: string, rows: TipRow[]) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    setTip({ x, y: event.clientY - box.top, flip: x > box.width * 0.6, title, rows });
  };
  const bind = (title: string, rows: TipRow[]) => ({
    onPointerEnter: (event: PointerEvent) => place(event, title, rows),
    onPointerMove: (event: PointerEvent) => place(event, title, rows),
    onPointerLeave: () => setTip(null),
  });

  const tooltip = tip && (
    <div className={`chart-tip${tip.flip ? " is-left" : ""}`} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <p className="chart-tip__title">{tip.title}</p>
      {tip.rows.map((row) => (
        <p key={row.label} className="chart-tip__row">
          {row.tone && <span className={`chart-tip__key ${row.tone}`} />}
          <strong>{row.value}</strong> <span>{row.label}</span>
        </p>
      ))}
    </div>
  );
  return { frameRef, bind, tooltip };
}

/** A legend: a swatch (or a line, for line series) and a name per series. */
export function Legend({ items }: { items: Array<{ tone: string; label: string; line?: boolean }> }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`chart-legend__key${item.line ? " is-line" : ""} ${item.tone}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Every chart's values as a plain table, folded away under the chart. */
export function ChartTable({ summary, caption, headers, rows }: { summary: string; caption: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="chart-table">
      <summary>{summary}</summary>
      <div className="chart-table__scroll">
        <table>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} scope="col" className={i > 0 ? "is-number" : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- a fixed table, in display order
              <tr key={r}>
                {row.map((cell, c) =>
                  c === 0 ? (
                    // eslint-disable-next-line @eslint-react/no-array-index-key -- columns are positional
                    <th key={c} scope="row">{cell}</th>
                  ) : (
                    // eslint-disable-next-line @eslint-react/no-array-index-key -- columns are positional
                    <td key={c} className="is-number">{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A column with a 4px rounded top and a square foot. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Shortens a label to about `chars` characters. */
const fit = (label: string, chars: number) => (label.length > chars ? `${label.slice(0, Math.max(1, chars - 1))}…` : label);

/** Breaks a label into lines of about `chars` characters, at spaces (at most `max` lines). */
function wrap(label: string, chars: number, max = 3): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= chars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length > max ? [...lines.slice(0, max - 1), fit(lines.slice(max - 1).join(" "), chars)] : lines;
}

// ---------------------------------------------------------- Segmented bars

export interface Segment {
  tone: string;
  label: string;
  value: number;
}

/**
 * One row per group: a bar split into its parts (widths by share of the row),
 * with the row's name before it and a summary after it. Rows of different
 * sizes all span the full width: the bar shows the split, the text the size.
 */
export function SegmentedBars({ rows, label }: { rows: Array<{ key: string; label: string; segments: Segment[]; summary: string }>; label: string }) {
  const { frameRef, bind, tooltip } = useTooltip();
  return (
    <div className="chart" ref={frameRef}>
      <ul className="seg-bars" aria-label={label}>
        {rows.map((row) => {
          const total = row.segments.reduce((sum, s) => sum + s.value, 0);
          return (
            <li key={row.key} className="seg-bars__row">
              <span className="seg-bars__label">{row.label}</span>
              <span className="seg-bars__bar" aria-hidden="true">
                {total === 0 ? (
                  <span className="seg-bars__empty" />
                ) : (
                  row.segments
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <span
                        key={s.label}
                        className={`seg-bars__part ${s.tone}`}
                        style={{ flexGrow: s.value }}
                        {...bind(row.label, row.segments.map((x) => ({ tone: x.tone, value: String(x.value), label: x.label })))}
                      />
                    ))
                )}
              </span>
              <span className="seg-bars__summary">{row.summary}</span>
            </li>
          );
        })}
      </ul>
      {tooltip}
    </div>
  );
}

// ---------------------------------------------------------- Stacked columns

/**
 * Columns stacked from a shared baseline (one stack per bin), 24px wide at
 * most, with a 2px gap between the parts and a rounded top on the last one.
 */
export function StackedColumns({
  bins,
  series,
  label,
  axisLabel,
}: {
  bins: Array<{ key: string; label: string; values: number[] }>;
  series: Array<{ tone: string; label: string }>;
  label: string;
  axisLabel: string;
}) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const { frameRef, bind, tooltip } = useTooltip();
  const height = 220;
  const m = { top: 14, right: 8, bottom: 34, left: 40 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = Math.max(1, ...bins.map((b) => b.values.reduce((s, v) => s + v, 0)));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const band = plotW / bins.length;
  const barW = Math.min(24, band * 0.6);
  const chars = Math.max(3, Math.floor(band / 7));

  return (
    <div className="chart" ref={frameRef}>
      <div ref={boxRef}>
        <svg width={width} height={height} role="img" aria-label={label} className="chart-svg">
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          <text className="chart-tick" x={12} y={m.top + plotH / 2} transform={`rotate(-90 12 ${m.top + plotH / 2})`} textAnchor="middle">{axisLabel}</text>
          {bins.map((bin, i) => {
            const x = m.left + band * i + (band - barW) / 2;
            const total = bin.values.reduce((s, v) => s + v, 0);
            let base = 0;
            const lastPart = bin.values.findLastIndex((v) => v > 0);
            return (
              <g key={bin.key} {...bind(bin.label, series.map((s, j) => ({ tone: s.tone, value: String(bin.values[j]), label: s.label })))}>
                <rect className="chart-hit" x={m.left + band * i} y={m.top} width={band} height={plotH} />
                {bin.values.map((v, j) => {
                  if (v === 0) return null;
                  const y0 = y(base);
                  const y1 = y(base + v);
                  base += v;
                  const gap = j === lastPart ? 0 : 2; // the 2px surface gap above each part but the last
                  return <path key={series[j].label} className={series[j].tone} d={columnPath(x, y1 + gap, barW, Math.max(0, y0 - y1 - gap), j === lastPart)} />;
                })}
                {total > 0 && <text className="chart-value" x={x + barW / 2} y={y(total) - 6} textAnchor="middle">{total}</text>}
                <text className="chart-tick" x={m.left + band * (i + 0.5)} y={height - m.bottom + 18} textAnchor="middle">{fit(bin.label, chars)}</text>
              </g>
            );
          })}
          <line className="chart-axis" x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} />
        </svg>
      </div>
      {tooltip}
    </div>
  );
}

// ---------------------------------------------------------------- Heat map

/** A grid of cells shaded by share (one hue, light to dark), each labeled with its share and count. */
export function Heatmap({
  rows,
  columns,
  label,
  scaleLabel,
  format,
}: {
  rows: Array<{ key: string; label: string; total: number; counts: number[] }>;
  columns: string[];
  label: string;
  scaleLabel: string;
  format: (share: number) => string;
}) {
  const { frameRef, bind, tooltip } = useTooltip();
  return (
    <div className="chart" ref={frameRef}>
      <div className="heatmap" role="img" aria-label={label} style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${columns.length}, minmax(0, 1fr))` }}>
        <span />
        {columns.map((c) => (
          <span key={c} className="heatmap__col">{c}</span>
        ))}
        {rows.map((row) => (
          <div key={row.key} className="heatmap__row">
            <span className="heatmap__label">{row.label}</span>
            {row.counts.map((n, i) => {
              const share = row.total ? n / row.total : null;
              return (
                <span
                  key={columns[i]}
                  className={`heatmap__cell heat-${heatStep(share)}`}
                  {...bind(`${row.label} · ${columns[i]}`, [{ value: share === null ? "—" : format(share), label: String(n) }])}
                >
                  {share === null ? "—" : format(share)}
                  <small>{n}</small>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heatmap__scale" aria-hidden="true">
        <span>{scaleLabel}</span>
        <span className="heatmap__steps">
          {[1, 2, 3, 4, 5].map((s) => (
            <span key={s} className={`heat-${s}`} />
          ))}
        </span>
        <span>0% → 100%</span>
      </div>
      {tooltip}
    </div>
  );
}

// ------------------------------------------------------------ Spider chart

/**
 * A spider (radar) chart: one spoke per axis from 0 (center) to 100%, one
 * closed outline per series. A missing value sits at the center.
 */
export function Radar({
  axes,
  series,
  label,
  format,
}: {
  axes: string[];
  series: Array<{ key: string; tone: string; label: string; values: Array<number | null> }>;
  label: string;
  format: (v: number | null) => string;
}) {
  const [boxRef, width] = useWidth<HTMLDivElement>(420);
  const { frameRef, bind, tooltip } = useTooltip();
  const chars = width < 420 ? 11 : 15;
  const labels = axes.map((axis) => wrap(axis, chars));
  // Room at the sides for the longest label line, above and below for three lines.
  const side = Math.min(130, Math.max(...labels.flat().map((l) => l.length)) * 6.6 + 16);
  const r = Math.max(56, Math.min(150, width / 2 - side));
  const height = 2 * r + 2 * 52;
  const cx = width / 2;
  const cy = height / 2;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / axes.length;
  const point = (i: number, v: number) => [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v] as const;

  return (
    <div className="chart" ref={frameRef}>
      <div ref={boxRef} className="radar">
        <svg width={width} height={height} role="img" aria-label={label} className="chart-svg">
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <polygon key={ring} className="chart-grid" fill="none" points={axes.map((_, i) => point(i, ring).join(",")).join(" ")} />
          ))}
          {axes.map((axis, i) => {
            const [x, y] = point(i, 1);
            const [lx, ly] = point(i, 1 + 12 / r);
            const cos = Math.cos(angle(i));
            const sin = Math.sin(angle(i));
            const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
            const lines = labels[i];
            // Above the chart the lines stack upward, below it downward, at the sides around the spoke.
            const first = sin < -0.5 ? -(lines.length - 1) * 1.15 - 0.2 : sin > 0.5 ? 0.9 : -((lines.length - 1) / 2) * 1.15 + 0.32;
            return (
              <g key={axis}>
                <line className="chart-grid" x1={cx} y1={cy} x2={x} y2={y} />
                <text className="chart-tick" x={lx} y={ly} textAnchor={anchor}>
                  {lines.map((line, j) => (
                    <tspan key={line} x={lx} dy={`${j === 0 ? first : 1.15}em`}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {series.map((s) => (
            <polygon key={s.key} className={`radar__area ${s.tone}`} points={s.values.map((v, i) => point(i, v ?? 0).join(",")).join(" ")} />
          ))}
          {series.map((s) =>
            s.values.map((v, i) => {
              const [x, y] = point(i, v ?? 0);
              return (
                <g key={`${s.key}-${axes[i]}`} {...bind(`${s.label} · ${axes[i]}`, [{ tone: s.tone, value: format(v), label: s.label }])}>
                  <circle className="chart-hit" cx={x} cy={y} r={12} />
                  <circle className={`radar__dot ${s.tone}`} cx={x} cy={y} r={4} />
                </g>
              );
            }),
          )}
        </svg>
      </div>
      {tooltip}
    </div>
  );
}

// ------------------------------------------------------------ Pareto chart

/**
 * A Pareto chart on one axis (0–100%): each group's share of the total as a
 * column, biggest first, and the running total as a line, with a guide at 80%.
 */
export function Pareto({
  bars,
  label,
  shareLabel,
  cumulativeLabel,
  countLabel,
  guideLabel,
  format,
}: {
  bars: Array<{ key: string; label: string; wrong: number; share: number; cumulative: number }>;
  label: string;
  shareLabel: string;
  cumulativeLabel: string;
  countLabel: string;
  guideLabel: string;
  format: (share: number) => string;
}) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const { frameRef, bind, tooltip } = useTooltip();
  const height = 240;
  const m = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const y = (v: number) => m.top + plotH - v * plotH;
  const band = plotW / Math.max(1, bars.length);
  const barW = Math.min(24, band * 0.6);
  const cx = (i: number) => m.left + band * (i + 0.5);
  const chars = Math.max(3, Math.floor(band / 7));
  // The running total climbs from 0 through each column's right edge, clear of the column labels.
  const edge = (i: number) => m.left + band * (i + 1);
  const line = `M${m.left},${y(0)}${bars.map((b, i) => `L${edge(i)},${y(b.cumulative)}`).join("")}`;

  return (
    <div className="chart" ref={frameRef}>
      <div ref={boxRef}>
        <svg width={width} height={height} role="img" aria-label={label} className="chart-svg">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          <line className="chart-guide" x1={m.left} x2={width - m.right} y1={y(0.8)} y2={y(0.8)} />
          <text className="chart-tick" x={width - m.right} y={y(0.8)} dy="-0.4em" textAnchor="end">{guideLabel}</text>
          {bars.map((b, i) => (
            <g
              key={b.key}
              {...bind(b.label, [
                { tone: "viz-series", value: format(b.share), label: shareLabel },
                { tone: "viz-ink-line", value: format(b.cumulative), label: cumulativeLabel },
                { value: String(b.wrong), label: countLabel },
              ])}
            >
              <rect className="chart-hit" x={m.left + band * i} y={m.top} width={band} height={plotH} />
              <path className="viz-series" d={columnPath(cx(i) - barW / 2, y(b.share), barW, Math.max(0, y(0) - y(b.share)), true)} />
              <text className="chart-value" x={cx(i)} y={y(b.share) - 6} textAnchor="middle">{format(b.share)}</text>
              <text className="chart-tick" x={cx(i)} y={height - m.bottom + 18} textAnchor="middle">{fit(b.label, chars)}</text>
            </g>
          ))}
          <path className="pareto__line" d={line} />
          {bars.map((b, i) => (
            <circle key={b.key} className="pareto__dot" cx={edge(i)} cy={y(b.cumulative)} r={4} />
          ))}
          <line className="chart-axis" x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} />
        </svg>
      </div>
      {tooltip}
    </div>
  );
}
