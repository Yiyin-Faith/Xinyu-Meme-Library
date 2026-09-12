import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissTask, failTask, finishTask, getTasks, resetTasks, startTask, subscribe, updateTask } from '../src/lib/tasks';

afterEach(() => resetTasks());

describe('background task store', () => {
  it('starts a running task and exposes it to subscribers', () => {
    const seen = vi.fn();
    const stop = subscribe(seen);

    const id = startTask({ id: 'job-1', kind: 'backup', title: '完整备份导出', label: '准备导出…', detail: '', badge: '准备中', percentage: 0, indeterminate: true });

    expect(id).toBe('job-1');
    expect(seen).toHaveBeenCalled();
    const [task] = getTasks();
    expect(task).toMatchObject({ id: 'job-1', state: 'running', dismissable: false, percentage: 0 });
    stop();
  });

  it('keeps a task running and readable after its owner unmounts', () => {
    // The store lives outside React, so progress survives the modal that
    // started the work. Nothing here unmounts anything: that is the point.
    const id = startTask({ id: 'job-2', kind: 'import', title: '导入', label: '正在入库 0 / 2', detail: '', badge: '0%', percentage: 0, indeterminate: false });

    updateTask(id, { label: '正在入库 1 / 2', percentage: 50, badge: '50%' });
    expect(getTasks()[0]).toMatchObject({ state: 'running', percentage: 50, label: '正在入库 1 / 2' });

    updateTask(id, { label: '正在入库 2 / 2', percentage: 100, badge: '100%' });
    expect(getTasks()[0].percentage).toBe(100);
  });

  it('marks finished tasks as done and dismissable', () => {
    const id = startTask({ id: 'job-3', kind: 'backup', title: '备份导出', label: '准备导出…', detail: '', badge: '准备中', percentage: 0, indeterminate: true });

    finishTask(id, { label: '备份已导出', detail: 'xinyu-full.puff.zip' });

    expect(getTasks()[0]).toMatchObject({ state: 'done', dismissable: true, percentage: 100, indeterminate: false, badge: '已完成', label: '备份已导出' });
  });

  it('records errors without dropping the task', () => {
    const id = startTask({ id: 'job-4', kind: 'restore', title: '从备份恢复', label: '校验中…', detail: '', badge: '处理中', percentage: 0, indeterminate: true });

    failTask(id, 'manifest 校验失败', { label: '恢复失败，未修改本地库' });

    expect(getTasks()[0]).toMatchObject({ state: 'error', dismissable: true, badge: '失败', error: 'manifest 校验失败' });
  });

  it('dismisses a task and stops notifying subscribers once gone', () => {
    const id = startTask({ id: 'job-5', kind: 'import', title: '导入', label: '入库中…', detail: '', badge: '处理中', percentage: 0, indeterminate: true });
    finishTask(id);

    const seen = vi.fn();
    const stop = subscribe(seen);
    dismissTask(id);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(getTasks()).toHaveLength(0);
    stop();
  });

  it('caps finished tasks so the dock never piles up', () => {
    for (let index = 0; index < 5; index += 1) {
      const id = startTask({ id: `job-${index}`, kind: 'import', title: '导入', label: '', detail: '', badge: '', percentage: 0, indeterminate: false });
      finishTask(id);
    }
    const finished = getTasks().filter((task) => task.state !== 'running');
    expect(finished).toHaveLength(2);
    // The two survivors are the most recent ones.
    expect(finished.map((task) => task.id)).toEqual(['job-4', 'job-3']);
  });

  it('does not prune running tasks', () => {
    const running = startTask({ id: 'running', kind: 'backup', title: '导出', label: '', detail: '', badge: '', percentage: 0, indeterminate: true });
    for (let index = 0; index < 4; index += 1) {
      const id = startTask({ id: `done-${index}`, kind: 'import', title: '导入', label: '', detail: '', badge: '', percentage: 0, indeterminate: false });
      finishTask(id);
    }
    expect(getTasks().some((task) => task.id === running && task.state === 'running')).toBe(true);
  });
});
