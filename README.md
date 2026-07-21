# KiMoDo Pose JSON Viewer

スマートフォンとPCのブラウザで、KiMoDo向けの手続き型ポーズJSONや関節座標JSONを表示する静的Three.jsアプリです。

## 主な機能

- `frames[].operations[]` 形式のポーズレシピをブラウザ内で計算
- `requested_positions` / `fitted_positions` / `positions` 形式の関節座標を表示
- `kimodo_dump_skeleton_meta.py` の骨格メタJSONを追加読込
- タッチ操作による回転、ピンチズーム、パン
- 正面・側面・上面・斜めカメラ
- 複数キーポーズの簡易補間再生
- 計算済み関節座標JSONの書き出し
- アップロードしたJSONは外部へ送信せず、ブラウザ内だけで処理

## ローカル確認

ES Modulesを使うため、ファイルを直接開かず簡単なHTTPサーバーを使います。

```bash
python -m http.server 8000 -d site
```

その後 `http://localhost:8000/` を開きます。

## GitHub Pages

1. リポジトリの **Settings → Pages** を開く
2. **Build and deployment → Source** を **GitHub Actions** にする
3. `main` へpushすると `.github/workflows/pages.yml` が `site/` を公開する

### 公開範囲に関する注意

`site/` 以下には秘密情報、APIキー、公開したくないモデルデータを置かないでください。

## JSON形式

### 手続き型ポーズレシピ

```json
{
  "description": "Example pose",
  "frames": [
    {
      "frame": 0,
      "operations": [
        { "op": "set_root", "position": [0, 0.95, 0] },
        {
          "op": "aim_bone",
          "joint": "RightArm",
          "child": "RightForeArm",
          "direction": [0.6, 0.7, 0.2]
        }
      ]
    }
  ]
}
```

対応操作:

- `set_root`
- `translate_all`
- `translate_subtree`
- `rotate_subtree`
- `aim_bone`
- `set_joint_position`

### 関節座標

```json
{
  "joint_names": ["Hips", "Spine1"],
  "frame_indices": [0],
  "positions": [
    [[0, 0.95, 0], [0, 1.10, 0]]
  ]
}
```

関節座標の名前が現在読み込まれている骨格と一致するものだけ表示されます。

## 依存関係

Three.js 0.185.1を `site/vendor/` に同梱しています。実行時のCDN接続やビルドツールは不要です。Three.jsのMIT Licenseは `site/vendor/THREE-LICENSE.txt` に収録しています。
