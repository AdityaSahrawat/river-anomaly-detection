import pandas as pd

df = pd.read_csv("river_area_timeseries.csv")
df['date'] = pd.to_datetime(df['date'])

df['month'] = df['date'].dt.month

print(df)

df = df.sort_values("date")

df["change"] = df["water_area_m2"].diff()

print(df)

df["pct_change"] = df["water_area_m2"].pct_change()

df["anomaly"] = df["pct_change"] < -0.4

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