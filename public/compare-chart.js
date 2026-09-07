// Клиент не считает данные: роут отдаёт готовые серии. Здесь только форма и цвет.
//
// Палитра — восемь слотов в фиксированном порядке из руководства по визуализации,
// проверенные валидатором на белом фоне (худшая соседняя пара: CVD ΔE 9.1,
// обычное зрение ΔE 19.6). Девятый слот не генерируется: линий максимум восемь.
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

  // Ширина, которую надо зарезервировать справа под подписи, считается по самому
  // длинному видимому имени: иначе подпись обрезается краем полотна.
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

  // Подпись у конца линии: при четырёх и меньше серий идентичность не должна
  // держаться на одном цвете даже при наличии легенды. Подписи разводятся по
  // вертикали, иначе совпавшие значения дают наложение вместо подписи.
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

      // Развести: сверху вниз, каждая следующая не ближе LABEL_GAP к предыдущей.
      candidates.sort(function (a, b) { return a.y - b.y; });
      var top = c.chartArea.top + 6;
      var bottom = c.chartArea.bottom - 6;
      candidates.forEach(function (item, i) {
        var min = i === 0 ? top : candidates[i - 1].y + LABEL_GAP;
        item.y = Math.min(Math.max(item.y, min), bottom);
      });
      // Если уехали за низ — поджать снизу вверх.
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

    // Полоса разброса — рецессивная серая, а не цвет серии: это контекст, не сущность.
    sets.push({
      label: payload.team.bandLabel, kind: "band", data: payload.team.lo,
      borderWidth: 0, pointRadius: 0, fill: "+1",
      backgroundColor: "rgba(35,32,28,.08)",
      // рамка нужна только легенде: на полотне линия не рисуется при borderWidth 0
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
                // Полоса разброса в легенде один раз, а не дважды.
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
      // По умолчанию линии выключены: сначала читается настроение команды,
      // индивидуальные линии добавляются осознанно.
      payload.people.forEach(function (p) { enabled[p.id] = false; });
      renderToggles();
      draw();
    })
    .catch(function () {
      if (note) note.textContent = "Не удалось загрузить данные графика.";
    });
})();
