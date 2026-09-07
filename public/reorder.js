// Dragging sections and questions in the template builder.
//
// The up/down arrows beside every item do the same thing with plain forms and always work,
// including on a phone and with JS off. Dragging is an accelerator, not the only way:
// losing the ability to reorder because a script failed to load is not acceptable.
(function () {
  var lists = document.querySelectorAll("[data-reorder]");
  if (lists.length === 0) return;

  var dragged = null;

  function itemsOf(list) {
    var selector = list.dataset.reorder === "sections" ? ":scope > .section-card" : ":scope > .field-row";
    return Array.prototype.slice.call(list.querySelectorAll(selector));
  }

  function send(list) {
    var keys = itemsOf(list).map(function (el) { return el.dataset.key; });
    var payload = list.dataset.reorder === "sections"
      ? { keys: keys }
      : { section: list.dataset.section, keys: keys };

    fetch(list.dataset.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        // The reorder may have landed in a new template version, so reload: the page must
        // show what is actually in the database, not what was dragged.
        if (r.ok) window.location.reload();
      })
      .catch(function () { window.location.reload(); });
  }

  lists.forEach(function (list) {
    itemsOf(list).forEach(function (item) {
      item.addEventListener("dragstart", function (e) {
        dragged = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        // Safari will not start a drag without this.
        e.dataTransfer.setData("text/plain", item.dataset.key || "");
      });

      item.addEventListener("dragend", function () {
        item.classList.remove("dragging");
        dragged = null;
      });

      item.addEventListener("dragover", function (e) {
        if (!dragged || dragged === item) return;
        if (dragged.parentElement !== list) return; // no dragging across sections
        e.preventDefault();
        var box = item.getBoundingClientRect();
        var below = e.clientY > box.top + box.height / 2;
        list.insertBefore(dragged, below ? item.nextSibling : item);
      });
    });

    list.addEventListener("drop", function (e) {
      if (!dragged) return;
      e.preventDefault();
      send(list);
    });
  });
})();
