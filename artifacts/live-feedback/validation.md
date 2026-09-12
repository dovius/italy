**Aiškesnis gyvo pokalbio ekranas · 2026-09-12**

Jungiantis matoma besisukanti piktograma ir „Jungiamės…“. Tik gavus vertėjo `session.started` patvirtinimą atsiranda žalia varnelė, „Prisijungta“ ir „Galite kalbėti“. Telefone matoma klausymo juosta: ramus judesys rodo pasirengimą, o bangelių aukštis reaguoja į esamą mikrofono garsumo matuoklį. Pristabdžius mikrofoną, pasibaigus pokalbiui ar atkuriant ryšį klausymo animacija nerodoma. Būsena visada paaiškinta ir tekstu.

Programėlė paleista vietiniame „Cloudflare“ serveryje. Padarytos ir vizualiai peržiūrėtos **viewport-only** nuotraukos (`fullPage: false`) ties 360 × 800, 375 × 812, 390 × 844, 430 × 932 ir sumažintu 390 × 640 langu. Patikrinti 768 × 1024, 1024 × 900 ir 1440 × 1080 dydžiai. „WebKit“ papildomai patikrintas ties 360 × 800, 430 × 932 ir 390 × 640.

Pirmoje iteracijoje laukimo bangelės atrodė pernelyg plokščios. Padidintas jų judesys tyloje, išlaikant ryškesnę reakciją kalbant. Pakartotinės nuotraukos patvirtino, kad klausymo juostos aukštis nepadidėjo. Mažame 390 × 640 lange būsena, grafikas, paskutinis vertimas ir valdymo mygtukai telpa; ankstesnį tekstą galima paslinkti pokalbio srityje.

| Telefono langas | Valdymo mygtukų apačia su vertimu | Matomas lango aukštis |
| --- | ---: | ---: |
| 360 × 800 | 790 px | 800 px |
| 375 × 812 | 802 px | 812 px |
| 390 × 844 | 834 px | 844 px |
| 430 × 932 | 811 px | 932 px |
| 390 × 640 | 630 px | 640 px |

Matavimuose tikrinti `innerHeight`, `clientHeight`, `visualViewport.height`, `scrollY` ir valdiklių ribos. Pradžios ekrano trys pasirinkimai taip pat telpa visuose tikrintuose telefono languose. Darbalaukio pradžios ekranas išlaikė atviruko stilių; darbalaukio pokalbio istorija lieka slenkama.

- [Trumpas judesio ir būsenų įrašas, 390 × 844](final/demo-390x844.webm)
- [Jungiamės: 360 × 800](final/connecting-chromium-360x800.png)
- [Klausomės: 360 × 800](final/listening-chromium-360x800.png)
- [Reakcija į balsą: 375 × 812](final/voice-chromium-375x812.png)
- [Pokalbis ir valdymas: 390 × 844](final/transcript-chromium-390x844.png)
- [Klausomės: 430 × 932](final/listening-chromium-430x932.png)
- [Mažesnis „WebKit“ langas: 390 × 640](final/transcript-webkit-390x640.png)
- [Galutiniai matavimai](final/geometry.json)

`npm run build:cloudflare` ir **117 / 117 naršyklės testų praėjo**. Nauji patikrinimai tikrina, kad vien WebRTC prisijungimas dar nerodytų pasirengimo kalbėti, kad bangelės iš tiesų judėtų ir reaguotų į signalą, o pristabdžius ar praradus ryšį nebūtų rodomas klausymas. Patikrintas `prefers-reduced-motion`, WCAG AA, mikrofono automatinio sustabdymo apsaugos, ankstesni programėlės srautai ir PWA.

Mikrofono signalas ir AI ryšys patikroje imituoti; tikros OpenAI sesijos nekurtos. Ekrano įrašas rodo tikrą naršyklėje veikiančią sąsają su šiuo bandomuoju signalu.

Pakartoti: paleidus vietinę programėlę ties 8787 prievadu, vykdyti `node --import tsx scripts/capture-live-feedback.ts final`. Adresą galima pakeisti per `QA_BASE_URL`.
