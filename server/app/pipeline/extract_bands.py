import os
import glob
import rasterio
import numpy as np

RAW_DIR = "data/raw/SAFE"
OUT_DIR = "data/extracted"

BANDS_10M = ("B02", "B03", "B04", "B08")

# Output tuning (override via env vars if needed)
GTIFF_COMPRESS = os.getenv("GTIFF_COMPRESS", "deflate").lower()  # deflate|lzw|zstd (if supported by GDAL)
GTIFF_TILE_SIZE = int(os.getenv("GTIFF_TILE_SIZE", "512"))
GTIFF_ZLEVEL = os.getenv("GTIFF_ZLEVEL")  # e.g. "9" for DEFLATE
MAX_SCENES = int(os.getenv("MAX_SCENES", "0"))  # 0 = all
SKIP_EXISTING = os.getenv("SKIP_EXISTING", "1") not in {"0", "false", "False"}

os.makedirs(OUT_DIR, exist_ok=True)

def find_band_files(safe_folder):
    r10_matches = glob.glob(os.path.join(safe_folder, "GRANULE", "*", "IMG_DATA", "R10m"))
    if not r10_matches:
        raise FileNotFoundError(f"No R10m IMG_DATA directory found under: {safe_folder}")
    r10_dir = r10_matches[0]

    bands: dict[str, str] = {}
    for band in BANDS_10M:
        matches = glob.glob(os.path.join(r10_dir, f"*{band}*_10m.jp2"))
        if not matches:
            matches = glob.glob(os.path.join(r10_dir, f"*{band}*.jp2"))
        if not matches:
            raise FileNotFoundError(f"Missing {band} JP2 in {r10_dir}")
        bands[band] = matches[0]

    return bands


def stack_bands(band_paths, output_path):
    with rasterio.open(band_paths["B02"]) as src0:
        profile = src0.profile.copy()

    profile.update(
        driver="GTiff",
        count=len(BANDS_10M),
        compress=GTIFF_COMPRESS,
        predictor=2,
        tiled=True,
        blockxsize=min(GTIFF_TILE_SIZE, profile["width"]),
        blockysize=min(GTIFF_TILE_SIZE, profile["height"]),
        BIGTIFF="IF_SAFER",
        interleave="pixel",
    )
    if GTIFF_COMPRESS == "deflate" and GTIFF_ZLEVEL:
        # GDAL creation option for DEFLATE level; only applied if supported.
        profile["zlevel"] = int(GTIFF_ZLEVEL)

    # Open all sources once.
    srcs = [rasterio.open(band_paths[b]) for b in BANDS_10M]
    try:
        # Sanity-check alignment.
        for s in srcs[1:]:
            if (s.width, s.height) != (srcs[0].width, srcs[0].height):
                raise ValueError("Band rasters have different shapes; resampling not implemented")
            if s.transform != srcs[0].transform:
                raise ValueError("Band rasters have different transforms; resampling not implemented")

        with rasterio.open(output_path, "w", **profile) as dst:
            # Windowed copy to keep memory usage low.
            for _, window in srcs[0].block_windows(1):
                for i, s in enumerate(srcs, start=1):
                    dst.write(s.read(1, window=window), i, window=window)
    finally:
        for s in srcs:
            s.close()


def main():
    safe_folders = glob.glob(os.path.join(RAW_DIR, "*.SAFE"))

    if MAX_SCENES > 0:
        safe_folders = safe_folders[:MAX_SCENES]

    for safe in safe_folders:
        scene_name = os.path.basename(safe).split("_")[2]  # date portion
        output_file = os.path.join(OUT_DIR, f"{scene_name}.tif")

        print(f"Processing {safe}")

        if SKIP_EXISTING and os.path.exists(output_file):
            print(f"Skipping existing {output_file}")
            continue

        band_paths = find_band_files(safe)
        stack_bands(band_paths, output_file)

        print(f"Saved {output_file}")


if __name__ == "__main__":
    main()