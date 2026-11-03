// Changes invalidate the view; only authenticated, RLS-filtered reads supply data.
// Polling recovers missed events and rechecks membership. No notification delivery.
export function startMonitor({load, subscribe, onData, onState, onAccessRemoved,
  timers = globalThis, interval = 15000, now = Date.now,
  target = globalThis.window, visibility = globalThis.document}) {
  let stopped = false, running = false, pending = false, connected = false;
  let lastSuccess = null, failure = '', cancel = () => {};
  const publish = () => {
    if (!stopped) onState({connected, lastSuccess, failure});
  };
  async function refresh() {
    if (stopped) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      const data = await load();
      if (stopped) return;
      lastSuccess = now(); failure = ''; onData(data);
    } catch (error) {
      if (stopped) return;
      failure = error.message || 'Updates unavailable.';
      if (error.accessRemoved) { stop(); onAccessRemoved(); return; }
    } finally {
      running = false; publish();
      if (pending && !stopped) { pending = false; void refresh(); }
    }
  }
  function channelState(status) {
    if (stopped) return;
    connected = status === 'SUBSCRIBED'; publish();
    if (connected) void refresh();
  }
  const resume = () => {
    if (visibility?.visibilityState !== 'hidden') {
      // Do not show a fresh connection until returning from a sleeping tab checks data.
      failure = 'Checking latest updates…'; publish(); void refresh();
    }
  };
  const offline = () => { connected = false; failure = 'Offline. Showing the last update.'; publish(); };
  const timer = timers.setInterval(() => { publish(); void refresh(); }, interval);
  target?.addEventListener('online', resume);
  target?.addEventListener('offline', offline);
  target?.addEventListener('focus', resume);
  visibility?.addEventListener('visibilitychange', resume);
  function stop() {
    if (stopped) return;
    stopped = true; timers.clearInterval(timer); cancel();
    target?.removeEventListener('online', resume);
    target?.removeEventListener('offline', offline);
    target?.removeEventListener('focus', resume);
    visibility?.removeEventListener('visibilitychange', resume);
  }
  try { cancel = subscribe(() => void refresh(), channelState); }
  catch { connected = false; }
  void refresh();
  return {refresh, stop};
}

export function monitorLabel(state, now = Date.now()) {
  if (!state.lastSuccess) return state.failure ? 'Updates unavailable · waiting for the first update' : 'Connecting · waiting for the first update';
  const age = Math.max(0, Math.floor((now - state.lastSuccess) / 1000));
  const ageText = age < 60 ? age + 's ago' : Math.floor(age / 60) + 'm ago';
  const mode = state.failure ? 'Updates interrupted' : age > 45 ? 'Updates delayed' :
    state.connected ? 'Live updates connected' : 'Checking every 15 seconds';
  return mode + ' · last refreshed ' + ageText;
}
