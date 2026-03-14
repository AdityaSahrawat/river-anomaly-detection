import os
import glob
import numpy as np
import rasterio
from rasterio.mask import mask
from shapely.geometry import shape
from shapely.ops import unary_union
from rasterio.features import shapes

EXTRACTED_DIR = "data/extracted"
OUTPUT_DIR = "data/processed"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def _safe_tiff_block_size(dim: int, target: int = 512) -> int | None:
    """Return a tiled TIFF block size that satisfies GDAL's multiple-of-16 rule.

    If the raster dimension is smaller than 16 pixels, return None to indicate
    tiling should be disabled.
    """
    if dim < 16:
        return None
    block = min(target, dim)
    block = (block // 16) * 16
    return max(16, block)


def crop_river(raster_path):

    with rasterio.open(raster_path) as src:
        # Read only bands needed for NDWI and keep float32 to reduce memory.
        green = src.read(2).astype("float32")
        nir = src.read(4).astype("float32")

        # NDWI = (G - NIR) / (G + NIR)
        denom = green + nir
        ndwi = np.zeros_like(green, dtype="float32")
        np.divide(green - nir, denom, out=ndwi, where=denom != 0)

        water_mask = ndwi > 0.1

        geoms = []
        for geom, value in shapes(water_mask.astype(np.uint8), transform=src.transform):
            if value == 1:
                geoms.append(shape(geom))

        if not geoms:
            print(f"No water pixels found for {os.path.basename(raster_path)}; skipping")
            return

        # Buffer around water (riverbanks). Assumes projected CRS in meters (e.g., UTM).
        buffer_geom = unary_union([g.buffer(150) for g in geoms])

        profile = src.profile.copy()
        nodata = profile.get("nodata")
        if nodata is None:
            nodata = 0

        out_image, out_transform = mask(src, [buffer_geom], crop=True, nodata=nodata, filled=True)

        # Ensure output stays compressed; tile when block sizes are valid.
        out_h, out_w = out_image.shape[1], out_image.shape[2]
        blockx = _safe_tiff_block_size(out_w)
        blocky = _safe_tiff_block_size(out_h)

        profile.update(
            driver="GTiff",
            height=out_h,
            width=out_w,
            transform=out_transform,
            nodata=nodata,
            compress="deflate",
            predictor=2,
            BIGTIFF="IF_SAFER",
        )

        if blockx is not None and blocky is not None:
            profile.update(
                tiled=True,
                blockxsize=blockx,
                blockysize=blocky,
            )
        else:
            # Too small to tile under GDAL constraints; keep compression, disable tiling.
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)
            profile["tiled"] = False

        out_file = os.path.join(OUTPUT_DIR, os.path.basename(raster_path))
        with rasterio.open(out_file, "w", **profile) as dst:
            dst.write(out_image)

        print("Saved:", out_file)


def main():

    rasters = glob.glob(os.path.join(EXTRACTED_DIR, "*.tif"))
    max_scenes = int(os.getenv("MAX_SCENES", "0"))
    if max_scenes > 0:
        rasters = rasters[:max_scenes]

    for r in rasters:
        crop_river(r)


if __name__ == "__main__":
    main()