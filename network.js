const canvas = document.getElementById('network-background');
const ctx = canvas.getContext('2d');
const prefersReducedMotion =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

const config = {
  nodeCount: 80,
  maxDistance: 200,
  nodeRadius: [1.1, 2.4],
  baseVelocity: 0.2,
  parallax: 0.04,
};

const nodes = [];
let mousePosition = { x: null, y: null };
let viewport = { width: window.innerWidth, height: window.innerHeight };
let animationFrameId = null;

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function resizeCanvas() {
  viewport = { width: window.innerWidth, height: window.innerHeight };
  canvas.width = viewport.width * window.devicePixelRatio;
  canvas.height = viewport.height * window.devicePixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function adjustNodeDensity() {
  let targetCount = viewport.width > 1600 ? 110 : 90;

  if (viewport.width < 1024) {
    targetCount = 80;
  }
  if (viewport.width < 768) {
    targetCount = 65;
  }
  if (viewport.width < 480) {
    targetCount = 45;
  }

  const targetDistance =
    viewport.width < 480
      ? 120
      : viewport.width < 768
      ? 150
      : viewport.width < 1024
      ? 170
      : 200;

  const densityChanged =
    targetCount !== config.nodeCount || targetDistance !== config.maxDistance;

  config.nodeCount = targetCount;
  config.maxDistance = targetDistance;

  return densityChanged;
}

function createNodes() {
  nodes.length = 0;
  for (let i = 0; i < config.nodeCount; i += 1) {
    nodes.push({
      x: Math.random() * viewport.width,
      y: Math.random() * viewport.height,
      vx: randomBetween(-config.baseVelocity, config.baseVelocity),
      vy: randomBetween(-config.baseVelocity, config.baseVelocity),
      radius: randomBetween(config.nodeRadius[0], config.nodeRadius[1]),
    });
  }
}

function updateNodes() {
  for (const node of nodes) {
    node.x += node.vx;
    node.y += node.vy;

    if (node.x < 0 || node.x > viewport.width) {
      node.vx *= -1;
    }
    if (node.y < 0 || node.y > viewport.height) {
      node.vy *= -1;
    }
  }
}

function containNodes() {
  for (const node of nodes) {
    node.x = Math.min(Math.max(node.x, 0), viewport.width);
    node.y = Math.min(Math.max(node.y, 0), viewport.height);
  }
}

function scaleNodes(previousViewport) {
  if (!previousViewport.width || !previousViewport.height) {
    return;
  }

  const widthRatio = viewport.width / previousViewport.width;
  const heightRatio = viewport.height / previousViewport.height;

  for (const node of nodes) {
    node.x *= widthRatio;
    node.y *= heightRatio;
  }
}

function drawNodes() {
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    const dx = mousePosition.x !== null ? node.x - mousePosition.x : 0;
    const dy = mousePosition.y !== null ? node.y - mousePosition.y : 0;
    const distanceToMouse = Math.sqrt(dx * dx + dy * dy);
    const parallaxFactor = mousePosition.x !== null ? Math.min(distanceToMouse / 600, 1) : 1;
    const nodeX = node.x - dx * config.parallax * (1 - parallaxFactor);
    const nodeY = node.y - dy * config.parallax * (1 - parallaxFactor);

    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + Math.random() * 0.5})`;
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(104, 212, 255, 0.45)';
    ctx.arc(nodeX, nodeY, node.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
    ctx.shadowBlur = 0;

    for (let j = i + 1; j < nodes.length; j += 1) {
      const target = nodes[j];
      const targetDx = mousePosition.x !== null ? target.x - mousePosition.x : 0;
      const targetDy = mousePosition.y !== null ? target.y - mousePosition.y : 0;
      const targetDistance = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
      const targetParallax = mousePosition.x !== null ? Math.min(targetDistance / 600, 1) : 1;
      const targetX =
        target.x - targetDx * config.parallax * (1 - targetParallax);
      const targetY =
        target.y - targetDy * config.parallax * (1 - targetParallax);

      const distance = Math.hypot(node.x - target.x, node.y - target.y);
      if (distance < config.maxDistance) {
        const opacity = 1 - distance / config.maxDistance;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(104, 212, 255, ${opacity * 0.35})`;
        ctx.lineWidth = 1;
        ctx.moveTo(nodeX, nodeY);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        ctx.closePath();
      }
    }
  }
}

function animate() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (prefersReducedMotion.matches) {
    drawNodes();
    return;
  }

  const step = () => {
    updateNodes();
    drawNodes();
    animationFrameId = requestAnimationFrame(step);
  };

  drawNodes();
  animationFrameId = requestAnimationFrame(step);
}

function handleMouseMove(event) {
  const rect = canvas.getBoundingClientRect();
  mousePosition = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function handleMouseLeave() {
  mousePosition = { x: null, y: null };
}

function handleTouchMove(event) {
  if (!event.touches || event.touches.length === 0) {
    return;
  }
  const touch = event.touches[0];
  const rect = canvas.getBoundingClientRect();
  mousePosition = {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  };
}

function init() {
  resizeCanvas();
  adjustNodeDensity();
  createNodes();
  animate();
}

function handleResize() {
  const previousViewport = { ...viewport };
  resizeCanvas();
  const densityChanged = adjustNodeDensity();
  if (densityChanged) {
    createNodes();
  } else {
    scaleNodes(previousViewport);
  }
  containNodes();
  animate();
}

window.addEventListener('resize', handleResize);

window.addEventListener('mousemove', handleMouseMove);
window.addEventListener('mouseleave', handleMouseLeave);
window.addEventListener('touchstart', handleTouchMove, { passive: true });
window.addEventListener('touchmove', handleTouchMove, { passive: true });
window.addEventListener('touchend', handleMouseLeave);
window.addEventListener('touchcancel', handleMouseLeave);

document.addEventListener('DOMContentLoaded', () => {
  init();
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const navToggle = document.querySelector('.nav-toggle');
  const siteHeader = document.querySelector('.site-header');
  const nav = document.getElementById('primary-navigation');

  if (navToggle && siteHeader && nav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      const nextState = !expanded;
      navToggle.setAttribute('aria-expanded', String(nextState));
      siteHeader.classList.toggle('is-open', nextState);
      document.body.classList.toggle('nav-open', nextState);
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        siteHeader.classList.remove('is-open');
        document.body.classList.remove('nav-open');
      });
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        navToggle.setAttribute('aria-expanded', 'false');
        siteHeader.classList.remove('is-open');
        document.body.classList.remove('nav-open');
      }
    });
  }
});

function handleMotionPreferenceChange() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  animate();
}

if (typeof prefersReducedMotion.addEventListener === 'function') {
  prefersReducedMotion.addEventListener('change', handleMotionPreferenceChange);
} else if (typeof prefersReducedMotion.addListener === 'function') {
  prefersReducedMotion.addListener(handleMotionPreferenceChange);
}
