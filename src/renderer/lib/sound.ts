/**
 * Spielt einen angenehmen, dezenten Zweiklang über die Web Audio API ab,
 * sobald ein Abruf erfolgreich abgeschlossen wurde.
 */
export function playCompletionSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;

    // Erster Ton (F5 = 698.46 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(698.46, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.12, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Zweiter Ton (C6 = 1046.50 Hz - harmonische Quinte darüber)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.5, now + 0.1);
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.14, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.6);

    // Audio-Kontext nach Beendigung des Ausklingens freigeben
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 750);
  } catch (err) {
    console.warn('[Sound] Konnte Audio-Chime nicht abspielen:', err);
  }
}
