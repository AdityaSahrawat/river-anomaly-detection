import os
from pathlib import Path

import pandas as pd

SERVER_DIR = Path(__file__).resolve().parents[2]  # .../server
DEFAULT_CSV = str(SERVER_DIR / "data" / "river_area_timeseries.csv")
CSV_PATH = os.getenv("CSV_PATH", DEFAULT_CSV)

ANOMALY_PCT_DROP = float(os.getenv("ANOMALY_PCT_DROP", "-0.4"))

df = pd.read_csv(CSV_PATH)
df['date'] = pd.to_datetime(df['date'])

df['month'] = df['date'].dt.month

print(df)

df = df.sort_values("date")

df["change"] = df["water_area_m2"].diff()

print(df)

df["pct_change"] = df["water_area_m2"].pct_change()

df["anomaly"] = df["pct_change"] < ANOMALY_PCT_DROP

print(df)

import matplotlib.pyplot as plt

plt.figure(figsize=(10,5))
plt.plot(df['date'], df['water_area_m2'], marker='o')

anoms = df[df["anomaly"]]
plt.scatter(anoms['date'], anoms['water_area_m2'], color="red", s=100)

plt.title("River Water Area Time Series")
plt.ylabel("Area (m²)")
plt.grid(True)
plt.show()