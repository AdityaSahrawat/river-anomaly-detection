package main

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TimeseriesRow struct {
	Date        string   `json:"date"`
	WaterAreaM2 float64  `json:"water_area_m2"`
	PctChange   *float64 `json:"pct_change"`
	Anomaly     bool     `json:"anomaly"`
}

type TimeseriesResponse struct {
	OK     bool            `json:"ok"`
	Source string          `json:"source,omitempty"`
	Rows   []TimeseriesRow `json:"rows"`
	Error  string          `json:"error,omitempty"`
}

func main() {
	addr := envOr("ADDR", ":8080")

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "time": time.Now().UTC().Format(time.RFC3339)})
	})

	mux.HandleFunc("/api/timeseries", handleTimeseries)

	h := withCORS(mux)

	fmt.Printf("Go API listening on %s\n", addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		panic(err)
	}
}

func handleTimeseries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Query params
	q := r.URL.Query()
	pctDrop := parseFloatDefault(q.Get("pctDrop"), -0.4)

	// Locate CSV
	csvPath, err := findTimeseriesCSV()
	if err != nil {
		writeJSON(w, http.StatusNotFound, TimeseriesResponse{OK: false, Error: err.Error(), Rows: []TimeseriesRow{}})
		return
	}

	rows, err := readTimeseriesCSV(csvPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, TimeseriesResponse{OK: false, Error: err.Error(), Rows: []TimeseriesRow{}})
		return
	}

	rows = computePctChangeAndAnomaly(rows, pctDrop)
	writeJSON(w, http.StatusOK, TimeseriesResponse{OK: true, Source: csvPath, Rows: rows})
}

func computePctChangeAndAnomaly(rows []TimeseriesRow, pctDrop float64) []TimeseriesRow {
	// Ensure ascending sort by date string (ISO sorts lexicographically).
	sort.Slice(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })

	var prev *float64
	for i := range rows {
		rows[i].PctChange = nil
		rows[i].Anomaly = false

		if prev != nil && *prev > 0 {
			pc := (rows[i].WaterAreaM2 - *prev) / *prev
			rows[i].PctChange = &pc
			rows[i].Anomaly = pc < pctDrop
		}
		v := rows[i].WaterAreaM2
		prev = &v
	}

	return rows
}

func readTimeseriesCSV(csvPath string) ([]TimeseriesRow, error) {
	f, err := os.Open(csvPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	records, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return []TimeseriesRow{}, nil
	}

	header := records[0]
	dateIdx := -1
	areaIdx := -1
	for i, h := range header {
		h = strings.TrimSpace(h)
		switch h {
		case "date":
			dateIdx = i
		case "water_area_m2":
			areaIdx = i
		}
	}
	if dateIdx == -1 || areaIdx == -1 {
		return nil, fmt.Errorf("unexpected CSV header: %q", strings.Join(header, ","))
	}

	out := make([]TimeseriesRow, 0, max(0, len(records)-1))
	for _, rec := range records[1:] {
		if len(rec) <= max(dateIdx, areaIdx) {
			continue
		}
		date := strings.TrimSpace(rec[dateIdx])
		areaStr := strings.TrimSpace(rec[areaIdx])
		if date == "" || areaStr == "" {
			continue
		}
		area, err := strconv.ParseFloat(areaStr, 64)
		if err != nil {
			continue
		}
		out = append(out, TimeseriesRow{Date: date, WaterAreaM2: area})
	}

	return out, nil
}

func findTimeseriesCSV() (string, error) {
	if p := strings.TrimSpace(os.Getenv("TIMESERIES_CSV")); p != "" {
		if fileExists(p) {
			return p, nil
		}
		return "", fmt.Errorf("TIMESERIES_CSV set but not found: %s", p)
	}

	serverDir := serverDirFromCaller()
	candidates := []string{
		filepath.Join(serverDir, "data", "river_area_timeseries.csv"),
		filepath.Join(serverDir, "river_area_timeseries.csv"),
	}
	for _, p := range candidates {
		if fileExists(p) {
			return p, nil
		}
	}
	return "", errors.New("river_area_timeseries.csv not found (generate it under server/data)")
}

func serverDirFromCaller() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		wd, _ := os.Getwd()
		return wd
	}
	appDir := filepath.Dir(thisFile) // .../server/app
	serverDir := filepath.Clean(filepath.Join(appDir, ".."))
	return serverDir
}

func withCORS(next http.Handler) http.Handler {
	allowed := strings.TrimSpace(os.Getenv("CORS_ORIGIN"))
	// Default: allow localhost dev origins.
	if allowed == "" {
		allowed = "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
	}
	allowedSet := make(map[string]struct{})
	for _, o := range strings.Split(allowed, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowedSet[o] = struct{}{}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, ok := allowedSet[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func parseFloatDefault(s string, fallback float64) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return fallback
	}
	return v
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	if err != nil {
		return false
	}
	return !st.IsDir()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
