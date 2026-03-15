// ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────
// Shows loading screen, imports all modules, then starts the app.

const loadingBar = document.getElementById('loading-bar-fill');
const loadingScreen = document.getElementById('loading-screen');

function setProgress(pct) {
  if (loadingBar) loadingBar.style.width = pct + '%';
}

async function boot() {
  setProgress(10);

  // Import modules in dependency order
  const data = await import('./data.js');
  setProgress(20);

  const planets = await import('./planets.js');
  setProgress(30);

  const scene = await import('./scene.js');
  setProgress(50);

  const graph = await import('./graph.js');
  setProgress(70);

  const focus = await import('./focus.js');
  setProgress(85);

  // ui.js wires everything together and starts the animate loop
  const ui = await import('./ui.js');
  setProgress(100);

  // Fade out loading screen after a short delay for the first frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (loadingScreen) {
        loadingScreen.classList.add('hidden');
        setTimeout(() => loadingScreen.remove(), 700);
      }
    });
  });
}

boot();
