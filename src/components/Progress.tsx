// A signed-in parent's Progress page: how one kid is doing, card by card.
//
// Filters (kid, period, deck) sit in one row above everything and scope every
// tile, chart and table below them. The numbers come from src/progress.ts.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { KidProfile } from "../account-shared";
import { api } from "../api";
import { PROGRESS_PERIODS, PROGRESS_RETENTION_DAYS, type ProgressData } from "../attempts";
import { DIFFICULTIES, type Difficulty } from "../deck";
import { useI18n, type Messages } from "../i18n";
import {
  answersOf,
  byDifficulty,
  cardHistories,
  changeHeatmap,
  changeSummary,
  decksOf,
  learningProfile,
  medianSeconds,
  missedCards,
  mostChanged,
  pareto,
  PROFILE_AXES,
  QUICK_SECONDS,
  ratio,
  retrySummary,
  tally,
  timeSummary,
  TRIED_COLUMNS,
  type Answer,
} from "../progress";
import { ChartTable, Heatmap, Legend, Pareto, Radar, SegmentedBars, StackedColumns } from "./charts";
import { ProfileAvatar } from "./ParentHome";

interface Props {
  profiles: KidProfile[];
  onBack: () => void;
}

type Load = { status: "loading"; data?: ProgressData } | { status: "ready"; data: ProgressData } | { status: "error"; message: string; data?: ProgressData };

const RIGHT = "viz-right";
const WRONG = "viz-wrong";
const LEVEL_TONE: Record<Difficulty, string> = { easy: "viz-easy", medium: "viz-medium", hard: "viz-hard" };
const DEFAULT_DAYS = 30;

