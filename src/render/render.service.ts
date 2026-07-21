import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AppConfig } from '../config/app.config';

type Settings = Record<string, string>;
type I18n = Record<string, any>;

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = esc;
const PLACEHOLDER_IMG = '/assets/img/part-placeholder.svg';

/**
 * Server-side rendering of the public client site (continental_client).
 * Every page ships as complete HTML so search engines index real content
 * (products, categories, business info) in all three languages.
 */
@Injectable()
export class RenderService {
  private readonly i18n: Record<string, I18n> = {};
  private readonly assetVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly config: AppConfig,
  ) {
    for (const lang of config.langs) {
      this.i18n[lang] = JSON.parse(
        fs.readFileSync(path.join(config.clientDir, 'i18n', `${lang}.json`), 'utf8'),
      );
    }
    // Cache-busting: asset URLs carry a version derived from file mtimes so
    // browsers and the service worker pick up new CSS/JS automatically.
    try {
      const files = [
        path.join(config.clientDir, 'public', 'css', 'client.css'),
        path.join(config.clientDir, 'public', 'js', 'client.js'),
      ];
      this.assetVersion = Math.round(Math.max(...files.map((f) => fs.statSync(f).mtimeMs))).toString(36);
    } catch {
      this.assetVersion = '1';
    }
  }

  private asset(p: string): string {
    return `${p}?v=${this.assetVersion}`;
  }

  pickLang(acceptLanguage = ''): string {
    for (const part of String(acceptLanguage).toLowerCase().split(',')) {
      const code = part.split(';')[0].trim().slice(0, 2);
      if ((this.config.langs as readonly string[]).includes(code)) return code;
    }
    return this.config.defaultLang;
  }

  // Category display names now come from the DB (Admin > Categories can add
  // more), not only the static i18n file — this is the merge point: the DB
  // translation wins, falling back to English, then the raw key.
  private async loadCategoryMap(): Promise<Record<string, { en: string; fr: string; zh: string }>> {
    const rows = await this.prisma.category.findMany();
    const map: Record<string, { en: string; fr: string; zh: string }> = {};
    for (const r of rows) map[r.key] = { en: r.nameEn, fr: r.nameFr || r.nameEn, zh: r.nameZh || r.nameEn };
    return map;
  }

  private catName(catMap: Record<string, { en: string; fr: string; zh: string }>, key: string, lang: string): string {
    const entry = catMap[key];
    if (!entry) return key;
    return entry[lang as 'en' | 'fr' | 'zh'] || entry.en || key;
  }

  private localizedName(p: Product, lang: string): string {
    return ({ en: p.nameEn, fr: p.nameFr, zh: p.nameZh }[lang] || p.nameEn) as string;
  }

  private localizedDesc(p: Product, lang: string): string {
    return ({ en: p.descEn, fr: p.descFr, zh: p.descZh }[lang] || p.descEn) as string;
  }

  private waLink(settings: Settings, text: string): string {
    const num = String(settings.whatsapp || settings.phone || '').replace(/[^\d]/g, '');
    return num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '#contact';
  }

  // ---------- shared page head ----------
  private head(opts: {
    lang: string; title: string; description: string; canonicalPath: string;
    ogImage?: string; jsonLd: unknown; altPaths: Record<string, string>;
  }): string {
    const { lang, title, description, canonicalPath, ogImage, jsonLd, altPaths } = opts;
    const t = this.i18n[lang];
    const url = (p: string) => `${this.config.siteUrl}${p}`;
    const alternates = this.config.langs
      .map((l) => `<link rel="alternate" hreflang="${l}" href="${url(altPaths[l])}">`)
      .join('\n  ');
    const ogLocales = this.config.langs
      .filter((l) => l !== lang)
      .map((l) => `<meta property="og:locale:alternate" content="${this.i18n[l].locale}">`)
      .join('\n  ');
    return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}">
  <meta name="keywords" content="${attr(t.meta.keywords)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url(canonicalPath)}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${url(altPaths[this.config.defaultLang])}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(this.config.business.name)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${url(canonicalPath)}">
  <meta property="og:image" content="${url(ogImage || '/assets/img/og-banner.png')}">
  <meta property="og:locale" content="${t.locale}">
  ${ogLocales}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${attr(title)}">
  <meta name="twitter:description" content="${attr(description)}">
  <meta name="twitter:image" content="${url(ogImage || '/assets/img/og-banner.png')}">
  <meta name="theme-color" content="#0e1726">
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/icons/icon-192.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="${this.asset('/assets/css/client.css')}">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
  }

  private storeJsonLd(settings: Settings) {
    const b = this.config.business;
    return {
      '@context': 'https://schema.org',
      '@type': 'AutoPartsStore',
      name: b.name,
      url: this.config.siteUrl,
      image: `${this.config.siteUrl}/assets/icons/icon-512.png`,
      telephone: settings.phone,
      email: settings.email,
      address: {
        '@type': 'PostalAddress',
        streetAddress: settings.address,
        addressLocality: b.city,
        addressRegion: b.region,
        addressCountry: b.countryCode,
      },
      geo: { '@type': 'GeoCoordinates', latitude: b.latitude, longitude: b.longitude },
      openingHours: settings.hours,
      ...(settings.facebook ? { sameAs: [settings.facebook] } : {}),
    };
  }

  // ---------- components ----------
  private langSwitcher(lang: string, pathFor: (l: string) => string): string {
    const labels: Record<string, string> = { en: 'EN', fr: 'FR', zh: '中文' };
    return `<nav class="lang-switch" aria-label="Language">
    ${this.config.langs.map((l) => l === lang
      ? `<span class="lang-current" aria-current="true">${labels[l]}</span>`
      : `<a href="${attr(pathFor(l))}" hreflang="${l}" rel="alternate">${labels[l]}</a>`).join('')}
  </nav>`;
  }

  private header(lang: string, t: I18n, pathFor: (l: string) => string, settings: Settings): string {
    const wa = this.waLink(settings, 'Hello Continental Auto Parts!');
    const tel = `tel:${String(settings.phone || '').replace(/\s/g, '')}`;
    return `<header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/${lang}">
        <img src="/assets/icons/favicon.svg" alt="" width="34" height="34">
        <span><strong>Continental</strong> Auto Parts</span>
      </a>
      <nav class="main-nav" id="main-nav" aria-label="Main">
        <a href="/${lang}#catalog">${esc(t.nav.catalog)}</a>
        <a href="/${lang}#about">${esc(t.nav.about)}</a>
        <a href="/${lang}#faq">FAQ</a>
        <a href="/${lang}#contact">${esc(t.nav.contact)}</a>
      </nav>
      <div class="header-cta">
        <a class="icon-btn" href="${attr(tel)}" aria-label="${attr(t.quick.call)}" title="${attr(t.quick.call)}">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>
        </a>
        <a class="icon-btn icon-wa" href="${attr(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.1 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.5-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 .9c.3.1.5.2.6.4 0 .1 0 .7-.2 1.2z"/></svg>
        </a>
      </div>
      ${this.langSwitcher(lang, pathFor)}
      <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="${attr(t.misc.menu)}">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>`;
  }

  private waFloat(t: I18n, settings: Settings): string {
    const wa = this.waLink(settings, 'Hello Continental Auto Parts!');
    return `<a class="wa-float" href="${attr(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.1 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.5-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 .9c.3.1.5.2.6.4 0 .1 0 .7-.2 1.2z"/></svg>
  </a>
  <button id="back-top" class="back-top" hidden aria-label="${attr(t.misc.backToTop)}">↑</button>`;
  }

  private productCard(p: Product, lang: string, t: I18n, settings: Settings, catMap: Record<string, { en: string; fr: string; zh: string }>): string {
    const name = this.localizedName(p, lang);
    const img = p.image || PLACEHOLDER_IMG;
    const stockCls = p.quantity > 0 ? 'in' : 'out';
    const stockTxt = p.quantity > 0 ? t.catalog.inStock : t.catalog.outOfStock;
    const inquire = this.waLink(settings, `${t.catalog.inquire}: ${name} — ${this.config.siteUrl}/${lang}/product/${p.slug}`);
    return `<article class="card" data-category="${attr(p.category)}" data-name="${attr(name.toLowerCase())}" data-brand="${attr((p.brand || '').toLowerCase())}">
    <a class="card-media" href="/${lang}/product/${attr(p.slug)}">
      <img src="${attr(img)}" alt="${attr(name)}" loading="lazy" width="400" height="300">
    </a>
    <div class="card-body">
      <span class="chip chip-cat">${esc(this.catName(catMap, p.category, lang))}</span>
      <h3><a href="/${lang}/product/${attr(p.slug)}">${esc(name)}</a></h3>
      ${p.brand ? `<p class="card-brand">${esc(p.brand)}</p>` : ''}
      <div class="card-foot">
        <span class="stock stock-${stockCls}">${esc(stockTxt)}</span>
        <a class="btn btn-sm" href="${attr(inquire)}" target="_blank" rel="noopener">${esc(t.catalog.inquire)}</a>
      </div>
    </div>
  </article>`;
  }

  private contactSection(t: I18n, settings: Settings): string {
    const wa = this.waLink(settings, 'Hello Continental Auto Parts!');
    const { latitude, longitude } = this.config.business;
    // "Get Directions" opens Google Maps (what most visitors have installed);
    // the embedded frame itself uses OpenStreetMap instead — Google's own
    // keyless embed URL sends X-Frame-Options: SAMEORIGIN and simply refuses
    // to render in anyone else's iframe, while the official Google embed API
    // requires a billed API key we don't have. OSM's embed needs neither.
    const directions = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    const offset = 0.008;
    const bbox = [longitude - offset, latitude - offset, longitude + offset, latitude + offset].join(',');
    const mapEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
    const rows: Array<[string, string, string | null]> = [
      ['phone', settings.phone, `tel:${String(settings.phone).replace(/\s/g, '')}`],
      ['whatsapp', settings.whatsapp, wa],
      ['email', settings.email, `mailto:${settings.email}`],
      ['address', settings.address, null],
      ['hours', settings.hours, null],
    ];
    return `<section id="contact" class="section section-contact">
    <div class="container">
      <h2>${esc(t.contact.title)}</h2>
      <p class="section-sub">${esc(t.contact.subtitle)}</p>
      <div class="contact-layout">
        <div class="contact-grid">
          ${rows.map(([key, value, href]) => `<div class="contact-item">
            <span class="contact-label">${esc(t.contact[key])}</span>
            ${href ? `<a href="${attr(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(value)}</a>` : `<span>${esc(value)}</span>`}
          </div>`).join('')}
        </div>
        <div class="contact-map">
          <iframe src="${attr(mapEmbed)}" width="100%" height="320" style="border:0" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" title="${attr(this.config.business.name)} — ${attr(this.config.business.city)} location map"></iframe>
          <a class="btn btn-map" href="${attr(directions)}" target="_blank" rel="noopener">📍 ${esc(t.contact.directionsCta)}</a>
        </div>
      </div>
      <a class="btn btn-whatsapp" href="${attr(wa)}" target="_blank" rel="noopener">${esc(t.contact.whatsappCta)}</a>
    </div>
  </section>`;
  }

  private footer(lang: string, t: I18n, settings: Settings, categories: string[], catMap: Record<string, { en: string; fr: string; zh: string }>): string {
    const labels: Record<string, string> = { en: 'English', fr: 'Français', zh: '中文' };
    return `<footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-col footer-brand-col">
        <a class="brand brand-light" href="/${lang}">
          <img src="/assets/icons/favicon.svg" alt="" width="30" height="30">
          <span><strong>Continental</strong> Auto Parts</span>
        </a>
        <p>${esc(t.footer.tagline)}</p>
        <div class="footer-langs">
          ${this.config.langs.map((l) => `<a href="/${l}" hreflang="${l}" ${l === lang ? 'aria-current="true"' : ''}>${labels[l]}</a>`).join('')}
        </div>
      </div>
      <div class="footer-col">
        <h3>${esc(t.footer.quickLinks)}</h3>
        <ul>
          <li><a href="/${lang}#catalog">${esc(t.nav.catalog)}</a></li>
          <li><a href="/${lang}#about">${esc(t.nav.about)}</a></li>
          <li><a href="/${lang}#faq">FAQ</a></li>
          <li><a href="/${lang}#contact">${esc(t.nav.contact)}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h3>${esc(t.footer.categoriesTitle)}</h3>
        <ul>
          ${categories.slice(0, 6).map((c) => `<li><a href="/${lang}?category=${encodeURIComponent(c)}#catalog">${esc(this.catName(catMap, c, lang))}</a></li>`).join('')}
        </ul>
      </div>
      <div class="footer-col">
        <h3>${esc(t.footer.contactTitle)}</h3>
        <ul class="footer-contact">
          <li><a href="tel:${attr(String(settings.phone || '').replace(/\s/g, ''))}">${esc(settings.phone)}</a></li>
          <li><a href="mailto:${attr(settings.email)}">${esc(settings.email)}</a></li>
          <li>${esc(settings.address)}</li>
          <li>${esc(settings.hours)}</li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="container">© ${new Date().getFullYear()} ${esc(this.config.business.legalName)}. ${esc(t.footer.rights)}</div>
    </div>
  </footer>`;
  }

  private pageShell(lang: string, t: I18n, headHtml: string, bodyHtml: string): string {
    return `<!doctype html>
<html lang="${lang}">
<head>
  ${headHtml}
</head>
<body data-lang="${lang}">
<a class="skip-link" href="#main">${esc(t.misc.skip)}</a>
${bodyHtml}
<script src="/socket.io/socket.io.js" defer></script>
<script src="${this.asset('/assets/js/client.js')}" defer></script>
</body>
</html>`;
  }

  // ---------- pages ----------
  async renderHome(lang: string): Promise<string> {
    const t = this.i18n[lang];
    const [settings, products, catMap] = await Promise.all([
      this.settingsService.getAll(),
      this.prisma.product.findMany({ where: { published: 1, status: 'approved' }, orderBy: { createdAt: 'desc' } }),
      this.loadCategoryMap(),
    ]);
    const categories = [...new Set(products.map((p) => p.category))];
    const catCounts: Record<string, number> = {};
    for (const p of products) catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].slice(0, 10);
    const pathFor = (l: string) => `/${l}`;

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: products.slice(0, 30).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${this.config.siteUrl}/${lang}/product/${p.slug}`,
        name: this.localizedName(p, lang),
      })),
    };

    const faqJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [1, 2, 3, 4].map((i) => ({
        '@type': 'Question',
        name: t.faq[`q${i}`],
        acceptedAnswer: { '@type': 'Answer', text: t.faq[`a${i}`] },
      })),
    };
    const websiteJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: this.config.business.name,
      url: this.config.siteUrl,
      inLanguage: this.config.langs,
    };

    const headHtml = this.head({
      lang,
      title: t.meta.title,
      description: t.meta.description,
      canonicalPath: `/${lang}`,
      altPaths: Object.fromEntries(this.config.langs.map((l) => [l, `/${l}`])),
      jsonLd: [this.storeJsonLd(settings), websiteJsonLd, itemList, faqJsonLd],
    });

    const body = `
