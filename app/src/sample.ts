import type { Project } from './types';
import { newProject, ops } from './store';

/** 使い方を掴むためのサンプルプロジェクト */
export function sampleProject(): Project {
  const p = newProject('少数データ画像分類の精度向上（サンプル）', '出戻りと分岐を含む研究記録の例です。自由に編集・削除してください。');
  const tag = (name: string) => p.tagOrder.find((id) => p.tags[id].name === name)!;
  let day = 0;
  const start = new Date('2026-04-06T10:00:00').getTime();
  const commit = (title: string, tags: string[], body = '', links: string[] = []) => {
    ops.commit({ title, body, tagIds: tags.map(tag), links }, (id) => {
      const t = new Date(start + day++ * 86400000 * 2).toISOString();
      p.commits[id].createdAt = t;
      p.commits[id].updatedAt = t;
    })(p);
    return p.branches[p.currentBranchId].headId!;
  };
  const branch = (from: string, name: string, note: string) => {
    ops.branchFrom(from, name, note)(p);
    p.branches[p.currentBranchId].createdAt = new Date(start + day * 86400000 * 2 - 1000).toISOString();
    return p.currentBranchId;
  };

  commit('研究の動機: 少数データでは画像分類モデルが過学習する', ['仮説・問い'],
    '研究室の実データは1クラスあたり数十枚しかない。\n\n- 既存モデルをそのまま学習すると検証精度が大きく落ちる\n- どうすれば少ないデータで汎化性能を上げられるか？');
  commit('サーベイ: データ拡張の総説を読む', ['先行研究'],
    '幾何変換・色変換・合成系など、拡張手法の分類を整理した。\n\n**要点**: 単純な拡張でも効果はあるが、データが極端に少ない場合の比較は少ない。',
    ['https://doi.org/10.1186/s40537-019-0197-0']);
  commit('サーベイ: Mixup / CutMix', ['先行研究'],
    '2枚の画像とラベルを混ぜる正則化手法。CIFAR 系で精度向上の報告あり。');
  commit('研究課題 (RQ) を設定', ['仮説・問い'],
    '**RQ**: データ量を1/10にした条件で、どの手法が最も精度低下を抑えられるか。\n\n成功基準: ベースライン比 +3pt 以上。');
  commit('実験計画: CIFAR-10 の10%サブセットで比較', ['実験計画'],
    '- 学習: 各クラス500枚\n- 評価: 公式テストセット\n- 3シード平均で比較');
  commit('ベースライン実装 (ResNet-18)', ['実験プログラム'],
    '```bash\npython train.py --model resnet18 --subset 0.1 --seed 0\n```', ['experiments/baseline/train.py']);
  const base = commit('ベースライン結果: 精度 71.2%', ['実験結果'],
    '| seed | acc |\n|---|---|\n| 0 | 71.0 |\n| 1 | 71.6 |\n| 2 | 70.9 |');

  // 案A: Mixup → 効果が小さく棄却
  const a = branch(base, '案A: Mixup', '先行研究で効果が報告されていたため最初に試す');
  commit('Mixup を実装', ['実験プログラム'], 'alpha = 0.2, 0.4, 1.0 を比較。', ['experiments/mixup/train.py']);
  commit('Mixup 結果: +1.1pt にとどまる', ['実験結果'], '最良でも 72.3%。成功基準 (+3pt) に届かない。');
  commit('考察: 少数データでは混合の多様性が足りない', ['考察'], '元画像の多様性自体が乏しいので、混ぜても新しい情報が増えにくいと考えられる。');
  p.branches[a].status = 'abandoned';
  p.branches[a].note = '改善幅が成功基準に届かず、指導教員と相談して方針転換';

  // 案B: 自己教師あり事前学習 → 採用
  const b = branch(base, '案B: 自己教師あり事前学習', 'ゼミでの議論を受け、ラベルなしデータの活用に切り替える');
  commit('ゼミでの議論: ラベルなしデータを活用しては？', ['指導・議論'], '研究室にはラベルなし画像が大量にある、との指摘。');
  commit('サーベイ: SimCLR（対照学習）', ['先行研究'], '同じ画像の異なる拡張同士を近づける表現学習。', ['https://arxiv.org/abs/2002.05709']);
  const ssl = commit('SimCLR 事前学習 + ファインチューニングを実装', ['実験プログラム'], '', ['experiments/simclr/pretrain.py', 'experiments/simclr/finetune.py']);
  commit('結果: 精度 77.5%（+6.3pt）', ['実験結果'], '3シードとも +6pt 以上。成功基準を満たした。');
  commit('考察: 表現学習がデータ不足を補う', ['考察'], 'ラベルなしデータの量を変えた追加実験で、量に応じて精度が伸びることを確認したい。');
  p.branches[b].status = 'adopted';

  // 寄り道: バッチサイズ検討（保留中）
  branch(ssl, 'バッチサイズの影響', '計算資源が限られるため、小バッチでも効くか確認');
  commit('バッチサイズ 64 / 128 / 256 で事前学習', ['実験プログラム', 'メモ']);

  p.currentBranchId = b;
  return p;
}
