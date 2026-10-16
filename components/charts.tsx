/**
 * Charts, drawn as plain SVG in server components.
 *
 * No charting library: these render with the page, need no client JavaScript, and inherit the
 * theme through CSS variables, so light and dark are handled by the palette rather than by two
 * sets of chart options.
 *
 * Every chart here plots values it was handed. None of them extrapolate, smooth or estimate -
 * an empty dataset renders as an empty state, never as a flat line implying a measured zero.
 */
export type Slice = { label: string; value: number; tone?: ChartTone };
export type ChartTone = "accent" | "ok" | "warn" | "bad" | "info" | "neutral";

const FILL: Record<ChartTone, string> = {
  accent: "rgb(var(--accent))", ok: "rgb(var(--ok))", warn: "rgb(var(--warn))",
  bad: "rgb(var(--bad))", info: "rgb(var(--info))", neutral: "rgb(var(--neutral))",
};

/** Deterministic tone rotation, so the same series keeps the same colours across renders. */
const CYCLE: ChartTone[] = ["accent", "info", "ok", "warn", "neutral", "bad"];
const toneAt = (i: number) => CYCLE[i % CYCLE.length];

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);

function NoData({ children = "No data yet." }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[120px] text-[12px] text-muted
                    text-center px-4">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ donut */

export function Donut({ data, size = 132, thickness = 17, centerLabel, centerValue, empty }: {
  data: Slice[]; size?: number; thickness?: number;
  centerLabel?: string; centerValue?: string | number; empty?: React.ReactNode;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <NoData>{empty}</NoData>;

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d, i) => {
            const len = (d.value / total) * circumference;
            const seg = (
              <circle key={d.label} cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={FILL[d.tone ?? toneAt(i)]} strokeWidth={thickness}
                strokeDasharray={`${len} ${circumference - len}`} strokeDashoffset={-offset}>
                <title>{`${d.label}: ${d.value.toLocaleString()} (${pct(d.value, total).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </g>
        {(centerValue !== undefined || centerLabel) && (
          <text x="50%" y="50%" textAnchor="middle" className="fill-ink">
            <tspan x="50%" dy="-2" fontSize="19" fontWeight="600">
              {typeof centerValue === "number" ? centerValue.toLocaleString() : centerValue}
            </tspan>
            <tspan x="50%" dy="16" fontSize="10" className="fill-muted">{centerLabel}</tspan>
          </text>
        )}
      </svg>
      <ul className="t-small space-y-1.5 flex-1 min-w-[150px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-sm shrink-0 mt-1"
              style={{ background: FILL[d.tone ?? toneAt(i)] }} />
            <span className="text-muted flex-1 leading-snug">{d.label}</span>
            <span className="tabular-nums font-medium">{d.value.toLocaleString()}</span>
            <span className="tabular-nums text-muted w-9 text-right">
              {pct(d.value, total).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- horizontal bars */

export function HBars({ data, max, unit, empty, href }: {
  data: Slice[]; max?: number; unit?: string; empty?: React.ReactNode;
  href?: (s: Slice) => string;
}) {
  if (!data.length) return <NoData>{empty}</NoData>;
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d, i) => {
        const label = (
          <span className="truncate text-muted group-hover:text-ink transition-colors">
            {d.label}
          </span>
        );
        return (
          <li key={d.label} className="group">
            <div className="flex items-baseline justify-between gap-3 text-[12px] mb-1">
              {href ? <a href={href(d)} className="truncate hover:underline">{label}</a> : label}
              <span className="tabular-nums shrink-0">
                {d.value.toLocaleString()}{unit && <span className="text-muted"> {unit}</span>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-line/70 overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(pct(d.value, top), d.value > 0 ? 2 : 0)}%`,
                         background: FILL[d.tone ?? toneAt(i)] }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- columns */

export function Columns({ data, height = 140, unit, empty }: {
  data: Slice[]; height?: number; unit?: string; empty?: React.ReactNode;
}) {
  if (!data.length || data.every((d) => d.value === 0)) return <NoData>{empty}</NoData>;
  const top = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: height + 34 }}>
      {data.map((d, i) => (
        <div key={d.label} className="flex flex-col items-center gap-1 flex-1 min-w-[34px] group">
          <span className="text-[10px] tabular-nums text-muted opacity-0 group-hover:opacity-100
                           transition-opacity">
            {d.value.toLocaleString()}
          </span>
          <div className="w-full rounded-t transition-all hover:opacity-80"
            style={{ height: Math.max((d.value / top) * height, d.value > 0 ? 3 : 1),
                     background: FILL[d.tone ?? toneAt(i)] }}
            title={`${d.label}: ${d.value.toLocaleString()}${unit ? ` ${unit}` : ""}`} />
          <span className="text-[10px] text-muted truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- meters */

export function Meter({ label, value, total, tone = "accent", caption }: {
  label: string; value: number; total: number; tone?: ChartTone; caption?: string;
}) {
  const p = pct(value, total);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-muted truncate">{label}</span>
        <span className="tabular-nums">
          {value.toLocaleString()}
          <span className="text-muted"> / {total.toLocaleString()} · {p.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-line/70 overflow-hidden mt-1.5">
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: FILL[tone] }} />
      </div>
      {caption && <div className="text-[10px] text-muted mt-1">{caption}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- funnel */

export function Funnel({ steps, empty }: { steps: Slice[]; empty?: React.ReactNode }) {
  const top = steps[0]?.value ?? 0;
  if (!top) return <NoData>{empty}</NoData>;
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const prev = i === 0 ? s.value : steps[i - 1].value;
        const drop = prev - s.value;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-[12px] mb-1">
              <span className="text-muted">{s.label}</span>
              <span className="tabular-nums">
                {s.value.toLocaleString()}
                {i > 0 && drop > 0 && (
                  <span className="text-muted"> · −{drop.toLocaleString()}</span>
                )}
              </span>
            </div>
            <div className="h-6 rounded bg-line/40 overflow-hidden">
              <div className="h-full rounded flex items-center px-2 text-[10px] font-medium
                              text-accent-ink transition-all"
                style={{ width: `${Math.max(pct(s.value, top), s.value > 0 ? 6 : 0)}%`,
                         background: FILL[s.tone ?? toneAt(i)] }}>
                {pct(s.value, top) >= 12 && `${pct(s.value, top).toFixed(0)}%`}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- sparkline */

export function Sparkline({ points, height = 44, tone = "accent", labels }: {
  points: number[]; height?: number; tone?: ChartTone; labels?: string[];
}) {
  if (points.length < 2 || points.every((p) => p === 0))
    return <NoData>Not enough activity yet to plot a trend.</NoData>;

  const w = 100, top = Math.max(...points, 1);
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - (p / top) * (height - 6) - 3] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none"
        className="w-full" style={{ height }} role="img"
        aria-label={`trend, peak ${top.toLocaleString()}`}>
        <path d={area} fill={FILL[tone]} opacity={0.12} />
        <path d={line} fill="none" stroke={FILL[tone]} strokeWidth={1.5}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {labels && (
        <div className="flex justify-between text-[10px] text-muted mt-0.5">
          <span>{labels[0]}</span><span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
