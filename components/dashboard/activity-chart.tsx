"use client";

import { useId, useState } from "react";
import styles from "./dashboard.module.css";

const shortDate = (day: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export function ActivityChart({ activity }: { activity: { day: string; n: number }[] }) {
  const [days, setDays] = useState(14);
  const [selected, setSelected] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const points = activity.slice(-days);
  const total = points.reduce((sum, point) => sum + point.n, 0);
  const max = Math.max(...points.map(point => point.n), 4);
  const scale = Math.ceil(max / 4) * 4;
  const width = 680, height = 168, padding = 8;
  const x = (index: number) => padding + index / Math.max(points.length - 1, 1) * (width - padding * 2);
  const y = (value: number) => height - padding - value / scale * (height - padding * 2);
  const path = points.map((point, i) => `${i ? "L" : "M"} ${x(i)} ${y(point.n)}`).join(" ");
  const selectedPoint = selected === null ? null : points[selected];
  return <section className={`${styles.panel} ${styles.activityPanel}`} aria-label="Workspace activity">
    <div className={styles.panelHeading}><h2>Workspace activity</h2><div role="group" aria-label="Activity date range" className={styles.periods}>{[7, 14, 30].map(period => <button type="button" key={period} aria-pressed={days === period} onClick={() => { setDays(period); setSelected(null); }}>{period} days</button>)}</div></div>
    <div className={styles.activityStats}><strong>{total.toLocaleString("en-US")}</strong><span>workspace events<span className={styles.activityRange}>{points.length ? `${shortDate(points[0].day)} – ${shortDate(points[points.length - 1].day)}` : "No activity yet"}</span></span><span className={styles.chartKey}><i />Audit activity</span></div>
    <div className={styles.chartArea}>
      <div className={styles.yAxis} aria-hidden>{[scale, scale * .75, scale * .5, scale * .25, 0].map(value => <span key={value}>{value}</span>)}</div>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${total} audit events over the last ${days} days`}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--dash-teal)" stopOpacity=".17" /><stop offset="100%" stopColor="var(--dash-teal)" stopOpacity=".015" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map(i => <line key={i} x1="0" x2={width} y1={y(scale * i / 4)} y2={y(scale * i / 4)} stroke="rgb(var(--line))" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
          {points.length > 0 && <><path d={`${path} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill={`url(#${gradientId})`} /><path d={path} fill="none" stroke="var(--dash-teal)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></>}
          {selectedPoint && selected !== null && <><line x1={x(selected)} x2={x(selected)} y1={padding} y2={height - padding} stroke="var(--dash-teal)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" /><circle cx={x(selected)} cy={y(selectedPoint.n)} r="4" fill="var(--dash-teal)" stroke="rgb(var(--panel))" strokeWidth="2" vectorEffect="non-scaling-stroke" /></>}
        </svg>
        <div className={styles.chartHitTargets} onMouseLeave={() => setSelected(null)}>{points.map((point, i) => <button key={point.day} type="button" aria-label={`${shortDate(point.day)}: ${point.n} audit events`} onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)} onBlur={() => setSelected(null)} onClick={() => setSelected(i)} />)}</div>
        {selectedPoint && selected !== null && <div className={styles.chartTooltip} style={{ left: `${Math.max(12, Math.min(88, selected / Math.max(points.length - 1, 1) * 100))}%` }} role="status"><span>{shortDate(selectedPoint.day)}</span><strong>{selectedPoint.n} {selectedPoint.n === 1 ? "event" : "events"}</strong></div>}
        <div className={styles.xAxis} aria-hidden>{points.filter((_, i) => i === 0 || i === Math.floor((points.length - 1) / 3) || i === Math.floor((points.length - 1) * 2 / 3) || i === points.length - 1).map(point => <span key={point.day}>{shortDate(point.day)}</span>)}</div>
      </div>
    </div>
  </section>;
}
