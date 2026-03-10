import matplotlib.pyplot as plt

plt.figure(figsize=(10,5))
plt.plot(df['date'], df['water_area_m2'], marker='o')

anoms = df[df["anomaly"]]
plt.scatter(anoms['date'], anoms['water_area_m2'], color="red", s=100)

plt.title("River Water Area Time Series")
plt.ylabel("Area (m²)")
plt.grid(True)
plt.show()