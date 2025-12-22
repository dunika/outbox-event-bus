export const pollEventsScript = `
  local pendingKey = KEYS[1]
  local processingKey = KEYS[2]
  local now = tonumber(ARGV[1])
  local batchSize = tonumber(ARGV[2])

  -- Get events due for processing (score <= now)
  local eventIds = redis.call('ZRANGEBYSCORE', pendingKey, '-inf', now, 'LIMIT', 0, batchSize)

  if #eventIds > 0 then
    for _, id in ipairs(eventIds) do
      -- Move from pending to processing with score = now
      redis.call('ZREM', pendingKey, id)
      redis.call('ZADD', processingKey, now, id)
    end
  end

  return eventIds
`

export const recoverEventsScript = `
  local processingKey = KEYS[1]
  local pendingKey = KEYS[2]
  local maxProcessingTime = tonumber(ARGV[1])
  local now = tonumber(ARGV[2])

  -- Calculate cutoff time
  local cutoff = now - maxProcessingTime

  -- Get any events in processing that have timed out
  local eventIds = redis.call('ZRANGEBYSCORE', processingKey, '-inf', cutoff)

  if #eventIds > 0 then
    for _, id in ipairs(eventIds) do
      -- Move back to pending to be picked up immediately
      redis.call('ZREM', processingKey, id)
      redis.call('ZADD', pendingKey, now, id)
    end
  end

  return #eventIds
`
