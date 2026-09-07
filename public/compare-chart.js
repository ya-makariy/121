// The client does not compute the data: the route returns ready series. This handles
// shape and colour only.
//
// The palette is eight slots in a fixed order from the data-visualization guidance,
// validated against a white surface (worst adjacent pair: CVD dE 9.1, normal vision
// dE 19.6). A ninth slot is never generated: at most eight lines.
//
// User-facing strings arrive in data- attributes from the server (CLAUDE.md rule 1).
(function () {
  var PALETTE = [
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
    "#e87ba4", "#008300", "#4a3aa7", "#e34948",
  ];
  var INK_MUTED = "#6f675d";
  var GRID = "rgba(35,32,28,.08)";

  var canvas = document.getElementById("compare-chart");
  var note = document.getElementById("compare-note");
  var toggles = document.getElementById("people-toggles");
  if (!canvas) return;

  var chart = null;
  var payload = null;
  var enabled = {};

  var LABEL_FONT = "600 11px -apple-system, system-ui, sans-serif";
  var LABEL_GAP = 14;
  var LABEL_MAX = 16;

  function shortName(name) {
    return name.length > LABEL_MAX ? name.slice(0, LABEL_MAX - 1) + "…" : name;
  }

  // The right-hand reserve is measured from the longest visible name; otherwise the
  // label gets clipped by the edge of the canvas.
  function labelPadding(names) {
    if (names.length === 0 || names.length > 4) return 8;
    var ctx = document.createElement("canvas").getContext("2d");
    ctx.font = LABEL_FONT;
    var widest = 0;
    names.forEach(function (n) {
      widest = Math.max(widest, ctx.measureText(shortName(n)).width);
    });
    return Math.ceil(widest) + 16;
  }

  // End-of-line labels: at four or fewer series, identity must not rest on colour alone
  // even with a legend present. Labels are spread vertically, otherwise equal values
  // overlap into an unreadable smudge.
  var endLabels = {
    id: "endLabels",
    afterDatasetsDraw: function (c) {
      var candidates = [];
      c.data.datasets.forEach(function (d, i) {
        if (d.kind !== "person") return;
        var meta = c.getDatasetMeta(i);
        if (meta.hidden) return;
        for (var k = d.data.length - 1; k >= 0; k--) {
          if (d.data[k] === null || d.data[k] === undefined) continue;
          candidates.push({ text: shortName(d.label), color: d.borderColor, y: meta.data[k].y });
          break;
        }
      });
      if (candidates.length === 0 || candidates.length > 4) return;

      // Spread top to bottom, each label at least LABEL_GAP from the previous one.
      candidates.sort(function (a, b) { return a.y - b.y; });
      var top = c.chartArea.top + 6;
      var bottom = c.chartArea.bottom - 6;
      candidates.forEach(function (item, i) {
        var min = i === 0 ? top : candidates[i - 1].y + LABEL_GAP;
        item.y = Math.min(Math.max(item.y, min), bottom);
      });
      // If they ran past the bottom, push them back up.
      for (var i = candidates.length - 1; i > 0; i--) {
        if (candidates[i].y - candidates[i - 1].y < LABEL_GAP) {
          candidates[i - 1].y = candidates[i].y - LABEL_GAP;
        }
      }

      var ctx = c.ctx;
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      candidates.forEach(function (item) {
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, c.chartArea.right + 8, item.y);
      });
      ctx.restore();
    },
  };

  function buildDatasets() {
    var sets = [];

    // The spread band is recessive grey rather than a series colour: it is context,
    // not an entity.
    sets.push({
      label: payload.team.bandLabel, kind: "band", data: payload.team.lo,
      borderWidth: 0, pointRadius: 0, fill: "+1",
      backgroundColor: "rgba(35,32,28,.08)",
      // the border is only for the legend: with borderWidth 0 no line is drawn
      borderColor: "rgba(35,32,28,.35)",
      tension: 0.25, spanGaps: true, order: 3,
    });
    sets.push({
      label: payload.team.bandLabel, kind: "band", data: payload.team.hi,
      borderWidth: 0, pointRadius: 0, fill: false, tension: 0.25, spanGaps: true, order: 3,
    });

    sets.push({
      label: payload.team.label, kind: "avg", data: payload.team.avg,
      borderColor: "#23201c", backgroundColor: "#23201c",
      borderWidth: 2, borderDash: [6, 4], pointRadius: 4, pointHoverRadius: 6,
      fill: false, tension: 0.25, spanGaps: true, order: 1,
    });

    payload.people.forEach(function (p) {
      if (!enabled[p.id]) return;
      var color = PALETTE[p.slot % PALETTE.length];
      sets.push({
        label: p.name, kind: "person", data: p.data,
        borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
        pointBorderColor: "#fff", pointBorderWidth: 1,
        fill: false, tension: 0.25, spanGaps: true, order: 2,
      });
    });

    return sets;
  }

  function shownNames() {
    return payload.people.filter(function (p) { return enabled[p.id]; })
      .map(function (p) { return p.name; });
  }

  function draw() {
    if (chart) chart.destroy();
    var pct = payload.normalized;
    chart = new Chart(canvas, {
      type: "line",
      data: { labels: payload.labels, datasets: buildDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: labelPadding(shownNames()) } },
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            min: payload.yMin,
            max: payload.yMax,
            grid: { color: GRID },
            border: { display: false },
            ticks: {
              color: INK_MUTED,
              callback: function (v) { return pct ? Math.round(v * 100) + "%" : v; },
            },
          },
          x: { grid: { display: false }, ticks: { color: INK_MUTED } },
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: INK_MUTED, boxWidth: 10, boxHeight: 10, usePointStyle: false,
              filter: function (item, data) {
                // The spread band appears in the legend once, not twice.
                return !(data.datasets[item.datasetIndex].kind === "band"
                         && item.datasetIndex === 1);
              },
            },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                if (ctx.raw === null || ctx.raw === undefined) return null;
                var v = pct ? Math.round(ctx.raw * 100) + "%" : Math.round(ctx.raw * 100) / 100;
                return ctx.dataset.label + ": " + v;
              },
            },
          },
        },
      },
      plugins: [endLabels],
    });
  }

  function renderToggles() {
    if (!toggles) return;
    var legend = toggles.querySelector("legend");
    toggles.innerHTML = "";
    if (legend) toggles.appendChild(legend);

    payload.people.forEach(function (p) {
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!enabled[p.id];
      box.addEventListener("change", function () {
        enabled[p.id] = box.checked;
        draw();
      });
      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = PALETTE[p.slot % PALETTE.length];
      label.appendChild(box);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(p.name));
      toggles.appendChild(label);
    });
  }

  fetch(canvas.dataset.src)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      payload = data;
      if (note) note.textContent = data.note || "";
      // Lines are off by default: the team mood reads first, and individual lines are
      // added deliberately.
      payload.people.forEach(function (p) { enabled[p.id] = false; });
      renderToggles();
      draw();
    })
    .catch(function () {
      if (note) note.textContent = canvas.dataset.loadFailed || "";
    });
})();
