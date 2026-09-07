// Клиент не считает: роут отдаёт готовые {labels, datasets}. Здесь только отрисовка.
(function () {
  const canvas = document.getElementById("metric-chart");
  const picker = document.getElementById("metric-pick");
  const note = document.getElementById("chart-note");
  if (!canvas || !picker) return;

  let chart = null;

  async function load(metricKey) {
    const res = await fetch(canvas.dataset.src + encodeURIComponent(metricKey));
    if (!res.ok) { note.textContent = "Не удалось загрузить данные графика."; return; }
    const data = await res.json();
    note.textContent = data.note || "";

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: data.datasets.map(function (d) {
          return Object.assign({
            borderColor: "#2c5f8a",
            backgroundColor: "rgba(44,95,138,.12)",
            tension: 0.25,
            pointRadius: 4,
            fill: true,
            spanGaps: true,
          }, d);
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: data.yMin,
            max: data.yMax,
            ticks: data.normalized
              ? { callback: function (v) { return Math.round(v * 100) + "%"; } }
              : { stepSize: 1 },
          },
        },
        plugins: {
          legend: { display: data.datasets.length > 1 },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                const i = items[0].dataIndex;
                return data.tooltips && data.tooltips[i] ? data.tooltips[i] : "";
              },
            },
          },
        },
      },
    });
  }

  picker.addEventListener("change", function () { load(picker.value); });
  if (picker.value) load(picker.value);
})();
