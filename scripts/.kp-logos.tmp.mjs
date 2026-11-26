import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { partnerTiers, cfId } from '../public/admin/partners-shared.js';
const read = (d) => readdirSync(`src/content/${d}`).filter((f) => f.endsWith('.json')).map((f) => ({ _id: f.slice(0, -5), ...JSON.parse(readFileSync(`src/content/${d}/${f}`, 'utf8')) }));
const partners = read('partners').map((p) => ({ ...p, slug: p.slug || p._id }));
const kids = read('kids').filter((k) => k.publishStatus !== 'draft');
const RANK = { room: 0, signature: 1, champion: 2, builder: 3, friend: 4 };
// the logo's box (CSS px) at 1440 wide, and k: the page's sizing (src/pages/kids/[slug].astro)
const BOX = { room: [388, 148, 0.9], signature: [323, 125, 0.84], champion: [241, 104, 0.86], builder: [185, 82, 0.88], friend: [151, 77, 0.92] };
const logos = new Map();
for (const k of kids) for (const g of partnerTiers(k.partnerLogos, k.sponsors, partners)) for (const p of g.list) {
  if (!p.url) continue;
  const id = cfId(p.url);
  const e = logos.get(id) || { id, url: p.url, name: p.name, slug: p.slug, tier: g.tier, kids: [] };
  if (RANK[g.tier] < RANK[e.tier]) e.tier = g.tier;
  e.kids.push(k.slug);
  logos.set(id, e);
}
const B = 'https://sunshineonaranneyday.com/cdn-cgi/imagedelivery/ROYFuPmfN2vPS6mt5sCkZQ';
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return Buffer.from(await r.arrayBuffer()); };
const out = [];
const list = [...logos.values()];
for (let i = 0; i < list.length; i += 12) {
  await Promise.all(list.slice(i, i + 12).map(async (e) => {
    try {
      const big = await get(`${B}/${e.id}/trim=border,w=3000,h=3000,fit=scale-down,format=png`);
      const meta = await sharp(big).metadata();
      const { data, info } = await sharp(big).resize({ width: Math.min(meta.width, 400), withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const W = info.width, H = info.height, px = (x, y) => { const o = (y * W + x) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
      const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // the outer ring: an opaque, light, not-white edge is a tinted box around the logo
      let ring = 0, tinted = 0, colored = 0;
      for (let x = 0; x < W; x++) for (const y of [0, 1, H - 2, H - 1]) { const p = px(x, y); ring++; if (p[3] > 200) { const l = luma(p); if (l >= 200 && l < 247) tinted++; else if (l < 200) colored++; } }
      for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) { const p = px(x, y); ring++; if (p[3] > 200) { const l = luma(p); if (l >= 200 && l < 247) tinted++; else if (l < 200) colored++; } }
      // contrast: the darkest 5% of the drawn (opaque, not white) pixels
      const ink = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = px(x, y); if (p[3] > 128) { const l = luma(p); if (l < 245) ink.push(l); } }
      ink.sort((a, b) => a - b);
      const dark = ink.length ? ink[Math.floor(ink.length * 0.05)] : 255;
      const r = meta.width / meta.height;
      const [bw, bh, k] = BOX[e.tier];
      const h = Math.min(bh, (bh * k) / Math.pow(r, 0.42), bw / r);
      const drawn = h * r;
      const sharpness = meta.width >= drawn * 2 ? 'sharp' : meta.width >= drawn ? 'soft' : 'blurry';
      out.push({ ...e, w: meta.width, h: meta.height, need: Math.ceil(drawn * 2), sharpness, tintedBox: tinted / ring > 0.5, coloredEdge: colored / ring > 0.5, dark: Math.round(dark), faint: dark > 150 });
    } catch (err) { out.push({ ...e, error: String(err.message || err) }); }
  }));
}
writeFileSync('/tmp/kp-logos.json', JSON.stringify(out, null, 1));
console.log(out.length, 'logos');
