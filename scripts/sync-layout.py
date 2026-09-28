#!/usr/bin/env python3
"""Synchronise l'en-tête, le pied de page et le <head> commun des pages publiques.

Chaque page contient des marqueurs :
    <!-- layout:head -->   ... <!-- /layout:head -->
    <!-- layout:header --> ... <!-- /layout:header -->
    <!-- layout:footer --> ... <!-- /layout:footer -->
Le script régénère le contenu entre ces marqueurs. Au premier passage, il
migre aussi les anciennes pages (ancienne navigation, décors, styles inline).

Usage : python3 scripts/sync-layout.py   (depuis la racine du dépôt ; agit sur public/)
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'

# page FR -> (page EN, clé de navigation)
PAIRS = {
    'index.html': ('index-en.html', 'home'),
    'apply.html': ('apply-en.html', 'apply'),
    'faq.html': ('faq-en.html', 'faq'),
    'faq-annexe.html': ('faq-annexe-en.html', 'faq'),
    'faq-decideurs.html': ('faq-decideurs-en.html', 'faq'),
    'faq-developpeurs.html': ('faq-developpeurs-en.html', 'faq'),
    'faq-ethique.html': ('faq-ethique-en.html', 'faq'),
    'faq-investisseurs.html': ('faq-investisseurs-en.html', 'faq'),
    'faq-regulateurs.html': ('faq-regulateurs-en.html', 'faq'),
    'faq-risque.html': ('faq-risque-en.html', 'faq'),
    'contact.html': ('contact-en.html', 'contact'),
    'privacy.html': ('privacy-en.html', 'privacy'),
    'terms.html': ('terms-en.html', 'terms'),
    'security.html': ('security-en.html', 'security'),
}

PAGES = {}
for fr, (en, key) in PAIRS.items():
    PAGES[fr] = {'lang': 'fr', 'key': key, 'fr': fr, 'en': en}
    PAGES[en] = {'lang': 'en', 'key': key, 'fr': fr, 'en': en}

T = {
    'fr': {
        'home': 'index.html', 'apply': 'apply.html', 'faq': 'faq.html',
        'start': '/client/inscription.html', 'docs': 'developers/',
        'skip': 'Aller au contenu', 'home_label': 'HumanLayer, accueil',
        'main_nav': 'Navigation principale', 'mobile_nav': 'Navigation mobile', 'lang': 'Langue',
        'open': 'Ouvrir le menu', 'login': 'Espace client', 'cta': 'Commencer', 'cta_long': 'Commencer maintenant',
        'nav': [('problem', 'Problème', '01'), ('arbitrium', 'Arbitrium', '02'), ('solution', 'Solution', '03'),
                ('usecases', 'Cas d’usage', '05'), ('api', 'API', '06'), ('pricing', 'Tarifs', '08')],
        'apply_label': 'Devenir Sentinel',
        'tagline': 'La couche d’autorité décisionnelle pour agents IA.',
        'address': '1250, avenue de la Station, Shawinigan (Québec) G9N&nbsp;8K9',
        'footer_nav': 'Pied de page',
        'cols': [
            ('Produit', [('#arbitrium', 'Arbitrium'), ('#solution', 'Solution'), ('#usecases', 'Cas d’usage'), ('#pricing', 'Tarifs')]),
            ('Développeurs', [('developers/', 'Documentation API'), ('faq-developpeurs.html', 'FAQ développeurs'), ('/client/', 'Espace client')]),
            ('Réseau', [('apply.html', 'Devenir Sentinel'), ('/sentinel/', 'Portail Sentinel'), ('faq-decideurs.html', 'FAQ Sentinels')]),
            ('Entreprise', [('faq.html', 'FAQ'), ('security.html', 'Sécurité'), ('privacy.html', 'Confidentialité'), ('terms.html', 'Conditions'), ('contact.html', 'Contact')]),
        ],
        'rights': '© 2026 HumanLayer Systems Inc. Tous droits réservés.',
        'made': 'Conçu au Québec', 'other': 'English version', 'powered': 'Propulsé par',
    },
    'en': {
        'home': 'index-en.html', 'apply': 'apply-en.html', 'faq': 'faq-en.html',
        'start': '/client/registration.html', 'docs': 'developers/index-en.html',
        'skip': 'Skip to content', 'home_label': 'HumanLayer, home',
        'main_nav': 'Main navigation', 'mobile_nav': 'Mobile navigation', 'lang': 'Language',
        'open': 'Open menu', 'login': 'Client portal', 'cta': 'Get started', 'cta_long': 'Get started now',
        'nav': [('problem', 'Problem', '01'), ('arbitrium', 'Arbitrium', '02'), ('solution', 'Solution', '03'),
                ('usecases', 'Use cases', '05'), ('api', 'API', '06'), ('pricing', 'Pricing', '08')],
        'apply_label': 'Become a Sentinel',
        'tagline': 'The decision authority layer for AI agents.',
        'address': '1250, avenue de la Station, Shawinigan, Quebec G9N&nbsp;8K9, Canada',
        'footer_nav': 'Footer',
        'cols': [
            ('Product', [('#arbitrium', 'Arbitrium'), ('#solution', 'Solution'), ('#usecases', 'Use cases'), ('#pricing', 'Pricing')]),
            ('Developers', [('developers/index-en.html', 'API documentation'), ('faq-developpeurs-en.html', 'Developer FAQ'), ('/client/', 'Client portal')]),
            ('Network', [('apply-en.html', 'Become a Sentinel'), ('/sentinel/', 'Sentinel portal'), ('faq-decideurs-en.html', 'Sentinel FAQ')]),
            ('Company', [('faq-en.html', 'FAQ'), ('security-en.html', 'Security'), ('privacy-en.html', 'Privacy'), ('terms-en.html', 'Terms'), ('contact-en.html', 'Contact')]),
        ],
        'rights': '© 2026 HumanLayer Systems Inc. All rights reserved.',
        'made': 'Designed in Quebec', 'other': 'Version française', 'powered': 'Powered by',
    },
}

HEAD = """  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
    rel="stylesheet">
  <link rel="icon" href="favicon.ico" type="image/x-icon">
  <link rel="apple-touch-icon" href="logo-mark.png">
  <link rel="stylesheet" href="styles.css">
  <meta name="theme-color" content="#04060b">
  <script>
    document.documentElement.classList.add('js');
    setTimeout(function () { if (!window.__hlReady) document.documentElement.classList.remove('js'); }, 2500);
  </script>"""


def lang_switch(info, t):
    fr_cur = ' aria-current="true"' if info['lang'] == 'fr' else ' hreflang="fr"'
    en_cur = ' aria-current="true"' if info['lang'] == 'en' else ' hreflang="en"'
    return (f'<div class="lang-switch" aria-label="{t["lang"]}">\n'
            f'          <a href="{info["fr"]}" lang="fr"{fr_cur}>FR</a>\n'
            f'          <a href="{info["en"]}" lang="en"{en_cur}>EN</a>\n'
            f'        </div>')


def header(page, info):
    t = T[info['lang']]
    home = info['key'] == 'home'
    base = '' if home else t['home']
    links, mobile = [], []
    for i, (anchor, label, num) in enumerate(t['nav']):
        links.append(f'        <a href="{base}#{anchor}">{label}</a>')
        mobile.append(f'        <a href="{base}#{anchor}" style="--i:{i}">{label} <small>{num}</small></a>')
    cur_apply = ' aria-current="page"' if info['key'] == 'apply' else ''
    cur_faq = ' aria-current="page"' if info['key'] == 'faq' else ''
    links.append(f'        <a href="{t["apply"]}"{cur_apply}>{t["apply_label"]}</a>')
    links.append(f'        <a href="{t["faq"]}"{cur_faq}>FAQ</a>')
    n = len(t['nav'])
    mobile.append(f'        <a href="{t["apply"]}" style="--i:{n}">{t["apply_label"]} <small>→</small></a>')
    mobile.append(f'        <a href="{t["faq"]}" style="--i:{n + 1}">FAQ <small>→</small></a>')
    mobile.append(f'        <a href="/client/" style="--i:{n + 2}">{t["login"]} <small>→</small></a>')
    switch = lang_switch(info, t)
    return f"""  <a class="skip-link" href="#main">{t['skip']}</a>
  <div class="scroll-progress" aria-hidden="true"></div>

  <header class="site-header" id="nav">
    <div class="container nav-inner">
      <a href="{t['home']}" class="brand" aria-label="{t['home_label']}">
        <img src="logo-mark.png" width="30" height="30" alt="">
        <span class="brand-name">Human<span>Layer</span></span>
      </a>
      <nav class="nav-links" aria-label="{t['main_nav']}">
{chr(10).join(links)}
      </nav>
      <div class="nav-actions">
        {switch}
        <a href="/client/" class="nav-login">{t['login']}</a>
        <a href="{t['start']}" class="btn btn-primary btn-sm" data-magnetic>{t['cta']}</a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu"
          aria-label="{t['open']}"><span></span><span></span></button>
      </div>
    </div>
    <div class="mobile-menu" id="mobile-menu" hidden>
      <nav aria-label="{t['mobile_nav']}">
{chr(10).join(mobile)}
      </nav>
      <div class="mobile-menu-foot">
        {switch}
        <a href="{t['start']}" class="btn btn-primary btn-lg">{t['cta_long']}</a>
      </div>
    </div>
  </header>"""


def footer(page, info):
    t = T[info['lang']]
    home = info['key'] == 'home'
    base = '' if home else t['home']
    cols = []
    for title, items in t['cols']:
        lis = []
        for href, label in items:
            if href.startswith('#'):
                href = base + href
            lis.append(f'              <li><a href="{href}">{label}</a></li>')
        cols.append(f"""          <div class="footer-col">
            <h2>{title}</h2>
            <ul>
{chr(10).join(lis)}
            </ul>
          </div>""")
    other_lang = 'en' if info['lang'] == 'fr' else 'fr'
    other_page = info[other_lang]
    return f"""  <footer class="site-footer">
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand">
          <a href="{t['home']}" class="brand" aria-label="{t['home_label']}">
            <img src="logo-mark.png" width="30" height="30" alt="">
            <span class="brand-name">Human<span>Layer</span></span>
          </a>
          <p>{t['tagline']}</p>
          <address>
            HumanLayer Systems Inc.<br>
            {t['address']}<br>
            <a href="mailto:humanlayer@probalink.com">humanlayer@probalink.com</a>
          </address>
        </div>
        <nav class="footer-cols" aria-label="{t['footer_nav']}">
{chr(10).join(cols)}
        </nav>
      </div>
      <div class="footer-wordmark" aria-hidden="true">HumanLayer</div>
    </div>
    <div class="footer-bottom">
      <div class="container footer-bottom-inner">
        <span>{t['rights']}</span>
        <span>{t['made']} · <a href="{other_page}" lang="{other_lang}" hreflang="{other_lang}">{t['other']}</a></span>
        <span class="footer-credit">{t['powered']} <a href="https://in6.ai" target="_blank" rel="noopener">in6.ai</a></span>
      </div>
    </div>
  </footer>"""


def replace_block(html, name, content):
    pattern = re.compile(rf'<!-- layout:{name} -->.*?<!-- /layout:{name} -->', re.S)
    block = f'<!-- layout:{name} -->\n{content}\n<!-- /layout:{name} -->'
    if not pattern.search(html):
        raise ValueError(f'marqueur layout:{name} absent')
    return pattern.sub(lambda _m: block, html, count=1)


def migrate(html, page):
    """Premier passage : remplace l'ancienne structure par des marqueurs."""
    # <head> : anciennes polices, feuilles, icône, styles inline
    head_end = html.index('</head>')
    head, rest = html[:head_end], html[head_end:]
    if '<!-- layout:head -->' not in head:
        head = re.sub(r'\s*<!--\s*(Fonts|Styles|SEO Meta Tags|Hreflang[^>]*|Open Graph[^>]*|Twitter)\s*-->', '', head)
        head = re.sub(r'\s*<link rel="preconnect"[^>]*>', '', head)
        head = re.sub(r'\s*<link\s+href="https://fonts\.googleapis\.com/css2[^"]*"\s+rel="stylesheet">', '', head)
        head = re.sub(r'\s*<link rel="(icon|apple-touch-icon)"[^>]*>', '', head)
        head = re.sub(r'\s*<link rel="stylesheet" href="(styles|icons)\.css">', '', head)
        head = re.sub(r'\s*<meta name="theme-color"[^>]*>', '', head)
        head = re.sub(r'\s*<style>.*?</style>', '', head, flags=re.S)
        head = re.sub(r"\s*<script>\s*document\.documentElement\.classList\.add\('js'\);.*?</script>", '', head, flags=re.S)
        head = head.rstrip() + '\n<!-- layout:head -->\n<!-- /layout:head -->\n'
    html = head + rest

    if '<!-- layout:header -->' not in html:
        html = html.replace('<?xml version="1.0" encoding="UTF-8"?>', '')
        html = re.sub(r'\s*<!--\s*(Background Animation|Navigation|Footer|JavaScript)\s*-->', '', html)
        html = re.sub(r'\s*<div class="(bg-animation|grid-overlay|cursor-glow)"></div>', '', html)
        html = re.sub(r'\s*<div class="scroll-progress" id="scroll-progress"></div>', '', html)
        # Page d'accueil déjà migrée à la main : on encadre simplement l'existant
        if '<header class="site-header"' in html:
            html = re.sub(r'  <a class="skip-link".*?</header>', '<!-- layout:header -->\n<!-- /layout:header -->', html, count=1, flags=re.S)
        else:
            html = re.sub(r'<nav class="nav" id="nav">.*?</nav>',
                          '\n<!-- layout:header -->\n<!-- /layout:header -->\n\n  <main id="main">', html, count=1, flags=re.S)
            html = re.sub(r'\s*<footer class="footer[^"]*">.*?</footer>',
                          '\n  </main>\n\n<!-- layout:footer -->\n<!-- /layout:footer -->', html, count=1, flags=re.S)
    if '<!-- layout:footer -->' not in html:
        html = re.sub(r'  <footer class="site-footer">.*?</footer>', '<!-- layout:footer -->\n<!-- /layout:footer -->', html, count=1, flags=re.S)

    html = html.replace('<script src="script.js"></script>', '<script src="script.js" defer></script>')
    # Annexe : un seul h1 par page
    html = re.sub(r'(<div class="legal-title">\s*)<h1>(.*?)</h1>', r'\1<h2>\2</h2>', html, flags=re.S)
    return html


def main():
    changed = []
    for page, info in PAGES.items():
        path = ROOT / page
        if not path.exists():
            print(f'  absent : {page}', file=sys.stderr)
            continue
        original = path.read_text(encoding='utf-8')
        html = migrate(original, page)
        if '<!-- layout:head -->' in html:
            html = replace_block(html, 'head', HEAD)
        html = replace_block(html, 'header', header(page, info))
        html = replace_block(html, 'footer', footer(page, info))
        if html != original:
            path.write_text(html, encoding='utf-8')
            changed.append(page)
    print(f'{len(changed)} page(s) mise(s) à jour : {", ".join(changed) if changed else "aucune"}')


if __name__ == '__main__':
    main()
