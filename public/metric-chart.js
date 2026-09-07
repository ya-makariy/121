// The client does not compute: the route returns ready {labels, datasets}. This only draws.
//
// User-facing strings arrive in data- attributes rendered by the server, so no localized
// text is hardcoded here (CLAUDE.md rule 1 and rule 6). Colours arrive the same way, from
// the token layer in app.css: the stylesheet owns both surfaces, so a canvas that reads
// its colours from the tokens follows the theme without knowing that a theme exists.
(function () {
  var canvas = document.getElementById("metric-chart");
  var picker = document.getElementById("metric-pick");
  var note = document.getElementById("chart-note");
  if (!canvas || !picker) return;

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  // The area under the line is the line's own colour, thinned. Deriving it here rather
  // than naming a second token keeps the two surfaces at one value per slot.
  function thin(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  var chart = null;
  var lastKey = null;

  async function load(metricKey) {
    lastKey = metricKey;
    var series = token("--series-1");
    var ink = token("--muted");
    // A recessive grid is the text colour thinned, not a colour of its own: on either
    // surface it lands a few percent away from the surface it is drawn on.
    var grid = thin(token("--text"), ".08");

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
            borderColor: series,
            backgroundColor: thin(series, ".12"),
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
            grid: { color: grid },
            border: { display: false },
            ticks: data.normalized
              ? { color: ink, callback: function (v) { return Math.round(v * 100) + "%"; } }
              : { color: ink, stepSize: 1 },
          },
          x: { grid: { display: false }, ticks: { color: ink } },
        },
        plugins: {
          legend: { display: data.datasets.length > 1, labels: { color: ink } },
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

  // The surface can change under an open page (the system switches at sunset). The tokens
  // change with it; the canvas is a bitmap and does not, so redraw.
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (lastKey !== null) load(lastKey);
    });
  }
})();
