// Cards behave like cut stones: they turn toward you, and the light moves across the face.
// One delegated listener rather than one per card.

const MAX = 7; // degrees

export function enableTilt(root = document) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(hover: hover)").matches) return;

  root.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".cut");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty("--ry", `${(px - 0.5) * MAX * 2}deg`);
    card.style.setProperty("--rx", `${(0.5 - py) * MAX * 1.4}deg`);
    card.style.setProperty("--mx", `${px * 100}%`);
    card.style.setProperty("--my", `${py * 100}%`);
  });

  root.addEventListener("pointerleave", (e) => {
    const card = e.target.closest?.(".cut");
    if (!card) return;
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  }, true);
}
