(function attachPublishQueueLogic(root) {
  const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4']);
  const DEFAULT_PRIORITY = 'P4';
  const RANK = Object.freeze(Object.fromEntries(PRIORITIES.map((value, index) => [value, index])));

  function normalizePriority(value) {
    return PRIORITIES.includes(value) ? value : DEFAULT_PRIORITY;
  }

  function isPublishableQueueItem(item) {
    return Boolean(
      item &&
        typeof item.sku === 'string' &&
        item.lifecycleStatus === 'LISTING_READY' &&
        item.status === 'LISTING_READY' &&
        item.publishable === true &&
        Number.isInteger(item.imageCount) &&
        item.imageCount >= 3 &&
        item.imageCount <= 6,
    );
  }

  function sortPublishQueue(items, priorities = {}) {
    const seenSkus = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item }) => isPublishableQueueItem(item))
      .filter(({ item }) => {
        if (seenSkus.has(item.sku)) return false;
        seenSkus.add(item.sku);
        return true;
      })
      .map(({ item, originalIndex }) => ({
        ...item,
        priority: normalizePriority(priorities[item.sku]),
        originalIndex,
      }))
      .sort((left, right) => RANK[left.priority] - RANK[right.priority] || left.originalIndex - right.originalIndex)
      .map(({ originalIndex, ...item }) => item);
  }

  const api = Object.freeze({
    PRIORITIES,
    DEFAULT_PRIORITY,
    normalizePriority,
    isPublishableQueueItem,
    sortPublishQueue,
  });

  root.PublishQueueLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
