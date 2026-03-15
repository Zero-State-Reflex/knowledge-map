// ─── AUDIO MODULE ────────────────────────────────────────────────────────────

export let audioCtx = null;
export let audioStarted = false;

// Domain -> chime root frequency (pentatonic-ish spread)
export const DOMAIN_FREQS = {
  "Formal Sciences":           65.41,   // C2
  "Physical Sciences":         73.42,   // D2
  "Earth & Space":             82.41,   // E2
  "Life Sciences":             87.31,   // F2
  "Chemistry":                 98.00,   // G2
  "Medicine & Health":         110.00,  // A2
  "Social Sciences":           123.47,  // B2
  "Humanities":                130.81,  // C3
  "Arts & Design":             146.83,  // D3
  "Engineering & Tech":        55.00,   // A1
  "Interdisciplinary":         61.74,   // B1
  "Esoteric & Occult":         46.25,   // F#1
  "Contemplative Traditions":  51.91,   // Ab1
  "Indigenous & Traditional":  58.27,   // Bb1
  "Consciousness & Fringe":    38.89,   // Eb1
};

export function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // ── Reverb convolver (synthetic IR) ──────────────────────────────────────
  const revLen  = audioCtx.sampleRate * 4.5;
  const revBuf  = audioCtx.createBuffer(2, revLen, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = revBuf.getChannelData(c);
    for (let i = 0; i < revLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 2.2);
    }
  }
  const reverb = audioCtx.createConvolver();
  reverb.buffer = revBuf;

  // Master volume — slider and mute both control this
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = parseFloat(document.getElementById('vol-slider').value);
  masterGain.connect(audioCtx.destination);
  audioCtx._masterGain = masterGain;

  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.55;
  reverb.connect(reverbGain);
  reverbGain.connect(masterGain);

  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.18;
  dryGain.connect(masterGain);

  // ── Ambient pad layer ─────────────────────────────────────────────────────
  // Slow-evolving drone: stacked detuned sine oscillators
  const padNotes = [65.41, 130.81, 196.00, 261.63, 329.63]; // C2 pentatonic

  padNotes.forEach((freq, idx) => {
    const count = 3;
    for (let v = 0; v < count; v++) {
      const osc = audioCtx.createOscillator();
      osc.type = v === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq * (1 + (v - 1) * 0.003); // slight detune

      // Slow LFO tremolo per voice
      const lfo = audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.03 + idx * 0.007 + v * 0.013;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 0.004;
      lfo.connect(lfoGain);

      const voiceGain = audioCtx.createGain();
      voiceGain.gain.value = 0.012 / count;
      lfoGain.connect(voiceGain.gain);

      osc.connect(voiceGain);
      voiceGain.connect(reverb);
      voiceGain.connect(dryGain);

      osc.start();
      lfo.start();
    }
  });

  // ── Slow melodic breath: random pentatonic notes fading in/out ────────────
  const pentatonic = [130.81, 146.83, 164.81, 196.00, 220.00,
                      261.63, 293.66, 329.63, 392.00, 440.00];

  function breathNote() {
    if (!audioCtx) return;
    const freq = pentatonic[Math.floor(Math.random() * pentatonic.length)];
    const dur  = 5 + Math.random() * 8;
    const wait = 3 + Math.random() * 9;

    const osc  = audioCtx.createOscillator();
    osc.type   = 'sine';
    osc.frequency.value = freq;

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.022, audioCtx.currentTime + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);

    osc.connect(g);
    g.connect(reverb);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);

    setTimeout(breathNote, (wait + dur * 0.6) * 1000);
  }
  breathNote();
  setTimeout(breathNote, 2000);
  setTimeout(breathNote, 5500);

  // Store refs for chime
  audioCtx._reverb  = reverb;
  audioCtx._revGain = reverbGain;
}

export function playChime(domain) {
  if (!audioCtx) return;
  const root = DOMAIN_FREQS[domain] || 65.41;
  const now  = audioCtx.currentTime;

  // Soft tone: pure harmonic series, sine waves only, slow swell
  const partials = [1, 2, 3, 4];
  const amps     = [1.0, 0.28, 0.10, 0.04];
  const attackT  = 0.35;   // slow soft attack
  const holdT    = 1.0;
  const decayT   = 4.5;

  partials.forEach((ratio, i) => {
    const osc = audioCtx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = root * ratio;

    // Slight vibrato on fundamental for warmth
    if (i === 0) {
      const vib = audioCtx.createOscillator();
      vib.frequency.value = 4.5;
      const vibGain = audioCtx.createGain();
      vibGain.gain.value = root * 0.003;
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);
      vib.start(now);
      vib.stop(now + attackT + holdT + decayT);
    }

    const g  = audioCtx.createGain();
    const pk = 0.055 * amps[i];
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(pk, now + attackT);          // slow swell in
    g.gain.linearRampToValueAtTime(pk * 0.85, now + attackT + holdT); // gentle hold
    g.gain.linearRampToValueAtTime(0.0001, now + attackT + holdT + decayT); // long fade

    osc.connect(g);
    g.connect(audioCtx._reverb);
    g.connect(audioCtx._masterGain);
    osc.start(now);
    osc.stop(now + attackT + holdT + decayT + 0.2);
  });
}
