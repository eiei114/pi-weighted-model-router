/**
 * Serializes async router mutations for the extension module.
 *
 * Pi normally drives one session per process, but overlapping handlers
 * (session_start, before_agent_start, after_provider_response, commands)
 * can still interleave awaits and corrupt in-memory selection/ledger state.
 *
 * The promise-chain tail is module-scoped, so serialization applies process-wide
 * (one queue per loaded extension module, not per extension instance).
 *
 * NOTE: non-reentrant. Do NOT call runSerialized() from within a task that is
 * already running under runSerialized() - it will deadlock. Call the unwrapped
 * *Body() variants from inside serialized contexts.
 */
let tail: Promise<unknown> = Promise.resolve();

export function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = tail.then(task, task);
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
