**Automatinio mikrofono išjungimo patikra · 2026-09-12**

Gyvas pokalbis automatiškai sustabdomas po 2 minučių be atpažintos kalbos arba po 10 minučių be aiškaus naudotojo patvirtinimo. Prieš terminą rodomas 20 sekundžių perspėjimas. Kalba panaikina tylos perspėjimą, tačiau ilgesniam pokalbiui reikia paspausti „Tęsti pokalbį“. Ryšio atkūrimas šių terminų nenustato iš naujo.

Užrakinus telefoną ar išėjus į kitą programėlę, puslapio `visibilitychange` / `pagehide` apdorojimas iškart sustabdo mikrofono takelius, uždaro WebRTC ir siunčia sesijos uždarymo užklausą. Mikrofonas automatiškai neįjungiamas grįžus. Išsaugotas tekstas naudojamas tęsiant pokalbį. Klausimo diktavimas ribojamas iki 60 sekundžių ir taip pat stabdomas paslėpus puslapį.

Programėlė paleista vietiniame „Cloudflare“ serveryje. Visos nuotraukos yra **tik matomo naršyklės lango** (`fullPage: false`), užfiksuotos neslenkant puslapio. Tikrinti `innerHeight`, `clientHeight`, `visualViewport.height` ir mygtukų ribos; visais žemiau pateiktais atvejais aukščiai sutapo, `scrollY = 0`, horizontalaus perpildymo nebuvo.

| Telefono langas | Pradžios veiksmų apačia | Perspėjimo mygtukų apačia | Sustabdyto pokalbio „Tęsti“ apačia |
| --- | ---: | ---: | ---: |
| 360 × 800 | 575 px | 578 px | 363 px |
| 375 × 812 | 575 px | 584 px | 351 px |
| 390 × 844 | 582 px | 600 px | 351 px |
| 430 × 932 | 582 px | 644 px | 351 px |
| 390 × 640, mažesnis langas | 582 px | 498 px | 313 px |

Peržiūrėtos ekrano nuotraukos: visos trys pradžios funkcijos iškart matomos, pavadinimai telpa, didelio atviruko telefone nėra. Perspėjimas trumpas, atgalinis skaičiavimas aiškus; abu pasirinkimai telpa lange ir yra bent 57 px aukščio. Patikrinti ir 768 × 1024, 1024 × 900 bei 1440 × 1080 langai. „WebKit“ papildomai nufotografuotas ties 360 × 800 ir 430 × 932; darbalaukio atvirukas ir vizualinis stilius išliko.

Pirmoje iteracijoje ties 390 × 640 po automatinio sustabdymo apatiniai mygtukai uždengė vertimą. Sutrumpintas sustabdymo paaiškinimas, o baigto pokalbio telefone paslėpta kalbų juosta. Pakartotinėje nuotraukoje paskutinis vertimas matomas virš mygtukų; tai tikrinama ir atskiru regresiniu testu.

- [Prieš pataisymą: 390 × 640](iteration-1/stopped-chromium-390x640.png)
- [Po pataisymo: 390 × 640](final/stopped-chromium-390x640.png)
- [Perspėjimas: 360 × 800](final/warning-chromium-360x800.png)
- [Pradžia: 375 × 812](final/home-chromium-375x812.png)
- [Pradžia: 390 × 844](final/home-chromium-390x844.png)
- [Pradžia: 430 × 932](final/home-chromium-430x932.png)
- [„WebKit“ perspėjimas: 360 × 800](final/warning-webkit-360x800.png)
- [Visi galutiniai matavimai](final/geometry.json)

`npm run build:cloudflare` praėjo. **87 / 87 naršyklės testai praėjo**, įskaitant 39 naujus mikrofono apsaugų scenarijų vykdymus darbalaukio „Chrome“, „Android Chrome“ ir „iPhone WebKit“ profiliuose. Tikrinti terminai, persijungimas į foną, `sendBeacon` atsarginis `keepalive` kelias, vėluojantis mikrofono leidimas, ryšio atkūrimas, istorijos išlaikymas, diktavimas, mygtukų geometrija ir WCAG AA automatizuota patikra.

Testuose mikrofonas, WebRTC ir AI atsakymai imituoti; realios AI užklausos nesiųstos. Telefono užrakinimas tikrintas puslapio gyvavimo įvykiais, o ne fizinio įrenginio užrakinimo mygtuku. Tikrų „iPhone“ / „Android“ operacinių sistemų bandymas lieka patikrai telefone po diegimo.

Ekrano nuotraukas galima pakartoti prieš vietinį serverį paleidus `node --import tsx scripts/capture-listening-safety.ts final`. Numatytasis adresas `http://127.0.0.1:8787`; jį galima pakeisti per `QA_BASE_URL`.
