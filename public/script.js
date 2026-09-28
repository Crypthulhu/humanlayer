/* =================================================================
   HumanLayer — interactions v2
   JavaScript natif, sans dépendance. Respecte prefers-reduced-motion,
   met en pause les animations hors écran et reste lisible sans JS.
   ================================================================= */
(() => {
  'use strict';

  window.__hlReady = true;

  const html = document.documentElement;
  const isEN = (html.lang || 'fr').toLowerCase().startsWith('en');
  const locale = isEN ? 'en-US' : 'fr-CA';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const NB = ' '; // espace insécable
  const NN = ' '; // espace fine insécable

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clock = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  };
  const decId = () => 'dec_' + Math.random().toString(36).slice(2, 6).replace(/^./, (c) => c.toUpperCase());

  /* ---------------------------------------------------------------
     Textes
     --------------------------------------------------------------- */
  const T = isEN
    ? {
        menuOpen: 'Open menu',
        menuClose: 'Close menu',
        copy: 'Copy',
        copied: 'Copied',
        hubIdle: 'Standing by',
        pct: (x) => x + '%',
        verdicts: { approved: 'Approved', rejected: 'Rejected', review: 'Second opinion' },
        cases: [
          { d: 'Credit', p: 'Certified credit analyst', v: 'approved' },
          { d: 'Legal', p: 'Qualified lawyer', v: 'approved' },
          { d: 'Health', p: 'Authorized radiologist', v: 'review' },
          { d: 'Prod access', p: 'CISO', v: 'rejected' },
          { d: 'Claim', p: 'Mandated expert', v: 'approved' },
          { d: 'Spend', p: 'CFO', v: 'approved' },
          { d: 'Quality', p: 'Quality manager', v: 'approved' },
          { d: 'Hiring', p: 'HR director', v: 'approved' },
        ],
        sim: {
          autoTitle: 'Automatic execution',
          autoSub: 'Below the threshold: the agent continues its workflow. The action is logged.',
          escTitle: 'Arbitrium crossed — Sentinel required',
          escSub: 'The request is routed to a qualified Sentinel. The agent waits for a traceable decision.',
          confidence: (v) => v + '%',
          scenarios: {
            expense: {
              prompt: '“€42 expense report — client lunch, compliant with internal policy. Reimburse?”',
              v: [8, 96, 20, 10],
              level: 'Level 1 · Compliance', type: 'compliance',
              profile: 'Financial controller',
              sla: '30 min', slaMinutes: 30,
              deliverable: 'Structured validation + audit trail',
            },
            credit: {
              prompt: '“AI analyzed 200 credit files. For this customer, the score is in a gray zone (480). Approve the €50,000 loan?”',
              v: [70, 48, 75, 60],
              level: 'Level 3 · Decision authority', type: 'signature',
              profile: 'Certified credit analyst',
              sla: '2 h (custom)', slaMinutes: 120,
              deliverable: 'Enforceable decision + audit trail',
            },
            legal: {
              prompt: '“Out of 500 contracts analyzed, 12 include a change-of-control clause. Is clause §4.2.b acceptable?”',
              v: [80, 62, 70, 70],
              level: 'Level 2 · Contextual judgment', type: 'judgment',
              profile: 'Qualified lawyer',
              sla: '2 h', slaMinutes: 120,
              deliverable: 'Qualified legal opinion',
            },
            health: {
              prompt: '“The algorithm detects an anomaly on patient #4521’s MRI. Tumor probability: 78%. Confirm the diagnosis?”',
              v: [90, 78, 95, 85],
              level: 'Level 3 · Decision authority', type: 'signature',
              profile: 'Authorized radiologist',
              sla: '30 min (custom)', slaMinutes: 30,
              deliverable: 'Assumed medical accountability',
            },
            access: {
              prompt: '“Admin access request to the prod server. Justification: ‘urgent debug’. User: junior dev, 10:30 pm. Approve?”',
              v: [75, 40, 55, 50],
              level: 'Level 2 · Contextual judgment', type: 'judgment',
              profile: 'CISO',
              sla: 'Priority (Enterprise)', slaMinutes: 15,
              deliverable: 'Zero-trust + full audit',
            },
          },
        },
        signedApprove: 'Decision recorded: approved, timestamped, archived.',
        signedReject: 'Decision recorded: rejected, justified, archived.',
        console: [
          'Ready · <b>POST /api/v1/decisions</b>',
          'Case submitted · level <b>1</b> · SLA <b>30 min</b>',
          'Routing to a qualified Sentinel · <b>S-4F2A9C</b>',
          'Decision signed · <b>Ed25519</b>',
          'Webhook <b>decision.completed</b> · signature verified',
        ],
        form: {
          sending: 'Sending…',
          successTitle: 'Thank you for your application!',
          successText: 'We’ll get back to you within 48 hours if your profile matches our needs.',
          errorTitle: 'Submission failed',
          errorText: 'Please try again in a moment.',
        },
      }
    : {
        menuOpen: 'Ouvrir le menu',
        menuClose: 'Fermer le menu',
        copy: 'Copier',
        copied: 'Copié',
        hubIdle: 'En attente',
        pct: (x) => x + NB + '%',
        verdicts: { approved: 'Approuvée', rejected: 'Refusée', review: 'Second avis' },
        cases: [
          { d: 'Crédit', p: 'Analyste crédit certifié', v: 'approved' },
          { d: 'Juridique', p: 'Juriste qualifié', v: 'approved' },
          { d: 'Santé', p: 'Radiologue habilité', v: 'review' },
          { d: 'Accès prod', p: 'RSSI', v: 'rejected' },
          { d: 'Sinistre', p: 'Expert mandaté', v: 'approved' },
          { d: 'Dépense', p: 'Directeur financier', v: 'approved' },
          { d: 'Qualité', p: 'Responsable qualité', v: 'approved' },
          { d: 'Recrutement', p: 'DRH', v: 'approved' },
        ],
        sim: {
          autoTitle: 'Exécution automatique',
          autoSub: `Sous le seuil${NB}: l’agent poursuit son workflow. L’action est journalisée.`,
          escTitle: 'Arbitrium franchi — Sentinel requis',
          escSub: 'La demande est routée vers un Sentinel qualifié. L’agent attend une décision tracée.',
          confidence: (v) => v + NB + '%',
          scenarios: {
            expense: {
              prompt: `«${NN}Note de frais de 42${NB}€ — repas client, conforme à la politique interne. Rembourser${NN}?${NN}»`,
              v: [8, 96, 20, 10],
              level: 'Niveau 1 · Conformité', type: 'compliance',
              profile: 'Contrôleur financier',
              sla: `30${NB}min`, slaMinutes: 30,
              deliverable: 'Validation structurée + audit trail',
            },
            credit: {
              prompt: `«${NN}L’IA a analysé 200 dossiers de crédit. Pour ce client, le scoring est en zone grise (480). Faut-il approuver le prêt de 50${NN}000${NB}€${NN}?${NN}»`,
              v: [70, 48, 75, 60],
              level: 'Niveau 3 · Autorité décisionnelle', type: 'signature',
              profile: 'Analyste crédit certifié',
              sla: `2${NB}h (sur mesure)`, slaMinutes: 120,
              deliverable: 'Décision opposable + audit trail',
            },
            legal: {
              prompt: `«${NN}Sur 500 contrats analysés, 12 contiennent une clause de changement de contrôle. Cette clause §4.2.b est-elle acceptable${NN}?${NN}»`,
              v: [80, 62, 70, 70],
              level: 'Niveau 2 · Jugement contextuel', type: 'judgment',
              profile: 'Juriste qualifié',
              sla: `2${NB}h`, slaMinutes: 120,
              deliverable: 'Opinion juridique qualifiée',
            },
            health: {
              prompt: `«${NN}L’algorithme détecte une anomalie sur l’IRM du patient #4521. Probabilité de tumeur${NB}: 78${NB}%. Confirmer le diagnostic${NN}?${NN}»`,
              v: [90, 78, 95, 85],
              level: 'Niveau 3 · Autorité décisionnelle', type: 'signature',
              profile: 'Radiologue habilité',
              sla: `30${NB}min (sur mesure)`, slaMinutes: 30,
              deliverable: 'Responsabilité médicale assumée',
            },
            access: {
              prompt: `«${NN}Demande d’accès admin au serveur de prod. Justification${NB}: “debug urgent”. Utilisateur${NB}: dev junior, 22${NB}h${NB}30. Approuver${NN}?${NN}»`,
              v: [75, 40, 55, 50],
              level: 'Niveau 2 · Jugement contextuel', type: 'judgment',
              profile: 'RSSI',
              sla: 'Prioritaire (Enterprise)', slaMinutes: 15,
              deliverable: 'Zero-trust + audit complet',
            },
          },
        },
        signedApprove: `Décision enregistrée${NB}: approuvée, horodatée, archivée.`,
        signedReject: `Décision enregistrée${NB}: refusée, justifiée, archivée.`,
        console: [
          'Prêt · <b>POST /api/v1/decisions</b>',
          'Dossier transmis · niveau <b>1</b> · SLA <b>30 min</b>',
          'Routage vers un Sentinel qualifié · <b>S-4F2A9C</b>',
          'Décision signée · <b>Ed25519</b>',
          'Webhook <b>decision.completed</b> · signature vérifiée',
        ],
        form: {
          sending: 'Envoi en cours…',
          successTitle: `Merci pour votre candidature${NN}!`,
          successText: `Nous reviendrons vers vous sous 48${NB}h si votre profil correspond à nos besoins.`,
          errorTitle: 'Envoi impossible',
          errorText: 'Réessayez dans un instant.',
        },
      };

  /* ---------------------------------------------------------------
     Outils
     --------------------------------------------------------------- */
  const onVisible = (el, cb, options = { threshold: 0.2 }) => {
    if (!('IntersectionObserver' in window)) {
      cb(true);
      return;
    }
    new IntersectionObserver(([entry]) => cb(entry.isIntersecting), options).observe(el);
  };

  // Clavier des onglets : flèches, Début, Fin (activation automatique)
  const tabKeys = (list, tabs, activate) => {
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      activate(n);
      tabs[n].focus();
    });
  };

  /* ---------------------------------------------------------------
     En-tête : état au défilement, progression, menu mobile, section active
     --------------------------------------------------------------- */
  function initHeader() {
    const header = $('#nav');
    const bar = $('.scroll-progress');
    let ticking = false;

    const onScroll = () => {
      ticking = false;
      const y = window.scrollY;
      if (header) header.classList.toggle('is-scrolled', y > 8);
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.setProperty('--progress', max > 0 ? (y / max).toFixed(4) : '0');
      }
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(onScroll);
        }
      },
      { passive: true }
    );
    onScroll();

    const toggle = $('.nav-toggle');
    const menu = $('#mobile-menu');
    if (toggle && menu) {
      const background = [$('main'), $('.site-footer')].filter(Boolean);
      const open = () => {
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', T.menuClose);
        document.body.classList.add('menu-open');
        background.forEach((el) => el.setAttribute('inert', ''));
        const first = $('a', menu);
        if (first) first.focus({ preventScroll: true });
      };
      const close = (restoreFocus) => {
        if (menu.hidden) return;
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', T.menuOpen);
        document.body.classList.remove('menu-open');
        background.forEach((el) => el.removeAttribute('inert'));
        if (restoreFocus) toggle.focus();
      };
      toggle.addEventListener('click', () => (menu.hidden ? open() : close()));
      menu.addEventListener('click', (e) => {
        if (e.target.closest('a')) close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(true);
      });
      window.matchMedia('(min-width: 1101px)').addEventListener('change', (e) => {
        if (e.matches) close();
      });
    }

    const links = $$('.nav-links a[href^="#"]');
    const sections = new Map();
    links.forEach((a) => {
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) sections.set(target, a);
    });
    if (sections.size && 'IntersectionObserver' in window) {
      const spy = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            links.forEach((l) => l.classList.remove('is-active'));
            const link = sections.get(entry.target);
            if (link) link.classList.add('is-active');
          });
        },
        { rootMargin: '-45% 0px -50% 0px' }
      );
      sections.forEach((_, section) => spy.observe(section));
    }
  }

  /* ---------------------------------------------------------------
     Apparitions au défilement
     --------------------------------------------------------------- */
  function initReveal() {
    const groups = $$('[data-stagger], .reveal-stagger');
    groups.forEach((g) => Array.from(g.children).forEach((c, i) => c.style.setProperty('--i', i)));
    const all = Array.from(new Set([...$$('[data-reveal], .reveal, [data-inview]'), ...groups]));

    const done = (el) => {
      el.classList.add('is-in');
      if (el.matches('[data-stagger], .reveal-stagger')) {
        setTimeout(() => el.classList.add('is-done'), el.children.length * 70 + 1000);
      }
    };

    if (reduceMotion || !('IntersectionObserver' in window)) {
      all.forEach(done);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          done(entry.target);
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    all.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------
     Titre découpé en mots (le texte reste dans le HTML pour le SEO)
     --------------------------------------------------------------- */
  function initSplit() {
    $$('[data-split]').forEach((heading) => {
      if (reduceMotion) {
        heading.classList.add('is-split');
        return;
      }
      let i = 0;
      Array.from(heading.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          node.textContent.split(/([ \t\n\r]+)/).forEach((part) => {
            if (!part) return;
            if (/^[ \t\n\r]+$/.test(part)) {
              frag.appendChild(document.createTextNode(' '));
              return;
            }
            const span = document.createElement('span');
            span.className = 'split-word';
            span.style.setProperty('--i', i++);
            span.textContent = part;
            frag.appendChild(span);
          });
          heading.replaceChild(frag, node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          node.style.setProperty('--i', i++);
        }
      });
      requestAnimationFrame(() => heading.classList.add('is-split'));
    });
  }

  /* ---------------------------------------------------------------
     Inclinaison 3D du moteur, qui se redresse au défilement
     --------------------------------------------------------------- */
  function initTilt() {
    const el = $('[data-tilt]');
    if (!el || reduceMotion) return;
    const anchor = el.parentElement;
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.bottom < -200 || r.top > vh + 200) return;
      const t = clamp((vh - r.top) / (vh * 0.85), 0, 1);
      const e = 1 - Math.pow(1 - t, 2);
      el.style.setProperty('--tilt', ((1 - e) * 18).toFixed(2) + 'deg');
      el.style.setProperty('--scale', (0.93 + 0.07 * e).toFixed(4));
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    window.addEventListener('resize', update);
    update();
  }

  /* ---------------------------------------------------------------
     Moteur de routage (canvas) : agents → Arbitrium → auto ou Sentinel
     --------------------------------------------------------------- */
  function initEngine() {
    const el = $('[data-engine]');
    if (!el) return;
    const body = $('.engine-body', el);
    const canvas = $('.engine-canvas', el);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const agents = $$('.engine-agents li', el);
    const gate = $('.engine-gate', el);
    const sink = $('.engine-sink', el);
    const hub = $('.engine-hub', el);
    const hubLabel = $('[data-hub-label]', el);
    const ledgerBox = $('.engine-ledger', el);
    const ledger = $('[data-ledger]', el);
    const stat = {
      total: $('[data-stat="total"]', el),
      rate: $('[data-stat="rate"]', el),
      auto: $('[data-stat="auto"]', el),
    };
    const nf = new Intl.NumberFormat(locale);
    const nf1 = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const COL = { cyan: [63, 224, 238], amber: [255, 181, 71], green: [61, 220, 151] };

    let W = 0;
    let H = 0;
    let A = null;
    let parts = [];
    let flashes = [];
    let queue = 0;
    let job = null;
    let total = 0;
    let autoCount = 0;
    let escCount = 0;
    let caseIdx = Math.floor(Math.random() * T.cases.length);
    let running = false;
    let inView = false;
    let raf = 0;
    let last = 0;
    let spawnAcc = 0;
    let statAcc = 0;
    let scan = 0;

    // Positions en coordonnées de mise en page : insensibles à l’inclinaison 3D
    const offsetIn = (node) => {
      let x = 0;
      let y = 0;
      let n = node;
      while (n && n !== body) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent;
      }
      return { x, y };
    };

    const measure = () => {
      W = body.clientWidth;
      H = body.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = offsetIn(sink);
      A = {
        // Les particules partent après le nom de l’agent, pas par-dessus
        agents: agents.map((li) => {
          const dot = $('i', li);
          const p = offsetIn(dot);
          const row = offsetIn(li);
          return { x: row.x + li.offsetWidth + 6, y: p.y + dot.offsetHeight / 2 };
        }),
        gateX: offsetIn(gate).x,
        exitY: s.y + sink.offsetHeight + 16,
        hub: offsetIn(hub),
      };
      parts = [];
      flashes = [];
    };

    const curve = (p0, p1, p2, p3) => ({ p0, p1, p2, p3, len: Math.hypot(p3.x - p0.x, p3.y - p0.y) * 1.15 + 1 });
    const point = (c, t) => {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const d = 3 * u * t * t;
      const e = t * t * t;
      return {
        x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
        y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
      };
    };

    const spawn = () => {
      const i = Math.floor(Math.random() * A.agents.length);
      const s = A.agents[i];
      const gy = lerp(s.y, H * 0.46, 0.55) + (Math.random() - 0.5) * H * 0.16;
      const mx = s.x + (A.gateX - s.x) * 0.5;
      const start = { x: s.x, y: s.y };
      parts.push({
        phase: 'in',
        // ≈ 15 % des demandes franchissent Arbitrium ; la 3e le fait toujours, pour le montrer tôt
        hot: total % 9 === 2 || Math.random() < 0.05,
        c: curve(start, { x: mx, y: s.y }, { x: mx, y: gy }, { x: A.gateX, y: gy }),
        t: 0,
        x: start.x,
        y: start.y,
        speed: 200 + Math.random() * 80,
        col: 'cyan',
        trail: [],
        r: 1.3 + Math.random() * 0.9,
        alpha: 1,
      });
      total++;
      const li = agents[i];
      li.classList.add('is-firing');
      setTimeout(() => li.classList.remove('is-firing'), 240);
    };

    const addLedger = (c) => {
      const li = document.createElement('li');
      const l1 = document.createElement('span');
      l1.className = 'l1';
      const tag = document.createElement('span');
      tag.className = 'verdict-tag is-' + c.v;
      tag.textContent = T.verdicts[c.v];
      l1.append(tag, document.createTextNode(c.d));
      const l2 = document.createElement('span');
      l2.className = 'l2';
      l2.textContent = `${decId()} · ${clock()} · ${c.p}`;
      li.append(l1, l2);
      ledger.prepend(li);
      while (ledger.children.length > 3) ledger.lastElementChild.remove();
    };

    // Transition d’une phase à l’autre ; retourne false quand la particule sort
    const advance = (p) => {
      const end = p.c.p3;
      if (p.phase === 'in') {
        p.t = 0;
        if (p.hot) {
          p.phase = 'hub';
          p.col = 'amber';
          p.speed = 175;
          p.r = 2.2;
          p.c = curve(end, { x: end.x + 50, y: end.y }, { x: A.hub.x - 80, y: A.hub.y }, { x: A.hub.x, y: A.hub.y });
          flashes.push({ x: end.x, y: end.y, t: 0, size: 24 });
          escCount++;
        } else {
          p.phase = 'auto';
          p.speed = 240 + Math.random() * 70;
          const ey = A.exitY + (Math.random() - 0.5) * 28;
          p.c = curve(end, { x: end.x + 90, y: end.y }, { x: W - 170, y: ey }, { x: W + 30, y: ey });
        }
        return true;
      }
      if (p.phase === 'auto') {
        autoCount++;
        return false;
      }
      if (p.phase === 'hub') {
        queue++;
        flashes.push({ x: A.hub.x, y: A.hub.y, t: 0, size: 40 });
        return false;
      }
      if (p.phase === 'out') {
        addLedger(p.item);
        return false;
      }
      return false;
    };

    const tickHub = (dt) => {
      if (!job && queue > 0) {
        queue--;
        const item = T.cases[caseIdx++ % T.cases.length];
        job = { t: 0, dur: queue > 2 ? 0.7 : 1.2 + Math.random() * 0.6, item };
        hubLabel.textContent = item.p;
      }
      if (!job) return;
      job.t += dt;
      hub.style.setProperty('--sla', Math.min(1, job.t / job.dur).toFixed(3));
      if (job.t < job.dur) return;
      const lb = offsetIn(ledgerBox);
      const target = { x: lb.x + 26, y: lb.y + 34 };
      parts.push({
        phase: 'out',
        item: job.item,
        c: curve(
          { x: A.hub.x, y: A.hub.y },
          { x: A.hub.x + 70, y: A.hub.y },
          { x: target.x - 60, y: target.y },
          target
        ),
        t: 0,
        x: A.hub.x,
        y: A.hub.y,
        speed: 210,
        col: 'green',
        trail: [],
        r: 2.3,
        alpha: 1,
      });
      job = null;
      hub.style.setProperty('--sla', '0');
      if (queue === 0) hubLabel.textContent = T.hubIdle;
    };

    const drawScene = (dt) => {
      ctx.clearRect(0, 0, W, H);

      // Guides pointillés des agents vers le seuil
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'rgba(160, 180, 220, 0.09)';
      ctx.beginPath();
      A.agents.forEach((a) => {
        const mx = a.x + (A.gateX - a.x) * 0.5;
        ctx.moveTo(a.x + 10, a.y);
        ctx.bezierCurveTo(mx, a.y, mx, H * 0.46, A.gateX, H * 0.46);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Le seuil Arbitrium : halo, ligne et balayage
      const halo = ctx.createLinearGradient(A.gateX - 60, 0, A.gateX + 60, 0);
      halo.addColorStop(0, 'rgba(255, 181, 71, 0)');
      halo.addColorStop(0.5, 'rgba(255, 181, 71, 0.10)');
      halo.addColorStop(1, 'rgba(255, 181, 71, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(A.gateX - 60, 0, 120, H);
      const line = ctx.createLinearGradient(0, 0, 0, H);
      line.addColorStop(0, 'rgba(255, 181, 71, 0)');
      line.addColorStop(0.12, 'rgba(255, 181, 71, 0.75)');
      line.addColorStop(0.88, 'rgba(255, 181, 71, 0.75)');
      line.addColorStop(1, 'rgba(255, 181, 71, 0)');
      ctx.fillStyle = line;
      ctx.fillRect(A.gateX - 0.75, 0, 1.5, H);
      scan = (scan + dt * 0.3) % 1;
      const sy = scan * (H + 160) - 80;
      const sweep = ctx.createLinearGradient(0, sy - 70, 0, sy + 70);
      sweep.addColorStop(0, 'rgba(255, 225, 170, 0)');
      sweep.addColorStop(0.5, 'rgba(255, 225, 170, 0.95)');
      sweep.addColorStop(1, 'rgba(255, 225, 170, 0)');
      ctx.fillStyle = sweep;
      ctx.fillRect(A.gateX - 1.5, sy - 70, 3, 140);

      ctx.globalCompositeOperation = 'lighter';

      // Traînées, regroupées par couleur
      ['cyan', 'amber', 'green'].forEach((key) => {
        const [r, g, b] = COL[key];
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${key === 'cyan' ? 0.28 : 0.45})`;
        ctx.lineWidth = key === 'cyan' ? 1.1 : 1.6;
        ctx.beginPath();
        parts.forEach((p) => {
          if (p.col !== key || p.trail.length < 2) return;
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
        });
        ctx.stroke();
      });

      // Particules : halo puis noyau
      parts.forEach((p) => {
        const [r, g, b] = COL[p.col];
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.14 * p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // Ondes au franchissement du seuil et à l’arrivée chez le Sentinel
      flashes.forEach((f) => {
        const k = f.t / 0.8;
        ctx.strokeStyle = `rgba(255, 181, 71, ${(1 - k) * 0.9})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 4 + k * f.size, 0, Math.PI * 2);
        ctx.stroke();
      });

      ctx.globalCompositeOperation = 'source-over';
    };

    const updateStats = () => {
      stat.total.textContent = nf.format(total);
      stat.auto.textContent = nf.format(autoCount);
      stat.rate.textContent = total >= 30 ? T.pct(nf1.format((escCount / total) * 100)) : '—';
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;

      spawnAcc += dt;
      const interval = W < 700 ? 0.24 : 0.14;
      while (spawnAcc > interval) {
        spawnAcc -= interval;
        spawn();
      }

      parts = parts.filter((p) => {
        p.t += (dt * p.speed) / p.c.len;
        if (p.t >= 1) {
          p.t = 1;
          if (!advance(p)) return false;
        }
        const q = point(p.c, p.t);
        p.x = q.x;
        p.y = q.y;
        p.trail.push(q);
        if (p.trail.length > 8) p.trail.shift();
        if (p.phase === 'auto') p.alpha = 1 - Math.max(0, (p.t - 0.72) / 0.28);
        return true;
      });
      flashes = flashes.filter((f) => (f.t += dt) < 0.8);
      tickHub(dt);
      drawScene(dt);

      statAcc += dt;
      if (statAcc > 0.25) {
        statAcc = 0;
        updateStats();
      }
    };

    const start = () => {
      if (running || !A) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Version fixe pour « mouvement réduit »
    const drawStill = () => {
      parts = [];
      for (let k = 0; k < 36; k++) {
        spawn();
        const p = parts[parts.length - 1];
        p.t = Math.random() * 0.95;
        const q = point(p.c, p.t);
        p.x = q.x;
        p.y = q.y;
      }
      total = 0;
      drawScene(0);
      if (ledger.children.length < 3) addLedger(T.cases[0]);
    };

    measure();
    // Deux décisions déjà au journal : le panneau n’est jamais vide
    T.cases.slice(1, 3).forEach(addLedger);
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        measure();
        if (reduceMotion) drawStill();
      }).observe(body);
    }

    if (reduceMotion) {
      drawStill();
      return;
    }

    onVisible(
      el,
      (visible) => {
        inView = visible;
        if (visible && !document.hidden) start();
        else stop();
      },
      { threshold: 0.05 }
    );
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else if (inView) start();
    });
  }

  /* ---------------------------------------------------------------
     Compteurs animés
     --------------------------------------------------------------- */
  function initCounters() {
    const els = $$('[data-count]');
    if (!els.length) return;
    const run = (el) => {
      const target = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.decimals || '0', 10);
      const f = new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (reduceMotion) {
        el.textContent = f.format(target);
        return;
      }
      const t0 = performance.now();
      const dur = 1600;
      const tick = (now) => {
        const k = clamp((now - t0) / dur, 0, 1);
        el.textContent = f.format(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          run(entry.target);
        });
      },
      { threshold: 0.6 }
    );
    els.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------
     Simulateur Arbitrium
     --------------------------------------------------------------- */
  function initSim() {
    const root = $('[data-sim]');
    if (!root) return;
    const THRESHOLD = 60;
    const S = T.sim;
    const names = ['impact', 'confidence', 'regulatory', 'irreversibility'];
    const inputs = names.map((n) => $(`input[name="${n}"]`, root));
    const outs = names.map((n) => $(`[data-out="${n}"]`, root));
    const list = $('[role="tablist"]', root);
    const tabs = $$('[role="tab"]', root);
    const panel = $('[role="tabpanel"]', root);
    const prompt = $('[data-sim-prompt]', root);
    const needle = $('[data-needle]', root);
    const arc = $('[data-gauge-val]', root);
    const scoreEl = $('[data-score]', root);
    const title = $('[data-verdict-title]', root);
    const sub = $('[data-verdict-sub]', root);
    const icon = $('[data-verdict-icon] use', root);
    const verdict = $('.verdict', root);
    const json = $('[data-sim-json]', root);
    const fields = {
      level: $('[data-v="level"]', root),
      profile: $('[data-v="profile"]', root),
      sla: $('[data-v="sla"]', root),
      deliverable: $('[data-v="deliverable"]', root),
    };

    // Graduations de la jauge
    const ticks = $('[data-ticks]', root);
    if (ticks) {
      const ns = 'http://www.w3.org/2000/svg';
      for (let v = 0; v <= 100; v += 10) {
        const a = Math.PI * (1 - v / 100);
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('class', 'gauge-tick');
        l.setAttribute('x1', (160 + 146 * Math.cos(a)).toFixed(1));
        l.setAttribute('y1', (178 - 146 * Math.sin(a)).toFixed(1));
        l.setAttribute('x2', (160 + (v % 50 === 0 ? 158 : 153) * Math.cos(a)).toFixed(1));
        l.setAttribute('y2', (178 - (v % 50 === 0 ? 158 : 153) * Math.sin(a)).toFixed(1));
        ticks.appendChild(l);
      }
    }

    const L = arc.getTotalLength ? arc.getTotalLength() : 408.4;
    arc.style.strokeDasharray = `${L}`;
    arc.style.strokeDashoffset = `${L}`;

    let current = 'expense';
    let state = null;
    let shown = 0;
    let numRaf = 0;

    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const toJSON = (obj) => {
      const entries = Object.entries(obj);
      const lines = entries.map(([k, v], i) => {
        let val;
        if (v === null) val = '<span class="tk-k">null</span>';
        else if (typeof v === 'boolean') val = `<span class="tk-k">${v}</span>`;
        else if (typeof v === 'number') val = `<span class="tk-n">${v}</span>`;
        else val = `<span class="tk-s">"${esc(v)}"</span>`;
        return `  <span class="tk-p">"${k}"</span>: ${val}${i < entries.length - 1 ? ',' : ''}`;
      });
      return ['{', ...lines, '}'].join('\n');
    };

    const fill = (input) => {
      input.style.setProperty('--p', `${input.value}%`);
    };

    const animateScore = (to) => {
      cancelAnimationFrame(numRaf);
      if (reduceMotion) {
        shown = to;
        scoreEl.textContent = to;
        return;
      }
      const from = shown;
      const t0 = performance.now();
      const tick = (now) => {
        const k = clamp((now - t0) / 500, 0, 1);
        shown = Math.round(lerp(from, to, 1 - Math.pow(1 - k, 3)));
        scoreEl.textContent = shown;
        if (k < 1) numRaf = requestAnimationFrame(tick);
      };
      numRaf = requestAnimationFrame(tick);
    };

    const compute = () => {
      const [impact, confidence, regulatory, irreversibility] = inputs.map((i) => +i.value);
      return Math.round(0.35 * impact + 0.25 * (100 - confidence) + 0.25 * regulatory + 0.15 * irreversibility);
    };

    const render = () => {
      const s = compute();
      const sc = S.scenarios[current];
      arc.style.strokeDashoffset = `${L * (1 - s / 100)}`;
      needle.style.setProperty('--v', s);
      animateScore(s);
      outs.forEach((o, i) => {
        o.textContent = names[i] === 'confidence' ? S.confidence(inputs[i].value) : inputs[i].value;
      });

      const next = s >= THRESHOLD ? 'escalated' : 'auto';
      root.dataset.state = next;
      if (next === 'escalated') {
        title.textContent = S.escTitle;
        sub.textContent = S.escSub;
        icon.setAttribute('href', '#icon-user');
        fields.level.textContent = sc.level;
        fields.profile.textContent = sc.profile;
        fields.sla.textContent = sc.sla;
        fields.deliverable.textContent = sc.deliverable;
        json.innerHTML = toJSON({
          arbitrium: true,
          criticality: s,
          action: 'POST /api/v1/decisions',
          request_type: sc.type,
          sla_minutes: sc.slaMinutes,
        });
      } else {
        title.textContent = S.autoTitle;
        sub.textContent = S.autoSub;
        icon.setAttribute('href', '#icon-bolt');
        json.innerHTML = toJSON({ arbitrium: false, criticality: s, action: 'auto_execute', logged: true });
      }
      if (state !== null && state !== next && !reduceMotion) {
        verdict.classList.remove('verdict-flash');
        void verdict.offsetWidth;
        verdict.classList.add('verdict-flash');
      }
      state = next;
    };

    // Les curseurs glissent vers les valeurs du scénario
    let slideRaf = 0;
    const load = (key) => {
      current = key;
      const sc = S.scenarios[key];
      prompt.textContent = sc.prompt;
      cancelAnimationFrame(slideRaf);
      if (reduceMotion) {
        inputs.forEach((inp, i) => {
          inp.value = sc.v[i];
          fill(inp);
        });
        render();
        return;
      }
      const from = inputs.map((i) => +i.value);
      const t0 = performance.now();
      const tick = (now) => {
        const k = clamp((now - t0) / 650, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        inputs.forEach((inp, i) => {
          inp.value = Math.round(lerp(from[i], sc.v[i], e));
          fill(inp);
        });
        render();
        if (k < 1) slideRaf = requestAnimationFrame(tick);
      };
      slideRaf = requestAnimationFrame(tick);
    };

    const select = (i) => {
      tabs.forEach((t, j) => {
        const on = j === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tabs[i].id);
      load(tabs[i].dataset.scenario);
    };

    tabs.forEach((t, i) => t.addEventListener('click', () => select(i)));
    tabKeys(list, tabs, select);
    inputs.forEach((inp) =>
      inp.addEventListener('input', () => {
        cancelAnimationFrame(slideRaf);
        fill(inp);
        render();
      })
    );

    inputs.forEach(fill);
    prompt.textContent = S.scenarios[current].prompt;
    render();
  }

  /* ---------------------------------------------------------------
     Les trois couches : la plaque active suit l’étape lue
     --------------------------------------------------------------- */
  function initStack() {
    const stack = $('[data-stack]');
    if (!stack || !('IntersectionObserver' in window)) return;
    const steps = $$('.layer-step');
    const setActive = (n) => {
      stack.dataset.active = String(n);
      steps.forEach((s) => s.classList.toggle('is-current', s.dataset.step === String(n)));
    };
    const mq = window.matchMedia('(max-width: 980px)');
    let io = null;
    let timer = 0;

    const setup = () => {
      if (io) io.disconnect();
      clearInterval(timer);
      if (mq.matches) {
        io = new IntersectionObserver(
          ([entry]) => {
            clearInterval(timer);
            if (!entry.isIntersecting || reduceMotion) return;
            let n = +stack.dataset.active || 1;
            timer = setInterval(() => {
              n = (n % 3) + 1;
              setActive(n);
            }, 2200);
          },
          { threshold: 0.4 }
        );
        io.observe(stack);
      } else {
        io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) setActive(entry.target.dataset.step);
            });
          },
          { rootMargin: '-45% 0px -45% 0px' }
        );
        steps.forEach((s) => io.observe(s));
      }
    };
    setActive(1);
    setup();
    mq.addEventListener('change', setup);
  }

  /* ---------------------------------------------------------------
     Registre de décision : champs liés, inclinaison, identifiant
     --------------------------------------------------------------- */
  function initRecord() {
    const rec = $('[data-record]');
    if (!rec) return;
    const props = $$('[data-props] .prop');
    const fields = $$('.rf', rec);
    const keys = props.map((p) => p.dataset.prop);
    let auto = true;
    let timer = 0;
    let i = 0;

    const light = (key) => {
      props.forEach((p) => p.classList.toggle('is-lit', p.dataset.prop === key));
      fields.forEach((f) => f.classList.toggle('is-lit', f.dataset.prop === key));
    };

    props.forEach((p) => {
      const on = () => {
        auto = false;
        clearInterval(timer);
        light(p.dataset.prop);
      };
      p.addEventListener('pointerenter', on);
      p.addEventListener('focus', on);
      p.addEventListener('pointerleave', () => light(null));
      p.addEventListener('blur', () => light(null));
    });

    if (finePointer && !reduceMotion) {
      rec.addEventListener('pointermove', (e) => {
        const r = rec.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        rec.style.setProperty('--ry', `${((x - 0.5) * 10).toFixed(2)}deg`);
        rec.style.setProperty('--rx', `${((0.5 - y) * 8).toFixed(2)}deg`);
        rec.style.setProperty('--sheen', `${(100 - x * 100).toFixed(1)}%`);
      });
      rec.addEventListener('pointerleave', () => {
        rec.style.setProperty('--rx', '0deg');
        rec.style.setProperty('--ry', '0deg');
        rec.style.setProperty('--sheen', '100%');
      });
    }

    const code = $('[data-scramble]', rec);
    let scrambled = false;
    const scramble = () => {
      if (!code || scrambled || reduceMotion) return;
      scrambled = true;
      const final = code.textContent;
      const chars = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
      const t0 = performance.now();
      const tick = (now) => {
        const k = (now - t0) / 1100;
        let out = '';
        for (let j = 0; j < final.length; j++) {
          out += j < 4 || j / final.length < k ? final[j] : chars[Math.floor(Math.random() * chars.length)];
        }
        code.textContent = out;
        if (k < 1) requestAnimationFrame(tick);
        else code.textContent = final;
      };
      requestAnimationFrame(tick);
    };

    onVisible(
      rec,
      (visible) => {
        clearInterval(timer);
        if (!visible) {
          if (auto) light(null);
          return;
        }
        scramble();
        if (!auto || reduceMotion) return;
        timer = setInterval(() => light(keys[i++ % keys.length]), 1700);
      },
      { threshold: 0.4 }
    );
  }

  /* ---------------------------------------------------------------
     Cas d’usage : onglets avec avance automatique
     --------------------------------------------------------------- */
  function initUseCases() {
    const root = $('[data-uc]');
    if (!root) return;
    const list = $('[role="tablist"]', root);
    const tabs = $$('[role="tab"]', root);
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    let idx = 0;

    const select = (i, byUser) => {
      idx = (i + tabs.length) % tabs.length;
      tabs.forEach((t, j) => {
        const on = j === idx;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      const p = panels[idx];
      p.classList.remove('is-entering');
      void p.offsetWidth;
      p.classList.add('is-entering');
      const t = tabs[idx];
      if (list.scrollWidth > list.clientWidth + 4) {
        list.scrollTo({
          left: t.offsetLeft - list.clientWidth / 2 + t.offsetWidth / 2,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }
      if (byUser) root.setAttribute('data-manual', '');
    };

    tabs.forEach((t, i) => t.addEventListener('click', () => select(i, true)));
    tabKeys(list, tabs, (i) => select(i, true));

    if (reduceMotion) {
      root.setAttribute('data-manual', '');
      return;
    }
    // L’avance est pilotée par la barre de progression CSS : la pause la fige
    root.setAttribute('data-paused', '');
    tabs.forEach((t) => {
      const bar = $('.bar', t);
      if (bar) {
        bar.addEventListener('animationend', () => {
          if (!root.hasAttribute('data-manual')) select(idx + 1, false);
        });
      }
    });
    let hovering = false;
    let visible = false;
    const sync = () => {
      if (visible && !hovering) root.removeAttribute('data-paused');
      else root.setAttribute('data-paused', '');
    };
    onVisible(
      root,
      (v) => {
        visible = v;
        sync();
      },
      { threshold: 0.35 }
    );
    root.addEventListener('pointerenter', () => {
      hovering = true;
      sync();
    });
    root.addEventListener('pointerleave', () => {
      hovering = false;
      sync();
    });
    root.addEventListener('focusin', () => {
      hovering = true;
      sync();
    });
  }

  /* ---------------------------------------------------------------
     Console API : onglets, copie, frappe ligne à ligne, statut
     --------------------------------------------------------------- */
  function initConsole() {
    const root = $('[data-console]');
    if (!root) return;
    const list = $('[role="tablist"]', root);
    const tabs = $$('[role="tab"]', root);
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    const copyBtn = $('[data-copy]', root);
    const copyLabel = copyBtn ? $('span', copyBtn) : null;
    const status = $('[data-console-status]', root);
    panels.forEach((p) => $$('.ln', p).forEach((ln, i) => ln.style.setProperty('--i', i)));
    let seen = false;

    const type = (p) => {
      if (reduceMotion || !p) return;
      p.classList.remove('is-typing');
      void p.offsetWidth;
      p.classList.add('is-typing');
    };
    const active = () => panels.find((p) => !p.hidden);
    const select = (i) => {
      tabs.forEach((t, j) => {
        const on = j === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (seen) type(panels[i]);
    };
    tabs.forEach((t, i) => t.addEventListener('click', () => select(i)));
    tabKeys(list, tabs, select);

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const p = active();
        if (!p) return;
        try {
          await navigator.clipboard.writeText(p.innerText.replace(/ /g, ' '));
          copyBtn.classList.add('is-done');
          if (copyLabel) copyLabel.textContent = T.copied;
          setTimeout(() => {
            copyBtn.classList.remove('is-done');
            if (copyLabel) copyLabel.textContent = T.copy;
          }, 1800);
        } catch (err) {
          /* presse-papiers indisponible : on ne fait rien */
        }
      });
    }

    let si = 0;
    let st = 0;
    onVisible(
      root,
      (visible) => {
        clearInterval(st);
        if (!visible) return;
        if (!seen) {
          seen = true;
          type(active());
        }
        if (reduceMotion || !status) return;
        st = setInterval(() => {
          si = (si + 1) % T.console.length;
          status.innerHTML = T.console[si];
        }, 2600);
      },
      { threshold: 0.3 }
    );
  }

  /* ---------------------------------------------------------------
     Démo du portail Sentinel
     --------------------------------------------------------------- */
  function initSentinelDemo() {
    const demo = $('[data-sentinel-demo]');
    if (!demo) return;
    const cd = $('[data-countdown]', demo);
    const start = parseInt(cd.dataset.countdown, 10) || 7199;
    let secs = start;
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (s) => `SLA ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    let timer = 0;
    onVisible(demo, (visible) => {
      clearInterval(timer);
      if (!visible || reduceMotion) return;
      timer = setInterval(() => {
        if (demo.hasAttribute('data-done')) return;
        secs = Math.max(0, secs - 1);
        cd.textContent = fmt(secs);
      }, 1000);
    });

    const signed = $('.request-signed', demo);
    const text = $('[data-signed-text]', demo);
    const meta = $('[data-signed-meta]', demo);
    signed.tabIndex = -1;
    let reset = 0;
    $$('[data-act]', demo).forEach((btn) =>
      btn.addEventListener('click', () => {
        const ok = btn.dataset.act === 'approve';
        signed.classList.toggle('is-rejected', !ok);
        text.textContent = ok ? T.signedApprove : T.signedReject;
        meta.textContent = `dec_8Pq2 · ${clock()} · S-0317`;
        demo.setAttribute('data-done', '');
        signed.focus({ preventScroll: true });
        clearTimeout(reset);
        reset = setTimeout(() => {
          demo.removeAttribute('data-done');
          secs = start;
          cd.textContent = fmt(secs);
        }, 6500);
      })
    );
  }

  /* ---------------------------------------------------------------
     Projecteur sur les cartes et boutons magnétiques
     --------------------------------------------------------------- */
  function initPointerFx() {
    if (!finePointer || reduceMotion) return;
    $$('.spotlight').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
    $$('[data-magnetic]').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.16;
        const y = (e.clientY - r.top - r.height / 2) * 0.26;
        btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.transform = '';
      });
    });
  }

  /* ---------------------------------------------------------------
     FAQ : accordéon accessible
     --------------------------------------------------------------- */
  function initFaq() {
    const items = $$('.faq-item');
    if (!items.length) return;

    const setOpen = (item, open) => {
      const q = $('.faq-question', item);
      const a = $('.faq-answer', item);
      if (!q || !a) return;
      q.setAttribute('aria-expanded', String(open));
      if (open) {
        item.classList.add('open');
        a.style.maxHeight = `${a.scrollHeight + 24}px`;
        const done = (e) => {
          if (e.propertyName !== 'max-height') return;
          if (item.classList.contains('open')) a.style.maxHeight = 'none';
          a.removeEventListener('transitionend', done);
        };
        a.addEventListener('transitionend', done);
        if (reduceMotion) a.style.maxHeight = 'none';
      } else {
        a.style.maxHeight = `${a.scrollHeight}px`;
        void a.offsetHeight;
        item.classList.remove('open');
        a.style.maxHeight = '0px';
      }
    };

    items.forEach((item, i) => {
      const q = $('.faq-question', item);
      const a = $('.faq-answer', item);
      if (!q || !a) return;
      q.type = 'button';
      q.id = q.id || `faq-q-${i}`;
      a.id = a.id || `faq-a-${i}`;
      q.setAttribute('aria-controls', a.id);
      q.setAttribute('aria-expanded', 'false');
      a.setAttribute('role', 'region');
      a.setAttribute('aria-labelledby', q.id);
      q.addEventListener('click', () => {
        const willOpen = !item.classList.contains('open');
        const group = item.closest('.faq-category');
        if (group && willOpen) {
          $$('.faq-item.open', group).forEach((other) => other !== item && setOpen(other, false));
        }
        setOpen(item, willOpen);
      });
    });
  }

  /* ---------------------------------------------------------------
     Formulaire de candidature Sentinel
     --------------------------------------------------------------- */
  function initApplyForm() {
    const form = $('#applyForm');
    if (!form) return;
    const submit = $('button[type="submit"]', form);
    const warning = $('#habilitation-warning');
    const status = $('[data-form-status]', form);
    const original = submit.innerHTML;

    $$('input[name="habilitation"]', form).forEach((radio) =>
      radio.addEventListener('change', () => {
        const blocked = radio.value === 'non' && radio.checked;
        if (warning) warning.hidden = !blocked;
        submit.disabled = blocked;
      })
    );

    const show = (kind, heading, message) => {
      if (!status) return;
      status.hidden = false;
      status.className = `form-status is-${kind}`;
      status.replaceChildren();
      const h = document.createElement('h4');
      h.textContent = heading;
      const p = document.createElement('p');
      p.textContent = message;
      status.append(h, p);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = T.form.sending;
      if (status) status.hidden = true;
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const res = await fetch('/.netlify/functions/submit-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('submit failed');
        show('success', T.form.successTitle, T.form.successText);
        form.reset();
      } catch (err) {
        show('error', T.form.errorTitle, T.form.errorText);
      } finally {
        submit.disabled = false;
        submit.innerHTML = original;
      }
    });
  }

  /* ---------------------------------------------------------------
     Démarrage
     --------------------------------------------------------------- */
  const boot = () => {
    initSplit();
    initHeader();
    initReveal();
    initTilt();
    initEngine();
    initCounters();
    initSim();
    initStack();
    initRecord();
    initUseCases();
    initConsole();
    initSentinelDemo();
    initPointerFx();
    initFaq();
    initApplyForm();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
