// Shows or hides parts of the question form according to the selected type.
//
// The server already coerces input to what is allowed (irrelevant values are nulled), so
// this is not validation — it is about not showing "Scale from … to" on a select field.
(function () {
  var SCALE = ["scale"];
  var METRIC = ["scale", "single_select", "multi_select", "checkbox"];

  document.querySelectorAll(".field-form").forEach(function (form) {
    var typeSelect = form.querySelector('select[name="type"]');
    if (!typeSelect) return;

    function apply() {
      var type = typeSelect.value;
      form.querySelectorAll(".scale-only").forEach(function (el) {
        el.hidden = SCALE.indexOf(type) === -1;
      });
      form.querySelectorAll(".metric-only").forEach(function (el) {
        el.hidden = METRIC.indexOf(type) === -1;
      });
    }

    typeSelect.addEventListener("change", apply);
    apply();
  });
})();
