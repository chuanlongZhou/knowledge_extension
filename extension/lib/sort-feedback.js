const animations = new WeakMap();

export function setSortDragImage(event, row) {
  const ghost = row.cloneNode(true);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  const rect = row.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: `${rect.width}px`,
    margin: '0',
    padding: getComputedStyle(row).padding,
    background: 'var(--white)',
    border: '1px solid var(--green)',
    borderRadius: '9px',
    boxShadow: '0 14px 34px #25332f30',
    pointerEvents: 'none',
    zIndex: '9999',
  });
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, Math.min(28, rect.width / 2), rect.height / 2);
  setTimeout(() => ghost.remove(), 0);
}

export function animateSortReflow(parent, mutate) {
  const rows = [...parent.children];
  for (const row of rows) animations.get(row)?.cancel();
  const before = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
  mutate();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const row of rows) {
    const distance = before.get(row) - row.getBoundingClientRect().top;
    if (Math.abs(distance) < 1) continue;
    const animation = row.animate(
      [{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }],
      { duration: 190, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    animations.set(row, animation);
    animation.addEventListener('finish', () => animations.delete(row), { once: true });
    animation.addEventListener('cancel', () => animations.delete(row), { once: true });
  }
}

export function moveSortItem(source, target, after) {
  const parent = source.parentElement;
  if (!parent || target.parentElement !== parent || source === target) return false;
  if (after ? target.nextElementSibling === source : source.nextElementSibling === target)
    return false;
  animateSortReflow(parent, () => parent.insertBefore(source, after ? target.nextSibling : target));
  return true;
}
