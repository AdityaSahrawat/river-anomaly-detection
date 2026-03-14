import csv
import glob
import os
from datetime import datetime
from pathlib import Path

import numpy as np
import rasterio

# Resolve defaults relative to the server/ folder, regardless of current working directory.
SERVER_DIR = Path(__file__).resolve().parents[2]  # .../server
DEFAULT_PROCESSED_DIR = str(SERVER_DIR / "data" / "processed")
DEFAULT_OUT_CSV = str(SERVER_DIR / "data" / "river_area_timeseries.csv")

PROCESSED_DIR = os.getenv("PROCESSED_DIR", DEFAULT_PROCESSED_DIR)
OUT_CSV = os.getenv("OUT_CSV", DEFAULT_OUT_CSV)
NDWI_THRESHOLD = float(os.getenv("NDWI_THRESHOLD", "0.1"))


def _parse_scene_datetime_from_filename(path: str) -> datetime:
    name = os.path.splitext(os.path.basename(path))[0]
    # Expected pattern: 20250612T052649
    return datetime.strptime(name, "%Y%m%dT%H%M%S")


def _pixel_area_m2(transform) -> float:
    # Determinant of the 2x2 affine matrix (handles rotation too)
    return abs(transform.a * transform.e - transform.b * transform.d)


def water_area_for_scene(tif_path: str) -> float:
    with rasterio.open(tif_path) as src:
        nodata = src.nodata
        px_area = _pixel_area_m2(src.transform)

        water_pixels = 0

        # Band order in extracted/processed GeoTIFF: B02,B03,B04,B08
        # NDWI uses green (B03 = band 2) and NIR (B08 = band 4)
        for _, window in src.block_windows(1):
            green = src.read(2, window=window).astype("float32")
            nir = src.read(4, window=window).astype("float32")

            denom = green + nir
            valid = denom != 0
            if nodata is not None:
                valid &= (green != nodata) & (nir != nodata)

            ndwi = np.zeros_like(green, dtype="float32")
            np.divide(green - nir, denom, out=ndwi, where=valid)

            water_pixels += int(((ndwi > NDWI_THRESHOLD) & valid).sum())

        return water_pixels * px_area


def main() -> None:
    tifs = sorted(glob.glob(os.path.join(PROCESSED_DIR, "*.tif")))
    if not tifs:
        raise FileNotFoundError(f"No .tif files found in {PROCESSED_DIR}")

    rows: list[dict[str, str]] = []
    for tif in tifs:
        dt = _parse_scene_datetime_from_filename(tif)
        area = water_area_for_scene(tif)
        rows.append({"date": dt.isoformat(timespec="seconds"), "water_area_m2": f"{area:.3f}"})
        print(f"{os.path.basename(tif)} -> {area:.3f} m^2")

    out_dir = os.path.dirname(OUT_CSV)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(OUT_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["date", "water_area_m2"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {OUT_CSV}")


if __name__ == "__main__":
    main()
