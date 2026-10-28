// The app isn't zoomable on a phone: an accidental double tap or pinch while
// cooking shouldn't leave the page zoomed in. The viewport tag covers Android
// and the CSS covers double taps, but iOS Safari ignores user-scalable=no for
// pinching, so its gesture events are cancelled here. Loaded early, not deferred.
(() => {
  const cancel = (event) => event.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, cancel, { passive: false });
  }
  // Browsers without gesture events: a two-finger move is a pinch.
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );
})();
