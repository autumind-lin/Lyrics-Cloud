# Lyrics Cloud (Offline)

私有离线中文歌词检索与可视化应用，支持本地 JSON 导入、IndexedDB 持久化、FlexSearch 搜索与词频可视化。

## 启动

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 导入歌词 JSON

点击页面上的“导入歌词 JSON”，选择本地文件。数据会被写入 IndexedDB，刷新页面仍可读取。

示例结构：

```json
{
  "schema_version": 1,
  "artist": "演示艺人",
  "tracks": [
    {
      "title": "雾灯之外",
      "album": "回声档案",
      "year": 2024,
      "lyricists": ["示例词作者"],
      "lyrics": "这里是占位示例歌词文本..."
    }
  ]
}
```

> 注意：请勿导入真实版权歌词内容。
