// Little Orrery: slowly twinkling star backdrop drawn on a fixed canvas.

export function startStarfield(canvas) {
  const g = canvas.getContext('2d');
  let stars = [];
  let W = 0;
  let H = 0;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((W * H) / 5200);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() < 0.08 ? 1.4 + Math.random() : 0.4 + Math.random() * 0.8,
      p: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 1.2,
      drift: 2 + Math.random() * 5,
    }));
  }

  function frame(now) {
    const t = now / 1000;
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      const a = 0.35 + 0.45 * Math.sin(t * s.sp + s.p);
      const y = reduced ? s.y : (s.y + t * s.drift) % H;
      g.fillStyle = `rgba(235,228,255,${a})`;
      g.beginPath();
      g.arc(s.x, y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}
