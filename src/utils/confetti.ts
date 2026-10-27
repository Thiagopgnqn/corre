import confetti from 'canvas-confetti';

export function fireConfetti() {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#10b981', '#6366f1', '#ec4899', '#f59e0b', '#06b6d4', '#a855f7'],
  });
}

export function fireMilestoneConfetti() {
  const duration = 2.5 * 1000;
  const end = Date.now() + duration;

  const interval: ReturnType<typeof setInterval> = setInterval(() => {
    if (Date.now() > end) {
      return clearInterval(interval);
    }
    confetti({
      startVelocity: 30,
      spread: 360,
      ticks: 60,
      origin: {
        x: Math.random(),
        y: Math.random() - 0.2,
      },
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'],
    });
  }, 250);
}
