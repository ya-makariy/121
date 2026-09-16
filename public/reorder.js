// Dragging items in ordered lists: sections and questions in the template builder, and
// metrics on the metrics page.
//
// The up/down arrows beside every item do the same thing with plain forms and always work,
// including on a phone and with JS off. Dragging is an accelerator, not the only way:
// losing the ability to reorder because a script failed to load is not acceptable.
//
// A list is any element with `data-reorder` and `data-url`; its items are the direct
// children that carry `data-key`. Lists nest (questions live inside a section card), so
// every handler checks that the item being dragged belongs to *this* list and stops the
// event there: otherwise a question drag bubbles up and the section list claims it.
(function () {
  var lists = document.querySelectorAll("[data-reorder][data-url]");
  if (lists.length === 0) return;

  var dragged = null;      // the element being dragged
  var origin = null;       // its list
  var originalKeys = null; // the order before the drag, to detect a no-op and to revert

  function itemsOf(list) {
    return Array.prototype.slice.call(list.querySelectorAll(":scope > [data-key]"));
  }
  function keysOf(list) {
    return itemsOf(list).map(function (el) { return el.dataset.key; });
  }
  // The item of `list` under `target`, walking out of nested lists' items if needed.
  function itemFromTarget(list, target) {
    var el = target instanceof Element ? target.closest("[data-key]") : null;
    while (el && el.parentElement !== list) {
      el = el.parentElement ? el.parentElement.closest("[data-key]") : null;
    }
    return el;
  }

  function send(list) {
    var payload = { keys: keysOf(list) };
    if (list.dataset.section !== undefined) payload.section = list.dataset.section;

    fetch(list.dataset.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function () {
        // The reorder may have landed in a new template version, so reload: the page must
        // show what is actually in the database, not what was dragged.
        window.location.reload();
      })
      .catch(function () { window.location.reload(); });
  }

  function restore(list, keys) {
    var byKey = {};
    itemsOf(list).forEach(function (el) { byKey[el.dataset.key] = el; });
    keys.forEach(function (key) { if (byKey[key]) list.appendChild(byKey[key]); });
  }

  // ---- auto-scroll ----
  // The browser does not scroll the page while an HTML5 drag is on, so a list taller than
  // the window could not be reordered end to end. While a drag is active the pointer's Y
  // is sampled from dragover and the window scrolls itself when the pointer is near an
  // edge, faster the closer it gets.
  var EDGE = 72;       // px from the viewport edge where scrolling starts
  var MAX_STEP = 18;   // px per tick at the very edge
  var TICK_MS = 16;    // about one frame
  var pointerY = null;
  var scrollTimer = null;

  function autoScrollTick() {
    if (pointerY === null) return;
    var h = window.innerHeight;
    var step = 0;
    if (pointerY < EDGE) step = -Math.ceil(((EDGE - pointerY) / EDGE) * MAX_STEP);
    else if (pointerY > h - EDGE) step = Math.ceil(((pointerY - (h - EDGE)) / EDGE) * MAX_STEP);
    if (step !== 0) window.scrollBy(0, step);
  }
  function startAutoScroll() {
    if (scrollTimer === null) scrollTimer = window.setInterval(autoScrollTick, TICK_MS);
  }
  function stopAutoScroll() {
    if (scrollTimer !== null) { window.clearInterval(scrollTimer); scrollTimer = null; }
  }

  document.addEventListener("dragover", function (e) {
    if (dragged !== null) pointerY = e.clientY;
  });

  Array.prototype.forEach.call(lists, function (list) {
    list.addEventListener("dragstart", function (e) {
      var item = itemFromTarget(list, e.target);
      if (!item) return;
      e.stopPropagation(); // a question drag must not also start a section drag
      dragged = item;
      origin = list;
      originalKeys = keysOf(list);
      pointerY = e.clientY;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      // Safari will not start a drag without this.
      e.dataTransfer.setData("text/plain", item.dataset.key || "");
      startAutoScroll();
    });

    list.addEventListener("dragover", function (e) {
      if (dragged === null || origin !== list) return; // no dragging across lists
      // Allow the drop anywhere over the list: over the dragged item itself and over the
      // gaps between items too. Without this the browser refuses the drop at the exact
      // moment it usually happens, with the pointer over the item that was just moved.
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      var item = itemFromTarget(list, e.target);
      if (!item || item === dragged) return;
      var box = item.getBoundingClientRect();
      var below = e.clientY > box.top + box.height / 2;
      list.insertBefore(dragged, below ? item.nextSibling : item);
    });

    list.addEventListener("drop", function (e) {
      if (dragged === null || origin !== list) return;
      // Marks the drop as accepted; the order itself is committed from dragend, which
      // fires whether or not the pointer was over an element with a handler.
      e.preventDefault();
      e.stopPropagation();
    });

    list.addEventListener("dragend", function (e) {
      if (dragged === null || origin !== list) return;
      e.stopPropagation();
      var item = dragged;
      var before = originalKeys;
      item.classList.remove("dragging");
      dragged = null; origin = null; originalKeys = null; pointerY = null;
      stopAutoScroll();

      var after = keysOf(list);
      var changed = after.join("|") !== before.join("|");
      // Escape, or letting go outside the list, cancels the drag: the browser reports
      // dropEffect "none". The items were already moved for the preview, so put them back.
      if (e.dataTransfer && e.dataTransfer.dropEffect === "none") {
        if (changed) restore(list, before);
        return;
      }
      if (changed) send(list);
    });
  });
})();
