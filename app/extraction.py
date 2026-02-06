import rasterio
import numpy as np
import pandas as pd
from pathlib import Path

BASE = Path("data")
results = []

for date_dir in sorted(BASE.iterdir()):
    b03 = rasterio.open(date_dir / "B03_10m.jp2")
    b08 = rasterio.open(date_dir / "B08_10m.jp2")

    green = b03.read(1).astype("float32")
    nir = b08.read(1).astype("float32")

    ndwi = (green - nir) / (green + nir + 1e-6)

    water = ndwi > 0.2   # threshold

    pixel_area = abs(b03.transform.a * b03.transform.e)
    water_area = water.sum() * pixel_area

    results.append({
        "date": date_dir.name,
        "water_area_m2": water_area
    })

df = pd.DataFrame(results)
df.to_csv("river_area_timeseries.csv", index=False)
