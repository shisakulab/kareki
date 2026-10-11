// テーマ定義：和菓子。お題の根拠は docs/quests.md
export default {
  id: 'jonamagashi', name: '和菓子', unit: '品',
  periods: [
    { key: '01', label: '睦月', color: '#d9788a',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '01_zenzai', name: 'ぜんざい', glyph: '善', aliases: ['おしるこ', 'お汁粉', '汁粉', '善哉'], hint: '1月11日ごろの鏡開きで、鏡餅を入れて食べる' },
      { key: '01_ichigo_daifuku', name: 'いちご大福', glyph: '苺', aliases: ['苺大福', 'イチゴ大福'], hint: 'いちごがおいしくなる冬〜春の大福' },
      { key: '01_hanabira_mochi', name: '花びら餅', glyph: '花', aliases: ['はなびら餅', '菱葩'], hint: '白い求肥でごぼうと白味噌あんを包んだ、新年の菓子' },
      { key: '01_uguisu_mochi', name: 'うぐいす餅', glyph: '鶯', aliases: ['鶯餅'], hint: '青きな粉をまぶした、春を待つ鳥の形の餅' },
      ] },
    { key: '02', label: '如月', color: '#c9a63c',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '02_ichigo_daifuku', name: 'いちご大福', glyph: '苺', aliases: ['苺大福', 'イチゴ大福'], hint: 'いちごがおいしくなる冬〜春の大福' },
      { key: '02_uguisu_mochi', name: 'うぐいす餅', glyph: '鶯', aliases: ['鶯餅'], hint: '青きな粉をまぶした、春を待つ鳥の形の餅' },
      { key: '02_tsubaki_mochi', name: '椿餅', glyph: '椿', aliases: ['つばき餅'], hint: '椿の葉ではさんだ道明寺の餅。早春の菓子' },
      { key: '02_sakura_mochi', name: '桜餅', glyph: '桜', aliases: ['道明寺', '長命寺', 'さくら餅'], hint: 'ひな祭りに向けて、2月から店に並びはじめる' },
      ] },
    { key: '03', label: '弥生', color: '#8fb86a',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '03_sakura_mochi', name: '桜餅', glyph: '桜', aliases: ['道明寺', '長命寺', 'さくら餅'], hint: 'ひな祭りの定番。関東は長命寺、関西は道明寺が多い' },
      { key: '03_kusa_mochi', name: '草餅', glyph: '草', aliases: ['よもぎ餅', '草もち', '蓬餅'], hint: '芽吹いたよもぎを入れた春の餅' },
      { key: '03_hina_arare', name: 'ひなあられ', glyph: '雛', aliases: ['雛あられ'], hint: 'ひな祭りに供えるあられ' },
      { key: '03_botamochi', name: 'ぼたもち', glyph: '牡', aliases: ['牡丹餅', 'おはぎ'], hint: '春のお彼岸に食べる。秋は「おはぎ」と呼ぶことが多い' },
      ] },
    { key: '04', label: '卯月', color: '#e59bb0',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '04_hanami_dango', name: '花見団子', glyph: '花', aliases: ['三色団子'], hint: '桃・白・緑の三色。お花見のお供' },
      { key: '04_sakura_mochi', name: '桜餅', glyph: '桜', aliases: ['道明寺', '長命寺', 'さくら餅'], hint: '桜の葉の塩漬けで包んだ、花の季節の餅' },
      { key: '04_kusa_dango', name: '草団子', glyph: '蓬', aliases: ['よもぎ団子', '草だんご'], hint: 'よもぎの香りの団子' },
      { key: '04_ichigo_daifuku', name: 'いちご大福', glyph: '苺', aliases: ['苺大福', 'イチゴ大福'], hint: 'いちごの季節の終わりまで楽しめる大福' },
      ] },
    { key: '05', label: '皐月', color: '#4fae86',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '05_kashiwa_mochi', name: '柏餅', glyph: '柏', aliases: ['かしわ餅', 'かしわもち'], hint: '5月5日の端午の節句に食べる' },
      { key: '05_chimaki', name: 'ちまき', glyph: '粽', aliases: ['粽'], hint: '端午の節句に食べる。関西で特によく食べられる' },
      { key: '05_kusa_mochi', name: '草餅', glyph: '草', aliases: ['よもぎ餅', '草もち', '蓬餅'], hint: 'よもぎがよく育つ季節の餅' },
      { key: '05_warabi_mochi', name: 'わらび餅', glyph: '蕨', aliases: ['わらびもち', '蕨餅'], hint: 'ぷるぷるの冷たい餅。初夏から夏に' },
      ] },
    { key: '06', label: '水無月', color: '#7a8fd0',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '06_minazuki', name: '水無月', glyph: '水', aliases: ['みなづき'], hint: '白いういろうに小豆をのせた三角の菓子。6月30日の夏越の祓に' },
      { key: '06_mizu_yokan', name: '水ようかん', glyph: '羊', aliases: ['水羊羹'], hint: 'ひんやりした夏の羊羹' },
      { key: '06_warabi_mochi', name: 'わらび餅', glyph: '蕨', aliases: ['わらびもち', '蕨餅'], hint: 'ぷるぷるの冷たい餅' },
      { key: '06_kuzu_manju', name: '葛まんじゅう', glyph: '葛', aliases: ['葛饅頭', '水まんじゅう', '水饅頭'], hint: '透き通った葛であんを包んだ、涼しげな饅頭' },
      ] },
    { key: '07', label: '文月', color: '#4fa3d6',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '07_mizu_yokan', name: '水ようかん', glyph: '羊', aliases: ['水羊羹'], hint: '暑中見舞いの贈り物にもなる夏の羊羹' },
      { key: '07_kuzu_manju', name: '葛まんじゅう', glyph: '葛', aliases: ['葛饅頭', '水まんじゅう', '水饅頭'], hint: '透き通った葛であんを包んだ、涼しげな饅頭' },
      { key: '07_kuzumochi', name: 'くずもち', glyph: '蜜', aliases: ['葛餅', 'くず餅', '久寿餅'], hint: '黒蜜ときな粉で食べる夏の餅' },
      { key: '07_kakigori', name: 'かき氷', glyph: '氷', aliases: ['氷あずき', '宇治金時', '氷小豆', 'かきごおり'], hint: '小豆や抹茶をかけた、和のかき氷' },
      ] },
    { key: '08', label: '葉月', color: '#e0a030',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '08_kakigori', name: 'かき氷', glyph: '氷', aliases: ['氷あずき', '宇治金時', '氷小豆', 'かきごおり'], hint: '小豆や抹茶をかけた、和のかき氷' },
      { key: '08_kuzukiri', name: '葛きり', glyph: '葛', aliases: ['くずきり'], hint: 'つるっと冷たい葛の麺。黒蜜で' },
      { key: '08_warabi_mochi', name: 'わらび餅', glyph: '蕨', aliases: ['わらびもち', '蕨餅'], hint: 'ぷるぷるの冷たい餅' },
      { key: '08_mizu_yokan', name: '水ようかん', glyph: '羊', aliases: ['水羊羹'], hint: 'ひんやりした夏の羊羹' },
      ] },
    { key: '09', label: '長月', color: '#c0527a',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '09_tsukimi_dango', name: '月見団子', glyph: '月', aliases: ['月見だんご', 'お月見団子'], hint: '十五夜のお月見に供える団子' },
      { key: '09_ohagi', name: 'おはぎ', glyph: '萩', aliases: ['お萩', 'ぼたもち', '牡丹餅'], hint: '秋のお彼岸に食べる' },
      { key: '09_kuri_manju', name: '栗饅頭', glyph: '饅', aliases: ['栗まんじゅう'], hint: '新栗の季節の饅頭' },
      { key: '09_kuri_mushi', name: '栗蒸し羊羹', glyph: '栗', aliases: ['栗蒸しようかん', '栗むし羊羹'], hint: '栗を入れて蒸した羊羹。秋の定番' },
      ] },
    { key: '10', label: '神無月', color: '#d9733a',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '10_kuri_kinton', name: '栗きんとん', glyph: '栗', aliases: ['栗金団'], hint: '栗をつぶして茶巾にしぼった秋の菓子' },
      { key: '10_kuri_mushi', name: '栗蒸し羊羹', glyph: '蒸', aliases: ['栗蒸しようかん', '栗むし羊羹'], hint: '栗を入れて蒸した羊羹。秋の定番' },
      { key: '10_imo_yokan', name: '芋ようかん', glyph: '芋', aliases: ['芋羊羹'], hint: 'さつまいもがおいしくなる季節の羊羹' },
      { key: '10_kuri_manju', name: '栗饅頭', glyph: '饅', aliases: ['栗まんじゅう'], hint: '栗の季節の饅頭' },
      ] },
    { key: '11', label: '霜月', color: '#b8432f',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '11_inoko_mochi', name: '亥の子餅', glyph: '亥', aliases: ['亥の子'], hint: '亥の月の亥の日に食べる、うり坊の形の餅' },
      { key: '11_yuzu_manju', name: '柚子饅頭', glyph: '柚', aliases: ['柚子まんじゅう', 'ゆず饅頭', '柚子餅'], hint: '柚子の香りの饅頭。柚子は晩秋〜冬が旬' },
      { key: '11_kuri_kinton', name: '栗きんとん', glyph: '栗', aliases: ['栗金団'], hint: '栗の季節の終わりまで楽しめる' },
      { key: '11_imo_yokan', name: '芋ようかん', glyph: '芋', aliases: ['芋羊羹'], hint: 'さつまいもの季節の羊羹' },
      ] },
    { key: '12', label: '師走', color: '#7f8b99',
      // 季節の和菓子4つ（品名から自動で当てはめる）。docs/quests.md
      quests: [
      { key: '12_zenzai', name: 'ぜんざい', glyph: '善', aliases: ['おしるこ', 'お汁粉', '汁粉', '善哉'], hint: '寒い日にうれしい、温かい小豆の菓子' },
      { key: '12_yuzu_manju', name: '柚子饅頭', glyph: '柚', aliases: ['柚子まんじゅう', 'ゆず饅頭', '柚子餅'], hint: '冬至の柚子の季節に' },
      { key: '12_sake_manju', name: '酒まんじゅう', glyph: '酒', aliases: ['酒饅頭', '酒素饅頭'], hint: '寒い日にうれしい、ふかしたての饅頭' },
      { key: '12_hanabira_mochi', name: '花びら餅', glyph: '花', aliases: ['はなびら餅', '菱葩'], hint: '年の瀬から店に並びはじめる、新年の菓子' },
      ] },
  ],
  // 定番の和菓子30種（通年）。図鑑にこの順で並べる。品名に name か aliases が含まれたら、その定番として数える
  classics: [
    { key: 'dorayaki', name: 'どら焼き', aliases: ['どらやき', 'どら焼', '銅鑼焼', '三笠'] },
    { key: 'daifuku', name: '大福', aliases: ['大福餅', 'だいふく'] },
    { key: 'mamedaifuku', name: '豆大福', aliases: ['まめ大福'] },
    { key: 'ichigodaifuku', name: 'いちご大福', aliases: ['苺大福', 'イチゴ大福'] },
    { key: 'dango', name: '団子', aliases: ['だんご', 'みたらし', '串団子', '月見団子', '花見団子', '草団子'] },
    { key: 'monaka', name: '最中', aliases: ['もなか'] },
    { key: 'yokan', name: '羊羹', aliases: ['ようかん', '練羊羹', '練りようかん'] },
    { key: 'mizuyokan', name: '水羊羹', aliases: ['水ようかん'] },
    { key: 'imoyokan', name: '芋ようかん', aliases: ['芋羊羹'] },
    { key: 'kintsuba', name: 'きんつば', aliases: ['金鍔'] },
    { key: 'taiyaki', name: 'たい焼き', aliases: ['鯛焼', '鯛焼き', 'たいやき'] },
    { key: 'imagawayaki', name: '今川焼き', aliases: ['今川焼', '大判焼', '回転焼', '御座候', '二重焼'] },
    { key: 'ningyoyaki', name: '人形焼き', aliases: ['人形焼'] },
    { key: 'manju', name: '饅頭', aliases: ['まんじゅう', '温泉饅頭', '薯蕷饅頭'] },
    { key: 'kurimanju', name: '栗饅頭', aliases: ['栗まんじゅう'] },
    { key: 'sakemanju', name: '酒饅頭', aliases: ['酒まんじゅう', '酒素饅頭'] },
    { key: 'senbei', name: 'せんべい', aliases: ['煎餅'] },
    { key: 'okaki', name: 'おかき', aliases: ['あられ', 'かきもち'] },
    { key: 'warabimochi', name: 'わらび餅', aliases: ['わらびもち', '蕨餅'] },
    { key: 'kuzumochi', name: 'くず餅', aliases: ['葛餅', 'くずもち'] },
    { key: 'ohagi', name: 'おはぎ', aliases: ['ぼたもち', '牡丹餅', 'お萩'] },
    { key: 'sakuramochi', name: '桜餅', aliases: ['道明寺', '長命寺'] },
    { key: 'kashiwamochi', name: '柏餅', aliases: ['かしわもち'] },
    { key: 'kusamochi', name: '草餅', aliases: ['よもぎ餅', '草もち'] },
    { key: 'karintou', name: 'かりんとう', aliases: ['花林糖'] },
    { key: 'kasutera', name: 'カステラ', aliases: ['かすてら'] },
    { key: 'uiro', name: 'ういろう', aliases: ['外郎'] },
    { key: 'yatsuhashi', name: '八ツ橋', aliases: ['八つ橋', '八ッ橋', '生八ツ橋'] },
    { key: 'rakugan', name: '落雁', aliases: ['らくがん'] },
    { key: 'anmitsu', name: 'あんみつ', aliases: ['餡蜜', 'みつ豆'] },
  ],
};
