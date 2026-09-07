// Marks the section the meeting page is currently scrolled to in the rail.
//
// Everything the rail says — the titles and the filled/total counts — is rendered by the
// server. This script adds nothing to it and reads no answer: it only moves one class, so
// there is no user-facing string here and nothing to translate. Without it the rail is
// still a working set of anchor links.
(function () {
  var rail = document.querySelector(".rail");
  if (!rail) return;

  var links = {};
  Array.prototype.forEach.call(rail.querySelectorAll("a[href^='#']"), function (a) {
    links[a.getAttribute("href").slice(1)] = a;
  });

  var heads = Array.prototype.filter.call(
    document.querySelectorAll(".section-head[id]"),
    function (el) { return links[el.id]; },
  );
  if (heads.length === 0) return;

  var queued = false;

  function paint() {
    queued = false;
    // The last heading to have passed the reading line — a quarter down the window — is
    // the section being worked on. Before any heading reaches it the first section stands,
    // which is where the reader is heading anyway.
    var line = window.innerHeight / 4;
    var current = heads[0].id;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= line) current = heads[i].id;
    }
    Object.keys(links).forEach(function (id) {
      links[id].classList.toggle("current", id === current);
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(paint);
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  paint();
})();
