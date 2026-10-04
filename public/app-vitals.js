(function () {
  'use strict';

  var endpoint = '/api/rum/vitals';
  var queue = [];
  var sentKeys = {};
  var maxQueueSize = 20;

  function nowPath() {
    return window.location && window.location.pathname ? window.location.pathname : '/';
  }

  function ratingFor(name, value) {
    if (name === 'CLS') {
      if (value <= 0.1) return 'good';
      if (value <= 0.25) return 'needs-improvement';
      return 'poor';
    }
    if (name === 'LCP') {
      if (value <= 2500) return 'good';
      if (value <= 4000) return 'needs-improvement';
      return 'poor';
    }
    if (name === 'INP') {
      if (value <= 200) return 'good';
      if (value <= 500) return 'needs-improvement';
      return 'poor';
    }
    if (name === 'FID') {
      if (value <= 100) return 'good';
      if (value <= 300) return 'needs-improvement';
      return 'poor';
    }
    if (name === 'FCP' || name === 'TTFB') {
      if (value <= 1800) return 'good';
      if (value <= 3000) return 'needs-improvement';
      return 'poor';
    }
    if (name === 'LOAD' || name === 'DCL') {
      if (value <= 2500) return 'good';
      if (value <= 5000) return 'needs-improvement';
      return 'poor';
    }
    return 'unknown';
  }

  function enqueue(name, value) {
    if (!Number.isFinite(value) || value < 0 || value > 120000) return;
    var roundedValue = Math.round(value * 1000) / 1000;
    var key = name + ':' + roundedValue;
    sentKeys[key] = true;
    queue.push({
      name: name,
      value: roundedValue,
      rating: ratingFor(name, roundedValue),
      path: nowPath()
    });
    if (queue.length >= maxQueueSize) flush();
  }

  function flush() {
    if (!queue.length) return;
    var payload = JSON.stringify({ vitals: queue.splice(0, maxQueueSize) });
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'same-origin'
    }).catch(function () {
      // RUM must never interrupt the ERP workflow.
    });
  }

  function observe(type, callback) {
    if (!('PerformanceObserver' in window)) return;
    try {
      var observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(callback);
      });
      observer.observe({ type: type, buffered: true });
    } catch {
      // Older browsers do not support every performance entry type.
    }
  }

  function collectNavigation() {
    var entries = performance.getEntriesByType ? performance.getEntriesByType('navigation') : [];
    var nav = entries && entries[0];
    if (!nav) return;
    enqueue('TTFB', nav.responseStart);
    enqueue('DCL', nav.domContentLoadedEventEnd);
    enqueue('LOAD', nav.loadEventEnd || nav.duration);
  }

  observe('paint', function (entry) {
    if (entry.name === 'first-contentful-paint') enqueue('FCP', entry.startTime);
  });

  var clsValue = 0;
  observe('layout-shift', function (entry) {
    if (!entry.hadRecentInput) {
      clsValue += entry.value;
      enqueue('CLS', clsValue);
    }
  });

  observe('largest-contentful-paint', function (entry) {
    enqueue('LCP', entry.startTime);
  });

  observe('first-input', function (entry) {
    enqueue('FID', entry.processingStart - entry.startTime);
  });

  observe('event', function (entry) {
    if (entry.interactionId && entry.duration) enqueue('INP', entry.duration);
  });

  if (document.readyState === 'complete') {
    collectNavigation();
  } else {
    window.addEventListener('load', collectNavigation, { once: true });
  }
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
})();
