/**
 * Serializes async router mutations within one extension instance.
 *
 * Pi normally drives one session per process, but overlapping handlers
 * (session_start, before_agent_start, after_provider_response, commands)
 * can still interleave awaits and corrupt in-memory selection/ledger state.
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
