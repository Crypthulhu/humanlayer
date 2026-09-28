(function (global) {
  'use strict';

  var STYLE_ID = 'hl-antibot-style';

  var DEFAULTS = {
    lang: 'fr',
    brandHTML: 'Human<span>Layer</span>',
    redirectUrl: null,
    redirectDelay: 1500,
    maxAgeMs: 10 * 60 * 1000,
    maxAttempts: 3,
    storageKey: 'hl_verify',
    storageTsKey: 'hl_verify_ts',
    persistSession: true,
    onSuccess: null,
    onFail: null,
    texts: {}
  };

  var DICT = {
    fr: {
      subtitle: "Vérification d'identité humaine",
      step1Title: 'Étape 1 — Séquence de symboles',
      step1Instruction: 'Cliquez sur ces symboles dans l\'ordre :',
      step2Title: 'Étape 2 — Calcul de vérification',
      step2Instruction: 'Trouvez la multiplication marquée d\'une flèche et donnez le résultat :',
      step3Title: 'Étape 3 — Test d\'intention',
      step3Instruction: 'Faites glisser la forme qui ne ressemble pas aux autres vers la zone grise.',
      step4Title: 'Étape 4 — Vérification finale',
      powProgress: 'Calcul cryptographique en cours…',
      successTitle: 'Identité humaine vérifiée',
      successInstruction: 'Redirection en cours…',
      failedTitle: 'Vérification échouée',
      failedInstruction: 'Trop de tentatives incorrectes. Veuillez réessayer.',
      retry: 'Réessayer',
      verifyBtn: 'Vérifier',
      placeholderMath: '?',
      placeholderDrop: 'déposer',
      feedbackSequenceOk: '✓ Séquence correcte !',
      feedbackWrongSymbol: '✗ Mauvais symbole. Recommencez.',
      feedbackEnterNumber: 'Entrez un nombre.',
      feedbackMathOk: '✓ Correct !',
      feedbackMathWrong: '✗ Incorrect.',
      feedbackShapeOk: '✓ Bonne forme !',
      feedbackShapeWrong: '✗ Ce n\'est pas la bonne forme.',
      attempts: 'tentative',
      attemptsPlural: 'tentatives',
      remaining: 'restante',
      remainingPlural: 'restantes',
      timerPrefix: 'Temps écoulé : '
    },
    en: {
      subtitle: 'Human identity verification',
      step1Title: 'Step 1 — Symbol sequence',
      step1Instruction: 'Click these symbols in order:',
      step2Title: 'Step 2 — Verification math',
      step2Instruction: 'Find the multiplication marked with an arrow and give the result:',
      step3Title: 'Step 3 — Intention test',
      step3Instruction: 'Drag the shape that does not look like the others to the gray zone.',
      step4Title: 'Step 4 — Final verification',
      powProgress: 'Cryptographic check in progress…',
      successTitle: 'Human identity verified',
      successInstruction: 'Redirecting…',
      failedTitle: 'Verification failed',
      failedInstruction: 'Too many incorrect attempts. Please try again.',
      retry: 'Retry',
      verifyBtn: 'Verify',
      placeholderMath: '?',
      placeholderDrop: 'drop',
      feedbackSequenceOk: '✓ Correct sequence!',
      feedbackWrongSymbol: '✗ Wrong symbol. Start over.',
      feedbackEnterNumber: 'Enter a number.',
      feedbackMathOk: '✓ Correct!',
      feedbackMathWrong: '✗ Incorrect.',
      feedbackShapeOk: '✓ Correct shape!',
      feedbackShapeWrong: '✗ This is not the right shape.',
      attempts: 'attempt',
      attemptsPlural: 'attempts',
      remaining: 'left',
      remainingPlural: 'left',
      timerPrefix: 'Elapsed time: '
    }
  };

  var ICONS = {
    shield: '<path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2zm0 2.18l7 3.82v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V8l7-3.82z" fill="currentColor"/><path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z" fill="currentColor"/>',
    lock: '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" fill="currentColor"/>',
    eye: '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/>',
    key: '<path d="M12.65 10a6 6 0 1 0 0 4H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" fill="currentColor"/>',
    fingerprint: '<path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12a9.388 9.388 0 0 0-3.39-2.94c-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39s-4.66 1.97-4.66 4.39c0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-4.91-1.31-7.78-6.47-7.78-11.32 0-2.69 2.35-4.89 5.25-4.89 2.89 0 5.25 2.19 5.25 4.89 0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.15-1.9-3.89-4.25-3.89s-4.25 1.75-4.25 3.89c0 4.4 2.56 9.09 6.96 10.19.27.07.42.35.35.61-.06.23-.27.39-.49.39z" fill="currentColor"/>',
    radar: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4" stroke="currentColor" stroke-width="1.5" fill="none"/>',
    atom: '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(0 12 12)" stroke="currentColor" stroke-width="1.5" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" stroke="currentColor" stroke-width="1.5" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
    circuit: '<path d="M12 2v4m0 12v4M2 12h4m12 0h4" stroke="currentColor" stroke-width="2" fill="none"/><rect x="8" y="8" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M6 8L4 6m14 14l2 2M6 16L4 18m14-14l2-2" stroke="currentColor" stroke-width="1.5" fill="none"/>',
    dna: '<path d="M6 2c0 7 12 5 12 12s-12 5-12 12" stroke="currentColor" stroke-width="2" fill="none"/><path d="M18 2c0 7-12 5-12 12s12 5 12 12" stroke="currentColor" stroke-width="2" fill="none"/><line x1="7" y1="7" x2="17" y2="7" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="17" x2="17" y2="17" stroke="currentColor" stroke-width="1.5"/>',
    scale: '<path d="M12 2L12 22" stroke="currentColor" stroke-width="2"/><path d="M4 7l8-3 8 3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 7c0 3 2 5 4 5s4-2 4-5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 7c0 3 2 5 4 5s4-2 4-5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="8" y="20" width="8" height="2" rx="1" fill="currentColor"/>',
    globe: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" fill="none"/><ellipse cx="12" cy="12" rx="4" ry="10" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7h17M3.5 17h17" stroke="currentColor" stroke-width="1"/>',
    brain: '<path d="M12 2C9 2 7 4 7 6.5c0 .5.1 1 .3 1.4C5.3 8.7 4 10.5 4 12.5c0 1.7 1 3.2 2.3 4-.2.5-.3 1-.3 1.5 0 2.2 1.8 4 4 4h4c2.2 0 4-1.8 4-4 0-.5-.1-1-.3-1.5 1.3-.8 2.3-2.3 2.3-4 0-2-1.3-3.8-3.3-4.6.2-.4.3-.9.3-1.4C17 4 15 2 12 2z" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 2v20M8 8c2 1 4 1 6 0M8 14c2 1 4 1 6 0" stroke="currentColor" stroke-width="1"/>',
    tower: '<path d="M4 22l2-14h12l2 14" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="9" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 8v6m-4 0h8" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/>',
    graph: '<path d="M3 20h18M7 20V10m4 10V6m4 14V12m4 8V8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    satellite: '<circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 14l4-4m-2-2l4 4" stroke="currentColor" stroke-width="2"/><rect x="14" y="2" width="8" height="8" rx="1" transform="rotate(45 18 6)" stroke="currentColor" stroke-width="1.5" fill="none"/>',
    crosshair: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4" stroke="currentColor" stroke-width="1.5"/>'
  };

  var ICON_KEYS = Object.keys(ICONS);

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = "\n.hlab-root{--primary:#2f6bef;--primary-dark:#2458cc;--bg:#f7f5f3;--surface:#fff;--text:#1a1a2e;--muted:#888;--border:#e0dcd8;--success:#27ae60;--danger:#e74c3c;--font-heading:'Geist',ui-sans-serif,system-ui,sans-serif;--font-body:'Geist',ui-sans-serif,system-ui,sans-serif;font-family:var(--font-body);background:var(--bg);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;box-sizing:border-box}.hlab-root *{box-sizing:border-box}.hlab-card{background:var(--surface);border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:520px;width:100%;text-align:center}.hlab-logo{font-family:var(--font-heading);font-size:1.8rem;font-weight:600;letter-spacing:-.03em;margin-bottom:8px}.hlab-logo span{color:var(--primary)}.hlab-subtitle{color:var(--muted);font-size:.9rem;margin-bottom:32px}.hlab-progress{width:100%;height:6px;background:#eee;border-radius:999px;overflow:hidden;margin-bottom:22px}.hlab-progress-fill{height:100%;width:0;background:linear-gradient(90deg,var(--primary),#1fb8d4);transition:width .25s}.hlab-stage{display:none}.hlab-stage.active{display:block}.hlab-title{font-weight:700;font-size:1.1rem;margin-bottom:16px;color:var(--text)}.hlab-instruction{font-size:.95rem;color:var(--text);margin-bottom:20px;line-height:1.5}.hlab-target-row{display:flex;justify-content:center;gap:16px;margin-bottom:24px}.hlab-target-item{width:60px;height:60px;border:2px solid var(--primary);border-radius:10px;display:flex;align-items:center;justify-content:center;background:#ebe8e4;position:relative;overflow:hidden}.hlab-target-item::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(-45deg,transparent,transparent 2.5px,rgba(60,60,80,.06) 2.5px,rgba(60,60,80,.06) 4px);pointer-events:none;z-index:1}.hlab-target-item::after{content:'';position:absolute;inset:-30%;background:radial-gradient(circle at center,transparent 6px,rgba(50,50,70,.05) 7px,transparent 8px),radial-gradient(circle at center,transparent 14px,rgba(50,50,70,.04) 15px,transparent 16px),radial-gradient(circle at center,transparent 22px,rgba(50,50,70,.05) 23px,transparent 24px);pointer-events:none;z-index:1}.hlab-target-watermark{position:absolute;inset:-6px;opacity:.14;pointer-events:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;z-index:2}.hlab-target-main{position:relative;z-index:3;opacity:.6}.hlab-target-main svg{width:30px;height:30px}.hlab-target-number{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:var(--primary);color:#fff;font-size:.65rem;font-weight:700;display:flex;align-items:center;justify-content:center}.hlab-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px auto;max-width:380px}.hlab-cell{aspect-ratio:1;border:2px solid var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s ease;user-select:none;position:relative;overflow:hidden;background:#eae7e3}.hlab-cell::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 2.5px,rgba(50,50,70,.07) 2.5px,rgba(50,50,70,.07) 4px),repeating-linear-gradient(-30deg,transparent,transparent 5px,rgba(50,50,70,.04) 5px,rgba(50,50,70,.04) 6px),radial-gradient(circle,rgba(40,40,60,.08) 1px,transparent 1px);background-size:auto,auto,8px 8px;pointer-events:none;z-index:1}.hlab-cell::after{content:'';position:absolute;inset:-30%;background:radial-gradient(circle at center,transparent 6px,rgba(50,50,70,.05) 7px,transparent 8px),radial-gradient(circle at center,transparent 13px,rgba(50,50,70,.05) 14px,transparent 15px),radial-gradient(circle at center,transparent 20px,rgba(50,50,70,.06) 21px,transparent 22px),radial-gradient(circle at center,transparent 27px,rgba(50,50,70,.04) 28px,transparent 29px),radial-gradient(circle at center,transparent 34px,rgba(50,50,70,.05) 35px,transparent 36px),radial-gradient(circle at center,transparent 41px,rgba(50,50,70,.03) 42px,transparent 43px);pointer-events:none;z-index:1}.hlab-watermark{position:absolute;inset:-12px;opacity:.16;pointer-events:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;z-index:2}.hlab-main-icon{position:relative;z-index:3;width:32px;height:32px;opacity:.45;filter:drop-shadow(0 0 .3px rgba(30,30,50,.15))}.hlab-cell:hover{border-color:var(--primary);transform:scale(1.05);box-shadow:0 2px 12px rgba(47,107,239,.15)}.hlab-cell.correct{border-color:var(--success);background:rgba(39,174,96,.08);pointer-events:none}.hlab-cell.wrong{border-color:var(--danger);background:rgba(231,76,60,.08);animation:hlab-shake .4s ease}.hlab-order-badge{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:var(--success);color:#fff;font-size:.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;z-index:4}@keyframes hlab-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}.hlab-feedback{min-height:22px;font-size:.95rem;font-weight:600;margin-top:8px}.hlab-feedback.success{color:var(--success)}.hlab-feedback.error{color:var(--danger)}.hlab-attempts{font-size:.85rem;color:#777;min-height:20px;margin-top:6px}.hlab-math-answer{display:flex;gap:10px;justify-content:center;align-items:center}.hlab-math-answer input{width:120px;padding:10px;border:2px solid var(--border);border-radius:8px;text-align:center;font-size:1rem;background:#fff}.hlab-btn{border:none;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer}.hlab-btn-primary{background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff}.hlab-shape-arena{position:relative;height:220px;border:2px dashed var(--border);border-radius:12px;background:#f1efec;margin-top:12px;overflow:hidden}.hlab-shape-item{position:absolute;width:48px;height:48px;touch-action:none;cursor:grab;transition:transform .15s ease}.hlab-shape-item.disabled{opacity:.4;cursor:not-allowed}.hlab-shape-item.active{animation:hlab-float 1.8s ease-in-out infinite}.hlab-shape-item.correct-drop{animation:hlab-correct .5s ease forwards}.hlab-drop{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:74px;height:74px;border-radius:10px;border:2px dashed #bbb;display:flex;align-items:center;justify-content:center;color:rgba(100,100,120,.45);font-size:.72rem;transition:all .2s ease}.hlab-drop.hover{border-color:var(--primary);background:rgba(47,107,239,.06)}@keyframes hlab-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@keyframes hlab-correct{0%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}100%{transform:scale(0);opacity:0}}.hlab-pow-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,0,0,.15);border-top-color:var(--primary);border-radius:50%;animation:hlab-spin .9s linear infinite;margin-right:8px;vertical-align:-2px}@keyframes hlab-spin{to{transform:rotate(360deg)}}.hlab-success-check{width:52px;height:52px;border-radius:50%;background:var(--success);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.4rem;margin:0 auto 14px}.hlab-timer{margin-top:20px;font-size:.8rem;color:#999}.hlab-canvas{width:100%;max-width:420px;border:2px solid var(--border);border-radius:12px;background:#f3f2f0;margin:8px auto 0;display:block}@media(max-width:640px){.hlab-card{padding:24px 16px}.hlab-grid{gap:8px}.hlab-target-row{gap:10px}.hlab-target-item{width:54px;height:54px}.hlab-math-answer{flex-direction:column}.hlab-math-answer input{width:100%}}";
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function svgFor(name, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + (size || 36) + '" height="' + (size || 36) + '" style="color:#2c2c3e">' + ICONS[name] + '</svg>';
  }

  function watermark(count) {
    var html = '';
    for (var i = 0; i < (count || 36); i++) {
      var key = ICON_KEYS[Math.floor(Math.random() * ICON_KEYS.length)];
      var rot = Math.floor(Math.random() * 360);
      var size = 10 + Math.floor(Math.random() * 16);
      var flip = Math.random() > 0.5 ? 'scaleX(-1)' : '';
      var skew = Math.floor(Math.random() * 20) - 10;
      html += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="transform:rotate(' + rot + 'deg) ' + flip + ' skewX(' + skew + 'deg);color:#2c2c3e">' + ICONS[key] + '</svg>';
    }
    return html;
  }

  function resolveOptions(options) {
    var merged = {};
    var k;
    for (k in DEFAULTS) merged[k] = DEFAULTS[k];
    if (options) {
      for (k in options) merged[k] = options[k];
    }
    var baseDict = DICT[merged.lang] || DICT.fr;
    var text = {};
    for (k in baseDict) text[k] = baseDict[k];
    if (merged.texts) {
      for (k in merged.texts) text[k] = merged.texts[k];
    }
    merged.text = text;
    return merged;
  }

  function stageTemplate(text, brandHTML) {
    return '' +
      '<div class="hlab-card">' +
      '  <div class="hlab-logo">' + brandHTML + '</div>' +
      '  <div class="hlab-subtitle">' + escapeHtml(text.subtitle) + '</div>' +
      '  <div class="hlab-progress"><div class="hlab-progress-fill" data-role="progress"></div></div>' +
      '  <div class="hlab-stage active" data-role="stage1">' +
      '    <div class="hlab-title">' + escapeHtml(text.step1Title) + '</div>' +
      '    <div class="hlab-instruction">' + escapeHtml(text.step1Instruction) + '</div>' +
      '    <div class="hlab-target-row" data-role="target-row"></div>' +
      '    <div class="hlab-grid" data-role="symbol-grid"></div>' +
      '    <div class="hlab-feedback" data-role="symbol-feedback"></div>' +
      '    <div class="hlab-attempts" data-role="symbol-attempts"></div>' +
      '  </div>' +
      '  <div class="hlab-stage" data-role="stage2">' +
      '    <div class="hlab-title">' + escapeHtml(text.step2Title) + '</div>' +
      '    <div class="hlab-instruction">' + escapeHtml(text.step2Instruction) + '</div>' +
      '    <canvas class="hlab-canvas" data-role="math-canvas" width="420" height="200"></canvas>' +
      '    <div class="hlab-math-answer">' +
      '      <input type="number" autocomplete="off" data-role="math-answer" placeholder="' + escapeHtml(text.placeholderMath) + '">' +
      '      <button class="hlab-btn hlab-btn-primary" data-role="math-submit">' + escapeHtml(text.verifyBtn) + '</button>' +
      '    </div>' +
      '    <div class="hlab-feedback" data-role="math-feedback"></div>' +
      '    <div class="hlab-attempts" data-role="math-attempts"></div>' +
      '  </div>' +
      '  <div class="hlab-stage" data-role="stage3">' +
      '    <div class="hlab-title">' + escapeHtml(text.step3Title) + '</div>' +
      '    <div class="hlab-instruction">' + escapeHtml(text.step3Instruction) + '</div>' +
      '    <div class="hlab-shape-arena" data-role="shape-arena"><div class="hlab-drop" data-role="drop-zone">' + escapeHtml(text.placeholderDrop) + '</div></div>' +
      '    <div class="hlab-feedback" data-role="shape-feedback"></div>' +
      '    <div class="hlab-attempts" data-role="shape-attempts"></div>' +
      '  </div>' +
      '  <div class="hlab-stage" data-role="stage4">' +
      '    <div class="hlab-title">' + escapeHtml(text.step4Title) + '</div>' +
      '    <div class="hlab-instruction" data-role="pow-status"><span class="hlab-pow-spinner"></span>' + escapeHtml(text.powProgress) + '</div>' +
      '    <div class="hlab-feedback" data-role="pow-feedback"></div>' +
      '  </div>' +
      '  <div class="hlab-stage" data-role="stage-success">' +
      '    <div class="hlab-success-check">✓</div>' +
      '    <div class="hlab-title" style="color:var(--success)">' + escapeHtml(text.successTitle) + '</div>' +
      '    <div class="hlab-instruction" data-role="success-instruction">' + escapeHtml(text.successInstruction) + '</div>' +
      '  </div>' +
      '  <div class="hlab-stage" data-role="stage-failed">' +
      '    <div class="hlab-title" style="color:var(--danger)">' + escapeHtml(text.failedTitle) + '</div>' +
      '    <div class="hlab-instruction">' + escapeHtml(text.failedInstruction) + '</div>' +
      '    <button class="hlab-btn hlab-btn-primary" data-role="retry">' + escapeHtml(text.retry) + '</button>' +
      '  </div>' +
      '  <div class="hlab-timer" data-role="timer"></div>' +
      '</div>';
  }

  function mount(target, options) {
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('HLAntiRobot: target not found');

    var cfg = resolveOptions(options || {});
    injectStyles();

    root.classList.add('hlab-root');
    root.innerHTML = stageTemplate(cfg.text, cfg.brandHTML || DEFAULTS.brandHTML);

    var startTime = Date.now();
    var mouseMovements = 0;
    var clickCount = 0;
    var symbolAttempts = 0;
    var mathAttempts = 0;
    var shapeAttempts = 0;
    var currentStep = 0;
    var targetSequence = [];

    var listeners = [];
    var intervals = [];

    function q(role) {
      return root.querySelector('[data-role="' + role + '"]');
    }

    function on(el, event, handler, opts) {
      if (!el) return;
      el.addEventListener(event, handler, opts);
      listeners.push([el, event, handler, opts]);
    }

    function showStage(key) {
      var all = root.querySelectorAll('.hlab-stage');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      q(key).classList.add('active');
    }

    function setProgress(pct) {
      q('progress').style.width = pct + '%';
    }

    function setFeedback(role, msg, type) {
      var el = q(role);
      if (!el) return;
      el.textContent = msg;
      el.className = 'hlab-feedback ' + (type || '');
    }

    function updateAttempts(role, count) {
      var el = q(role);
      if (!el) return;
      var left = cfg.maxAttempts - count;
      if (left === cfg.maxAttempts) {
        el.textContent = '';
        return;
      }
      var attemptsWord = left > 1 ? cfg.text.attemptsPlural : cfg.text.attempts;
      var remainingWord = left > 1 ? cfg.text.remainingPlural : cfg.text.remaining;
      el.textContent = left + ' ' + attemptsWord + ' ' + remainingWord;
    }

    function fail() {
      setProgress(0);
      showStage('stage-failed');
      if (typeof cfg.onFail === 'function') cfg.onFail();
    }

    function resetAll() {
      symbolAttempts = 0;
      mathAttempts = 0;
      shapeAttempts = 0;
      currentStep = 0;
      goToStage(1);
    }

    function success() {
      setProgress(100);
      showStage('stage-success');

      var payload = {
        verified: true,
        ts: Date.now(),
        elapsed: Date.now() - startTime,
        mouse: mouseMovements,
        clicks: clickCount,
        nonce: crypto.getRandomValues(new Uint8Array(8)).join('')
      };

      var raw = JSON.stringify(payload);
      var sig = btoa(raw).split('').reverse().join('');
      if (cfg.persistSession) {
        sessionStorage.setItem(cfg.storageKey, btoa(JSON.stringify({ p: raw, s: sig })));
        sessionStorage.setItem(cfg.storageTsKey, Date.now().toString());
      }

      if (typeof cfg.onSuccess === 'function') cfg.onSuccess(payload);
      if (cfg.redirectUrl) {
        setTimeout(function () {
          window.location.href = cfg.redirectUrl;
        }, cfg.redirectDelay);
      }
    }

    function initSymbolChallenge() {
      var grid = q('symbol-grid');
      var targetRow = q('target-row');

      var shuffled = ICON_KEYS.slice().sort(function () { return Math.random() - 0.5; });
      var gridIcons = shuffled.slice(0, 12);
      var targetIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].sort(function () { return Math.random() - 0.5; }).slice(0, 3);
      targetSequence = targetIndices.map(function (i) { return gridIcons[i]; });

      targetRow.innerHTML = '';
      targetSequence.forEach(function (name, i) {
        var div = document.createElement('div');
        div.className = 'hlab-target-item';

        var wm = document.createElement('div');
        wm.className = 'hlab-target-watermark';
        wm.innerHTML = watermark(14);
        div.appendChild(wm);

        var main = document.createElement('div');
        main.className = 'hlab-target-main';
        main.innerHTML = svgFor(name, 30);
        div.appendChild(main);

        var badge = document.createElement('span');
        badge.className = 'hlab-target-number';
        badge.textContent = String(i + 1);
        div.appendChild(badge);

        targetRow.appendChild(div);
      });

      var display = gridIcons.slice().sort(function () { return Math.random() - 0.5; });
      grid.innerHTML = '';
      display.forEach(function (name) {
        var cell = document.createElement('div');
        cell.className = 'hlab-cell';

        var wm = document.createElement('div');
        wm.className = 'hlab-watermark';
        wm.innerHTML = watermark(36);

        var main = document.createElement('div');
        main.className = 'hlab-main-icon';
        main.innerHTML = svgFor(name, 36);

        cell.appendChild(wm);
        cell.appendChild(main);
        on(cell, 'click', function () {
          if (cell.classList.contains('correct') || cell.classList.contains('wrong')) return;
          var expected = targetSequence[currentStep];
          if (name === expected) {
            cell.classList.add('correct');
            var order = document.createElement('div');
            order.className = 'hlab-order-badge';
            order.textContent = String(currentStep + 1);
            cell.appendChild(order);
            currentStep += 1;
            if (currentStep === targetSequence.length) {
              setFeedback('symbol-feedback', cfg.text.feedbackSequenceOk, 'success');
              setTimeout(function () { goToStage(2); }, 800);
            }
          } else {
            cell.classList.add('wrong');
            symbolAttempts += 1;
            setTimeout(function () { cell.classList.remove('wrong'); }, 400);
            if (symbolAttempts >= cfg.maxAttempts) {
              fail();
              return;
            }
            var all = grid.querySelectorAll('.hlab-cell');
            for (var i = 0; i < all.length; i++) {
              all[i].classList.remove('correct');
              var b = all[i].querySelector('.hlab-order-badge');
              if (b) b.remove();
            }
            currentStep = 0;
            setFeedback('symbol-feedback', cfg.text.feedbackWrongSymbol, 'error');
            updateAttempts('symbol-attempts', symbolAttempts);
          }
        });
        grid.appendChild(cell);
      });

      currentStep = 0;
      setFeedback('symbol-feedback', '', '');
      updateAttempts('symbol-attempts', symbolAttempts);
    }

    function initMathChallenge() {
      var canvas = q('math-canvas');
      var ctx = canvas.getContext('2d');
      var W = canvas.width;
      var H = canvas.height;

      var a = Math.floor(Math.random() * 12) + 3;
      var b = Math.floor(Math.random() * 12) + 3;
      var correct = a * b;
      var realExpr = a + ' × ' + b + ' = ?';

      var decoys = [];
      var ops = ['+', '−', '÷'];
      for (var i = 0; i < 4; i++) {
        var da = Math.floor(Math.random() * 50) + 5;
        var db = Math.floor(Math.random() * 30) + 2;
        var op = ops[Math.floor(Math.random() * ops.length)];
        var result;
        if (op === '+') result = da + db;
        else if (op === '−') result = da - db;
        else result = db;
        decoys.push(da + ' ' + op + ' ' + db + ' = ' + result);
      }

      var realIdx = Math.floor(Math.random() * 5);
      var allExpr = decoys.slice();
      allExpr.splice(realIdx, 0, realExpr);

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = '#333';
      for (var x = -H; x < W + H; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + H, H);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#444';
      for (var d = 0; d < 120; d++) {
        var dx = Math.random() * W;
        var dy = Math.random() * H;
        var dr = 0.5 + Math.random() * 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      var lineH = H / 5;
      var fonts = ['16px serif', '15px monospace', '17px sans-serif', '14px Georgia', '16px Courier'];

      allExpr.forEach(function (expr, i) {
        var y = lineH * i + lineH * 0.65;
        var isReal = i === realIdx;
        var xOff = 40 + Math.floor(Math.random() * 60);

        ctx.save();
        var angle = (Math.random() - 0.5) * 0.04;
        ctx.translate(xOff, y);
        ctx.rotate(angle);
        ctx.font = fonts[i % fonts.length];
        ctx.fillStyle = isReal ? '#2c2c3e' : 'rgba(60,60,70,0.45)';
        ctx.globalAlpha = isReal ? 0.85 : 0.5;
        ctx.fillText(expr, 0, 0);
        if (!isReal) {
          var tw = ctx.measureText(expr).width;
          ctx.globalAlpha = 0.2;
          ctx.strokeStyle = '#666';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -5);
          ctx.lineTo(tw, -5);
          ctx.stroke();
        }
        ctx.restore();

        if (isReal) {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#2f6bef';
          ctx.font = '18px sans-serif';
          ctx.fillText('►', 14, y + 2);
          ctx.restore();
        }
      });

      var input = q('math-answer');
      var btn = q('math-submit');
      input.value = '';
      btn.disabled = false;
      setFeedback('math-feedback', '', '');
      updateAttempts('math-attempts', mathAttempts);
      setTimeout(function () { input.focus(); }, 100);

      var check = function () {
        var v = parseInt(input.value, 10);
        if (isNaN(v)) {
          setFeedback('math-feedback', cfg.text.feedbackEnterNumber, 'error');
          return;
        }
        if (v === correct) {
          setFeedback('math-feedback', cfg.text.feedbackMathOk, 'success');
          btn.disabled = true;
          setTimeout(function () { goToStage(3); }, 800);
        } else {
          mathAttempts += 1;
          if (mathAttempts >= cfg.maxAttempts) {
            fail();
            return;
          }
          setFeedback('math-feedback', cfg.text.feedbackMathWrong, 'error');
          input.value = '';
          input.focus();
          updateAttempts('math-attempts', mathAttempts);
        }
      };

      btn.onclick = check;
      input.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    }

    function initShapeChallenge() {
      var arena = q('shape-arena');
      var dropZone = q('drop-zone');

      var oldShapes = arena.querySelectorAll('.hlab-shape-item');
      for (var i = 0; i < oldShapes.length; i++) oldShapes[i].remove();

      setFeedback('shape-feedback', '', '');
      updateAttempts('shape-attempts', shapeAttempts);

      var shapes = [];
      var oddIdx = Math.floor(Math.random() * 8);

      for (var n = 0; n < 8; n++) {
        var el = document.createElement('div');
        el.className = 'hlab-shape-item disabled';
        el.style.animationDelay = (n * 0.12) + 's';
        el.dataset.odd = n === oddIdx ? '1' : '0';

        var col = n % 4;
        var row = Math.floor(n / 4);
        var baseX = 20 + col * 90 + Math.floor(Math.random() * 15);
        var baseY = 10 + row * 72 + Math.floor(Math.random() * 10);
        el.style.left = baseX + 'px';
        el.style.top = baseY + 'px';

        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '48');
        svg.setAttribute('height', '48');
        svg.setAttribute('viewBox', '0 0 48 48');

        if (n === oddIdx) {
          var path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', 'M24 4 C32 3, 42 10, 44 20 C46 30, 38 43, 28 44 C18 45, 6 38, 4 28 C2 18, 10 5, 24 4 Z');
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', '#2c2c3e');
          path.setAttribute('stroke-width', '2');
          path.setAttribute('opacity', '0.65');
          svg.appendChild(path);
        } else {
          var circle = document.createElementNS(svgNS, 'circle');
          var r = 17 + Math.random() * 2.5;
          circle.setAttribute('cx', '24');
          circle.setAttribute('cy', '24');
          circle.setAttribute('r', r.toFixed(1));
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke', '#2c2c3e');
          circle.setAttribute('stroke-width', '2');
          circle.setAttribute('opacity', '0.65');
          svg.appendChild(circle);
        }

        el.appendChild(svg);
        arena.appendChild(el);
        shapes.push(el);
      }

      setTimeout(function () {
        shapes.forEach(function (shape) {
          shape.classList.remove('disabled');
          shape.classList.add('active');
        });
      }, 2000);

      var dragging = null;
      var dragOffX = 0;
      var dragOffY = 0;
      var origX = 0;
      var origY = 0;

      function startDrag(e, el) {
        if (el.classList.contains('disabled')) return;
        e.preventDefault();
        dragging = el;
        var rect = el.getBoundingClientRect();
        var arenaRect = arena.getBoundingClientRect();
        origX = rect.left - arenaRect.left;
        origY = rect.top - arenaRect.top;
        var pt = e.touches ? e.touches[0] : e;
        dragOffX = pt.clientX - rect.left;
        dragOffY = pt.clientY - rect.top;
        el.style.zIndex = '100';
        el.style.animation = 'none';
      }

      function moveDrag(e) {
        if (!dragging) return;
        e.preventDefault();
        var pt = e.touches ? e.touches[0] : e;
        var arenaRect = arena.getBoundingClientRect();
        dragging.style.left = (pt.clientX - arenaRect.left - dragOffX) + 'px';
        dragging.style.top = (pt.clientY - arenaRect.top - dragOffY) + 'px';

        var dzRect = dropZone.getBoundingClientRect();
        var cx = pt.clientX;
        var cy = pt.clientY;
        var tolerance = 30;
        var inZone = cx > dzRect.left - tolerance && cx < dzRect.right + tolerance && cy > dzRect.top - tolerance && cy < dzRect.bottom + tolerance;
        dropZone.classList.toggle('hover', inZone);
      }

      function endDrag() {
        if (!dragging) return;
        var el = dragging;
        dragging = null;
        el.style.zIndex = '';

        var dzRect = dropZone.getBoundingClientRect();
        var elRect = el.getBoundingClientRect();
        var cx = elRect.left + elRect.width / 2;
        var cy = elRect.top + elRect.height / 2;
        var tolerance = 30;
        var inZone = cx > dzRect.left - tolerance && cx < dzRect.right + tolerance && cy > dzRect.top - tolerance && cy < dzRect.bottom + tolerance;

        dropZone.classList.remove('hover');

        if (inZone) {
          if (el.dataset.odd === '1') {
            el.classList.add('correct-drop');
            setFeedback('shape-feedback', cfg.text.feedbackShapeOk, 'success');
            setTimeout(function () { goToStage(4); }, 1000);
          } else {
            shapeAttempts += 1;
            if (shapeAttempts >= cfg.maxAttempts) {
              fail();
              return;
            }
            setFeedback('shape-feedback', cfg.text.feedbackShapeWrong, 'error');
            updateAttempts('shape-attempts', shapeAttempts);
            el.style.left = origX + 'px';
            el.style.top = origY + 'px';
            el.style.animation = '';
            el.classList.add('active');
          }
        } else {
          el.style.left = origX + 'px';
          el.style.top = origY + 'px';
          el.style.animation = '';
          el.classList.add('active');
        }
      }

      shapes.forEach(function (shape) {
        on(shape, 'mousedown', function (e) { startDrag(e, shape); });
        on(shape, 'touchstart', function (e) { startDrag(e, shape); }, { passive: false });
      });
      on(arena, 'mousemove', moveDrag);
      on(arena, 'touchmove', moveDrag, { passive: false });
      on(arena, 'mouseup', endDrag);
      on(arena, 'mouseleave', endDrag);
      on(arena, 'touchend', endDrag);
      on(arena, 'touchcancel', endDrag);
    }

    function runProofOfWork() {
      var challenge = crypto.getRandomValues(new Uint8Array(16));
      var challengeHex = Array.from(challenge).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      var nonce = 0;
      var powStatus = q('pow-status');

      return new Promise(function (resolve) {
        var tick = async function () {
          for (var i = 0; i < 5000; i++) {
            var data = new TextEncoder().encode(challengeHex + nonce);
            var hashBuffer = await crypto.subtle.digest('SHA-256', data);
            var hex = Array.from(new Uint8Array(hashBuffer)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            if (hex.indexOf('0000') === 0) {
              resolve({ nonce: nonce, hash: hex });
              return;
            }
            nonce += 1;
          }
          powStatus.innerHTML = '<span class="hlab-pow-spinner"></span>' + escapeHtml(cfg.text.powProgress) + ' (' + nonce.toLocaleString() + ')';
          requestAnimationFrame(tick);
        };
        tick();
      });
    }

    function goToStage(stage) {
      if (stage === 1) {
        setProgress(0);
        showStage('stage1');
        initSymbolChallenge();
      } else if (stage === 2) {
        setProgress(25);
        showStage('stage2');
        initMathChallenge();
      } else if (stage === 3) {
        setProgress(50);
        showStage('stage3');
        initShapeChallenge();
      } else if (stage === 4) {
        setProgress(75);
        showStage('stage4');
        runProofOfWork().then(function () {
          if ((Date.now() - startTime) < 3000 || mouseMovements < 5) {
            fail();
            return;
          }
          setTimeout(function () { success(); }, 1000);
        });
      }
    }

    on(document, 'mousemove', function () { mouseMovements += 1; });
    on(document, 'click', function () { clickCount += 1; });

    var retry = q('retry');
    if (retry) on(retry, 'click', resetAll);

    intervals.push(setInterval(function () {
      var timer = q('timer');
      if (timer) timer.textContent = cfg.text.timerPrefix + Math.floor((Date.now() - startTime) / 1000) + 's';
    }, 1000));

    goToStage(1);

    return {
      destroy: function () {
        listeners.forEach(function (entry) {
          entry[0].removeEventListener(entry[1], entry[2], entry[3]);
        });
        intervals.forEach(clearInterval);
        root.innerHTML = '';
        root.classList.remove('hlab-root');
      }
    };
  }

  function getSessionConfig(options) {
    var cfg = options || {};
    return {
      storageKey: cfg.storageKey || DEFAULTS.storageKey,
      storageTsKey: cfg.storageTsKey || DEFAULTS.storageTsKey,
      maxAgeMs: typeof cfg.maxAgeMs === 'number' ? cfg.maxAgeMs : DEFAULTS.maxAgeMs
    };
  }

  function clearVerification(options) {
    var cfg = getSessionConfig(options);
    sessionStorage.removeItem(cfg.storageKey);
    sessionStorage.removeItem(cfg.storageTsKey);
  }

  function isVerified(options) {
    var cfg = getSessionConfig(options);
    var token = sessionStorage.getItem(cfg.storageKey);
    var ts = parseInt(sessionStorage.getItem(cfg.storageTsKey) || '0', 10);

    if (!token || !ts || (Date.now() - ts) > cfg.maxAgeMs) return false;

    try {
      var decoded = JSON.parse(atob(token));
      var raw = decoded && decoded.p ? decoded.p : '';
      var sig = decoded && decoded.s ? decoded.s : '';
      if (!raw || !sig) return false;
      var expected = btoa(raw).split('').reverse().join('');
      if (sig !== expected) return false;
      var payload = JSON.parse(raw);
      return !!(payload && payload.verified);
    } catch (_e) {
      return false;
    }
  }

  function requireVerified(options) {
    var cfg = options || {};
    if (isVerified(cfg)) return true;
    clearVerification(cfg);
    if (cfg.redirectUrl) {
      window.location.replace(cfg.redirectUrl);
    }
    return false;
  }

  global.HLAntiRobot = {
    mount: mount,
    isVerified: isVerified,
    requireVerified: requireVerified,
    clearVerification: clearVerification,
    version: '1.1.0'
  };
})(window);