${this.header(lang, t, pathFor, settings)}
<main id="main">
  <section class="hero">
    <div class="container">
      <span class="hero-badge">${esc(t.hero.badge)}</span>
      <h1>${esc(t.hero.title)}</h1>
      <p class="hero-sub">${esc(t.hero.subtitle)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#catalog">${esc(t.hero.cta)}</a>
        <a class="btn btn-ghost" href="#contact">${esc(t.hero.cta2)}</a>
      </div>
      <div class="hero-stats">
        <div><strong>${products.length}</strong><span>${esc(t.statsec.parts)}</span></div>
        <div><strong>${brands.length}</strong><span>${esc(t.statsec.brands)}</span></div>
        <div><strong>${categories.length}</strong><span>${esc(t.statsec.categories)}</span></div>
      </div>
    </div>
  </section>

  ${categories.length ? `<section class="section section-cats">
    <div class="container">
      <h2>${esc(t.catsec.title)}</h2>
      <p class="section-sub">${esc(t.catsec.sub)}</p>
      <div class="cat-grid">
        ${categories.map((c) => `<button class="cat-card" data-category="${attr(c)}">
          <span class="cat-initial">${esc(this.catName(catMap, c, lang).slice(0, 1))}</span>
          <span class="cat-name">${esc(this.catName(catMap, c, lang))}</span>
          <span class="cat-count">${catCounts[c]}</span>
        </button>`).join('')}
      </div>
    </div>
  </section>` : ''}

  <section id="catalog" class="section">
    <div class="container">
      <h2>${esc(t.catalog.title)}</h2>
      <p class="section-sub">${esc(t.catalog.subtitle)}</p>
      <div class="catalog-tools">
        <div class="search-wrap">
          <input id="search" type="search" placeholder="${attr(t.catalog.search)}" aria-label="${attr(t.catalog.search)}">
          <button id="search-clear" class="search-clear" hidden aria-label="${attr(t.misc.clear)}">✕</button>
        </div>
        <div class="chips" id="category-chips">
          <button class="chip chip-filter active" data-category="">${esc(t.catalog.all)}</button>
          ${categories.map((c) => `<button class="chip chip-filter" data-category="${attr(c)}">${esc(this.catName(catMap, c, lang))}</button>`).join('')}
        </div>
      </div>
      <p class="results-count"><span id="results-count">${products.length}</span> ${esc(t.misc.results)}</p>
      <div class="grid" id="product-grid" data-msg-updated="${attr(t.catalog.updated)}">
        ${products.map((p) => this.productCard(p, lang, t, settings, catMap)).join('\n')}
      </div>
      <p id="empty-msg" class="empty-msg" hidden>${esc(t.catalog.empty)}</p>
      <button id="show-more" class="btn btn-outline show-more-btn" hidden>${esc(t.misc.showMore)}</button>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <h2>${esc(t.steps.title)}</h2>
      <p class="section-sub">${esc(t.steps.sub)}</p>
      <div class="steps-grid">
        <div class="step"><span class="step-n">1</span><h3>${esc(t.steps.s1t)}</h3><p>${esc(t.steps.s1d)}</p></div>
        <div class="step"><span class="step-n">2</span><h3>${esc(t.steps.s2t)}</h3><p>${esc(t.steps.s2d)}</p></div>
        <div class="step"><span class="step-n">3</span><h3>${esc(t.steps.s3t)}</h3><p>${esc(t.steps.s3d)}</p></div>
      </div>
      ${brands.length ? `<div class="brands-strip">
        <span class="brands-title">${esc(t.brands.title)}</span>
        ${brands.map((b) => `<span class="brand-badge">${esc(b)}</span>`).join('')}
      </div>` : ''}
    </div>
  </section>

  <section id="about" class="section">
    <div class="container">
      <h2>${esc(t.about.title)}</h2>
      <p class="about-text">${esc(t.about.text)}</p>
      <ul class="about-points">
        <li>${esc(t.about.point1)}</li>
        <li>${esc(t.about.point2)}</li>
        <li>${esc(t.about.point3)}</li>
      </ul>
    </div>
  </section>

  <section id="faq" class="section section-alt">
    <div class="container">
      <h2>${esc(t.faq.title)}</h2>
      <p class="section-sub">${esc(t.faq.sub)}</p>
      <div class="faq-list">
        ${[1, 2, 3, 4].map((i) => `<details class="faq-item">
          <summary>${esc(t.faq[`q${i}`])}</summary>
          <p>${esc(t.faq[`a${i}`])}</p>
        </details>`).join('')}
      </div>
    </div>
  </section>

  ${this.contactSection(t, settings)}
</main>
${this.footer(lang, t, settings, categories, catMap)}
${this.waFloat(t, settings)}`;

    return this.pageShell(lang, t, headHtml, body);
  }

  async renderProduct(lang: string, slug: string): Promise<string | null> {
    const t = this.i18n[lang];
    const [settings, p, catMap] = await Promise.all([
      this.settingsService.getAll(),
      this.prisma.product.findFirst({ where: { slug, published: 1, status: 'approved' } }),
      this.loadCategoryMap(),
    ]);
    if (!p) return null;
    const name = this.localizedName(p, lang);
    const description = this.localizedDesc(p, lang);
    const img = p.image || PLACEHOLDER_IMG;
    const pathFor = (l: string) => `/${l}/product/${p.slug}`;
    const inquire = this.waLink(settings, `${t.catalog.inquire}: ${name} — ${this.config.siteUrl}/${lang}/product/${p.slug}`);

    const [related, categoryRows] = await Promise.all([
      this.prisma.product.findMany({
        where: { published: 1, status: 'approved', category: p.category, id: { not: p.id } },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.prisma.product.findMany({
        where: { published: 1, status: 'approved' },
        select: { category: true },
        distinct: ['category'],
      }),
    ]);
    const categories = categoryRows.map((r) => r.category);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name,
      ...(description ? { description } : {}),
      image: `${this.config.siteUrl}${img}`,
      ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
      ...(p.sku ? { sku: p.sku } : {}),
      category: this.catName(catMap, p.category, lang),
    };
    const breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.nav.home, item: `${this.config.siteUrl}/${lang}` },
        { '@type': 'ListItem', position: 2, name: this.catName(catMap, p.category, lang), item: `${this.config.siteUrl}/${lang}?category=${encodeURIComponent(p.category)}#catalog` },
        { '@type': 'ListItem', position: 3, name, item: `${this.config.siteUrl}/${lang}/product/${p.slug}` },
      ],
    };

    const headHtml = this.head({
      lang,
      title: `${name}${t.meta.titleSuffix}`,
      description: description || `${name} — ${t.meta.description}`,
      canonicalPath: `/${lang}/product/${p.slug}`,
      ogImage: img,
      altPaths: Object.fromEntries(this.config.langs.map((l) => [l, `/${l}/product/${p.slug}`])),
      jsonLd: [this.storeJsonLd(settings), jsonLd, breadcrumbJsonLd],
    });

    const stockCls = p.quantity > 0 ? 'in' : 'out';
    const stockTxt = p.quantity > 0 ? t.catalog.inStock : t.catalog.outOfStock;

    const body = `
${this.header(lang, t, pathFor, settings)}
<main id="main">
  <div class="container product-page">
    <nav class="breadcrumb"><a href="/${lang}#catalog">← ${esc(t.product.back)}</a></nav>
    <article class="product-detail">
      <div class="product-media">
        <img src="${attr(img)}" alt="${attr(name)}" width="600" height="450">
      </div>
      <div class="product-info">
        <span class="chip chip-cat">${esc(this.catName(catMap, p.category, lang))}</span>
        <h1>${esc(name)}</h1>
        ${description ? `<p class="product-desc">${esc(description)}</p>` : ''}
        <dl class="product-meta">
          ${p.brand ? `<div><dt>${esc(t.product.brand)}</dt><dd>${esc(p.brand)}</dd></div>` : ''}
          <div><dt>${esc(t.product.category)}</dt><dd>${esc(this.catName(catMap, p.category, lang))}</dd></div>
          <div><dt>${esc(t.product.availability)}</dt><dd><span class="stock stock-${stockCls}">${esc(stockTxt)}</span></dd></div>
        </dl>
        <div class="inquire-box">
          <h2>${esc(t.product.inquireTitle)}</h2>
          <p>${esc(t.product.inquireText)}</p>
          <a class="btn btn-whatsapp" href="${attr(inquire)}" target="_blank" rel="noopener">${esc(t.contact.whatsappCta)}</a>
        </div>
      </div>
    </article>

    ${related.length ? `<section class="related-sec">
      <h2>${esc(t.related.title)}</h2>
      <div class="grid">
        ${related.map((r) => this.productCard(r, lang, t, settings, catMap)).join('\n')}
      </div>
    </section>` : ''}
  </div>
  ${this.contactSection(t, settings)}
</main>
${this.footer(lang, t, settings, categories, catMap)}
${this.waFloat(t, settings)}`;

    return this.pageShell(lang, t, headHtml, body);
  }

  // ---------- sitemap & robots ----------
  async renderSitemap(): Promise<string> {
    const products = await this.prisma.product.findMany({
      where: { published: 1, status: 'approved' },
      select: { slug: true, updatedAt: true },
    });
    const url = (p: string) => `${this.config.siteUrl}${p}`;
    const entry = (paths: Record<string, string>, lastmod?: string) => {
      const alts = this.config.langs
        .map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${url(paths[l])}"/>`)
        .join('');
      return this.config.langs
        .map((l) => `<url><loc>${url(paths[l])}</loc>${alts}${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`)
        .join('');
    };
    let body = entry(Object.fromEntries(this.config.langs.map((l) => [l, `/${l}`])));
    for (const p of products) {
      body += entry(
        Object.fromEntries(this.config.langs.map((l) => [l, `/${l}/product/${p.slug}`])),
        p.updatedAt,
      );
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;
  }

  renderRobots(): string {
    return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /workers
Disallow: /api/

Sitemap: ${this.config.siteUrl}/sitemap.xml
`;
  }
}
