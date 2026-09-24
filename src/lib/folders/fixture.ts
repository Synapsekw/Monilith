import { resolveLayout } from "./layout";
import { PRESETS, type PresetKey } from "./presets";
import type { FolderPayload, RollupRow } from "./types";

export const FIXTURE_TODAY = "2026-09-15";

const base = (
  o: Partial<RollupRow> &
    Pick<
      RollupRow,
      | "boardId"
      | "boardName"
      | "boardPosition"
      | "groupId"
      | "groupName"
      | "groupPosition"
    >,
): RollupRow => ({
  groupColor: "#0073ea",
  total: 0,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  incomplete: 0,
  plannedByToday: 0,
  dueThisWeek: 0,
  dueThisWeekNotStarted: 0,
  oldestOverdue: null,
  minDue: null,
  maxDue: null,
  ...o,
});

/** 3 boards × stages Discovery / Build / QA (+ "Launch" only on Website). */
export function folderFixture(): FolderPayload {
  const rollup: RollupRow[] = [
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:discovery",
      groupName: "Discovery",
      groupPosition: 0,
      total: 4,
      done: 4,
      plannedByToday: 4,
      minDue: "2026-08-03",
      maxDue: "2026-08-21",
    }),
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:build",
      groupName: "Build",
      groupPosition: 1,
      total: 6,
      done: 3,
      inProgress: 2,
      overdue: 1,
      blocked: 1,
      plannedByToday: 4,
      dueThisWeek: 2,
      dueThisWeekNotStarted: 1,
      oldestOverdue: "2026-09-01",
      minDue: "2026-08-24",
      maxDue: "2026-09-25",
    }),
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:qa",
      groupName: "QA",
      groupPosition: 2,
      total: 2,
      done: 2,
      plannedByToday: 2,
      minDue: "2026-09-01",
      maxDue: "2026-09-10",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:discovery",
      groupName: "discovery",
      groupPosition: 0,
      total: 3,
      done: 3,
      plannedByToday: 3,
      minDue: "2026-08-03",
      maxDue: "2026-08-14",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:build",
      groupName: "Build",
      groupPosition: 1,
      total: 5,
      done: 1,
      inProgress: 2,
      notStarted: 2,
      stale: 1,
      unassigned: 1,
      incomplete: 2,
      plannedByToday: 2,
      dueThisWeek: 1,
      minDue: "2026-09-07",
      maxDue: "2026-10-02",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:qa",
      groupName: "QA",
      groupPosition: 2,
      total: 1,
      notStarted: 1,
      minDue: "2026-10-05",
      maxDue: "2026-10-09",
    }),
    base({
      boardId: "b3",
      boardName: "Website",
      boardPosition: 2,
      groupId: "b3:build",
      groupName: "Build",
      groupPosition: 0,
      total: 3,
      done: 0,
      notStarted: 3,
      unassigned: 2,
      incomplete: 3,
      minDue: "2026-10-12",
      maxDue: "2026-10-30",
    }),
    base({
      boardId: "b3",
      boardName: "Website",
      boardPosition: 2,
      groupId: "b3:launch",
      groupName: "Launch",
      groupPosition: 1,
      total: 2,
      notStarted: 2,
      minDue: "2026-11-02",
      maxDue: "2026-11-06",
    }),
  ];
  return {
    folder: {
      id: "f1",
      name: "Q4 Launch",
      workspaceId: "w1",
      orgId: "o1",
      position: 0,
    },
    boards: [
      { id: "b1", name: "Backend", position: 0 },
      { id: "b2", name: "Mobile", position: 1 },
      { id: "b3", name: "Website", position: 2 },
    ],
    rollup,
    burn: [
      { stageKey: "build", weekStart: "2026-08-24", planned: 2, completed: 1 },
      { stageKey: "build", weekStart: "2026-08-31", planned: 3, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-07", planned: 2, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-14", planned: 3, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-21", planned: 2, completed: 0 },
      { stageKey: "build", weekStart: "2026-09-28", planned: 2, completed: 0 },
      { stageKey: "qa", weekStart: "2026-08-24", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-08-31", planned: 1, completed: 1 },
      { stageKey: "qa", weekStart: "2026-09-07", planned: 1, completed: 1 },
      { stageKey: "qa", weekStart: "2026-09-14", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-09-21", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-09-28", planned: 0, completed: 0 },
    ],
    attention: [
      {
        itemId: "i1",
        itemName: "Auth refactor",
        boardId: "b1",
        boardName: "Backend",
        groupId: "b1:build",
        groupName: "Build",
        reason: "overdue",
        ageDays: 14,
        severity: 4,
      },
      {
        itemId: "i2",
        itemName: "Push notifications",
        boardId: "b1",
        boardName: "Backend",
        groupId: "b1:build",
        groupName: "Build",
        reason: "blocked",
        ageDays: 3,
        severity: 3,
      },
      {
        itemId: "i3",
        itemName: "Onboarding flow",
        boardId: "b2",
        boardName: "Mobile",
        groupId: "b2:build",
        groupName: "Build",
        reason: "unassigned",
        ageDays: 6,
        severity: 2,
      },
      {
        itemId: "i4",
        itemName: "Crash reporting",
        boardId: "b2",
        boardName: "Mobile",
        groupId: "b2:build",
        groupName: "Build",
        reason: "stale",
        ageDays: 21,
        severity: 1,
      },
    ],
    briefs: [
      {
        boardId: "b1",
        boardName: "Backend",
        brief: "Build is on pace; one auth item slipped two weeks.",
        generatedAt: "2026-09-15T08:00:00.000Z",
      },
    ],
    members: [
      { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
      { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
    ],
    layout: resolveLayout(null),
    generatedAt: "2026-09-15T09:00:00.000Z",
    todayISO: FIXTURE_TODAY,
  };
}

/** A fixture payload whose layout is a named preset — for tests that assert a
 *  CRM folder hides burn and milestones. */
export function folderFixtureWithPreset(preset: PresetKey): FolderPayload {
  return {
    ...folderFixture(),
    layout: { config: PRESETS[preset], preset, version: 1 },
  };
}
