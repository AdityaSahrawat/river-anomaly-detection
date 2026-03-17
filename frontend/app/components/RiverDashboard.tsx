"use client";

import {useEffect, useMemo, useState} from "react";
import RiverMap from "./RiverMap";

type ApiRow = {
  date: string;
  water_area_m2: number;
  pct_change?: number | null;
  anomaly?: boolean;
};

type TimeseriesRow = ApiRow & {
  pct_change: number | null;
  anomaly: boolean;
};

type ApiResponse =
  | {
      ok: true;
      source: string;
      rows: ApiRow[];
    }
  | {
      ok: false;
      error: string;
      rows: ApiRow[];
    };

function getTimeseriesUrl(pctDrop: number): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE is not set. Set it to your Go backend URL (e.g. http://localhost:8080).",
    );
  }
  const path = `/api/timeseries?pctDrop=${encodeURIComponent(String(pctDrop))}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

function getPctDropThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_ANOMALY_PCT_DROP;
  const fallback = -0.4;
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRows(rows: ApiRow[], pctDrop: number): TimeseriesRow[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  let prev: number | null = null;
  return sorted.map((r) => {
    const area = r.water_area_m2;

    let pct_change: number | null = r.pct_change ?? null;
    if (pct_change === null && prev !== null && prev > 0) {
      pct_change = (area - prev) / prev;
    }

    const anomaly =
      (r.anomaly ?? null) !== null
        ? Boolean(r.anomaly)
        : pct_change !== null && pct_change < pctDrop;
    prev = area;

    return { ...r, pct_change, anomaly };
  });
}

function formatTimestampUTC(ts: string): {primary: string; secondary: string} {
  // CSV timestamps are Sentinel-like (UTC but often without a trailing "Z").
  const d = new Date(ts.endsWith("Z") ? ts : `${ts}Z`);
  if (Number.isNaN(d.getTime())) return { primary: ts, secondary: "" };
  const iso = d.toISOString();
  return { primary: iso.slice(0, 10), secondary: `${iso.slice(11, 16)} UTC` };
}

function formatArea(area: number): string {
  if (!Number.isFinite(area)) return "—";
  if (area >= 1_000_000_000) return `${(area / 1_000_000_000).toFixed(2)}B m²`;
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(2)}M m²`;
  if (area >= 1_000) return `${(area / 1_000).toFixed(2)}K m²`;
  return `${area.toFixed(0)} m²`;
}

function Sparkline({values}: {values: number[]}) {
  const w = 280;
  const h = 48;
  const pad = 2;

  if (values.length < 2) {
    return (
      <div className="text-xs text-zinc-600 dark:text-zinc-300">Not enough data</div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pts = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
      const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-full"
      role="img"
      aria-label="Water area sparkline"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={pts}
        className="text-zinc-900 dark:text-zinc-100"
      />
    </svg>
  );
}

export default function RiverDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [apiRows, setApiRows] = useState<ApiRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const pctDrop = getPctDropThreshold();
  const riverGeojsonUrl = (process.env.NEXT_PUBLIC_RIVER_GEOJSON_URL ?? "").trim();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const url = getTimeseriesUrl(pctDrop);
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;

        if (cancelled) return;

        if (!json.ok) {
          setError(json.error);
          setApiRows([]);
          setSource(null);
          return;
        }

        setApiRows(json.rows);
        setSource(json.source);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pctDrop]);

  const rows = useMemo(() => normalizeRows(apiRows, pctDrop), [apiRows, pctDrop]);
  const anomalies = rows.filter((r) => r.anomaly);

  const areas = useMemo(() => rows.map((r) => r.water_area_m2), [rows]);
  const latest = rows.at(-1) ?? null;
  const minArea = areas.length ? Math.min(...areas) : null;
  const maxArea = areas.length ? Math.max(...areas) : null;
  const latestTs = latest ? formatTimestampUTC(latest.date) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-black/10 px-5 py-3 dark:border-white/10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-semibold">River Dashboard</div>
            <div className="text-xs text-zinc-700 dark:text-zinc-300">
              NDWI time series + simple anomaly flags
            </div>
          </div>
          <div className="text-right text-xs text-zinc-700 dark:text-zinc-300">
            <div>Threshold: pct_change &lt; {pctDrop}</div>
            <div className="truncate max-w-[60ch] text-zinc-600 dark:text-zinc-300">
              {source ? `Source: ${source}` : ""}
            </div>
          </div>
        </div>
      </header>

      <main className="flex flex-1 min-h-0">
        <section className="flex-1 min-w-0">
          <RiverMap rows={rows} selectedDate={selectedDate} />
        </section>

        <aside className="w-90 border-l border-black/10 p-4 dark:border-white/10">
          {loading ? (
            <div className="text-sm text-zinc-700 dark:text-zinc-300">Loading…</div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
                <div className="text-sm font-medium">Summary</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {latest ? formatArea(latest.water_area_m2) : "—"}
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-300">Latest</div>
                    {latestTs ? (
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                        {latestTs.primary} · {latestTs.secondary}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {anomalies.length}
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-300">Anomalies</div>
                  </div>
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {minArea === null ? "—" : formatArea(minArea)}
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-300">Min</div>
                  </div>
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {maxArea === null ? "—" : formatArea(maxArea)}
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-300">Max</div>
                  </div>
                </div>

                <div className="mt-2">
                  <Sparkline values={areas} />
                </div>

                <div className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
                  Threshold: pct_change &lt; {pctDrop}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-sm font-medium">Anomalies</div>
                <div className="text-xs text-zinc-700 dark:text-zinc-300">
                  {anomalies.length} flagged out of {rows.length}
                </div>
              </div>

              <div className="mt-3 flex-1 overflow-auto rounded-md border border-black/10 dark:border-white/10">
                {anomalies.length === 0 ? (
                  <div className="p-3 text-sm text-zinc-700 dark:text-zinc-300">
                    No anomalies found.
                  </div>
                ) : (
                  <ul className="divide-y divide-black/10 text-sm dark:divide-white/10">
                    {anomalies.map((a) => (
                      (() => {
                        const ts = formatTimestampUTC(a.date);
                        const isSelected = selectedDate === a.date;
                        const pctText =
                          a.pct_change !== null
                            ? `${(a.pct_change * 100).toFixed(1)}%`
                            : "—";
                        const pctIsBad = a.pct_change !== null && a.pct_change < pctDrop;

                        return (
                      <li key={a.date}>
                        <button
                          type="button"
                          onClick={() => setSelectedDate(a.date)}
                          className={
                            "w-full p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10 " +
                            (isSelected ? "bg-black/5 dark:bg-white/10" : "")
                          }
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="font-medium">{ts.primary}</div>
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                              {ts.secondary}
                            </div>
                          </div>
                          <div className="text-xs text-zinc-700 dark:text-zinc-300">
                            area: {formatArea(a.water_area_m2)} · pct_change:{" "}
                            <span
                              className={
                                pctIsBad
                                  ? "font-medium text-zinc-900 dark:text-zinc-100"
                                  : ""
                              }
                            >
                              {pctText}
                            </span>
                          </div>
                        </button>
                      </li>
                        );
                      })()
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
                {riverGeojsonUrl ? (
                  <>River overlay: <span className="font-medium">{riverGeojsonUrl}</span></>
                ) : (
                  <>To draw the river on the map, set <span className="font-medium">NEXT_PUBLIC_RIVER_GEOJSON_URL</span> and serve a GeoJSON from <span className="font-medium">/public</span>.</>
                )}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
