import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv("river_area_timeseries.csv")
df['date'] = pd.to_datetime(df['date'])
df = df.sort_values("date")

plt.figure(figsize=(10,5))
plt.plot(df['date'], df['water_area_m2'], marker='o')
plt.xticks(rotation=45)
plt.ylabel("Water Area (m²)")
plt.title("Yamuna River Water Area Over Time")
plt.grid(True)
plt.show()