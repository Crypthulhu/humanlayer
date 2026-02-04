// ============================================
// HumanLayer - Enhanced Interactive Scripts
// Game-Changing Visual Experience
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Core initializations
  initNavScroll();
  initMobileNav();
  initNavSpy();
  initScrollReveal();
  initSmoothScroll();
  initScrollProgress();
  initCursorGlow();
  initNavSignalPulse();

  // Enhanced visual effects
  initNeuralNetwork();
  initTypingEffect();
  initParallax();
  initCardEffects();
  initAnimatedCounters();
  initCodeTyping();

  // FAQ accordion
  initFaqAccordion();

  // Form handler
  initApplyForm();
});

// ============================================
// Navigation
// ============================================
function initNavScroll() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });
}

function initMobileNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  const toggle = nav.querySelector('.nav-toggle');
  const links = nav.querySelector('.nav-links');
  const backdrop = nav.querySelector('.nav-backdrop');

  if (!toggle || !links) return;

  const openMenu = () => {
    nav.classList.add('open');
    document.body.classList.add('nav-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fermer le menu');
    links.scrollTop = 0;
    const firstLink = links.querySelector('a');
    if (firstLink) {
      requestAnimationFrame(() => firstLink.focus());
    }
    requestAnimationFrame(() => updateNavSignal());
  };

  const closeMenu = () => {
    nav.classList.remove('open');
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
  };

  toggle.addEventListener('click', () => {
    if (nav.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  links.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => closeMenu());
  });

  if (backdrop) {
    backdrop.addEventListener('click', () => closeMenu());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMenu();
  });
}

function initNavSpy() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  const navLinks = Array.from(nav.querySelectorAll('.nav-links a[href^="#"]')).filter(link => link.getAttribute('href') !== '#');
  if (navLinks.length === 0) return;

  const sectionMap = new Map();
  navLinks.forEach(link => {
    const id = link.getAttribute('href').slice(1);
    const section = document.getElementById(id);
    if (section) {
      sectionMap.set(section, link);
    }
  });

  if (sectionMap.size === 0) {
    updateNavSignal();
    window.addEventListener('resize', () => updateNavSignal());
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sectionMap.forEach(link => link.classList.remove('active'));
        const activeLink = sectionMap.get(entry.target);
        if (activeLink) {
          activeLink.classList.add('active');
          updateNavSignal();
        }
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });

  sectionMap.forEach((_, section) => observer.observe(section));
  updateNavSignal();
  window.addEventListener('resize', () => updateNavSignal());
}

function updateNavSignal() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  const signal = nav.querySelector('.nav-signal');
  const activeLink = nav.querySelector('.nav-links a.active') || nav.querySelector('.nav-links a:not(.btn)');
  const scanline = nav.querySelector('.nav-scanline');

  if (!signal || !activeLink) {
    if (signal) signal.style.opacity = '0';
    return;
  }

  const signalHeight = 22;
  const offset = activeLink.offsetTop + activeLink.offsetHeight / 2 - signalHeight / 2;
  signal.style.setProperty('--signal-offset', `${offset}px`);
  signal.style.opacity = '1';

  if (scanline) {
    const scanOffset = activeLink.offsetTop + activeLink.offsetHeight / 2;
    scanline.style.top = `${scanOffset}px`;
    scanline.classList.remove('scanline-active');
    void scanline.offsetWidth;
    scanline.classList.add('scanline-active');
  }
}

function initNavSignalPulse() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const signal = nav.querySelector('.nav-signal');
  if (!signal) return;

  const updatePulse = () => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = totalHeight > 0 ? window.scrollY / totalHeight : 0;
    const scale = 1 + progress * 0.8;
    const glow = 0.4 + progress * 0.6;
    signal.style.setProperty('--signal-scale', scale.toFixed(2));
    signal.style.setProperty('--signal-glow', glow.toFixed(2));
  };

  updatePulse();
  window.addEventListener('scroll', updatePulse, { passive: true });
  window.addEventListener('resize', updatePulse);
}

function initScrollProgress() {
  const progress = document.getElementById('scroll-progress');
  if (!progress) return;

  const updateProgress = () => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progressPercent = totalHeight > 0 ? (window.scrollY / totalHeight) * 100 : 0;
    progress.style.width = `${progressPercent}%`;
  };

  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
}

function initCursorGlow() {
  const glow = document.querySelector('.cursor-glow');
  if (!glow) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  if (reduceMotion || coarsePointer) {
    glow.classList.add('hidden');
    return;
  }

  let rafId = null;
  let targetX = 0;
  let targetY = 0;

  const update = () => {
    glow.style.left = `${targetX}px`;
    glow.style.top = `${targetY}px`;
    rafId = null;
  };

  window.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(update);
    glow.classList.remove('hidden');
  });

  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget && !e.toElement) {
      glow.classList.add('hidden');
    }
  });
}