export function Progress({ profiles, onBack }: Props) {
  const { t } = useI18n();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [deckKey, setDeckKey] = useState("");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];

  useEffect(() => {
    if (!profile) return;
    let current = true;
    // Keep showing what's there (faded) while the new period or kid loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page follows the filters
    setLoad((l) => ({ status: "loading", data: l.data?.profileId === profile.id ? l.data : undefined }));
    api
      .getProgress(profile.id, days)
      .then((data) => current && setLoad({ status: "ready", data }))
      .catch((err: Error) => current && setLoad((l) => ({ status: "error", message: err.message, data: l.data })));
    return () => {
      current = false;
    };
  }, [profile, days, attempt]);

  const data = load.data;
  const decks = useMemo(() => (data ? decksOf(data) : []), [data]);
  // A deck picked for another kid or period may not be there now: show all decks then.
  const deck = decks.some((d) => d.deckKey === deckKey) ? deckKey : "";
  const answers = useMemo(() => (data ? answersOf(data, deck) : []), [data, deck]);

  return (
    <div className="manage progress-page">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          {t.common.back}
        </button>
        <h1>{t.progress.title}</h1>
      </header>
      <p className="manage__intro muted">{t.progress.intro(PROGRESS_RETENTION_DAYS)}</p>

      {profiles.length === 0 || !profile ? (
        <p className="empty">{t.progress.noProfiles}</p>
      ) : (
        <>
          <div className="progress-filters" role="group" aria-label={t.progress.filters}>
            <label className="field">
              <span>{t.progress.kid}</span>
              <span className="progress-filters__kid">
                <ProfileAvatar profile={profile} size={36} />
                <select value={profile.id} onChange={(e) => setProfileId(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji} {p.nickname}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="field">
              <span>{t.progress.period}</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {PROGRESS_PERIODS.map((n) => (
                  <option key={n} value={n}>
                    {t.progress.lastDays(n)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t.progress.deck}</span>
              <select value={deck} onChange={(e) => setDeckKey(e.target.value)} disabled={decks.length === 0}>
                <option value="">{t.progress.allDecks}</option>
                {decks.map((d) => (
                  <option key={d.deckKey} value={d.deckKey}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {load.status === "error" && (
            <div className="save-problem" role="alert">
              <p>{t.progress.loadFailed(load.message)}</p>
              <button type="button" className="btn btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
                {t.progress.tryAgain}
              </button>
            </div>
          )}

          {!data ? (
            load.status === "loading" && <p className="muted loading" role="status">{t.common.loading}</p>
          ) : (
            <div className={`progress-body${load.status === "loading" ? " is-refreshing" : ""}`} aria-busy={load.status === "loading"}>
              {data.truncated && <p className="muted">{t.progress.truncated(data.attempts.length)}</p>}
              {answers.length === 0 ? (
                <p className="empty">{t.progress.empty(profile.nickname)}</p>
              ) : (
                <Dashboard answers={answers} groupByDeck={!deck} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Everything below the filters, for one set of answers. */
function Dashboard({ answers, groupByDeck }: { answers: Answer[]; groupByDeck: boolean }) {
  const { t } = useI18n();
  const p = t.progress;
  const pct = (share: number | null) => (share === null ? p.none : p.percent(share));
  const secs = (s: number | null) => (s === null ? p.none : p.seconds(s));

  const all = tally(answers);
  const levels = byDifficulty(answers, tally);
  const histories = cardHistories(answers);
  const missed = missedCards(histories);
  const retries = retrySummary(missed);
  const time = timeSummary(answers);
  const timeByLevel = byDifficulty(answers, (group) => ({ ...medianSeconds(group), all: timeSummary(group).medianSeconds }));
  const changes = changeSummary(answers);
  const heat = changeHeatmap(answers);
  const changed = mostChanged(histories, 4);
  const habits = byDifficulty(answers, (group) => (group.length ? learningProfile(group) : null));

  return (
    <>
      <ul className="stat-tiles">
        <li className="stat-tile">
          <span className="stat-tile__label">{p.tiles.answered}</span>
          <span className="stat-tile__value">{p.count(all.answered)}</span>
          <span className="stat-tile__note">{p.tiles.rightShare(pct(ratio(all.right, all.answered)))}</span>
        </li>
        <li className="stat-tile">
          <span className="stat-tile__label">
            <span className={`stat-tile__key ${RIGHT}`} aria-hidden="true" />✓ {p.tiles.right}
          </span>
          <span className="stat-tile__value">{p.count(all.right)}</span>
        </li>
        <li className="stat-tile">
          <span className="stat-tile__label">
            <span className={`stat-tile__key ${WRONG}`} aria-hidden="true" />✗ {p.tiles.wrong}
          </span>
          <span className="stat-tile__value">{p.count(all.wrong)}</span>
        </li>
        <li className="stat-tile">
          <span className="stat-tile__label">{p.tiles.time}</span>
          <span className="stat-tile__value">{secs(time.averageSeconds)}</span>
          <span className="stat-tile__note">{p.tiles.timeNote(secs(time.medianSeconds))}</span>
        </li>
        <li className="stat-tile">
          <span className="stat-tile__label">{p.tiles.retries}</span>
          <span className="stat-tile__value">{p.count(retries.retries)}</span>
          <span className="stat-tile__note">{p.tiles.retriesNote(retries.fixed, retries.missed)}</span>
        </li>
        <li className="stat-tile">
          <span className="stat-tile__label">{p.tiles.changed}</span>
          <span className="stat-tile__value">{p.count(changes.changed)}</span>
          <span className="stat-tile__note">{p.tiles.changedNote(pct(ratio(changes.changed, all.answered)))}</span>
        </li>
      </ul>

      <div className="progress-grid">
        <RightWrong t={t} levels={levels} all={all} pct={pct} />
        <Retries t={t} retries={retries} missed={missed} />
        <TimePerCard t={t} time={time} byLevel={timeByLevel} secs={secs} />
        <Changes t={t} heat={heat} changes={changes} changed={changed} pct={pct} />
        <LearningProfile t={t} profiles={habits} pct={pct} />
        <Mistakes t={t} answers={answers} groupByDeck={groupByDeck} />
      </div>
    </>
  );
}

function Card({ title, subtitle, children, wide }: { title: string; subtitle: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`chart-card${wide ? " is-wide" : ""}`}>
      <h2 className="chart-card__title">{title}</h2>
      <p className="chart-card__subtitle muted">{subtitle}</p>
      {children}
    </section>
  );
}

type Pct = (share: number | null) => string;

function RightWrong({ t, levels, all, pct }: { t: Messages; levels: Record<Difficulty, ReturnType<typeof tally>>; all: ReturnType<typeof tally>; pct: Pct }) {
  const p = t.progress;
  const rows = [
    ...DIFFICULTIES.map((level) => ({ key: level, label: p.levels[level], ...levels[level] })),
    { key: "all", label: p.rightWrong.all, ...all },
  ];
  return (
    <Card title={p.rightWrong.title} subtitle={p.rightWrong.subtitle}>
      <Legend items={[{ tone: RIGHT, label: `✓ ${p.right}` }, { tone: WRONG, label: `✗ ${p.wrong}` }]} />
      <SegmentedBars
        label={p.rightWrong.title}
        rows={rows.map((r) => ({
          key: r.key,
          label: r.label,
          segments: [
            { tone: RIGHT, label: p.right, value: r.right },
            { tone: WRONG, label: p.wrong, value: r.wrong },
          ],
          summary: r.answered ? p.rightWrong.summary(r.right, r.wrong, pct(ratio(r.right, r.answered))) : p.answers(0),
        }))}
      />
      <ChartTable
        summary={p.asTable}
        caption={p.rightWrong.title}
        headers={[p.levelHeader, p.right, p.wrong, "%"]}
        rows={rows.map((r) => [r.label, r.right, r.wrong, pct(ratio(r.right, r.answered))])}
      />
    </Card>
  );
}

function Retries({ t, retries, missed }: { t: Messages; retries: ReturnType<typeof retrySummary>; missed: ReturnType<typeof missedCards> }) {
  const p = t.progress;
  const b = p.retries.buckets;
  const rows = [
    { key: "first", label: b.first, value: retries.buckets.first, tone: RIGHT },
    { key: "second", label: b.second, value: retries.buckets.second, tone: RIGHT },
    { key: "thirdPlus", label: b.thirdPlus, value: retries.buckets.thirdPlus, tone: RIGHT },
    { key: "notYet", label: b.notYet, value: retries.buckets.notYet, tone: WRONG },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const toMaster = missed
    .filter((m) => !m.fixed)
    .sort((x, y) => y.misses - x.misses || x.info.question.localeCompare(y.info.question))
    .slice(0, 4);
  return (
    <Card title={p.retries.title} subtitle={p.retries.subtitle}>
      {retries.missed === 0 ? (
        <p className="muted">{p.retries.noneMissed}</p>
      ) : (
        <>
          <ul className="count-bars" aria-label={p.retries.title}>
            {rows.map((r) => (
              <li key={r.key}>
                <span className="count-bars__label">{r.tone === RIGHT ? "✓ " : "✗ "}{r.label}</span>
                <span className="count-bars__track" aria-hidden="true">
                  {r.value > 0 && <span className={`count-bars__bar ${r.tone}`} style={{ width: `${(r.value / max) * 100}%` }} />}
                </span>
                <span className="count-bars__value">{p.retries.cards(r.value)}</span>
              </li>
            ))}
          </ul>
          {retries.averageToFix !== null && (
            <p className="chart-note">{p.retries.average(retries.averageToFix, retries.averageToFix.toLocaleString(t.locale, { maximumFractionDigits: 1 }))}</p>
          )}
          {toMaster.length > 0 && (
            <>
              <h3 className="chart-card__subhead">{p.retries.toMaster}</h3>
              <ul className="card-list">
                {toMaster.map((m) => (
                  <li key={`${m.info.deckKey}-${m.info.cardKey}`}>
                    <span className="card-list__question">{m.info.question}</span>
                    <span className="card-list__meta">
                      {p.levels[m.info.difficulty]} · {p.retries.misses(m.misses)} · {p.retries.retried(m.retries)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function TimePerCard({
  t,
  time,
  byLevel,
  secs,
}: {
  t: Messages;
  time: ReturnType<typeof timeSummary>;
  byLevel: Record<Difficulty, { right: number | null; wrong: number | null; all: number | null }>;
  secs: (s: number | null) => string;
}) {
  const p = t.progress;
  const bins = time.bins.map((b) => ({ key: String(b.from), label: p.time.bin(b.from, b.to), values: [b.right, b.wrong] }));
  return (
    <Card title={p.time.title} subtitle={p.time.subtitle}>
      <Legend items={[{ tone: RIGHT, label: `✓ ${p.right}` }, { tone: WRONG, label: `✗ ${p.wrong}` }]} />
      <StackedColumns
        bins={bins}
        series={[
          { tone: RIGHT, label: p.right },
          { tone: WRONG, label: p.wrong },
        ]}
        label={p.time.title}
        axisLabel={p.time.axis}
      />
      <table className="mini-table">
        <caption>{p.time.medianTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{p.levelHeader}</th>
            <th scope="col" className="is-number">{p.time.medianRight}</th>
            <th scope="col" className="is-number">{p.time.medianWrong}</th>
          </tr>
        </thead>
        <tbody>
          {DIFFICULTIES.map((level) => (
            <tr key={level}>
              <th scope="row">{p.levels[level]}</th>
              <td className="is-number">{secs(byLevel[level].right)}</td>
              <td className="is-number">{secs(byLevel[level].wrong)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ChartTable
        summary={p.asTable}
        caption={p.time.title}
        headers={[p.time.binHeader, p.right, p.wrong]}
        rows={bins.map((b) => [b.label, b.values[0], b.values[1]])}
      />
    </Card>
  );
}

function Changes({
  t,
  heat,
  changes,
  changed,
  pct,
}: {
  t: Messages;
  heat: ReturnType<typeof changeHeatmap>;
  changes: ReturnType<typeof changeSummary>;
  changed: ReturnType<typeof mostChanged>;
  pct: Pct;
}) {
  const p = t.progress;
  const columns = TRIED_COLUMNS.map((n, i) => p.changes.tried(n, i === TRIED_COLUMNS.length - 1));
  const rows = DIFFICULTIES.map((level) => ({ key: level, label: p.levels[level], ...heat[level] }));
  return (
    <Card title={p.changes.title} subtitle={p.changes.subtitle}>
      <Heatmap rows={rows} columns={columns} label={p.changes.title} scaleLabel={p.changes.scale} format={(s) => p.percent(s)} />
      {changes.changed === 0 ? (
        <p className="chart-note muted">{p.changes.none}</p>
      ) : (
        <ul className="chart-note chart-note--list">
          <li>✗ {p.changes.rightToWrong(changes.rightToWrong)}</li>
          <li>✓ {p.changes.wrongToRight(changes.wrongToRight)}</li>
        </ul>
      )}
      {changed.length > 0 && (
        <>
          <h3 className="chart-card__subhead">{p.changes.mostChanged}</h3>
          <ul className="card-list">
            {changed.map((c) => (
              <li key={`${c.info.deckKey}-${c.info.cardKey}`}>
                <span className="card-list__question">{c.info.question}</span>
                <span className="card-list__meta">
                  {p.levels[c.info.difficulty]} · {p.changes.changes(c.changes)} · {c.lastRight ? `✓ ${p.changes.lastRight}` : `✗ ${p.changes.lastWrong}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ChartTable
        summary={p.asTable}
        caption={p.changes.title}
        headers={[p.levelHeader, ...columns]}
        rows={rows.map((r) => [r.label, ...r.counts.map((n) => p.changes.cell(pct(ratio(n, r.total)), n))])}
      />
    </Card>
  );
}

function LearningProfile({ t, profiles, pct }: { t: Messages; profiles: Record<Difficulty, ReturnType<typeof learningProfile> | null>; pct: Pct }) {
  const p = t.progress;
  const axisLabel = (axis: (typeof PROFILE_AXES)[number]) => (axis === "quick" ? p.profile.axes.quick(QUICK_SECONDS) : p.profile.axes[axis]);
  const levels = DIFFICULTIES.filter((level) => profiles[level]);
  // Nothing missed means nothing to recover from: that spoke is drawn full, and the table says why.
  const value = (level: Difficulty, axis: (typeof PROFILE_AXES)[number]) => {
    const v = profiles[level]?.[axis] ?? null;
    return axis === "recovery" && v === null ? 1 : v;
  };
  const cell = (level: Difficulty, axis: (typeof PROFILE_AXES)[number]) => {
    const profile = profiles[level];
    if (!profile) return p.profile.noAnswers;
    if (axis === "recovery" && profile.recovery === null) return p.profile.noMisses;
    return pct(profile[axis]);
  };
  return (
    <Card title={p.profile.title} subtitle={p.profile.subtitle}>
      <Legend
        items={DIFFICULTIES.map((level) => ({
          tone: LEVEL_TONE[level],
          label: profiles[level] ? p.levels[level] : `${p.levels[level]} (${p.profile.noAnswers})`,
          line: true,
        }))}
      />
      <Radar
        axes={PROFILE_AXES.map(axisLabel)}
        series={levels.map((level) => ({ key: level, tone: LEVEL_TONE[level], label: p.levels[level], values: PROFILE_AXES.map((axis) => value(level, axis)) }))}
        label={p.profile.title}
        format={pct}
      />
      <ChartTable
        summary={p.asTable}
        caption={p.profile.title}
        headers={[p.profile.axisHeader, ...DIFFICULTIES.map((level) => p.levels[level])]}
        rows={PROFILE_AXES.map((axis) => [axisLabel(axis), ...DIFFICULTIES.map((level) => cell(level, axis))])}
      />
    </Card>
  );
}

function Mistakes({ t, answers, groupByDeck }: { t: Messages; answers: Answer[]; groupByDeck: boolean }) {
  const p = t.progress;
  const [group, setGroup] = useState<"difficulty" | "deck">("difficulty");
  const by = groupByDeck ? group : "difficulty";
  const wrong = answers.filter((a) => !a.correct);
  const groups =
    by === "difficulty"
      ? DIFFICULTIES.map((level) => ({ key: level, label: p.levels[level], wrong: wrong.filter((a) => a.info.difficulty === level).length }))
      : [...new Map(wrong.map((a) => [a.info.deckKey, a.info.deckTitle])).entries()].map(([key, label]) => ({
          key,
          label,
          wrong: wrong.filter((a) => a.info.deckKey === key).length,
        }));
  const bars = pareto(groups, 8, p.pareto.other, by === "difficulty");

  return (
    <Card title={p.pareto.title} subtitle={p.pareto.subtitle}>
      {groupByDeck && (
        <div className="segmented" role="group" aria-label={p.pareto.group}>
          <span className="segmented__label">{p.pareto.group}</span>
          {(["difficulty", "deck"] as const).map((g) => (
            <button key={g} type="button" aria-pressed={by === g} onClick={() => setGroup(g)}>
              {g === "difficulty" ? p.pareto.byDifficulty : p.pareto.byDeck}
            </button>
          ))}
        </div>
      )}
      {bars.length === 0 ? (
        <p className="muted">{p.pareto.none}</p>
      ) : (
        <>
          <Legend
            items={[
              { tone: "viz-series", label: p.pareto.share },
              { tone: "viz-ink-line", label: p.pareto.cumulative, line: true },
            ]}
          />
          <Pareto
            bars={bars}
            label={p.pareto.title}
            shareLabel={p.pareto.share}
            cumulativeLabel={p.pareto.cumulative}
            countLabel={p.pareto.wrongCount}
            guideLabel={p.pareto.guide}
            format={(s) => p.percent(s)}
          />
          <ChartTable
            summary={p.asTable}
            caption={p.pareto.title}
            headers={[p.pareto.groupHeader, p.pareto.wrongCount, p.pareto.share, p.pareto.cumulative]}
            rows={bars.map((b) => [b.label, b.wrong, p.percent(b.share), p.percent(b.cumulative)])}
          />
        </>
      )}
    </Card>
  );
}
