export interface QueuedPromptRef {
  id: string
}

export function applyQueuedPromptSubmission<T extends QueuedPromptRef>(
  queue: T[],
  submittedId: string,
  accepted: boolean,
) {
  if (!accepted) return queue
  if (queue[0]?.id === submittedId) return queue.slice(1)
  return queue.filter((item) => item.id !== submittedId)
}
