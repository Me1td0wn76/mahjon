// このファイルは Vite（ビルドツール）の設定ファイル。
// 開発サーバーの起動、TypeScript→JSの変換、Reactプラグインの組み込みなどを担当する。
// 通常はあまり変更しないが、プラグインを追加する時にここを編集する。
import { defineConfig } from 'vite'
// React 用プラグイン。JSXを解釈したり、React Refresh（HMR）を有効にする。
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
// Babel プラグイン。React Compiler のプリセットを使ってビルド時に最適化を行う。
import babel from '@rolldown/plugin-babel'

// defineConfig を使うと型補完が効くので、設定の typo を防げる。
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages は https://<user>.github.io/<repo>/ で公開されるため、
  // build 時のみリポジトリ名のサブパスを base にする。dev は '/' のままにしておく。
  base: command === 'build' ? '/mahjon/' : '/',
  plugins: [
    react(),
    // React Compiler のプリセットを Babel 経由で有効化。
    // 自動メモ化により、useMemo / useCallback を書かなくても再レンダリングが最適化される。
    babel({ presets: [reactCompilerPreset()] })
  ],
}))
