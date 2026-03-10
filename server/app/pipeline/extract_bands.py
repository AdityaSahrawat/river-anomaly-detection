import os
import glob
import rasterio
import numpy as np

RAW_DIR = "data/raw/SAFE"
OUT_DIR = "data/extracted"

os.makedirs(OUT_DIR, exist_ok=True)

def find_band_files(safe_folder):
    r10_dir = glob.glob(os.path.join(safe_folder, "GRANULE", "*", "IMG_DATA", "R10m"))[0]

    bands = {
        "B02": glob.glob(os.path.join(r10_dir, "*B02*.jp2"))[0],
        "B03": glob.glob(os.path.join(r10_dir, "*B03*.jp2"))[0],
        "B04": glob.glob(os.path.join(r10_dir, "*B04*.jp2"))[0],
        "B08": glob.glob(os.path.join(r10_dir, "*B08*.jp2"))[0],
    }

    return bands


def stack_bands(band_paths, output_path):
    with rasterio.open(band_paths["B02"]) as src:
        meta = src.meta

    meta.update(
    driver="GTiff",
    count=4,
    compress="deflate",
    predictor=2,
    tiled=True,
    blockxsize=512,
    blockysize=512
)

    with rasterio.open(output_path, "w", **meta) as dst:
        for i, band in enumerate(["B02", "B03", "B04", "B08"], start=1):
            with rasterio.open(band_paths[band]) as src:
                dst.write(src.read(1), i)


def main():
    safe_folders = glob.glob(os.path.join(RAW_DIR, "*.SAFE"))

    for safe in safe_folders:
        scene_name = os.path.basename(safe).split("_")[2]  # date portion
        output_file = os.path.join(OUT_DIR, f"{scene_name}.tif")

        print(f"Processing {safe}")

        band_paths = find_band_files(safe)
        stack_bands(band_paths, output_file)

        print(f"Saved {output_file}")


if __name__ == "__main__":
    main()