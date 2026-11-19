import { afterEach, describe, expect, it, vi } from 'vitest';
import { startScheduleReconciler } from '../../src/modules/ingestion/index';
import { silentLog } from '../../src/shared/log';

describe('startScheduleReconciler', () => {
  afterEach(() => vi.useRealTimers());

  it('reconcilia al arrancar y periódicamente hasta que se detiene', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ['a']);
    const reconciler = startScheduleReconciler(run, 1000, silentLog);
    await reconciler.ready;
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(4);

    reconciler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('un fallo se registra y la siguiente vuelta lo reintenta', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const run = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('redis caído'))
      .mockResolvedValue(['a']);
    const reconciler = startScheduleReconciler(run, 1000, { ...silentLog, warn });
    await reconciler.ready;
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    reconciler.stop();
  });

  it('no solapa ejecuciones si una vuelta tarda más que el intervalo', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = vi.fn(() => new Promise<string[]>((resolve) => (release = () => resolve(['a']))));
    const reconciler = startScheduleReconciler(run, 1000, silentLog);
    await vi.advanceTimersByTimeAsync(3500);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await reconciler.ready;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    reconciler.stop();
  });
});
