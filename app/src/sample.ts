import type { ID, Project, Reference, ResultItem } from './types';
import { newProject, ops } from './store';

/** 使い方を掴むためのサンプルプロジェクト */
export function sampleProject(): Project {
  const p = newProject('少数データ画像分類の精度向上（サンプル）', '出戻りと分岐を含む研究記録の例です。自由に編集・削除してください。');
  const tag = (name: string) => p.tagOrder.find((id) => p.tags[id].name === name)!;
  let day = 0;
  const start = new Date('2026-04-06T10:00:00').getTime();
  const stamp = (id: ID) => {
    const t = new Date(start + day++ * 86400000 * 2).toISOString();
    p.commits[id].createdAt = t;
    p.commits[id].updatedAt = t;
  };
  const commit = (title: string, tags: string[], body = '', extra: { links?: string[]; ref?: Reference; results?: [string, string][] } = {}) => {
    const results: ResultItem[] = (extra.results ?? []).map(([key, value]) => ({ key, value }));
    ops.commit({ title, body, tagIds: tags.map(tag), links: extra.links ?? [], taskIds: [], ref: extra.ref ?? null, results }, stamp)(p);
    return p.branches[p.currentBranchId].headId!;
  };
  const branch = (from: string, name: string, note: string) => {
    ops.branchFrom(from, name, note)(p);
    p.branches[p.currentBranchId].createdAt = new Date(start + day * 86400000 * 2 - 1000).toISOString();
    return p.currentBranchId;
  };
  const ref = (r: Partial<Reference>): Reference => ({ key: '', type: 'inproceedings', authors: '', year: '', title: '', venue: '', doi: '', url: '', ...r });

  commit('研究の動機: 少数データでは画像分類モデルが過学習する', ['仮説・問い'],
    '研究室の実データは1クラスあたり数十枚しかない。\n\n- 既存モデルをそのまま学習すると検証精度が大きく落ちる\n- どうすれば少ないデータで汎化性能を上げられるか？');
  commit('サーベイ: データ拡張の総説を読む', ['先行研究'],
    '幾何変換・色変換・合成系など、拡張手法の分類を整理した。\n\n**要点**: 単純な拡張でも効果はあるが、データが極端に少ない場合の比較は少ない。',
    {
      links: ['https://doi.org/10.1186/s40537-019-0197-0'],
      ref: ref({ key: 'shorten2019survey', type: 'article', authors: 'Shorten, Connor and Khoshgoftaar, Taghi M.', year: '2019', title: 'A survey on Image Data Augmentation for Deep Learning', venue: 'Journal of Big Data', doi: '10.1186/s40537-019-0197-0' }),
    });
  commit('サーベイ: Mixup / CutMix', ['先行研究'],
    '2枚の画像とラベルを混ぜる正則化手法。CIFAR 系で精度向上の報告あり。',
    { ref: ref({ key: 'zhang2018mixup', authors: 'Zhang, Hongyi and Cisse, Moustapha and Dauphin, Yann N. and Lopez-Paz, David', year: '2018', title: 'mixup: Beyond Empirical Risk Minimization', venue: 'International Conference on Learning Representations (ICLR)' }) });
  commit('研究課題 (RQ) を設定', ['仮説・問い'],
    '**RQ**: データ量を1/10にした条件で、どの手法が最も精度低下を抑えられるか。\n\n成功基準: ベースライン比 +3pt 以上。');
  commit('実験計画: CIFAR-10 の10%サブセットで比較', ['実験計画'],
    '- 学習: 各クラス500枚\n- 評価: 公式テストセット\n- 3シード平均で比較');
  commit('ベースライン実装 (ResNet-18)', ['実験プログラム'],
    '```bash\npython train.py --model resnet18 --subset 0.1 --seed 0\n```', { links: ['experiments/baseline/train.py'] });
  const base = commit('ベースライン結果: 精度 71.2%', ['実験結果'],
    '| seed | acc |\n|---|---|\n| 0 | 71.0 |\n| 1 | 71.6 |\n| 2 | 70.9 |',
    { results: [['手法', 'ResNet-18（ベースライン）'], ['データ量', '10%'], ['accuracy', '71.2'], ['seed数', '3']] });

  // 案A: Mixup → 効果が小さく棄却
  const a = branch(base, '案A: Mixup', '先行研究で効果が報告されていたため最初に試す');
  commit('Mixup を実装', ['実験プログラム'], 'alpha = 0.2, 0.4, 1.0 を比較。', { links: ['experiments/mixup/train.py'] });
  commit('Mixup 結果: +1.1pt にとどまる', ['実験結果'], '最良でも 72.3%。成功基準 (+3pt) に届かない。',
    { results: [['手法', 'Mixup (alpha=0.4)'], ['データ量', '10%'], ['accuracy', '72.3'], ['seed数', '3']] });
  const mixupDisc = commit('考察: 少数データでは混合の多様性が足りない', ['考察'], '元画像の多様性自体が乏しいので、混ぜても新しい情報が増えにくいと考えられる。');
  p.branches[a].status = 'abandoned';
  p.branches[a].note = '改善幅が成功基準に届かず、指導教員と相談して方針転換';

  // 案B: 自己教師あり事前学習 → 採用
  const b = branch(base, '案B: 自己教師あり事前学習', 'ゼミでの議論を受け、ラベルなしデータの活用に切り替える');
  commit('ゼミでの議論: ラベルなしデータを活用しては？', ['指導・議論'], '研究室にはラベルなし画像が大量にある、との指摘。');
  commit('サーベイ: SimCLR（対照学習）', ['先行研究'], '同じ画像の異なる拡張同士を近づける表現学習。', {
    links: ['https://arxiv.org/abs/2002.05709'],
    ref: ref({ key: 'chen2020simclr', authors: 'Chen, Ting and Kornblith, Simon and Norouzi, Mohammad and Hinton, Geoffrey', year: '2020', title: 'A Simple Framework for Contrastive Learning of Visual Representations', venue: 'International Conference on Machine Learning (ICML)', url: 'https://arxiv.org/abs/2002.05709' }),
  });
  const ssl = commit('SimCLR 事前学習 + ファインチューニングを実装', ['実験プログラム'], '', { links: ['experiments/simclr/pretrain.py', 'experiments/simclr/finetune.py'] });
  commit('結果: 精度 77.5%（+6.3pt）', ['実験結果'], '3シードとも +6pt 以上。成功基準を満たした。',
    { results: [['手法', 'SimCLR + FT'], ['データ量', '10%'], ['accuracy', '77.5'], ['seed数', '3'], ['batch size', '256']] });
  const discB = commit('考察: 表現学習がデータ不足を補う', ['考察'], 'ラベルなしデータの量を変えた追加実験で、量に応じて精度が伸びることを確認したい。');
  p.branches[b].status = 'adopted';

  // 寄り道: バッチサイズ検討 → 案B に統合
  const bs = branch(ssl, 'バッチサイズの影響', '計算資源が限られるため、小バッチでも効くか確認');
  commit('バッチサイズ 64 / 128 / 256 で事前学習', ['実験プログラム', 'メモ']);
  commit('結果: batch 128 でも精度はほぼ同じ', ['実験結果'], 'batch 128 で 77.1%。GPU 1枚で回せる設定にできる。',
    { results: [['手法', 'SimCLR + FT'], ['データ量', '10%'], ['accuracy', '77.1'], ['seed数', '3'], ['batch size', '128']] });
  ops.checkout(b)(p);
  ops.merge(bs, '「バッチサイズの影響」の結果を統合', '本線の設定を batch 128 に変更（精度はほぼ同じで、計算コストが半分）。', true, stamp)(p);

  // マイルストーンとタスク
  const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  ops.addMilestone({ title: '中間発表', date: addDays(21), description: '研究室内の中間発表（15分）' })(p);
  ops.addMilestone({ title: '国内学会 投稿締切', date: addDays(60), description: '' })(p);
  const ms = Object.values(p.milestones).sort((x, y) => x.date.localeCompare(y.date));
  const task = (title: string, body: string, tags: string[], o: { status?: 'todo' | 'doing' | 'done' | 'dropped'; due?: number; ms?: number; source?: ID }) => {
    let id = '';
    ops.addTask({ title, body, tagIds: tags.map(tag), status: o.status ?? 'todo', due: o.due !== undefined ? addDays(o.due) : null, milestoneId: o.ms !== undefined ? ms[o.ms].id : null },
      { sourceCommitId: o.source ?? null }, (x) => { id = x; })(p);
    return id;
  };
  const t1 = task('Mixup の結果を指導教員に報告する', '成功基準に届かなかったことと、次の方針の相談。', ['指導・議論'], { status: 'done', source: mixupDisc });
  p.commits[mixupDisc].taskIds = [t1];
  task('ラベルなしデータの量を変えた追加実験', '- [ ] 1万 / 5万 / 10万枚で事前学習\n- [ ] 精度との関係をグラフにする\n\nきっかけ: [[考察: 表現学習がデータ不足を補う]]', ['実験計画'], { status: 'doing', due: 10, ms: 0, source: discB });
  task('関連研究: 半教師あり学習（FixMatch など）も調べる', '査読で「半教師あり学習と比べたか」と聞かれそう。', ['先行研究'], { due: 14, ms: 0 });
  task('論文の図1（手法の全体像）を作る', '', ['メモ'], { ms: 1 });

  p.currentBranchId = b;
  return p;
}
