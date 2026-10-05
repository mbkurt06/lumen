import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

async function readEnv(file) {
  const raw = await fs.readFile(file, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = await readEnv(path.join(process.cwd(), ".env.local"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Lumen e-posta: ")).trim();
const password = (await rl.question("Lumen şifre: ")).trim();
rl.close();

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw authError;

const { data: root, error: rootError } = await supabase
  .from("library_items")
  .select("id")
  .is("parent_id", null)
  .eq("title", "Tesbihat")
  .maybeSingle();
if (rootError) throw rootError;
if (!root) throw new Error("Tesbihat kökü bulunamadı.");

const R = (text, target = null, note = null) => ({ text, target, note, instruction: false });
const I = text => ({ text, target: null, note: null, instruction: true });

const MUNCIYE = [
  R("Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed."),
  R("Salâten tüncînâ bihâ min-cemî‘i’l-ehvâli ve’l-âfât.", null, "“ve’l-âfât” derken avuç içleri yere bakacak şekilde çevrilir, bitince de eski hâline getirilir."),
  R("Ve takdî lenâ bihâ cemî‘a’l-hâcât."),
  R("Ve tütahhirunâ bihâ min-cemî‘i’s-seyyiât."),
  R("Ve terfe‘unâ bihâ ‘indeke a‘le’d-derecât."),
  R("Ve tübelliğunâ bihâ aksâ’l-gâyât."),
  R("Min-cemî‘i’l-hayrâti fi’l-hayâti ve ba‘de’l-memât."),
  R("Âmîn yâ Mucîbe’d-de‘avâti ve’l-hamdü lillâhi Rabbi’l-âlemîn. Âmîn."),
  I("Denilir ve eller yüze sürülüp indirilir."),
];

const ORTAK_ZIKIR = [
  R("Sübhânellahi ve’l-hamdü lillâhi ve lâ ilâhe illallâhü vallâhü ekber ve lâ havle ve lâ kuvvete illâ billâhi’l-aliyyi’l-azîm."),
  I("Ve Âyetel-Kürsî okunur:"),
  R("Bismillâhirrahmânirrahîm."),
  R("Allâhü lâ ilâhe illâ hüve’l-hayyü’l-kayyûm. Lâ te’huzühû sinetün velâ nevm. Lehû mâ fi’s-semâvâti ve mâ fi’l-ardi. Menze’llezî yeşfe‘u ‘indehû illâ bi-iznih. Ya‘lemü mâ beyne eydîhim ve mâ halfehüm ve lâ yuhîtûne bi-şey’in min-ilmihî illâ bi-mâ şâe. Vesi‘a kürsiyyühü’s-semâvâti ve’l-ardi. Velâ yeûdühû hifzuhümâ ve hüve’l-aliyyü’l-azîm."),
  I("Şu tesbih sözleri tekrarlanır:"),
  R("Ve hüve’l-aliyyü’l-azîmu zü’l-celâli sübhânellâh", 1),
  R("Sübhânellâh", 33),
  R("Sübhâne’l-bâkî dâimeni’l-hamdülillâh", 1),
  R("Elhamdülillâh", 33),
  R("Rabbi’l-âlemîne te‘âlâ şânühû Allâhü Ekber", 1),
  R("Allâhü Ekber", 33),
  R("Lâ ilâhe illallâhü, vahdehû, lâ şerîke leh, lehü’l-mülkü ve lehü’l-hamdü, yuhyî ve yumît ve hüve hayyün lâ yemût, bi-yedihi’l-hayru ve hüve ‘alâ külli şey’in kadîr ve ileyhi’l-masîr."),
  I("Denilir ve namaz duası yapılır."),
  I("Duâdan sonraki tesbihata şöyle devam edilir:"),
  R("Fa‘lem ennehû", 1),
  R("Lâ ilâhe illallâh", 33),
  R("Muhammedü’r-resûlullâhi sallallâhu te‘âlâ ‘aleyhi ve sellem.", 1),
];

const SALAVATLAR = [
  I("Tesbihâtın burasında Peygamberimize (a.s.m.) şöyle salât ve selâm edilir:"),
  R("Bismillâhirrahmânirrahîm."),
  R("İnnallâhe ve melâiketehû yüsallûne ‘ale’n-nebiy. Yâ eyyühellezîne âmenû sallû ‘aleyhi ve sellimû teslîmâ. Lebbeyk."),
  R("Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîrâ."),
  R("Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîrâ."),
  R("Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîran kesîrâ."),
  R("Salli ve sellim yâ Rabbi ‘alâ habîbike Muhammedin ve ‘alâ cemî‘i’l-enbiyâi ve’l-mürselîne ve ‘alâ âli küllin ve sahbi küllin ecma‘în. Âmîn ve’l-hamdü lillâhi Rabbi’l-âlemîn."),
  R("Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ Resûlellah."),
  R("Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ Habîballah."),
  R("Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ emîne vahyillâh."),
  R("Allâhümme salli ve sellim ve bârik ‘alâ seyyidinâ Muhammedin ve ‘alâ âlihî ve ashâbihî bi-‘adedi evrâki’l-eşcâr ve emvâci’l-bihâr ve katarâti’l-emtâr vağfir lenâ verhamnâ veltuf binâ ve bi-Üstâzinâ Sa‘îdi’n-Nursî (radıyallâhu ‘anh) ve vâlideynâ ve bi-talebeti Resâili’n-Nûri’s-sâdıkîne yâ ilâhenâ bi-külli salâtim-minhâ eşhedü el-lâilâhe illallâh ve eşhedü enne Muhammede’r-Resûlullâhi Sallallâhü ‘Aleyhi Vesellem."),
];

const ISMI_AZAM = [
  I("İsm-i A‘zâm duası okunur:"),
  R("Bismillâhirrahmânirrahîm."),
  R("Yâ Cemîlu yâ Allah, Yâ Karîbu yâ Allah"),
  R("Yâ Mucîbu yâ Allah, Yâ Habîbu yâ Allah"),
  R("Yâ Raûfu yâ Allah, Yâ ‘Atûfu yâ Allah"),
  R("Yâ Ma‘rûfu yâ Allah, Yâ Latîfu yâ Allah"),
  R("Yâ ‘Azîmu yâ Allah, Yâ Hannânu yâ Allah"),
  R("Yâ Mennânu yâ Allah, Yâ Deyyânu yâ Allah"),
  R("Yâ Sübhânu yâ Allah, Yâ Emânu yâ Allah"),
  R("Yâ Bürhânu yâ Allah, Yâ Sultânu yâ Allah"),
  R("Yâ Müste‘ânu yâ Allah, Yâ Muhsinu yâ Allah"),
  R("Yâ Müte‘âlu yâ Allah, Yâ Rahmânu yâ Allah"),
  R("Yâ Rahîmu yâ Allah, Yâ Kerîmu yâ Allah"),
  R("Yâ Mecîdu yâ Allah, Yâ Ferdu yâ Allah"),
  R("Yâ Vitru yâ Allah, Yâ Ehadu yâ Allah"),
  R("Yâ Samedu yâ Allah, Yâ Mahmûdu yâ Allah"),
  R("Yâ Sâdıka’l-Va‘di yâ Allah, Yâ ‘Aliyyu yâ Allah"),
  R("Yâ Ganiyyu yâ Allah, Yâ Şâfî yâ Allah"),
  R("Yâ Kâfî yâ Allah, Yâ Mu‘âfî yâ Allah"),
  R("Yâ Bâkî yâ Allah, Yâ Hâdî yâ Allah"),
  R("Yâ Kâdiru yâ Allah, Yâ Sâtiru yâ Allah"),
  R("Yâ Kahhâru yâ Allah, Yâ Cebbâru yâ Allah"),
  R("Yâ Gaffâru yâ Allah, Yâ Fettâhu yâ Allah"),
  I("Avuçlar yukarı gelecek şekilde eller açılır:"),
  R("Yâ Rabbe’s-semâvâti ve’l-ardi, yâ ze’l-celâli ve’l-ikrâm. Es’elüke bi-hakkı hâzihi’l-esmâi küllihâ entüsalliye ‘alâ-seyyidinâ Muhammedin kemâ salleyte ve sellemte ve bârekte ve rahimte ve terahhamte ‘alâ İbrâhîme ve ‘alâ âli İbrâhîme fi’l-âlemîn, Rabbenâ inneke hamîdü’m-mecîd, bi-rahmetike yâ erhamerrâhimîn, ve’l-hamdü lillâhi Rabbi’l-âlemîn."),
];

const UZUN_ISTIAZE = [
  I("İstiâze Duası’yla tesbihâta devam edilir. Dua ederken eller kaldırılır ve avuç içleri yere bakacak şekilde tutulur:"),
  R("Allâhümme ecirnâ mine’n-nâr.", 3, "3, 5 veya 7 defa tekrar edilir."),
  R("Allâhümme ecirnâ min-külli nâr."),
  R("Allâhümme ecirnâ min-fitneti’d-dîniyyeti ve’d-dünyeviyyeh."),
  R("Allâhümme ecirnâ min-fitneti âhiri’z-zemân."),
  R("Allâhümme ecirnâ min-fitneti Mesîhi’d-Deccâli ve’s-Süfyân."),
  R("Allâhümme ecirnâ mine’d-dalâlâti ve’l-bid’iyyâti ve’l-beliyyât."),
  R("Allâhümme ecirnâ min-şerri’n-nefsi’l-emmâreh."),
  R("Allâhümme ecirnâ min-şürûri’n-nüfûsi’l-emmârâti’l-fir‘avniyyeh."),
  R("Allâhümme ecirnâ min-şerri’n-nisâ."),
  R("Allâhümme ecirnâ min-belâi’n-nisâ."),
  R("Allâhümme ecirnâ min-fitneti’n-nisâ."),
  R("Allâhümme ecirnâ min-‘azâbi’l-kabr."),
  R("Allâhümme ecirnâ min-‘azâbi yevmi’l-kıyâmeh."),
  R("Allâhümme ecirnâ min-‘azâbi Cehennem."),
  R("Allâhümme ecirnâ min-‘azâbi kahrik."),
  R("Allâhümme ecirnâ min-nâri kahrik."),
  R("Allâhümme ecirnâ min-‘azâbi’l-kabri ve’n-nîrân."),
  R("Allâhümme ecirnâ mine’r-riyâi ve’s-süm‘ati ve’l-‘ucubi ve’l-fahr."),
  R("Allâhümme ecirnâ min-tecâvüzi’l-mülhidîn."),
  R("Allâhümme ecirnâ min-şerri’l-münâfikîn."),
  R("Allâhümme ecirnâ min-fitneti’l-fâsikîn."),
  R("Allâhümme ecirnâ ve ecir vâlideynâ ve talebete Resâili’n-Nûri’s-sâdıkîne fi-hidmeti’l-Kur’âni ve’l-îmân. Ve ahbâbene’l-mü’minîne’l-muhlisîne ve akrabâenâ ve ecdâdenâ mine’n-nâr."),
  I("Bundan sonra avuç içleri yukarı çevrilir."),
  R("Bi-‘afvike yâ Mücîr, bi-fadlike yâ Gaffâr."),
  R("Allâhümme’d-hilne’l-Cennete me‘a’l-ebrâr."),
  R("Allâhümme’d-hilne’l-Cennete me‘a’l-ebrâr."),
  R("Allâhümme’d-hilnâ ve edhil Üstâzenâ Sa‘îde’n-Nursî (radıyallâhu ‘anh) ve vâlideynâ ve talebete Resâili’n-Nûri’s-sâdıkîne ve ihvânenâ ve ehavâtinâ ve akrabâenâ ve ecdâdenâ ve ahbâbene’l-mü’minîne’l-muhlisîne fi-hidmeti’l-îmâni ve’l-Kur’ân. El-Cennete me‘a’l-ebrâr bi-şefâati nebiyyike’l-muhtâr ve âlihi’l-ethâr ve eshâbihi’l-ahyâr ve sellim mâ dâme’l-leylü ve’n-nehâr. Âmîn, ve’l-hamdü lillâhi Rabbi’l-Âlemîn."),
  I("Denilir ve eller yüze sürülür."),
];

const DUA_TERCUMAN = [
  I("Aşağıdaki Duâ-i Tercümân-ı İsm-i A‘zâm ile tesbihata devam edilir:"),
  R("Sübhâneke yâ Allah te‘âleyte yâ Rahmân ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Rahîm te‘âleyte yâ Kerîm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Hamîd te‘âleyte yâ Hakîm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Mecîd te‘âleyte yâ Melik ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Kuddûs te‘âleyte yâ Selâm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Mü’min te‘âleyte yâ Müheymin ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ ‘Azîz te‘âleyte yâ Cebbâr ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Mütekebbir te‘âleyte yâ Hâlık ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Evvel te‘âleyte yâ Âhir ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Zâhir te‘âleyte yâ Bâtın ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Bâri’ te‘âleyte yâ Musavvir ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Tevvâb te‘âleyte yâ Vehhâb ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Bâis te‘âleyte yâ Vâris ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Kadîm te‘âleyte yâ Mukîm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Ferd te‘âleyte yâ Vitr ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Nûr te‘âleyte yâ Settâr ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Celîl te‘âleyte yâ Cemîl ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Kâhir te‘âleyte yâ Kâdir ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Melik te‘âleyte yâ Muktedir ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ ‘Âlim te‘âleyte yâ ‘Allâm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ ‘Azîm te‘âleyte yâ Gâfûr ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Halîm te‘âleyte yâ Vedûd ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Şehîd te‘âleyte yâ Şâhid ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Kebîr te‘âleyte yâ Müte‘âl ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Nûr te‘âleyte yâ Latîf ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Semî‘ te‘âleyte yâ Kefîl ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Karîb te‘âleyte yâ Basîr ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Hak te‘âleyte yâ Mübîn ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Raûf te‘âleyte yâ Rahîm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Tâhir te‘âleyte yâ Mutahhir ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Mücemmil te‘âleyte yâ Mufaddıl ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Muzhir te‘âleyte yâ Mün‘im ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Deyyân te‘âleyte yâ Sultân ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Hannân te‘âleyte yâ Mennân ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Ehad te‘âleyte yâ Samed ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Hayy te‘âleyte yâ Kayyûm ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ ‘Adl te‘âleyte yâ Hakem ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  R("Sübhâneke yâ Ferd te‘âleyte yâ Kuddûs ecirnâ mine’n-nâr bi-‘afvike yâ Rahmân."),
  I("Avuçlar yukarı gelecek şekilde eller kaldırılır:"),
  R("Sübhâneke âhiyyen şerâhiyyen te‘âleyte lâ ilâhe illâ ente ecirnâ ve ecir Üstâzenâ Sa‘îde’n-Nursî (radıyallâhu ‘anh) ve vâlideynâ ve ihvânenâ ve ehavâtinâ ve talebete Resâili’n-Nûri ve rufekâenâ ve ahbâbene’l-mü’minîne’l-muhlisîne mine’n-nâr."),
  I("Avuç içleri yere bakacak şekilde çevrilir."),
  R("Ve min-külli nâr vahfeznâ min-şerri’n-nefsi ve’ş-şeytân ve min-şerri’l-cinni ve’l-insân ve min-şerri’l-bid‘ati ve’d-dalâlâti ve’l-ilhâdi ve’t-tuğyân."),
  I("Avuç içleri tekrar yukarıya bakacak şekle getirilir."),
  R("Bi-‘afvike yâ Mücîr, bi-fadlike yâ Gaffâr bi-rahmetike yâ Erhame’r-râhimîn."),
  R("Allâhümme edhilne’l-Cennete me‘a’l-ebrâr, bi-şefâati nebiyyike’l-muhtâr. Âmîn, ve’l-hamdü lillâhi Rabbi’l-Âlemîn."),
];

const SURES = {
  hasr: [
    I("Haşir Sûresi’nin 20-24. âyetleri (Lâyestevî) okunur ve tesbihat sona erer, namaz bitirilir."),
    R("Bismillâhirrahmânirrahîm."),
    R("Lâ yestevî ashâbü’n-nâri ve ashâbü’l-Cenneh. Ashâbü’l-Cenneti hümü’l-fâizûn."),
    R("Lev enzelnâ hâze’l-Kur’âne ‘alâ cebelin leraeytehû hâşi‘an-mütesaddian-min-haşyetillâh. Ve tilke’l-emsâlü nadribuhâ linnâsi le‘allehüm yetefekkerûn."),
    R("Hüvallâhü’l-lezî lâ ilâhe illâ hû. ‘Âlimü’l-gaybi ve’ş-şehâdeh. Hüve’r-Rahmânü’r-Rahîm."),
    R("Hüvallâhü’l-lezî lâ ilâhe illâ hû. El-Melikü’l-Kuddûsü’s-Selâmü’l-Mü’minü’l-Müheyminü’l-‘Azîzü’l-Cebbârü’l-Mütekebbir. Sübhânallâhi ‘ammâ yüşrikûn."),
    R("Hüvallâhü’l-Hâlikü’l-Bâriü’l-Musavviru lehü’l-Esmâü’l-Hüsnâ. Yüsebbihu lehû mâ fi’s-semâvâti ve’l-ardi. Vehüve’l-‘Azîzü’l-Hakîm."),
  ],
  fetih: [
    I("Fetih Sûresi’nin 27-29. âyetleri (Lekad Sadakallâhü) okunur ve tesbihat sona erer."),
    R("Bismillâhirrahmânirrahîm."),
    R("Lekad sadakallâhü resûlehü’r-rü’yâ bi’l-hakkı letedhulünne’l-mescide’l-harâme inşâallâhü âminîne muhallikîne ruûseküm ve mukassırîne lâ tehâfûne, fe‘alime mâ lem ta‘lemû fece‘ale min-dûni zâlike fethan karîbâ."),
    R("Hüvellezî ersele rasûlehû bi’l-hüdâ ve dîni’l-hakkı li-yuzhirahû ‘ale’d-dîni küllihî ve kefâ billâhi şehîdâ."),
    R("Muhammedü’r-resûlullâhi ve’l-lezîne me‘ahû eşiddâü ‘ale’l-küffâri ruhamâü beynehüm terâhüm rukke‘an sücceden yebteğûne fadlem-minallâhi ve rıdvânâ, sîmâhüm fî-vücûhihim min-eseri’s-sücûd. Zâlike meselühüm fi’t-tevrâti ve meselühüm fi’l-incîli kezer‘in ahrace şat’ehû feâzerahû festağleza festevâ ‘alâ sûkihî yu‘cibü’z-zürrâ‘a li-yağîza bi-himü’l-küffâr. Ve‘adallâhü’l-lezîne âmenû ve ‘amilü’s-sâlihâti min-hüm mağfiraten ve ecran ‘azîmâ."),
  ],
  bakara: [
    I("Bakara Sûresi’nin 285-286. âyetleri (Âmene’r-resûlü) okunur ve tesbihat sona erer."),
    R("Bismillâhirrahmânirrahîm."),
    R("Âmene’r-resûlü bimâ ünzile ileyhi mir-rabbihî ve’l-mü’minûn. Küllün âmene billâhi ve melâiketihî ve kütübihî ve rusulih. Lâ nüferriku beyne ehadim-mirrusulih. Ve kâlû semi‘nâ ve ata‘nâ ğufrâneke rabbenâ ve ileyke’l-masîr."),
    R("Lâ yükellifullâhü nefsen illâ vüs‘ahâ. Lehâ mâ kesebet ve aleyhâ mektesebet. Rabbenâ lâ tüâhiznâ in-nesînâ ev ahta’nâ. Rabbenâ velâ tahmil ‘aleynâ isran kemâ hameltehû ‘alellezîne min-kablinâ. Rabbenâ velâ tühammilnâ mâ lâ tâkate le-nâ bih. Va‘fü ‘annâ, vağfir le-nâ, verhamnâ, ente mevlânâ fensurnâ ‘ale’l-kavmil kâfirîn."),
  ],
  nebe: [
    I("Nebe’ (Amme) Sûresi okunur ve tesbihat sona erer."),
    R("Bismillâhirrahmânirrahîm."),
    R("‘Amme yetesâelûn. Ani’n-nebei’l-azîm. Ellezî hüm fîhi muhtelifûn. Kellâ seya‘lemûn. Sümme kellâ seya‘lemûn. Elem nec‘ali’l-arda mihâdâ. Ve’l-cibâle evtâdâ. Ve halaknâküm ezvâcâ. Ve ce‘alnâ nevmeküm sübâtâ. Ve ce‘alne’l-leyle libâsâ. Ve ce‘alne’n-nehâra me‘âşâ. Ve beneynâ fevkaküm seb‘an şidâdâ. Ve ce‘alnâ sirâcev-vehhâcâ. Ve enzelnâ mine’l-mu‘sırâti mâen seccâcâ. Linuhrice bihî habbev-venebâtâ. Ve cennâtin elfâfâ. İnne yevme’l-fasli kâne mîkâtâ. Yevme yünfehu fi’s-sûri fete’tûne efvâcâ. Ve fütihati’s-semâü fekânet ebvâbâ. Ve süyyirati’l-cibâlü fekânet serâbâ. İnne Cehenneme kânet mirsâdâ."),
    R("Li’t-tâğîne meâbâ. Lâbisîne fîhâ ehkâbâ. Lâ yezûkûne fîhâ berdev-velâ şarâbâ. İllâ hamîmev-veğassâkâ. Cezâev-vifâkâ. İnnehüm kânû lâ yercûne hisâbâ. Ve kezzebû bi-âyâtinâ kizzâbâ. Ve külle şey’in ahsaynâhü kitâbâ. Fezûkû felen-nezîdeküm illâ ‘azâbâ. İnne li’l-müttekîne mefâzâ. Hadâika ve a‘nâbâ. Ve kevâibe etrâbâ. Ve ke’sen dihâkâ. Lâ yesme‘ûne fîhâ lağvev-velâ-kizzâbâ. Cezâem-mir-Rabbike ‘atâen hisâbâ. Rabbi’s-semâvâti ve’l-ardi vemâ beynehüme’r-rahmâni lâ yemlikûne minhü hitâbâ. Yevme yekûmü’r-rûhu ve’l-melâiketü saffâ. Lâ yetekellemûne illâ men ezine lehü’r-rahmânü ve kâle savâbâ. Zâlike’l-yevmü’l-hakku femenşâettehaze ilâ Rabbihî meâbâ. İnnâ enzernâküm ‘azâben karîbâ, yevme yenzuru’l-mer’ü mâ kaddemet yedâhü ve yekûlü’l-kâfiru yâ leytenî küntü türâbâ."),
  ],
};

const SABAH = [
  I("Sabah namazının farzı kılınıp selâm verildikten sonra,"),
  R("Allâhümme ente’s-selâmü ve minke’s-selâm, tebârekte yâ ze’l-celâli ve’l-ikrâm."),
  I("Denilir ve aşağıdaki Salât-ı Münciye Duası, (yani Salâte’n-Tüncînâ) okunur:"),
  ...MUNCIYE,
  I("Sonra tesbihâta şöyle devam edilir:"),
  R("Allâhümme innâ nukaddimu ileyke beyne yedey külli nefesin ve lemhatin ve lâhzatin ve tarfetin yatrifü bi-hâ ehlü’s-semâvâti ve ehlü’l-aradîne şehâdeten: Eşhedü en..."),
  I("Buraya kadar bir defa söylenir."),
  R("Lâ ilâhe illallâhü vahdehû lâ şerîke leh. Lehü’l-mülkü ve lehü’l-hamdü yuhyî ve yumît. Ve hüve hayyün lâ yemût, bi-yedihi’l-hayr ve hüve ‘alâ külli şey’in kadîr", 10, "On defa tekrar edilir ve sonunda “ve ileyhi’l-masîr” denilerek Kelime-i Tevhid bitirilir."),
  R("Ve ileyhi’l-masîr."),
  ...UZUN_ISTIAZE,
  I("Sonra namaz tesbihatına şu dua ile devam edilir:"),
  ...ORTAK_ZIKIR,
  I("İsteyen sabah ve yatsı namazlarından sonra “Lâ ilâhe illallâh”ı 100 defa tekrarlayabilir."),
  R("Lâilâhe illallâhü el-melikü’l-hakku’l-mübîn, Muhammedü’r-resûlullâhi sâdiku’l-va‘di’l-emîn.", 10),
  ...SALAVATLAR,
  ...DUA_TERCUMAN.slice(17),
  ...SURES.hasr,
];

const OGLE = [
  I("Öğle namazının farzı kılınıp selâm verildikten sonra,"),
  R("Allâhümme ente’s-selâmü ve minke’s-selâm, tebârekte yâ ze’l-celâli ve’l-ikrâm."),
  I("Denir ve aşağıdaki Salât-ı Münciye Duası, (yani Salâte’n-Tüncînâ) okunur:"),
  ...MUNCIYE,
  I("Öğle namazının son sünneti kılınır. Selâm verdikten sonra tesbihata şu dua ile devam edilir."),
  ...ORTAK_ZIKIR,
  ...SALAVATLAR,
  ...ISMI_AZAM,
  ...SURES.fetih,
];

const IKINDI = [
  I("İkindi namazının farzı kılınıp selâm verildikten sonra,"),
  R("Allâhümme ente’s-selâmü ve minke’s-selâm, tebârekte yâ ze’l-celâli ve’l-ikrâm."),
  I("Denilir ve aşağıdaki Salât-ı Münciye Duası, (yani Salâte’n-Tüncînâ) okunur:"),
  ...MUNCIYE,
  I("Sonra tesbihata şu dua ile devam edilir:"),
  ...ORTAK_ZIKIR,
  ...SALAVATLAR,
  ...DUA_TERCUMAN,
  ...SURES.nebe,
];

const AKSAM = [
  I("Akşam namazının farzı kılınıp selâm verildikten sonra,"),
  R("Allâhümme ente’s-selâmü ve minke’s-selâm, tebârekte yâ ze’l-celâli ve’l-ikrâm."),
  I("Denilir ve aşağıdaki Salât-ı Münciye Duası, (yani Salâte’n-Tüncînâ) okunur:"),
  ...MUNCIYE,
  I("Akşam namazının son sünneti kılınır. Selâm verdikten sonra,"),
  R("Âmennâ bi-ennehû", 1),
  R("Lâ ilâhe illallâhü, vahdehû, lâ şerîke leh, lehü’l-mülkü ve lehü’l-hamdü, yuhyî ve yumît, bi-yedihi’l-hayr ve hüve ‘alâ külli şey’in kadîr.", 9),
  I("Dokuz defa söylenir; onuncuda ise aşağıdaki ilâve cümleyle tekrar edilir."),
  R("Lâ ilâhe illallâhü, vahdehû, lâ şerîke leh, lehü’l-mülkü ve lehü’l-hamdü, yuhyî ve yumît ve hüve hayyün lâ yemût, bi-yedihi’l-hayr ve hüve ‘alâ külli şey’in kadîr ve ileyhi’l-masîr.", 1),
  ...UZUN_ISTIAZE,
  I("Sonra tesbihata şöyle devam edilir:"),
  ...ORTAK_ZIKIR,
  ...SALAVATLAR,
  ...ISMI_AZAM,
  ...SURES.hasr,
];

const YATSI = [
  I("Yatsı namazının farzı kılınıp selâm verildikten sonra,"),
  R("Allâhümme ente’s-selâmü ve minke’s-selâm, tebârekte yâ ze’l-celâli ve’l-ikrâm."),
  I("Denilir ve aşağıdaki Salât-ı Münciye Duası, (yani Salâte’n-Tüncînâ) okunur:"),
  ...MUNCIYE,
  I("Yatsı namazının son sünneti ve Vitir namazı kılınır. Selâm verildikten sonra tesbihata şu dua ile devam edilir."),
  ...ORTAK_ZIKIR,
  ...SALAVATLAR,
  ...ISMI_AZAM,
  ...SURES.bakara,
];

const docs = [
  ["Sabah Namazı Tesbihatı", 0, SABAH],
  ["Öğle Namazı Tesbihatı", 1, OGLE],
  ["İkindi Namazı Tesbihatı", 2, IKINDI],
  ["Akşam Namazı Tesbihatı", 3, AKSAM],
  ["Yatsı Namazı Tesbihatı", 4, YATSI],
];

async function getOrCreateDoc(title, order) {
  const { data: existing, error: findError } = await supabase
    .from("library_items")
    .select("id")
    .eq("parent_id", root.id)
    .eq("title", title)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase
      .from("library_items")
      .update({
        sort_order: order,
        metadata: { source: "namaz-tesbihati-pdf-verbatim-2026-10-05" },
      })
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supabase
    .from("library_items")
    .insert({
      parent_id: root.id,
      kind: "document",
      title,
      subtitle: null,
      sort_order: order,
      metadata: { source: "namaz-tesbihati-pdf-verbatim-2026-10-05" },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function replaceRows(documentId, rows) {
  const { error: deleteError } = await supabase.from("content_nodes").delete().eq("document_id", documentId);
  if (deleteError) throw deleteError;

  const payload = rows.map((row, index) => ({
    document_id: documentId,
    parent_id: null,
    kind: row.instruction ? "instruction" : "phrase",
    sort_order: index,
    title: null,
    text_content: row.text,
    secondary_text: null,
    translation: null,
    metadata: {
      instruction: !!row.instruction,
      target: row.target ?? null,
      note: row.note ?? null,
      source: "namaz-tesbihati-pdf-verbatim-2026-10-05",
    },
  }));

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("content_nodes").insert(payload.slice(i, i + 200));
    if (error) throw error;
  }
}

for (const [title, order, rows] of docs) {
  const id = await getOrCreateDoc(title, order);
  await replaceRows(id, rows);
  console.log("PDF’ye göre yeniden yazıldı:", title, "-", rows.length, "satır/parça");
}

// Ayrı eserler: kullanıcı bunları ezber için ayrıca kullanıyor.
for (const oldTitle of ["Namaz Sonrası Salavatlar"]) {
  const { data: old } = await supabase
    .from("library_items")
    .select("id")
    .eq("parent_id", root.id)
    .eq("title", oldTitle)
    .maybeSingle();
  if (old) {
    const { error } = await supabase.from("library_items").delete().eq("id", old.id);
    if (error) throw error;
    console.log("Ayrı listeden kaldırıldı:", oldTitle);
  }
}

const extraDocs = [
  ["Salât-ı Münciye (Salâten Tüncînâ)", 5, MUNCIYE],
  ["İstiâze Duası (Uzun)", 6, UZUN_ISTIAZE],
];

for (const [title, order, rows] of extraDocs) {
  const id = await getOrCreateDoc(title, order);
  await replaceRows(id, rows);
  console.log("Ezber eseri güncellendi:", title);
}

console.log("\nTamamlandı.");
console.log("Beş namaz tesbihatı PDF sırasına göre baştan yazıldı.");
console.log("Salavatın ilk iki 'kesîrâ' satırı ve üçüncü 'kesîran kesîrâ' satırı ayrı ayrı bulunuyor.");
console.log("Ayrı 'Namaz Sonrası Salavatlar' eseri kaldırıldı.");
