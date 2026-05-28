// このファイルは React アプリの「起動点」です。
// HTML の <div id="root"></div> に対して React のレンダリングを開始します。
// `.tsx` は TypeScript + JSX（HTMLのようなReact記法）を書けるファイル拡張子。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'                                          // グローバルCSSの読み込み
import App from './App.tsx'

// document.getElementById('root') は HTMLElement | null を返す。
// 末尾の `!` は「絶対 null じゃない」とTSに教えるアサーション。
// StrictMode は開発時のチェックを強化するReactのラッパー（副作用の二重実行などで問題を発見）。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
