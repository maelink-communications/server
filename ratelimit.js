import { TtlCache } from "@std/cache/ttl-cache";

// SECURITY: Ratelimits
// bucketId, requests, seconds
// ex. bucketId = "post:john", requests = 6, seconds = 5
// user john is only allowed to make 6 requests every 5 seconds

// we set a default fallback TTL of 60 seconds (60,000 ms)
export const rateLimitCache = new TtlCache(60_000);

// checks if a bucket has already run out of tokens
export const rateLimited = (bucketId) => {
  const record = rateLimitCache.get(bucketId);
  
  if (record !== undefined && record.remaining < 1) {
    return true; // no more tokens for you!
  }
  return false; // okay
}

// deducts a token
export const rateLimit = (bucketId, limit, seconds) => {
  const now = Date.now();
  const record = rateLimitCache.get(bucketId);

  // case 1: first request in this window (or old window expired)
  if (record === undefined) {
    rateLimitCache.set(
      bucketId, 
      { 
        remaining: limit - 1, 
        resetTime: now + (seconds * 1000)
      }, 
      { ttl: seconds * 1000 }
    );
    return;
  }

  // case 2: continuing the current fixed window
  record.remaining--;

  // calculate how much time is left in the current window
  const timeLeft = record.resetTime - now;

  // update the cache with the remaining time left
  // this prevents the window from extending or sliding forward!
  if (timeLeft > 0) {
    rateLimitCache.set(bucketId, record, { ttl: timeLeft });
  }
}

export const clearRateLimit = (bucketId) => {
  rateLimitCache.delete(bucketId);
};