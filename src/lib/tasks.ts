import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store for long-running work (backup export, restore,
 * batch import).
 *
 * The store lives outside React on purpose: a task started from a modal keeps
 * running after that modal unmounts, so the user can keep browsing, switch
 * pages, and come back to find the same progress. `useTasks` subscribes a
 * component to the current snapshot.
 */

export type TaskKind = 'backup' | 'restore' | 'import';
export type TaskState = 'running' | 'done' | 'error';

export type TaskProgress = {
  /** Producer phase name, kept for labelling only. */
  phase: string;
  completed: number;
  total: number;
  bytesCompleted: number;
  totalBytes: number;
  /** Whether completed/total can be turned into a percentage and an ETA. */
  measurable: boolean;
};

export type BackgroundTask = {
  id: string;
  kind: TaskKind;
  title: string;
  state: TaskState;
  /** Primary status line, e.g. "正在读取图片 12 / 40". */
  label: string;
  /** Secondary line. The dock appends a live ETA to this while running. */
  detail: string;
  /** Right-hand badge, e.g. "42%" or "正在打包". */
  badge: string;
  percentage: number;
  indeterminate: boolean;
  progress?: TaskProgress;
  startedAt: number;
  updatedAt: number;
  error?: string;
  /** Toast text raised once the task settles. */
  message?: string;
  /** Body posted as an Android notification once the task settles. */
  notification?: string;
  /** Finished tasks can be dismissed; running ones cannot. */
  dismissable: boolean;
};

const MAX_FINISHED = 2;
const DONE_DISMISS_MS = 4000;
const ERROR_DISMISS_MS = 7000;

let tasks: BackgroundTask[] = [];
let cached: BackgroundTask[] = tasks;
const listeners = new Set<() => void>();
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dismissTokens = new Map<string, object>();

function emit() {
  cached = tasks.slice();
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return cached;
}

/** Drop the oldest finished tasks so the dock never piles up. */
function prune() {
  const finished = tasks.filter((task) => task.state !== 'running');
  if (finished.length <= MAX_FINISHED) return;
  const keep = new Set(
    finished
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FINISHED)
      .map((task) => task.id),
  );
  for (const task of finished) if (!keep.has(task.id)) clearDismissTimer(task.id);
  tasks = tasks.filter((task) => task.state === 'running' || keep.has(task.id));
}

function clearDismissTimer(id: string) {
  const timer = dismissTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  dismissTimers.delete(id);
  dismissTokens.delete(id);
}

function scheduleDismiss(id: string, state: Exclude<TaskState, 'running'>, delay: number) {
  clearDismissTimer(id);
  const token = {};
  dismissTokens.set(id, token);
  const timer = setTimeout(() => {
    if (dismissTokens.get(id) !== token) return;
    dismissTimers.delete(id);
    dismissTokens.delete(id);
    const current = tasks.find((task) => task.id === id);
    // An old completion must never remove a newly-started task with the same
    // id, nor a task that has since become running again.
    if (current?.state !== state) return;
    dismissTask(id);
  }, delay);
  dismissTimers.set(id, timer);
}

export function useTasks(): BackgroundTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Current snapshot for non-React callers (and tests). */
export function getTasks(): BackgroundTask[] {
  return cached;
}

export function startTask(task: Omit<BackgroundTask, 'startedAt' | 'updatedAt' | 'state' | 'dismissable'>): string {
  clearDismissTimer(task.id);
  const now = Date.now();
  const next: BackgroundTask = { ...task, state: 'running', startedAt: now, updatedAt: now, dismissable: false };
  tasks = [next, ...tasks.filter((item) => item.id !== next.id)];
  emit();
  return next.id;
}

export function updateTask(id: string, patch: Partial<BackgroundTask>) {
  let changed = false;
  const next = tasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;
    return { ...task, ...patch, updatedAt: Date.now() };
  });
  if (!changed) return;
  tasks = next;
  emit();
}

export function finishTask(id: string, patch: Partial<BackgroundTask> = {}) {
  updateTask(id, { state: 'done', dismissable: true, percentage: 100, indeterminate: false, badge: '已完成', ...patch });
  if (tasks.some((task) => task.id === id && task.state === 'done')) scheduleDismiss(id, 'done', DONE_DISMISS_MS);
  prune();
  emit();
}

export function failTask(id: string, error: string, patch: Partial<BackgroundTask> = {}) {
  updateTask(id, { state: 'error', dismissable: true, indeterminate: false, badge: '失败', error, ...patch });
  if (tasks.some((task) => task.id === id && task.state === 'error')) scheduleDismiss(id, 'error', ERROR_DISMISS_MS);
  prune();
  emit();
}

export function dismissTask(id: string) {
  clearDismissTimer(id);
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return;
  tasks = next;
  emit();
}

/** Test-only helper so suites start from a clean slate. */
export function resetTasks() {
  for (const timer of dismissTimers.values()) clearTimeout(timer);
  dismissTimers.clear();
  dismissTokens.clear();
  tasks = [];
  emit();
}
