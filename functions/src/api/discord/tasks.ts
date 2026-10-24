import { getFunctions } from 'firebase-admin/functions';

// How long a command waits to queue its Cloud Task before replying and doing the work inline instead
const ENQUEUE_TIMEOUT_MS = 1500;

/**
 * Queues slow command work as a Cloud Task, which gets full CPU (3.7). Returns false if queueing
 * fails or is slow, in which case the caller replies and runs the work inline instead.
 */
export async function queueTask(functionName: 'roastTask' | 'importTask' | 'commandTask', data: Record<string, any>): Promise<boolean> {
  return Promise.race([
    getFunctions()
      .taskQueue(functionName)
      .enqueue(data)
      .then(() => true)
      .catch((err: any) => {
        console.warn(`[Tasks] Could not queue ${functionName} (${err.message}); running it inline`);
        return false;
      }),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), ENQUEUE_TIMEOUT_MS)),
  ]);
}