// ============================================
// Neural Network Background Animation
// ============================================
function initNeuralNetwork() {
  const hero = document.querySelector('.hero');
  if (!hero) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'neural-canvas';
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  `;
  hero.style.position = 'relative';
  hero.insertBefore(canvas, hero.firstChild);

  const ctx = canvas.getContext('2d');
  let nodes = [];
  let animationId;

  function resize() {
    canvas.width = hero.offsetWidth;
    canvas.height = hero.offsetHeight;
    initNodes();
  }

  function initNodes() {
    nodes = [];
    const nodeCount = Math.min(80, Math.floor((canvas.width * canvas.height) / 15000));

    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 2 + 1,
        color: Math.random() > 0.5 ? '#00D4FF' : '#7C3AED'
      });
    }
  }

  function drawNode(node) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = node.color;
    ctx.fill();

    // Glow effect
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius * 3, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(
      node.x, node.y, 0,
      node.x, node.y, node.radius * 3
    );
    gradient.addColorStop(0, node.color + '40');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  function drawConnections() {
    const maxDist = 150;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          const opacity = (1 - dist / maxDist) * 0.3;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(0, 212, 255, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  function updateNodes() {
    nodes.forEach(node => {
      node.x += node.vx;
      node.y += node.vy;

      if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
      if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawConnections();
    nodes.forEach(drawNode);
    updateNodes();
    animationId = requestAnimationFrame(animate);
  }

  resize();
  animate();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(animationId);
    resize();
    animate();
  });
}

// ============================================
// Typing Effect for Headlines
// ============================================
function initTypingEffect() {
  const headline = document.querySelector('.hero h1');
  if (!headline) return;

  const highlightSpan = headline.querySelector('.highlight');
  if (!highlightSpan) return;

  const text = highlightSpan.textContent;
  highlightSpan.textContent = '';
  highlightSpan.style.borderRight = '3px solid var(--primary)';

  let i = 0;
  function type() {
    if (i < text.length) {
      highlightSpan.textContent += text.charAt(i);
      i++;
      setTimeout(type, 80);
    } else {
      highlightSpan.style.borderRight = 'none';
    }
  }

  // Start after a delay
  setTimeout(type, 1000);
}

// ============================================
// Scroll Reveal with Stagger
// ============================================
function initScrollReveal() {
  // Trigger reveal much earlier - 200px before element is visible
  const observerOptions = {
    root: null,
    rootMargin: '200px 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');

        // Stagger children with faster timing
        if (entry.target.classList.contains('reveal-stagger')) {
          entry.target.querySelectorAll('.glass-card, .solution-step, .why-card, .trust-item, .pricing-card').forEach((child, index) => {
            child.style.transitionDelay = `${index * 0.05}s`; // Faster stagger: 50ms instead of 100ms
            child.classList.add('stagger-active');
          });
        }
      }
    });
  }, observerOptions);

  document.querySelectorAll('.reveal, .reveal-stagger').forEach(el => {
    observer.observe(el);
  });
}

// ============================================
// Smooth Scroll
// ============================================
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);

      if (target) {
        const navHeight = document.getElementById('nav')?.offsetHeight || 0;
        const targetPosition = target.offsetTop - navHeight - 20;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// ============================================
// Parallax Effects
// ============================================
function initParallax() {
  const parallaxElements = document.querySelectorAll('[data-parallax]');

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;

    parallaxElements.forEach(el => {
      const speed = parseFloat(el.dataset.parallax) || 0.5;
      const yPos = -(scrollY * speed);
      el.style.transform = `translateY(${yPos}px)`;
    });
  });
}

// ============================================
// Enhanced Card Effects
// ============================================
function initCardEffects() {
  const cards = document.querySelectorAll('.glass-card');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  if (reduceMotion || coarsePointer) return;

  cards.forEach(card => {
    // 3D tilt effect
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = (y - centerY) / 20;
      const rotateY = (centerX - x) / 20;

      card.style.transform = `perspective(1000px) translateY(-6px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(12px)`;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) translateY(0) rotateX(0) rotateY(0) translateZ(0)';
    });
  });
}

// ============================================
// Animated Counters
// ============================================
function initAnimatedCounters() {
  const counters = document.querySelectorAll('[data-count]');

  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.5
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
        entry.target.classList.add('counted');
        const target = parseFloat(entry.target.dataset.count);
        const suffix = entry.target.dataset.suffix || '';
        const prefix = entry.target.dataset.prefix || '';
        const precision = parseInt(entry.target.dataset.precision || '0', 10);
        const duration = 2000;
        let start = 0;
        const increment = target / (duration / 16);

        const formatNumber = (value) => {
          if (precision > 0) {
            return value.toFixed(precision);
          }
          return Math.floor(value).toString();
        };

        function updateCounter() {
          start += increment;
          if (start < target) {
            entry.target.textContent = `${prefix}${formatNumber(start)}${suffix}`;
            requestAnimationFrame(updateCounter);
          } else {
            entry.target.textContent = `${prefix}${formatNumber(target)}${suffix}`;
          }
        }

        updateCounter();
      }
    });
  }, observerOptions);

  counters.forEach(counter => observer.observe(counter));
}

// ============================================
// Code Block Typing Animation
// ============================================
function initCodeTyping() {
  const codeBlocks = document.querySelectorAll('.code-content');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.classList.contains('typed')) {
        entry.target.classList.add('typed');
        entry.target.classList.add('code-typing');
      }
    });
  }, { threshold: 0.3 });

  codeBlocks.forEach(block => observer.observe(block));
}

// ============================================
// FAQ Accordion
// ============================================
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');

    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      // Close all FAQ items in the same category (optional - remove for multi-open)
      const category = item.closest('.faq-category');
      if (category) {
        category.querySelectorAll('.faq-item').forEach(faqItem => {
          faqItem.classList.remove('open');
        });
      }

      // Toggle the clicked item
      if (!isOpen) {
        item.classList.add('open');
      }
    });
  });
}

// ============================================
// Application Form Handler
// ============================================
function initApplyForm() {
  const form = document.getElementById('applyForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<svg class="hl-icon spin"><use href="#icon-timer"/></svg> Envoi en cours...';

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    await new Promise(resolve => setTimeout(resolve, 1500));

    submitBtn.innerHTML = '<svg class="hl-icon"><use href="#icon-check"/></svg> Candidature envoyée !';
    submitBtn.style.background = 'linear-gradient(135deg, #10B981 0%, #059669 100%)';

    const successMessage = document.createElement('div');
    successMessage.className = 'form-success';
    successMessage.innerHTML = `
      <div class="success-box">
        <svg class="hl-icon hl-2xl"><use href="#icon-check"/></svg>
        <h4>Merci pour votre candidature !</h4>
        <p>Nous reviendrons vers vous sous 48h si votre profil correspond à nos besoins.</p>
      </div>
    `;
    form.appendChild(successMessage);

    console.log('Application submitted:', data);

    setTimeout(() => {
      form.reset();
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
      submitBtn.style.background = '';
      successMessage.remove();
    }, 5000);
  });
}

// ============================================
// Inject Enhanced Styles
// ============================================
const enhancedStyles = document.createElement('style');
enhancedStyles.textContent = `
  /* Stagger animation for children - visible by default with subtle animation */
  .glass-card, .solution-step, .why-card, .trust-item, .pricing-card {
    opacity: 0.6;
    transform: translateY(15px);
    transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .stagger-active {
    opacity: 1;
    transform: translateY(0);
  }
  
  /* Enhanced card glow effect */
  .glass-card {
    position: relative;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }
  
  .glass-card::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.3), rgba(124, 58, 237, 0.3), rgba(0, 212, 255, 0.3));
    background-size: 200% 200%;
    animation: gradientMove 4s ease infinite;
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: -1;
  }
  
  .glass-card:hover::before {
    opacity: 1;
  }
  
  .glass-card::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: inherit;
    background: radial-gradient(
      400px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
      rgba(0, 212, 255, 0.15),
      transparent 40%
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .glass-card:hover::after {
    opacity: 1;
  }
  
  @keyframes gradientMove {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  
  /* Code typing effect */
  .code-typing {
    animation: codeReveal 0.5s ease forwards;
  }
  
  @keyframes codeReveal {
    from { opacity: 0.3; }
    to { opacity: 1; }
  }
  
  /* Spin animation for loading */
  .spin {
    animation: spin360 1s linear infinite;
  }
  
  @keyframes spin360 {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  /* Success box */
  .success-box {
    text-align: center;
    padding: 24px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 16px;
    margin-top: 20px;
  }
  
  .success-box h4 {
    color: #10B981;
    margin: 12px 0 8px;
  }
  
  .success-box p {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  
  /* Enhanced button hover */
  .btn-primary {
    position: relative;
    overflow: hidden;
  }
  
  .btn-primary::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: left 0.5s ease;
  }
  
  .btn-primary:hover::before {
    left: 100%;
  }
`;
document.head.appendChild(enhancedStyles);
