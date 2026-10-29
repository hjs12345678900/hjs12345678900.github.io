(() => {
  const videos = [...document.querySelectorAll('video[data-event-video]')];
  if (!videos.length || !('IntersectionObserver' in window)) return;

  const states = videos.map((video) => {
    // Set the property as well as the HTML attribute for muted inline playback.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    return {
      video,
      visible: false,
      manuallyPaused: false,
      expectedPauseEvents: 0,
      request: 0,
      pendingPlay: null,
    };
  });
  const byVideo = new Map(states.map((state) => [state.video, state]));
  const shouldPlay = (state) => state.visible && !document.hidden && !state.manuallyPaused;

  const pauseAutomatically = (state) => {
    // Invalidate any play promise that is still waiting for media to load.
    state.request += 1;
    state.pendingPlay = null;
    if (!state.video.paused) {
      // The pause event is queued, so retain its origin until that event arrives.
      state.expectedPauseEvents += 1;
      state.video.pause();
    }
  };

  const updatePlayback = (state) => {
    if (!shouldPlay(state)) {
      pauseAutomatically(state);
      return;
    }
    if (!state.video.paused || state.pendingPlay !== null) return;

    const request = ++state.request;
    state.pendingPlay = request;
    let attempt;
    try {
      attempt = state.video.play();
    } catch {
      state.pendingPlay = null;
      return;
    }
    Promise.resolve(attempt)
      .then(() => {
        // Scrolling, hiding the tab or a manual pause can happen while loading.
        if (!shouldPlay(state)) pauseAutomatically(state);
      })
      .catch(() => {
        // Browser autoplay restrictions leave the native play button available.
      })
      .finally(() => {
        if (state.pendingPlay === request) state.pendingPlay = null;
      });
  };

  states.forEach((state) => {
    state.video.addEventListener('pause', () => {
      if (state.expectedPauseEvents > 0) {
        state.expectedPauseEvents -= 1;
        return;
      }
      if (state.video.paused && !state.video.ended && !document.hidden) {
        // Keep a deliberate pause across scrolling until the viewer presses play.
        state.manuallyPaused = true;
      }
    });
    state.video.addEventListener('play', () => {
      if (state.pendingPlay === null) state.manuallyPaused = false;
      if (!state.visible || document.hidden) pauseAutomatically(state);
    });
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const state = byVideo.get(entry.target);
      state.visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      updatePlayback(state);
    });
  }, { threshold: [0, 0.5] });
  videos.forEach((video) => observer.observe(video));

  document.addEventListener('visibilitychange', () => states.forEach(updatePlayback));
  window.addEventListener('pagehide', () => states.forEach(pauseAutomatically));
  window.addEventListener('pageshow', () => states.forEach(updatePlayback));
})();
