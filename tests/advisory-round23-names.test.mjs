/**
 * Advisory Board QA round 23 (Nov 23 2026): how the public application reads a name, findings 1 to 8 of the round 23
 * public tester (test-results/qa23-public: n01 to n07, e03). The greeting (the thank-you, the applicant's copy, the
 * welcome and the monthly ask all greet with greetName) greets only on positive evidence: a missed name is fine, a wrong
 * one is the finding. Add to Advisory Board's web address and its "same person?" question read readName: an address
 * never takes a place, a company, pronouns or letters, and two different people are never offered as one because of what
 * the code doesn't know. Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round23-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
// (only what the live code exports too, so each test says on it what it says; round 23's own helpers are read off the
// module and checked to be there)
import { greetName, readName, placeWord, whereWord, placeLists } from '../functions/api/_advisory-form.js';
import * as G from '../functions/api/_given-names.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import { slugOf } from '../public/admin/team-shared.js';
import { createD1 } from './lib/d1-shim.mjs';

const { givenName, familyFirst, givenFamilyFirst, familyFirstBefore, markedNames, listSizes } = G;

// Each row: [full name, preferred name, the greeting]; the applicant's copy's first line says the same
const say = (rows) => {
  for (const [fullName, preferredName, want] of rows) {
    assert.equal(greetName({ fullName, preferredName }), want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}.` : 'Thank you.', fullName);
  }
};
const addressOf = (n) => { const r = readName(n); return slugOf((r.address || r.words).join(' ')); };

// ─── Finding 1: a family name written first that's a given name elsewhere ──

test('finding 1: Wade-Giles and Cantonese family names that are given names elsewhere (Tung, Pao) are the family name before their people\'s given names; written given name first they\'re greeted', () => say([
  // (the tester's rows)
  ['Tung Chih-ming', '', ''], ['Tung Yu-ting', '', ''], ['Tung Wei', '', ''], ['Pao Yu-ting', '', ''], ['Tung Chih-ming', 'Tung', ''], ['Pao Yu-ting', 'Pao', ''],
  ['Tung Ka-ming', '', ''], ['Tung Wing-yan', '', ''],
  // (and the others the lists find the same way: Cantonese Kei and Lou, Korean Seung, Japanese Ken, Rin, Hiro and Ike)
  ['Kei Ka-ming', '', ''], ['Lou Ka-ming', '', ''], ['Seung Min-jun', '', ''], ['Ken Yuki', '', ''], ['Rin Hiroshi', '', ''], ['Hiro Keiko', '', ''], ['Ike Haruto', '', ''],
  // (given name first, before a family name that isn't one of their people's given names: theirs)
  ['Tung Nguyen', '', ''] /* r25: Tung is a family name some people write first and Nguyen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Pao Vang', '', ''] /* r25: Pao is a family name some people write first and Vang no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ken Smith', '', 'Ken'], ['Ike Turner', '', 'Ike'], ['Lou Ames', '', 'Lou'], ['Rin Okafor', '', 'Rin'],
]));

// The tester's family names by people (qa23-public/n01-family-first.mjs, written apart from the site's lists), and given
// names of each people's that the site's lists have. (Linh and Hai, in the tester's Vietnamese list, are given names, not
// family names, in Vietnam: left out here, as they are from the site's)
const FAMILIES = {
  chinese: `Chen Lin Huang Chang Li Wang Wu Liu Tsai Yang Hsu Cheng Hsieh Kuo Hung Tseng Chiu Liao Lai Chou Yeh Su Chuang Lu Chiang Ho Kao Lo Pan
    Chien Chung Peng Tsao Tu Fu Shen Fan Tien Hu Weng Wei Ting Ku Chu Kang Teng Tang Jen Shih Yu Chao Chi Sung Lan Kuan Hou Yen Hsiao Mao Pai Chin
    Yin Ou Kung Tsui Hsueh Fang Tai Lung Fei Chia Mei Tung Tuan Tso Tsou Pei Pi Pao Hsiung Kan Ma Mo Mu Niu Shao Wan Wen Yao Yuan Yung Hsing Hsia
    Ching Chuan Shan Shu Kuang Chai Han Chan Cheung Chow Fong Kwan Kwok Lam Lau Leung Mak Ng Siu Tam Tsang Tse Wong Yeung Yip Lee Choi Fung Kwong
    Law Lui Mok Poon Tong Yau Yuen Yim Yiu Hui Man Kong Ko Kam Shum Sham Szeto Au Chau Chong Chuk Fok Hau Hon Ip Kei Keung Lok Lou Lum Mui Ngai
    Pak Pang Pun Shek Sin So Tin To Tsoi Wai Wing Yam Yan Yee Yue Yuk Kwai Ming Zhang Zhao Zhou Xu Sun Zhu Guo He Gao Luo Zheng Liang Xie Song
    Feng Deng Cao Zeng Xiao Tian Dong Cai Jiang Du Ye Ding Ren Yao Cui Zhong Tan Jin Shi Jia Xia Bai Zou Meng Xiong Qin Qiu Xue Duan Lei Long Tao
    Gu Hao Gong Qian Dai Xiang Chi Hong Ge Geng Guan Bao An Zuo Zhan Qi Ning Ji Ling Hua Xin Ying Jian Zhen Jing Qing Bo Ping Kai Yong Rui Qiang
    Zhi Jie Hai Kou Min Rong Yue Zhuang Ruan Lian Ai Huo Pu Qu Bian Hang Shang Gan Dou Sheng Zhai Ni Cen Ke Yun`,
  japanese: `Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura
    Hayashi Shimizu Mori Abe Ikeda Maeda Ogawa Goto Okada Saito Endo Aoki Ota Ono Wada Hara Sakai Kudo Ando Imai Ueno Chiba Kubo Sano Arai Honda
    Noda Oda Seki Tani Toda Yano Hino Kono Naka Shima Mita Nishi Kawai Sone Taira Shiba Hata Nara Mine Kaji Oka Hori Ken Jo Mano Kai Rin Aida
    Miki Sakura Yuki Hiro Ike Mai`,
  korean: `Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Jeon Hong Yoo Ko Moon Yang Son Bae Baek Heo Nam Shim
    Noh Ha Kwak Sung Cha Joo Woo Koo Min Ryu Na Jin Ji Uhm Chae Won Chun Bang Gong Hyun Ham Byun Yeom Yeo Choo Do Seok Sun Seol Ma Gil Pyo Yeon
    Wi Ki Ban Wang Geum Ok Yook In Maeng Je Mo Tak Kook Eo Eun Yong Ye Kyung Bong Sa Bu Sim Rhee Yi Roh Suh Hahn Paik Pak Chang Chong Kong Hur Yu
    Im Myung Joe Jee Jeong Jun Ku Gu Sohn Tae Chi Seung`,
  vietnamese: `Nguyen Tran Le Pham Hoang Huynh Phan Vu Vo Dang Bui Do Ho Ngo Duong Ly Truong Dinh Mai Trinh Luong Cao Ta Kieu Thai Quach Luu Doan
    Vuong Trieu La Tong Diep Banh Thach Phung Mac Bach Giang Kha Nghiem Lieu Tieu Ton Chau Tang Lam Quan Dao Au Vi Ung Lac Kim Hua Lai Han Ninh
    Khuc Chu Mach Lu Hau Ong Dam Tat To Tham Than Nong Hoa Quang Trang Luc Tien Long Hong Phi Nhan Giap Manh Cu Thanh Vinh`,
  khmer: `Sam Chea Sok Keo Kim Chan Heng Meas Chhim Pen Hun Sar Tep Chhay Prak Ouk Mao Seng Yim Ly Hor Lim Tan Phan Long Nhem Kong Kang Ung Pich
    Phal Em Nou Chhun Kheang Mam Nuon Sim Som Sun Uy Var Voeun Ros Mey Sin San Seang Touch Ek Kheng Pok Nhim Thach Chhin Ngin Chum Om Hang Cheng`,
  hmong: `Vang Xiong Thao Lee Yang Her Moua Lor Hang Khang Kue Pha Lo Thor Chue Chang Vue Cha Fang Kong Kha Koua`,
};
const GIVEN_OF = { chinese: ['Xiaoming', 'Yu-ting', 'Meiling', 'Ka-ming'], japanese: ['Hiroshi', 'Keiko'], korean: ['Min-jun', 'Ji-eun'], vietnamese: ['Minh', 'Huong'],
  khmer: ['Sokha', 'Rainsy'], hmong: ['Kou', 'Shoua'] };

test('finding 1: every family name a family-first people writes that\'s a given name anywhere on the lists is that people\'s family name before their given names (the tester\'s family names, checked against the site\'s lists)', () => {
  const missing = [];
  for (const [people, fams] of Object.entries(FAMILIES)) {
    for (const f of new Set(fams.split(/\s+/).filter(Boolean))) {
      if (!givenName(f) || familyFirst(f)) continue;
      for (const g of GIVEN_OF[people]) {
        if (!familyFirstBefore(f, g) || greetName({ fullName: `${f} ${g}` }) || greetName({ fullName: `${f} ${g}`, preferredName: f })) missing.push(`${people}: ${f} ${g}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'a family name that\'s a given name, greeted before its people\'s given name');
});

test('finding 1: the site\'s own lists build it: every family name written out for a people (FAMILY_NAMES_OF) that\'s a given name on the lists and not always first is marked, and nothing else is', () => {
  const m = markedNames();
  assert.ok(m.familyNamesOf && m.givenNamesOf, 'each people\'s family names written out (round 23)');
  const marked = new Set(m.familyFirstBefore.map(G.nameKey));
  const want = new Set();
  for (const [people, fams] of Object.entries(m.familyNamesOf)) {
    for (const f of fams) {
      if (!givenName(f) || familyFirst(f)) continue;
      want.add(G.nameKey(f));
      const g = m.givenNamesOf[people].find((x) => givenName(x) && !familyFirst(x) && !fams.includes(x)) || m.givenNamesOf[people][0];
      assert.ok(familyFirstBefore(f, g), `${people}: ${f} before ${g}`);
    }
  }
  assert.deepEqual([...marked].filter((k) => !want.has(k)), [], 'marked without being a family name the lists write out');
  for (const w of ['Tung', 'Pao', 'Kei', 'Lou', 'Seung', 'Ken', 'Rin', 'Hiro', 'Ike', 'Tien', 'Jen', 'Sam', 'Yong', 'Joe']) assert.ok(marked.has(G.nameKey(w)), w);
});

// ─── Finding 2: one spelling-neutral key ──────────────────────────────

test('finding 2: a given name joined, hyphenated or with a capital inside is the same name everywhere it\'s looked up ("Meiling", "Mei-ling", "Mei-Ling", "MeiLing")', () => {
  say([
    // (the tester's rows: no name either way)
    ['Tien Mei-ling', '', ''], ['Tien Meiling', '', ''], ['Tien Mei-Ling', '', ''], ['Tien MeiLing', '', ''], ['Tien Yi-ting', '', ''], ['Tien Yiting', '', ''],
    ['Jen Xiao-ming', '', ''], ['Jen Xiaoming', '', ''], ['Shan Hsin-yi', '', ''], ['Shan Hsinyi', '', ''], ['Yong Min-jun', '', ''], ['Yong Minjun', '', ''],
    ['Joe Min-jun', '', ''], ['Joe Minjun', '', ''], ['Tien Mei-ling', 'Tien', ''], ['TIEN MEI-LING', '', ''], ['tien meiling', '', ''],
    // (given name first it's greeted, in the spelling typed: the list's capitals when typed all in one case)
    ['Mei-ling Chen', '', 'Mei-ling'], ['Meiling Chen', '', 'Meiling'], ['MINJUN KIM', '', 'Minjun'], ['minjun park', '', 'Minjun'], ['Joanna Ames', 'MEI-LING', 'Mei-ling'],
    ['Joanna Ames', 'Minjun', 'Minjun'], ['JO-ANN AMES', '', 'Jo-Ann'], ['JOANN AMES', '', 'Joann'], ['Jo-Ann Ames', '', 'Jo-Ann'],
  ]);
  for (const [a, b] of [['Meiling', 'Mei-ling'], ['Mei-Ling', 'MeiLing'], ['Minjun', 'Min-jun'], ['Hsinyi', 'Hsin-Yi'], ['Joann', 'Jo-Ann']]) assert.equal(G.nameKey(a), G.nameKey(b), `${a} ${b}`);
  // (the tester's n06 sweep: every name from the site's Chinese and Korean lists, joined and hyphenated, after a family name
  // marked as written first before that people's names, greeted the same both ways)
  const CH = 'Meiling:Mei-ling Xiaoming:Xiao-ming Yiting:Yi-ting Yuting:Yu-ting Jingyi:Jing-yi Zhiwei:Zhi-wei Xiaoling:Xiao-ling Wenjun:Wen-jun Yiming:Yi-ming Zihan:Zi-han Hsinyi:Hsin-yi Chihming:Chih-ming Weiming:Wei-ming Peishan:Pei-shan Shufen:Shu-fen Chiahao:Chia-hao';
  const KO = 'Minjun:Min-jun Seoyeon:Seo-yeon Jihoon:Ji-hoon Jiwoo:Ji-woo Hyunwoo:Hyun-woo Jieun:Ji-eun Soojin:Soo-jin Minji:Min-ji Jiho:Ji-ho Jisoo:Ji-soo';
  const differ = [];
  for (const [fams, pairs] of [['Tien Jen Shan Shu Ming Ying Bo Kai Yong', CH], ['Yong Joe', KO]]) {
    for (const fam of fams.split(' ')) for (const [joined, hyph] of pairs.split(' ').map((p) => p.split(':'))) {
      const a = greetName({ fullName: `${fam} ${joined}` });
      const b = greetName({ fullName: `${fam} ${hyph}` });
      if (a !== b || a) differ.push(`${fam} ${joined} ${JSON.stringify(a)} | ${fam} ${hyph} ${JSON.stringify(b)}`);
    }
  }
  assert.deepEqual(differ, []);
});

// ─── Finding 3: Hungarian married names ───────────────────────────────

test('finding 3: a Hungarian wife written by her husband\'s name ("Simon Zoltánné", Mrs. Zoltán Simon) gets no name, and the family name before it is never greeted', () => {
  say([
    ['Simon Zoltánné', '', ''], ['Dr. Simon Zoltánné', '', ''], ['Fábián Péterné', '', ''], ['Ádám Lászlóné', '', ''], ['Simon Zoltanne', '', ''], ['SIMON ZOLTÁNNÉ', '', ''],
    ['Simon Zoltánné', 'Simon', ''], ['Dr. Simon Zoltánné', 'Simon', ''], ['Albert Istvánné', 'Albert', ''],
    // (names that end the same way and are no husband's are theirs)
    ['Jeanne Ames', '', 'Jeanne'], ['Joanne Ames', '', 'Joanne'], ['Marianne Ames', '', 'Marianne'], ['Adrienne Ames', '', 'Adrienne'], ['Suzanne Ames', '', 'Suzanne'],
    ['Yvonne Ames', '', 'Yvonne'], ['René Dupont', '', 'René'], ['Simon Jeanne', '', ''] /* r25: Simon is one of Hungary's family names and Jeanne no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Simon Joanne', '', ''] /* r25: Simon is one of Hungary's family names and Joanne no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
  ]);
  assert.equal(typeof G.marriedName, 'function', 'a married name by the husband\'s, read (round 23)');
  for (const w of ['Zoltánné', 'Péterné', 'Lászlóné', 'Istvánné', 'Zoltanne']) assert.ok(G.marriedName(w), w);
  for (const w of ['Jeanne', 'Joanne', 'Marianne', 'Adrienne', 'René', 'Renée', 'Yvonne', 'Simone', 'Dionne', 'Leanne', 'Anne', 'Corinne']) assert.ok(!G.marriedName(w), w);
});

// ─── Finding 4: every given word after the family name ────────────────

test('finding 4: family-first evidence comes from every given word after the family name, not only the last', () => say([
  // (the tester's rows)
  ['Simon Katalin Anna', '', ''], ['Simon András Viktor', '', ''], ['Ádám Zsófia Anna', '', ''], ['Dávid Eszter Rita', '', ''], ['Fábián Gergely Norbert', '', ''],
  ['Albert Ildikó Erika', '', ''], ['Simon Anna Mária', '', ''], ['Simon Katalin Anna', 'Simon', ''],
  // (and the same for a family name that comes first before its own people's given names)
  ['Tien Van Minh', '', ''], ['Tien Thi Lan', '', ''], ['Thanh Van Minh', '', ''],
  // (a given name first, a middle name and a family name are still the given name's: "Văn" and "Thị" are middle names)
  ['Thanh Van Nguyen', '', ''] /* r25: Thanh is a family name some people write first and Nguyen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Hai Van Nguyen', '', ''] /* r25: Hai is a family name some people write first, Van is Văn, no particle, and Nguyen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Linh Thi Nguyen', '', 'Linh'], ['Mary Beth Rowe', '', 'Mary Beth'], ['Thanh Huong Ames', '', 'Thanh Huong'],
  ['Jordan Taylor Ames', '', 'Jordan'],
]));

// ─── Finding 5: the peoples' own given-name lists ─────────────────────

// (the tester's 265 common Hungarian names, qa23-public/n02-hungarian.mjs)
const HU265 = `László István József János Zoltán Sándor Gábor Ferenc Attila Péter Tamás Zsolt Tibor András Csaba Imre Lajos György Balázs Róbert Mihály
Gyula Károly Dániel Ádám Krisztián Miklós Bence Dávid Béla Máté Antal Géza Márk Pál Ákos Szabolcs Richárd Levente Gergely Árpád Kristóf Szilárd Ernő
Dezső Barnabás Milán Endre Jenő Kálmán Vilmos Márton Olivér Gergő Botond Zalán Marcell Bálint Benedek Áron Nándor Ottó Tivadar Elemér Dénes Lőrinc
Ödön Rezső Iván Kornél Zsigmond Huba Bertalan Csongor Hunor Kende Örs Gellért Mátyás Tódor Bulcsú Vince Benjámin Ármin Barna Bendegúz Zente Bátor
Dorián Zénó Brúnó Hugó Ede Jónás Nimród Krisztofer Rajmund Benett Zsombor Vencel Ábel Sámuel Lukács Gáspár Menyhért Bónis Csanád Domonkos Ervin Erik
Rudolf Arnold Albert Viktor Patrik Roland Norbert Martin Dominik Noel Alex Kevin Emil Félix Valentin Adrián Mária Erzsébet Katalin Ilona Éva Zsuzsanna
Margit Judit Ágnes Krisztina Irén Eszter Mónika Edit Szilvia Tímea Ildikó Magdolna Rozália Julianna Klára Viktória Piroska Gizella Marianna Enikő Beáta
Melinda Nikolett Zsófia Dóra Réka Lilla Csilla Orsolya Boglárka Kitti Brigitta Hajnalka Noémi Adrienn Henrietta Bernadett Kinga Dorina Fanni Jázmin
Nóra Anikó Emese Zita Ibolya Terézia Etelka Tünde Hedvig Kornélia Valéria Nikoletta Szabina Dalma Léna Csenge Bianka Liliána Natália Abigél Panna
Zselyke Szofi Dorka Emília Flóra Boróka Hanga Kincső Lilien Gréta Zorka Villő Míra Janka Sára Olívia Kamilla Izabella Írisz Alíz Jolán Mariann Klaudia
Diána Evelin Lívia Fruzsina Ivett Renáta Bettina Tekla Rebeka Emőke Erzsi Kata Kati Zsuzsi Bori Juli Rozi Marcsi Andi Kriszta Niki Szandra Anett Vanda
Viola Andrea Erika Anita Gabriella Rita Vera Laura Zoé Luca Hanna Lili Bella Mira Maja Liza Petra Barbara Veronika Alexandra Vivien Tamara Regina
Johanna`.split(/\s+/);

test('finding 5: Hungary\'s given names cover the tester\'s 265 common ones and the common modern ones: written after one of Hungary\'s family names, the name gets no name; the names Hungarians share with everyone say nothing on their own', () => {
  assert.equal(HU265.length, 265);
  assert.deepEqual(HU265.filter((g) => !givenFamilyFirst(g)), [], 'one of the tester\'s Hungarian names not on the lists');
  const greeted = [];
  for (const fam of ['Simon', 'Ádám', 'Dávid', 'Dániel', 'Péter', 'Fábián', 'Albert', 'Sámuel', 'Ábel', 'Márk', 'Balázs', 'László']) {
    for (const g of HU265) if (greetName({ fullName: `${fam} ${g}` }) || greetName({ fullName: `${fam} ${g}`, preferredName: fam })) greeted.push(`${fam} ${g}`);
  }
  assert.deepEqual(greeted, [], 'a Hungarian family name greeted before one of Hungary\'s given names');
  say([
    // (the tester's rows, and the modern ones)
    ['Simon Csongor', '', ''], ['Ádám Zselyke', '', ''], ['Dávid Hedvig', '', ''], ['Simon Zente', '', ''], ['Simon Bátor', '', ''], ['Simon Lilien', '', ''], ['Simon Boldizsár', '', ''],
    ['Simon Bíborka', '', ''], ['Simon Lotti', '', ''], ['Simon Szófia', '', ''], ['Simon Rita', '', ''], ['Albert Martin', '', ''],
    // (a shared name after a first word that isn't one of Hungary's family names, or a plain spelling of an accented one,
    // is anyone's: greeted, as round 22 had it)
    ['Jordan Martin', '', 'Jordan'], ['Steve Martin', '', 'Steve'], ['Eddie Albert', '', 'Eddie'], ['Jordan Kevin', '', 'Jordan'], ['Adam Rita', '', 'Adam'],
    ['Simon Peter', '', ''] /* r25: Simon is one of Hungary's family names and Peter no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Simon Robert', '', 'Simon'], ['Eva Simon', '', 'Eva'], ['Grace Lukacs', '', 'Grace'],
  ]);
  // (no name counted however typed is another people's given name; every accents-only one has an accent)
  const m = markedNames();
  const known = new Set(['Zoltán', 'László', 'Balázs', 'István', 'Ferenc', 'Csaba', 'Attila', 'Katalin', 'Erzsébet', 'Zsófia', 'Margit']);
  assert.deepEqual(m.hungarian.filter((w) => givenName(w) && !known.has(w)), [], 'counted without accents, but another people\'s given name');
  assert.ok(Array.isArray(m.hungarianShared) && m.hungarianShared.length >= 50, 'the names Hungarians share with everyone written out (round 23)');
});

test('finding 5: the Chinese list holds several hundred common given names in pinyin and Taiwan\'s and Hong Kong\'s usual forms, the Khmer list the common names: a marked family name before one gets no name', () => {
  const s = listSizes();
  assert.ok(s.chinese >= 400, `${s.chinese} Chinese given names`);
  assert.ok(s.khmer >= 100, `${s.khmer} Khmer given names`);
  assert.ok(s.hungarian >= 400, `${s.hungarian} Hungarian given names`);
  const MAINLAND = 'Xiaoming Wei Jing Meiling Xiaohong Yiming Haoran Zihan Yuxuan Jiahui Xiaoli Jianguo Guoqiang Lihua Hongmei Xiuying Dongmei Junjie Zhiqiang Chunhua'.split(' ');
  const TAIWAN = 'Yu-ting Hsin-yi Chih-ming Wei-ming Shu-fen Pei-shan Mei-ling Chun-hui Ya-ting Chia-hui Shu-hui Hui-ling Chien-hung Tsung-han Kuan-yu Yi-chen Po-han Wen-hsiung Chun-chieh Hsiao-mei'.split(' ');
  const HK = 'Ka-ming Wing-yan Siu-ming Chi-wai Ka-yan Wai-man Kin-wah Man-kit Hoi-yan Chun-kit Mei-ling Siu-wai'.split(' ');
  const greeted = [];
  for (const fam of 'Ying Jian Zhen Jing Qing Ming Bo Ping Kai Yong Shu Shan Rui Qiang Zhi Lou Jie Hai Kou'.split(' ')) for (const g of MAINLAND) if (greetName({ fullName: `${fam} ${g}` })) greeted.push(`${fam} ${g}`);
  for (const fam of 'Tien Jen Tung Pao Shan Shu'.split(' ')) for (const g of TAIWAN) if (greetName({ fullName: `${fam} ${g}` })) greeted.push(`${fam} ${g}`);
  for (const fam of 'Tung Kei Lou Ming'.split(' ')) for (const g of HK) if (greetName({ fullName: `${fam} ${g}` })) greeted.push(`${fam} ${g}`);
  for (const g of 'Rainsy Sokha Sophea Dara Vanna Bopha Rithy Phalla Sopheak Sreypov Sokunthea Sothy Vanny Bunna Sokhom Chamroeun Samnang Sovanna'.split(' ')) if (greetName({ fullName: `Sam ${g}` })) greeted.push(`Sam ${g}`);
  assert.deepEqual(greeted, []);
  // (written given name first, they're greeted)
  say([['Jianguo Wang', '', 'Jianguo'], ['Xiuying Chen', '', 'Xiuying'], ['Chun-hui Lin', '', 'Chun-hui'], ['Sopheak Chea', '', 'Sopheak'], ['Sreypov Sok', '', 'Sreypov']]);
});

// ─── Finding 6: places and organizations ──────────────────────────────

test('finding 6: a city and its state\'s two letters, a business word in either number, the missing kinds, Georgia\'s cities and towns and the country\'s places that start with a given name are no name', () => say([
  // (a) a city and a state's two letters
  ['Hope Atlanta GA', '', ''], ['Faith Marietta GA', '', ''], ['Grace Decatur GA', '', ''], ['Hope Nashville TN', '', ''], ['Faith Miami FL', '', ''], ['hope atlanta ga', '', ''],
  ['HOPE ATLANTA GA', '', ''], ['Hope Atlanta Ga', '', ''], ['Hope Atlanta, GA', '', ''],
  // (b) singular and plural alike
  ['Jordan Service', '', ''], ['Jordan Cabinet', '', ''], ['Grace Orchard', '', ''], ['Hope Lab', '', ''], ['Grace Photo', '', ''], ['Jordan Film', '', ''], ['Grace Nail', '', ''],
  ['Hope Wine', '', ''], ['Jordan Gutter', '', ''], ['Jordan Print', '', ''], ['Jordan Paint', '', ''], ['Jordan Lawn', '', ''],
  // (c) the kinds that were missing
  ['Grace Community', '', ''], ['Hope Community', '', ''], ['Trinity United', '', ''], ['Grace AME', '', ''], ['Grace UMC', '', ''], ['Hope Recovery', '', ''],
  ['Grace Assisted Living', '', ''], ['Hope Senior Living', '', ''], ['Jordan Lawn Service', '', ''], ['Jordan Tree Service', '', ''], ['Taylor Tax Service', '', ''],
  ['Jordan Car Wash', '', ''], ['Grace Coffee', '', ''], ['Jordan Market', '', ''], ['Jordan Produce', '', ''], ['Hope Cattle', '', ''], ['Grace Dance', '', ''],
  // (d) Georgia's cities and towns and two-word places, metro Atlanta's communities, places that start with a given name
  ['Grace Chamblee', '', ''], ['Hope Dacula', '', ''], ['Jordan Dawsonville', '', ''], ['Grace Watkinsville', '', ''], ['Hope Cedartown', '', ''], ['Faith Rockmart', '', ''],
  ['Grace Hiawassee', '', ''], ['Hope Adairsville', '', ''], ['Jordan Hoschton', '', ''], ['Grace Villa Rica', '', ''], ['Hope Flowery Branch', '', ''],
  ['Faith Social Circle', '', ''], ['Grace Locust Grove', '', ''], ['Hope Blue Ridge', '', ''], ['Grace Buckhead', '', ''], ['Hope Vinings', '', ''],
  ['Ann Arbor', '', ''], ['Myrtle Beach', '', ''], ['Glen Ellyn', '', ''], ['Glen Burnie', '', ''], ['Rocky Mount', '', ''],
  // (people: family names that are places or trades, the other number of a word that's a family name, a given name and a
  // family name that a place shares)
  ['Jordan Banks', '', 'Jordan'], ['Jordan Chambers', '', 'Jordan'], ['Jordan Saint James', '', 'Jordan'], ['Jordan Painter', '', 'Jordan'], ['Jordan Pool', '', 'Jordan'],
  ['Aminata Fall', '', 'Aminata'], ['Jordan Ames', '', 'Jordan'], ['Jordan Ames MD', '', 'Jordan'], ['Jordan Ames PA', '', 'Jordan'], ['Jordan Tucker', '', 'Jordan'],
  ['Jordan Decatur', '', 'Jordan'], ['Jordan Dalton', '', 'Jordan'], ['Jordan Milton', '', 'Jordan'], ['Grant Park', '', 'Grant'], ['Rose Hill', '', 'Rose'],
  ['Morgan Hill', '', 'Morgan'], ['Holly Hill', '', 'Holly'], ['Jordan Park', '', 'Jordan'], ['Nguyen Loan', '', ''], ['Loan Nguyen', '', ''],
]));

test('finding 6: no word on the place lists, each word\'s other number among them, is a given name, a word on the names lists, a family name that comes first, or a family name a place shares', () => {
  const l = placeLists();
  assert.ok(Array.isArray(l.two) && l.two.length >= 200, 'places of two words written out (round 23)');
  assert.deepEqual([...l.anywhere, ...l.last].filter((w) => givenName(w)), [], 'a given name');
  assert.deepEqual([...l.anywhere, ...l.last, ...l.lastNamed].filter((w) => familyFirst(w)), [], 'a family name that comes first');
  assert.deepEqual(l.anywhere.filter((w) => G.onTheLists?.(w)), [], 'a word on the names lists');
  for (const [a, b] of [['Service', 'Services'], ['Cabinet', 'Cabinets'], ['Orchard', 'Orchards'], ['Lab', 'Labs'], ['Photo', 'Photos'], ['Market', 'Markets'], ['Lawn', 'Lawns'], ['Bank', 'Banking']]) {
    assert.deepEqual([greetName({ fullName: `Jordan ${a}` }), greetName({ fullName: `Jordan ${b}` })], ['', ''], `${a} ${b}`);
  }
  for (const w of ['banks', 'chambers', 'saint', 'painter', 'pool', 'ames', 'fall', 'loan', 'floor', 'senior', 'cruise', 'burger', 'craft', 'sweet']) assert.ok(!placeWord(w) && !whereWord(w), w);
  for (const w of ['chamblee', 'dacula', 'dawsonville', 'watkinsville', 'cedartown', 'rockmart', 'hiawassee', 'adairsville', 'hoschton', 'buckhead', 'vinings']) assert.ok(whereWord(w), w);
});

test('finding 6e: the same lists drive the comma reading: a place or organization after one family name and a comma is never their first name', () => {
  for (const tail of ['Grace Community', 'Ann Arbor', 'Hope Recovery', 'Grace Church', 'Decatur GA', 'Atlanta GA', 'Chamblee', 'Villa Rica', 'Jordan Lawn Service', 'Myrtle Beach',
    'Hope Senior Living', 'Grace AME', 'Jordan Service']) {
    const n = `Ames, ${tail}`;
    const r = readName(n);
    assert.deepEqual([r.words.join(' '), r.shown, addressOf(n)], ['Ames', n, 'ames'], n);
  }
  for (const [n, words] of [['Ames, Jordan', 'Jordan Ames'], ['Ames, Savannah', 'Savannah Ames'], ['Ames, Grace', 'Grace Ames'], ['Ames, Jordan MD', 'Jordan Ames']]) assert.equal(readName(n).words.join(' '), words, n);
});

// ─── Findings 7 and 8: the comma reading ──────────────────────────────

test('finding 7: "not on the list" is never proof of a family name; a particle is; a whole name before a comma with a place, a company, pronouns or more names after it is that name alone', () => {
  for (const [n, address] of [
    // (the tester's rows)
    ['Octavia Ames, Edward Jones', 'octavia-ames'], ['Hezekiah Rowe, Raymond James', 'hezekiah-rowe'], ['Booker Hale, Taylor Morrison', 'booker-hale'],
    ['Imogene Hale, Raymond James', 'imogene-hale'], ['De La Cruz, Xochitl', 'de-la-cruz-xochitl'], ['Al Fayed, Dodi', 'al-fayed-dodi'], ['Garcia Lopez, Xochitl', 'garcia-lopez'],
    ['Octavia Ames, Atlanta', 'octavia-ames'], ['Octavia Ames, Decatur', 'octavia-ames'], ['Octavia Ames, she/her', 'octavia-ames'],
    // (one given name the list has after it and none before it: "Family, Given", as today, the lead's positive evidence)
    ['Octavia Ames, Grace', 'octavia-ames-grace'],
    ['Montgomery Quill, Allen & Overy', 'montgomery-quill'], ['Zion Taylor, Morgan Stanley', 'zion-taylor'],
    // (rounds 21 and 22's, kept)
    ['Jordan Ames, Edward Jones', 'jordan-ames'], ['De La Cruz, Maria', 'de-la-cruz-maria'], ['Garcia Lopez, Maria', 'garcia-lopez-maria'], ['Del Rey, Compass', 'del-rey'],
    ['Van Jones, Dream Corps', 'van-jones'], ['De La Cruz, Grace Church', 'de-la-cruz'], ['Garcia Lopez, Maria de los Angeles', 'garcia-lopez-maria-de-los-angeles'],
    ['Al Green, Atlanta', 'al-green'], ['van der Berg, Joost', 'van-der-berg-joost'], ['Garcia Lopez, Ana Maria Sofia Isabel', 'garcia-lopez-ana-maria-sofia-isabel']]) {
    assert.equal(addressOf(n), address, n);
    assert.equal(readName(n).shown, n, `${n}: People's name stays as typed`);
  }
  // (and the greeting: no name from any of them)
  for (const n of ['Octavia Ames, Edward Jones', 'De La Cruz, Xochitl', 'Al Fayed, Dodi', 'Garcia Lopez, Xochitl']) assert.equal(greetName({ fullName: n }), '', n);
});

// A made-up applicant world for Add, on its own: each application stored as the public form stores it, then planned by the admin
async function addWorld() {
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  const shot = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
  const adminApi = await import('../functions/api/advisory-applications-admin.js');
  const env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  const BASE = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
    introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
  let k = 0;
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r23n.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
  const ctx = (method, body, query = '') => ({ env, request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;
  const addNew = async (app) => { const p = await plan(app.id); const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }))).json(); assert.equal(r.success, true, r.error); return p; };
  return { applied, plan, addNew };
}
const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)].filter(Boolean);
const withFakes = async (fn) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/images/v1') && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/x/${id}/public`] } }); }
    if (url.host === 'api.resend.com') { const b = [JSON.parse(init.body)].flat(); return Response.json({ data: b.map((_, i) => ({ id: `e${i}` })) }); }
    throw new Error(`no route for ${url.href}`);
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; }
};

test('finding 7: through Add, the same whole name before a comma is offered as one whatever the list knows of its first word; relatives "Family, Given" and the same family name in parts with another given name never are', () => withFakes(async () => {
  // (the tester's pairs, each in a world of its own: the first added, then the second planned, asked whether it's the first)
  for (const [first, second, slug] of [['Octavia Ames, Atlanta', 'Octavia Ames, Decatur', 'octavia-ames'], ['Dean Ames, Atlanta', 'Dean Ames, Decatur', 'dean-ames'],
    ['Hezekiah Rowe, Atlanta', 'Hezekiah Rowe, Decatur', 'hezekiah-rowe'], ['Gertrude Rowe, Grace Church', 'Gertrude Rowe, Hope Clinic', 'gertrude-rowe'],
    ['Bartholomew Quill, Grace Church', 'Bartholomew Quill, Hope Clinic', 'bartholomew-quill'], ['Octavia Ames, Edward Jones', 'Octavia Ames, Raymond James', 'octavia-ames'],
    ['Octavia Ames, Edward Jones', 'Octavia Ames', 'octavia-ames'], ['Al Green, Atlanta', 'Al Green, Memphis', 'al-green'], ['Jordan Ames, Atlanta', 'Jordan Ames, Decatur', 'jordan-ames']]) {
    const w = await addWorld();
    const a = await w.addNew(await w.applied(first));
    assert.deepEqual([a.kind, a.slug], ['new', slug], first);
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, among(b)], ['choose', [slug]], `${second}: asked whether it's ${first}`);
  }
  // (relatives and namesakes in parts: never offered, each at the address of all of their name)
  for (const [first, second, secondSlug] of [['Al Fayed, Mohammed', 'Al Fayed, Dodi', 'al-fayed-dodi'], ['De La Cruz, Maria', 'De La Cruz, Xochitl', 'de-la-cruz-xochitl'],
    ['De La Cruz, Xochitl', 'De La Cruz, Maria', 'de-la-cruz-maria'], ['Garcia Lopez, Maria', 'Garcia Lopez, Xochitl', 'garcia-lopez'], ['van der Berg, Piet', 'van der Berg, Klaas', 'van-der-berg-klaas']]) {
    const w = await addWorld();
    await w.addNew(await w.applied(first));
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, among(b), b.slug], ['new', [], secondSlug], `${second}: never offered ${first}`);
  }
}));

test('finding 8: "Family, Given, place": the web address is the name\'s words only, in the order typed; a place, a company, pronouns or letters after the second comma never go in it; People\'s name stays as typed', () => withFakes(async () => {
  for (const [n, address, words] of [['Ames, Jordan, Atlanta', 'ames-jordan', 'Jordan Ames'], ['Ames, Jordan, Grace Church', 'ames-jordan', 'Jordan Ames'],
    ['Ames, Jordan, Edward Jones', 'ames-jordan', 'Jordan Ames'], ['Ames, Jordan, she/her', 'ames-jordan', 'Jordan Ames'], ['Ames, Jordan, Decatur GA', 'ames-jordan', 'Jordan Ames'], ['Ames, Jordan, Decatur', 'ames-jordan', 'Jordan Ames'],
    ['De La Cruz, Maria, Atlanta', 'de-la-cruz-maria', 'De La Cruz Maria'],
    // (more of their given names after it are theirs, as round 20 had it; letters after it are letters)
    ['Ames, Jordan, Amy and Sam', 'ames-jordan-amy-and-sam', 'Jordan Ames'], ['Ames, Jordan, MD', 'jordan-ames', 'Jordan Ames']]) {
    const r = readName(n);
    assert.deepEqual([addressOf(n), r.words.join(' ')], [address, words], n);
  }
  for (const [n, slug] of [['Ames, Jordan, Atlanta', 'ames-jordan'], ['Ames, Jordan, Grace Church', 'ames-jordan'], ['Ames, Jordan, Edward Jones', 'ames-jordan']]) {
    const w = await addWorld();
    const app = await w.applied(n);
    const p = await w.plan(app.id);
    assert.deepEqual([p.kind, p.slug, p.asName || app.name], ['new', slug, n], n);
  }
}));
