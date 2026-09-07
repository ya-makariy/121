// The client does not compute: the route returns ready {labels, datasets}. This only draws.
//
// User-facing strings arrive in data- attributes rendered by the server, so no localized
// text is hardcoded here (CLAUDE.md rule 1 and rule 6).
(function () {
  var canvas = document.getElementById("metric-chart");
  var picker = document.getElementById("metric-pick");
  var note = document.getElementById("chart-note");
  if (!canvas || !picker) return;

  var chart = null;

  async function load(metricKey) {
    var res = await fetch(canvas.dataset.src + encodeURIComponent(metricKey));
    if (!res.ok) {
      if (note) note.textContent = canvas.dataset.loadFailed || "";
      return;
    }
    var data = await res.json();
    if (note) note.textContent = data.note || "";

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: data.datasets.map(function (d) {
          return Object.assign({
            borderColor: "#2a78d6",
            backgroundColor: "rgba(42,120,214,.12)",
            borderWidth: 2,
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
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            min: data.yMin,
            max: data.yMax,
            grid: { color: "rgba(35,32,28,.08)" },
            border: { display: false },
            ticks: data.normalized
              ? { callback: function (v) { return Math.round(v * 100) + "%"; } }
              : { stepSize: 1 },
          },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { display: data.datasets.length > 1 },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                var i = items[0].dataIndex;
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
