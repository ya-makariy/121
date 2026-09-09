/*
 * The calendar behind the app's date field.
 *
 * The field itself (views/components/date-field.ts) is a plain text input in day-month-year
 * order and is fully usable on its own; this file adds the panel. Every word it renders
 * arrives in a data- attribute from the server, so there is no user-facing text here
 * (CLAUDE.md rule 6) and no locale branch either — month and weekday names come already
 * translated, "today" comes already computed in the manager's timezone (rule 4), and the
 * browser's own clock is never consulted.
 */
(function () {
  "use strict";

  var DAY_MS = 86400000;

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /** UTC noon, so a daylight-saving shift can never move a day. */
  function at(y, m, d) { return new Date(Date.UTC(y, m, d, 12)); }

  function toIso(date) {
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate());
  }

  function fromIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? at(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /** The same order the server parses: day, month, year. */
  function fromTyped(text) {
    var m = /^\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s*$/.exec(text || "");
    if (!m) return null;
    var date = at(+m[3], +m[2] - 1, +m[1]);
    return date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[1] ? date : null;
  }

  function toTyped(date) {
    return pad(date.getUTCDate()) + "." + pad(date.getUTCMonth() + 1) + "." + date.getUTCFullYear();
  }

  /** Monday = 0, matching the weekday row the server sends. */
  function weekdayIndex(date) { return (date.getUTCDay() + 6) % 7; }

  function setup(root) {
    if (root.dataset.ready === "1") return;
    root.dataset.ready = "1";

    var input = root.querySelector(".datepick-input");
    var opener = root.querySelector(".datepick-open");
    if (!input || !opener) return;

    var months = (root.dataset.months || "").split("|");
    var weekdays = (root.dataset.weekdays || "").split("|");
    var todayIso = root.dataset.todayOn || "";
    var panel = null;
    var cursor = null; // first of the month on show
    var focused = null; // the day the grid's tab stop sits on

    function selected() { return fromTyped(input.value); }

    function open() {
      if (panel) return;
      var base = selected() || fromIso(todayIso) || at(2000, 0, 1);
      cursor = at(base.getUTCFullYear(), base.getUTCMonth(), 1);
      focused = base;
      panel = document.createElement("div");
      panel.className = "datepick-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", root.dataset.dialog || "");
      root.appendChild(panel);
      opener.setAttribute("aria-expanded", "true");
      draw();
      document.addEventListener("mousedown", onOutside, true);
    }

    function close(refocus) {
      if (!panel) return;
      panel.remove();
      panel = null;
      opener.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", onOutside, true);
      if (refocus) input.focus();
    }

    function onOutside(e) {
      if (!root.contains(e.target)) close(false);
    }

    function commit(date) {
      input.value = toTyped(date);
      // Both events, and both bubbling: htmx listens for `change` on answer fields, and a
      // browser typing into the field would have fired `input` too.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close(true);
    }

    function move(days) {
      focused = new Date(focused.getTime() + days * DAY_MS);
      cursor = at(focused.getUTCFullYear(), focused.getUTCMonth(), 1);
      draw(true);
    }

    function shiftMonth(delta) {
      cursor = at(cursor.getUTCFullYear(), cursor.getUTCMonth() + delta, 1);
      // Keep the focused day inside the month on show, clamped to its last day.
      var last = at(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0).getUTCDate();
      focused = at(cursor.getUTCFullYear(), cursor.getUTCMonth(),
                   Math.min(focused.getUTCDate(), last));
      draw(true);
    }

    function button(cls, label, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    }

    function draw(focusGrid) {
      panel.textContent = "";

      var head = document.createElement("div");
      head.className = "datepick-head";
      var prev = button("datepick-nav", "‹", function () { shiftMonth(-1); });
      prev.setAttribute("aria-label", root.dataset.prev || "");
      var title = document.createElement("span");
      title.className = "datepick-title";
      title.textContent = (months[cursor.getUTCMonth()] || "") + " " + cursor.getUTCFullYear();
      var next = button("datepick-nav", "›", function () { shiftMonth(1); });
      next.setAttribute("aria-label", root.dataset.next || "");
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      panel.appendChild(head);

      var names = document.createElement("div");
      names.className = "datepick-weekdays";
      weekdays.forEach(function (w) {
        var cell = document.createElement("span");
        cell.textContent = w;
        names.appendChild(cell);
      });
      panel.appendChild(names);

      var grid = document.createElement("div");
      grid.className = "datepick-grid";
      grid.addEventListener("keydown", onGridKey);

      var start = new Date(cursor.getTime() - weekdayIndex(cursor) * DAY_MS);
      var pick = selected();
      var tabStop = null;
      for (var i = 0; i < 42; i++) {
        var day = new Date(start.getTime() + i * DAY_MS);
        var iso = toIso(day);
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "datepick-day";
        cell.textContent = String(day.getUTCDate());
        cell.dataset.on = iso;
        if (day.getUTCMonth() !== cursor.getUTCMonth()) cell.classList.add("other");
        if (iso === todayIso) cell.classList.add("today");
        if (pick && iso === toIso(pick)) {
          cell.classList.add("chosen");
          cell.setAttribute("aria-current", "date");
        }
        var isFocus = iso === toIso(focused);
        cell.tabIndex = isFocus ? 0 : -1;
        if (isFocus) tabStop = cell;
        cell.addEventListener("click", (function (d) {
          return function () { commit(d); };
        })(day));
        grid.appendChild(cell);
      }
      panel.appendChild(grid);

      var foot = document.createElement("div");
      foot.className = "datepick-foot";
      if (todayIso) {
        foot.appendChild(button("link", root.dataset.today || "", function () {
          commit(fromIso(todayIso));
        }));
      }
      foot.appendChild(button("link", root.dataset.clear || "", function () {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close(true);
      }));
      panel.appendChild(foot);

      if (focusGrid && tabStop) tabStop.focus();
    }

    function onGridKey(e) {
      var handled = true;
      switch (e.key) {
        case "ArrowLeft": move(-1); break;
        case "ArrowRight": move(1); break;
        case "ArrowUp": move(-7); break;
        case "ArrowDown": move(7); break;
        case "PageUp": shiftMonth(-1); break;
        case "PageDown": shiftMonth(1); break;
        case "Home": move(-weekdayIndex(focused)); break;
        case "End": move(6 - weekdayIndex(focused)); break;
        case "Enter":
        case " ": commit(focused); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }

    opener.addEventListener("click", function () {
      if (panel) close(true); else { open(); }
    });

    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel) { close(true); e.stopPropagation(); }
      // Down-arrow from the field is the usual way into a date picker.
      if (e.key === "ArrowDown" && e.target === input && !panel) { open(); draw(true); e.preventDefault(); }
    });
  }

  function scan(node) {
    var root = node || document;
    if (root.matches && root.matches(".datepick")) setup(root);
    root.querySelectorAll(".datepick").forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { scan(document); });
  } else {
    scan(document);
  }
  // Fields arriving in an htmx swap — the agreement list rerenders with its own field.
  document.addEventListener("htmx:load", function (e) { scan(e.target); });
})();
