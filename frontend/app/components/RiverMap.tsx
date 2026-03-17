"use client";

import {useEffect, useMemo, useState} from "react";
import DeckGL from "@deck.gl/react";
import {GeoJsonLayer} from "@deck.gl/layers";
import Map from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type TimeseriesRow = {
  date: string;
  water_area_m2: number;
  pct_change: number | null;
  anomaly: boolean;
};

type Props = {
  rows: TimeseriesRow[];
  selectedDate?: string | null;
};

function formatTimestampUTC(ts: string): {primary: string; secondary: string} {
  const d = new Date(ts.endsWith("Z") ? ts : `${ts}Z`);
  if (Number.isNaN(d.getTime())) return { primary: ts, secondary: "" };
  const iso = d.toISOString();
  return { primary: iso.slice(0, 10), secondary: `${iso.slice(11, 16)} UTC` };
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function approxLineLengthKm(geom: any): number {
  if (!geom || typeof geom !== "object") return 0;
  const t = geom.type;
  const coords = geom.coordinates;
  const sumLine = (line: any[]): number => {
    let s = 0;
    for (let i = 1; i < line.length; i++) {
      const p0 = line[i - 1];
      const p1 = line[i];
      if (!Array.isArray(p0) || !Array.isArray(p1)) continue;
      s += haversineKm([p0[0], p0[1]], [p1[0], p1[1]]);
    }
    return s;
  };

  if (t === "LineString" && Array.isArray(coords)) return sumLine(coords);
  if (t === "MultiLineString" && Array.isArray(coords)) {
    return coords.reduce((acc: number, line: any[]) => acc + sumLine(line), 0);
  }
  return 0;
}

// NOTE: We generate river.geojson as a pre-filtered mainstem path.
// The frontend should render it as-is (no additional heuristics).

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export default function RiverMap({rows, selectedDate}: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const riverGeojsonUrl = (process.env.NEXT_PUBLIC_RIVER_GEOJSON_URL ?? "").trim();

  const [viewState, setViewState] = useState(() => ({
    longitude: getEnvNumber("NEXT_PUBLIC_MAP_CENTER_LON", 78.9629),
    latitude: getEnvNumber("NEXT_PUBLIC_MAP_CENTER_LAT", 20.5937),
    zoom: getEnvNumber("NEXT_PUBLIC_MAP_ZOOM", 4),
    pitch: 0,
    bearing: 0,
  }));

  const [geojson, setGeojson] = useState<any | null>(null);

  useEffect(() => {
    if (!riverGeojsonUrl) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(riverGeojsonUrl, {cache: "no-store"});
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setGeojson(json);
      } catch {
        // optional file
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [riverGeojsonUrl]);

  const latest = rows.at(-1);
  const latestTs = latest ? formatTimestampUTC(latest.date) : null;
  const selected = selectedDate
    ? rows.find((r) => r.date === selectedDate) ?? null
    : null;
  const selectedTs = selected ? formatTimestampUTC(selected.date) : null;

  const layers = useMemo(() => {
    const out: any[] = [];

    if (geojson) {
      out.push(
        new GeoJsonLayer({
          id: "river-geojson",
          data: geojson,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1,
          getLineColor: [0, 0, 0, 170],
          getLineWidth: 2,
        }),
      );
    }

    return out;
  }, [geojson]);

  return (
    <div className="relative h-full w-full">
      {!token ? (
        <div className="flex h-full w-full items-center justify-center p-6 text-sm text-zinc-600">
          Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to enable the map.
        </div>
      ) : (
        <DeckGL
          viewState={viewState}
          controller
          onViewStateChange={(e) => setViewState(e.viewState as any)}
          layers={layers}
        >
          <Map
            mapLib={mapboxgl as any}
            mapboxAccessToken={token}
            mapStyle={
              process.env.NEXT_PUBLIC_MAP_STYLE ??
              "mapbox://styles/mapbox/light-v11"
            }
          />
        </DeckGL>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-black/10 bg-white/80 px-3 py-2 text-xs text-zinc-800 backdrop-blur dark:border-white/10 dark:bg-black/60 dark:text-zinc-100">
        <div className="font-medium">River Anomaly Detection</div>
        <div className="text-zinc-800 dark:text-zinc-200">
          Latest:{" "}
          {latest && latestTs
            ? `${latestTs.primary} · ${latestTs.secondary} (${latest.water_area_m2.toFixed(0)} m²)`
            : "—"}
        </div>
        {selected ? (
          <div className="text-zinc-800 dark:text-zinc-200">
            Selected:{" "}
            {selectedTs
              ? `${selectedTs.primary} · ${selectedTs.secondary} (${selected.water_area_m2.toFixed(0)} m²)`
              : `${selected.date} (${selected.water_area_m2.toFixed(0)} m²)`}
          </div>
        ) : null}
        {!geojson && riverGeojsonUrl ? (
          <div className="text-zinc-800 dark:text-zinc-200">
            River geometry not loaded (check NEXT_PUBLIC_RIVER_GEOJSON_URL).
          </div>
        ) : null}
      </div>
    </div>
  );
}
