# data/shops/

OpenStreetMap から作った、日本の和菓子屋の位置データです。`node tools/build-shops.mjs` で作り直せます。

- 出典：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- ライセンス：[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。このデータを使うときは、出典を示し、同じライセンスで公開してください
- 元データ：`shop=confectionery`、および名前に「甘味」を含む `amenity=cafe`。そのうち、店名から和菓子屋らしいものだけを残しています（`logic.js` の `isWagashiShop`）。名前のない店・洋菓子の語を含む店は除いています。違う店や抜けがあります

## ファイル
- `<緯度の下端>_<経度の下端>.json`：0.5度四方の区画。例 `35.5_139.5.json`（北緯 35.5〜36.0、東経 139.5〜140.0）。中身は `[[osmId, 店名, 緯度, 経度], …]`。osmId の頭の `n` `w` `r` は OSM の node / way / relation
- `meta.json`：作った日付、件数、区画の一覧、出典
