// Runs in <head>, before anything is drawn: if the page should be dark (your
// saved theme on this device, Sunset after dark, or nothing saved yet), paint
// it dark straight away instead of flashing white while the app loads. The app
// applies the real theme moment later and removes the "theme-dark-boot" class.
(function () {
  var dark = true;
  try {
    var keys = Object.keys(window.localStorage).filter(function (key) {
      return key.indexOf("storecipe_theme_") === 0;
    });
    // A signed-in user's choice beats the signed-out one.
    var key = keys.filter(function (k) { return !/anonymous$/.test(k); })[0] || keys[0];
    var theme = key ? window.localStorage.getItem(key) : null;
    var hour = new Date().getHours();
    if (theme === "light") dark = false;
    else if (theme === "sunset") dark = hour >= 19 || hour < 7;
  } catch (_error) {
    // No storage access: stay dark, the gentler choice in a dark room.
  }
  if (!dark) return;
  document.documentElement.classList.add("theme-dark-boot");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#0b1622");
})();
