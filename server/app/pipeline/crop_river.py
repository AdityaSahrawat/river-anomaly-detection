import os
import glob
import geopandas as gpd
import rasterio
from rasterio.mask import mask

EXTRACTED_DIR = "data/extracted"
RIVER_SHP = "data/river/HydroRIVERS_v10_asia.shp"
OUTPUT_DIR = "data/processed"

os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Loading river dataset...")
rivers = gpd.read_file(RIVER_SHP)


def crop_raster(raster_path):

    with rasterio.open(raster_path) as src:

        bounds = src.bounds

        # create bounding box polygon
        bbox = gpd.GeoDataFrame(
            geometry=[gpd.GeoSeries.box(bounds.left, bounds.bottom, bounds.right, bounds.top)[0]],
            crs=src.crs
        )

        # convert river CRS to match raster
        rivers_proj = rivers.to_crs(src.crs)

        # select rivers intersecting tile
        rivers_tile = rivers_proj[rivers_proj.intersects(bbox.geometry[0])]

        # create river buffer (500 meters)
        river_buffer = rivers_tile.buffer(500)

        geoms = river_buffer.geometry.values

        out_image, out_transform = mask(src, geoms, crop=True)

        out_meta = src.meta.copy()

        out_meta.update({
            "height": out_image.shape[1],
            "width": out_image.shape[2],
            "transform": out_transform
        })

        output_name = os.path.basename(raster_path)
        output_path = os.path.join(OUTPUT_DIR, output_name)

        with rasterio.open(output_path, "w", **out_meta) as dest:
            dest.write(out_image)

        print("Saved:", output_path)


def main():

    rasters = glob.glob(os.path.join(EXTRACTED_DIR, "*.tif"))

    for r in rasters:
        crop_raster(r)


if __name__ == "__main__":
    main()