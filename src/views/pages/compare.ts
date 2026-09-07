import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict, plural } from "../../i18n/index.ts";
import type { Locale, MetricRow } from "../../db/types.ts";
import type { PersonStanding, TeamOption } from "../../db/queries/metrics.ts";
import { formatDate } from "../../i18n/dates.ts";

/**
 * Two forms side by side, because there are two questions.
 *
 * The "team mood" chart: the average plus a spread band. Readable at any team size, with
 * individual lines as an opt-in above it.
 *
 * The "who needs attention" list: it doubles as the table view of the chart's data, which
 * is why identity never rests on colour alone anywhere here.
 */
export function comparePage(o: {
  locale: Locale;
  metrics: MetricRow[];
  teams: TeamOption[];
  selectedMetric: MetricRow | null;
  selectedTeam: number | null;
  standings: PersonStanding[];
  normalized: boolean;
}): string {
  const t = dict(o.locale);

  if (o.metrics.length === 0 || o.selectedMetric === null) {
    return layout({
      locale: o.locale, title: t.compare.title, nav: "compare", path: "/compare",
      body: html`
        <h1>${t.compare.title}</h1>
        <p class="sub">${t.compare.subtitle}</p>
        <div class="empty">${t.compare.empty}</div>
      `,
    });
  }

  const metric = o.selectedMetric;
  const teamQuery = o.selectedTeam === null ? "" : `&team=${o.selectedTeam}`;

  // The metric direction decides what counts as worse: for workload and attrition risk
  // the bad end is the top of the scale, for the rest it is the bottom.
  const delta = (s: PersonStanding): { text: string; tone: string } | null => {
    if (s.prev_norm === null || s.norm_value === null) return null;
    const diff = s.norm_value - s.prev_norm;
    if (Math.abs(diff) < 0.001) return { text: t.compare.noChange, tone: "neutral" };
    const better = metric.direction === 1 ? diff > 0 : diff < 0;
    const pp = Math.round(Math.abs(diff) * 100);
    return {
      text: `${diff > 0 ? "↑" : "↓"} ${pp} ${t.compare.percentagePoints}`,
      tone: better ? "ok" : "overdue",
    };
  };

  const body = html`
    <h1>${t.compare.title}</h1>
    <p class="sub">${t.compare.subtitle}</p>

    <form method="get" action="/compare" class="card" id="compare-filters">
      <div class="grid2">
        <div class="field">
          <label for="metric">${t.compare.metric}</label>
          <select id="metric" name="metric" onchange="this.form.submit()">
            ${o.metrics.map(
              (m) => html`
                <option value="${m.key}" ${m.key === metric.key ? "selected" : ""}>
                  ${m.label}${m.direction === -1 ? " ↓" : ""}
                </option>
              `,
            )}
          </select>
        </div>
        <div class="field">
          <label for="team">${t.compare.team}</label>
          <select id="team" name="team" onchange="this.form.submit()">
            <option value="">${t.compare.allPeople}</option>
            ${o.teams.map(
              (team) => html`
                <option value="${team.id}" ${team.id === o.selectedTeam ? "selected" : ""}>
                  ${team.name} (${team.people})
                </option>
              `,
            )}
          </select>
        </div>
      </div>
    </form>

    ${o.standings.length < 2 ? html`<div class="notice">${t.compare.needTwo}</div>` : ""}

    <div class="card">
      <div class="chart-wrap"><canvas id="compare-chart"
        data-load-failed="${t.charts.loadFailed}"
        data-src="/api/charts/compare/metric/${metric.key}?x=1${teamQuery}"></canvas></div>
      <p class="chart-note" id="compare-note"></p>
      <fieldset class="people-toggles" id="people-toggles">
        <legend class="small muted">${t.compare.showPeople}</legend>
      </fieldset>
    </div>

    <h2>${t.compare.attention}</h2>
    <p class="sub small">${t.compare.attentionHint}</p>
    ${o.standings.length === 0
      ? html`<div class="empty">${t.compare.empty}</div>`
      : html`
          <div class="rows">
            ${o.standings.map((s) => {
              const d = delta(s);
              const shown = o.normalized
                ? `${Math.round((s.norm_value ?? 0) * 100)}%`
                : String(s.raw_value ?? "—");
              return html`
                <div class="row">
                  <span class="standing-value">${shown}</span>
                  <span class="grow">
                    <a class="name" href="/people/${s.person_id}">${s.full_name}</a>
                    <span class="small muted">
                      · ${t.compare.lastMeasured} ${formatDate(s.on_date, o.locale)}
                      · ${plural(o.locale, s.n, t.compare.pointForms)}
                    </span>
                  </span>
                  ${d
                    ? html`<span class="badge ${d.tone}">${d.text}</span>`
                    : html`<span class="badge neutral">${t.compare.onePoint}</span>`}
                </div>
              `;
            })}
          </div>
        `}

    <script src="/vendor/chart.umd.min.js"></script>
    <script src="/compare-chart.js"></script>
  `;

  return layout({
    locale: o.locale, title: t.compare.title, nav: "compare", path: "/compare", body,
  });
}
