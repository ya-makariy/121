// Validation messages in the page's own style, instead of the browser's bubble.
//
// The constraints themselves stay native: `required`, `pattern`, `min`/`max` on the
// controls, checked by the browser before a form submits (and by htmx before it issues a
// request). Only the *reporting* changes. The bubble the browser draws follows the
// operating system, not the page — a different font, a different surface, and gone the
// moment the pointer moves — so a page that has a language switch and two themes was
// getting a message from neither. With this script the invalid field is marked and the
// message sits under it until the value is fixed.
//
// Every word comes from data- attributes on <body>, rendered by the server from the
// dictionary (rule 6): there is no user-facing text in this file. Without the script,
// or with it failing to load, the browser's own reporting still works.
(function () {
  "use strict";

  var words = document.body ? document.body.dataset : {};

  function messageFor(control) {
    var v = control.validity;
    if (v.valueMissing) return words.vRequired || "";
    if (control.closest(".datepick")) return words.vDate || "";
    if (v.rangeUnderflow || v.rangeOverflow || v.stepMismatch) return words.vRange || "";
    return words.vFormat || "";
  }

  /** The element the message goes after: the date picker as a whole, else the control. */
  function anchorOf(control) {
    return control.closest(".datepick") || control;
  }

  function noteOf(control, create) {
    var anchor = anchorOf(control);
    var next = anchor.nextElementSibling;
    if (next && next.classList.contains("field-error")) return next;
    if (!create) return null;
    var note = document.createElement("p");
    note.className = "field-error";
    note.id = (control.id || control.name || "field") + "-error";
    anchor.insertAdjacentElement("afterend", note);
    return note;
  }

  function show(control) {
    var note = noteOf(control, true);
    note.textContent = messageFor(control);
    anchorOf(control).classList.add("invalid");
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", note.id);
  }

  function clear(control) {
    var note = noteOf(control, false);
    if (note) note.remove();
    anchorOf(control).classList.remove("invalid");
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  }

  function isControl(el) {
    return el instanceof Element && el.matches("input, select, textarea");
  }

  // `invalid` does not bubble, so it is caught in the capture phase at the document.
  // Several fire in a row when a form is checked; the first one gets the focus, the way
  // the browser would have done it, and the rest are only marked.
  var focusedThisTick = false;
  document.addEventListener("invalid", function (e) {
    if (!isControl(e.target)) return;
    e.preventDefault(); // no bubble
    show(e.target);
    if (!focusedThisTick) {
      focusedThisTick = true;
      e.target.focus({ preventScroll: true });
      anchorOf(e.target).scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(function () { focusedThisTick = false; }, 0);
    }
  }, true);

  // A field that was marked clears itself as soon as it is fixed. It is not re-marked
  // while typing: nagging on every keystroke is the other way to be unpleasant.
  document.addEventListener("input", function (e) {
    if (!isControl(e.target)) return;
    if (e.target.getAttribute("aria-invalid") === "true" && e.target.validity.valid) clear(e.target);
  });

  // Leaving a field that holds something the field cannot accept — text in a date — shows
  // the message right away, without waiting for a submit. An empty required field is left
  // alone here: the person may simply be moving on to fill it later.
  document.addEventListener("focusout", function (e) {
    if (!isControl(e.target)) return;
    var control = e.target;
    if (control.value === "" || control.validity.valid) return;
    if (control.validity.valueMissing) return;
    show(control);
  });
})();
