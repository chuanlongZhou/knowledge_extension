import { driveMessages } from './messages-drive.js';
function decodeRows(text) {
  return text
    .trim()
    .split('\n')
    .map((row) => {
      const [key, ...values] = row.split('|').map((part) => part.replace(/\\n/g, '\n'));
      if (values.length !== 3 || values.some((value) => !value))
        throw new Error('Invalid translation: ' + key);
      return [key, values];
    });
}
// Keys are the original authored interface text. Values: English, French, Japanese.
// Placeholders are substituted as text; user content is never used as a message key.
// Translation rows keep the original key, then English, French and Japanese.
export const messages = Object.fromEntries(
  decodeRows(String.raw`
打开启动页|Open start page|Ouvrir l’accueil|スタートページを開く
启动页|Start page|Accueil|スタートページ
打开启动页查看 Todo、Idea、喜欢的网页、待浏览网页组与项目。Dock 常用网站保存在当前浏览器。|Open the start page for Todo, Idea, favorite pages, unread groups and projects. Dock sites are saved in this browser.|Ouvrez l’accueil pour retrouver Todo, Idea, favoris, groupes à lire et projets. Les sites du Dock sont enregistrés dans ce navigateur.|スタートページで Todo、Idea、お気に入り、未読グループ、プロジェクトを表示します。Dock のサイトはこのブラウザに保存されます。
从这里回到你的知识：计划、灵感、喜欢的网页和正在进行的项目，都在这里。|Return to your knowledge: plans, ideas, favorite pages and ongoing projects, all in one place.|Retrouvez vos connaissances : tâches, idées, pages favorites et projets, au même endroit.|計画、アイデア、お気に入りのページ、進行中のプロジェクト。自分の知識へ、ここから。
保存|Save|Enregistrer|保存
GUGA 已设为浏览器的新标签页。点击“+”或按 Ctrl+T 即可打开。|GUGA is your browser’s new-tab page. Open a tab with + or Ctrl+T.|GUGA est votre nouvel onglet. Ouvrez un onglet avec + ou Ctrl+T.|GUGA はブラウザの新しいタブに設定されています。＋ または Ctrl+T で開けます。
打开新标签页|Open new tab|Ouvrir un nouvel onglet|新しいタブを開く
安装后，新建浏览器标签页会打开 GUGA 启动页。|After installation, new browser tabs open the GUGA start page.|Après l’installation, les nouveaux onglets ouvrent l’accueil GUGA.|インストール後、新しいタブで GUGA スタートページが開きます。
完全隐藏内置示例|Hide built-in examples completely|Masquer complètement les exemples intégrés|組み込みサンプルを完全に非表示
开启后隐藏收件箱样例及侧栏入口；已加入收件箱的个人记录不受影响。|Hides inbox examples and the sidebar shortcut. Examples already saved as personal records remain available.|Masque les exemples de la boîte de réception et le raccourci du panneau latéral. Les exemples déjà enregistrés comme fiches personnelles restent disponibles.|受信箱のサンプルとサイドバーの入口を非表示にします。保存済みの個人記録はそのまま残ります。
取消|Cancel|Annuler|キャンセル
关闭|Close|Fermer|閉じる
删除|Delete|Supprimer|削除
编辑|Edit|Modifier|編集
确认|Confirm|Confirmer|確認
知道了|Got it|Compris|確認しました
语言|Language|Langue|言語
界面语言|Interface language|Langue de l’interface|表示言語
应用语言|Apply language|Appliquer la langue|言語を適用
应用后重新加载当前页面，草稿会保留。其他已打开页面刷新后生效。语言仅保存在当前浏览器，不修改记录内容。|Applying reloads this page and keeps drafts. Refresh other open pages to apply. Language is saved in this browser; your content stays unchanged.|L’application recharge cette page et conserve les brouillons. Actualisez les autres pages ouvertes. La langue est enregistrée dans ce navigateur ; vos contenus restent inchangés.|適用するとこのページを再読み込みします。下書きは保持されます。他のページは再読み込み後に反映されます。言語はこのブラウザに保存され、記録の内容は変わりません。
设置与数据管理|Settings & data|Paramètres et données|設定とデータ管理
打开设置|Open settings|Ouvrir les paramètres|設定を開く
收件箱|Inbox|Boîte de réception|受信箱
全部记录|All records|Toutes les fiches|すべての記録
已整理|Organized|Classées|整理済み
喜爱|Favorites|Favoris|お気に入り
收藏|Favorites|Favoris|お気に入り
待同步记录|Pending sync|À synchroniser|同期待ちの記録
待同步|Pending sync|À synchroniser|同期待ち
重复检查|Duplicates|Doublons|重複チェック
回收站|Trash|Corbeille|ゴミ箱
全部|All|Tout|すべて
项目|Projects|Projets|プロジェクト
标签|Tags|Étiquettes|タグ
普通记录|Note|Note|ノート
网页快照|Snapshot|Capture de page|ページのスナップショット
清单|List|Liste|リスト
网页组|Web group|Groupe de pages|ウェブグループ
记录|Record|Fiche|記録
网页|Web page|Page web|ウェブページ
图片|Image|Image|画像
录音|Audio|Audio|音声
来源|Sources|Sources|出典
来源：|Sources:|Sources :|出典：
内容|Content|Contenu|内容
主题与字体|Theme & fonts|Thème et polices|テーマとフォント
使用说明书|User guide|Guide d’utilisation|使い方ガイド
主题|Theme|Thème|テーマ
字体|Font|Police|フォント
字号|Font size|Taille de police|文字サイズ
搜索标题、正文、标签和来源…|Search titles, content, tags and sources…|Rechercher titres, contenus, étiquettes et sources…|タイトル、本文、タグ、出典を検索…
搜索记录|Search records|Rechercher des fiches|記録を検索
记录视图|Record views|Vues des fiches|記録ビュー
记录列表|Record list|Liste des fiches|記録一覧
记录类型|Record type|Type de fiche|記録の種類
标签筛选|Filter by tag|Filtrer par étiquette|タグで絞り込み
是否在项目|Project membership|Appartenance à un projet|プロジェクトへの所属
已在项目|In a project|Dans un projet|プロジェクトに所属
未在项目|Outside projects|Sans projet|プロジェクト未所属
选择本页|Select this page|Sélectionner cette page|このページを選択
全部标签|All tags|Toutes les étiquettes|すべてのタグ
排序|Sort|Trier|並べ替え
记录排序方式|Record sort order|Tri des fiches|記録の並べ替え方法
切换排序方向|Change sort direction|Inverser le tri|並べ替えの方向を変更
重新排序|Re-sort|Recalculer le tri|並べ替えを適用
最近修改时间|Last modified|Dernière modification|更新日時
创建时间|Date created|Date de création|作成日時
标题|Title|Titre|タイトル
↑ 升序|↑ Ascending|↑ Croissant|↑ 昇順
↓ 降序|↓ Descending|↓ Décroissant|↓ 降順
修改后保留当前位置|Keep position while editing|Position conservée pendant les modifications|編集後も現在の位置を保持
顺序有变化，下次进入或点击重新排序时生效|Order changed. Reopen this view or re-sort to apply.|Ordre modifié. Rouvrez cette vue ou relancez le tri.|順序に変更があります。次回表示時または再並べ替えで反映されます。
加载更多|Load more|Afficher la suite|さらに表示
导出备份|Export backup|Exporter une sauvegarde|バックアップを書き出す
↓ 同步下载|↓ Download sync|↓ Télécharger|↓ 同期ダウンロード
↑ 同步上传|↑ Upload sync|↑ Envoyer|↑ 同期アップロード
新建记录|New record|Nouvelle fiche|新しい記録
＋ 新建记录|＋ New record|＋ Nouvelle fiche|＋ 新しい記録
整理页 ↗|Organizer ↗|Classement ↗|整理ページ ↗
企鹅|Penguin|Manchot|ペンギン
新增项目|Add project|Ajouter un projet|プロジェクトを追加
新建项目|New project|Nouveau projet|新しいプロジェクト
新建标签|New tag|Nouvelle étiquette|新しいタグ
设置标签外观|Tag appearance settings|Apparence des étiquettes|タグの表示設定
重复检查与回收站|Duplicates and trash|Doublons et corbeille|重複チェックとゴミ箱
把标签拖到记录上；把记录拖到项目文件夹。归类后可标记已整理。|Drag tags onto records and records into projects. Mark them organized when ready.|Glissez les étiquettes sur les fiches et les fiches dans les projets, puis marquez-les comme classées.|タグを記録へ、記録をプロジェクトへドラッグできます。分類後に整理済みにできます。
查看内置示例|View examples|Voir les exemples|サンプルを表示
内置示例|Built-in examples|Exemples intégrés|組み込みサンプル
GUGA Knowledge · 知识收件箱|GUGA Knowledge · Knowledge inbox|GUGA Knowledge · Boîte à connaissances|GUGA Knowledge · 知識の受信箱
GUGA Knowledge · 快捷收集|GUGA Knowledge · Quick capture|GUGA Knowledge · Capture rapide|GUGA Knowledge · クイック収集
GUGA Knowledge · 新的一页|GUGA Knowledge · A new page|GUGA Knowledge · Une nouvelle page|GUGA Knowledge · 新しいページ
启动页导航|Start page navigation|Navigation de l’accueil|スタートページのナビゲーション
打开整理页 ↗|Open organizer ↗|Ouvrir le classement ↗|整理ページを開く ↗
启动页设置|Start page settings|Paramètres de l’accueil|スタートページの設定
⚙ 设置|⚙ Settings|⚙ Paramètres|⚙ 設定
今天，想做点什么？|What’s on your mind today?|Qu’avez-vous en tête aujourd’hui ?|今日は、何をしましょう？
留一点空间给计划，也给突然出现的灵感。|A little space for plans and unexpected ideas.|Un peu de place pour vos projets et vos idées spontanées.|計画にも、ふと浮かぶアイデアにも、少しの余白を。
休息中的企鹅|Resting penguin|Manchot au repos|休憩中のペンギン
Todo 与 Idea|Todo and Idea|Todo et Idea|Todo と Idea
完整清单 ↗|Full list ↗|Liste complète ↗|リスト全体 ↗
添加 Todo|Add Todo|Ajouter un Todo|Todo を追加
保存 Todo|Save Todo|Enregistrer le Todo|Todo を保存
添加 Idea|Add Idea|Ajouter une Idea|Idea を追加
保存 Idea|Save Idea|Enregistrer l’Idea|Idea を保存
接下来，做这一件事…|One thing to do next…|La prochaine chose à faire…|次にやりたいことをひとつ…
先把这个念头留下来…|Keep this thought here…|Gardez cette idée ici…|このアイデアを残しておこう…
喜爱的网页|Favorite pages|Pages favorites|お気に入りのページ
喜欢的网页|Favorite pages|Pages favorites|お気に入りのページ
查看全部 ↗|View all ↗|Tout voir ↗|すべて表示 ↗
待浏览网页组|Unread web groups|Groupes à lire|未読のウェブグループ
待浏览的网页组|Web groups to read|Groupes de pages à lire|これから読むウェブグループ
全部 ↗|All ↗|Tout ↗|すべて ↗
正在进行的项目|Projects in progress|Projets en cours|進行中のプロジェクト
浏览器离线保存 · 云端同步由你决定|Saved offline · Sync when you choose|Sauvegarde hors ligne · Synchronisez à votre rythme|ブラウザに保存 · クラウド同期は自分のタイミングで
常用网站 Dock|Website Dock|Dock de sites|よく使うサイトの Dock
新标签页与启动页|New tab & start page|Nouvel onglet et accueil|新しいタブとスタートページ
使用 GUGA 启动页作为新标签页|Use GUGA for new tabs|Utiliser GUGA pour les nouveaux onglets|新しいタブに GUGA を表示
启动页喜爱网页数量|Favorite cards on start page|Favoris sur l’accueil|スタートページのお気に入り表示数
预览启动页|Preview start page|Aperçu de l’accueil|スタートページをプレビュー
在新标签页查看 Todo、Idea、喜欢的网页、待浏览网页组与项目。开关和 Dock 常用网站保存在当前浏览器。|See Todo, Idea, favorites, unread groups and projects in new tabs. This option and Dock sites are saved in this browser.|Retrouvez Todo, Idea, favoris, groupes à lire et projets dans vos nouveaux onglets. Ce réglage et le Dock sont enregistrés dans ce navigateur.|新しいタブで Todo、Idea、お気に入り、未読グループ、プロジェクトを表示します。設定と Dock はこのブラウザに保存されます。
已开启，下次新建标签页时生效。|Enabled for the next new tab.|Activé pour le prochain nouvel onglet.|有効にしました。次に開く新しいタブから反映されます。
已关闭，下次新建标签页使用浏览器原页面。|Disabled. New tabs will use the browser’s page.|Désactivé. Les nouveaux onglets afficheront la page du navigateur.|無効にしました。次の新しいタブからブラウザのページを表示します。
{0} 张卡片|{0} cards|{0} cartes|{0} 枚のカード
{0} 待完成|{0} to do|{0} à faire|未完了 {0} 件
{0} 个念头|{0} ideas|{0} idées|アイデア {0} 件
{0} 待浏览|{0} unread|{0} à lire|未読 {0} 件
{0} 条记录|{0} records|{0} fiches|{0} 件の記録
给今天留下一件想完成的事。|Keep one thing you want to do today.|Gardez une chose à accomplir aujourd’hui.|今日やりたいことをひとつ残しましょう。
灵感不必完整，先记下来。|An idea needn’t be complete. Write it down.|Une idée peut être incomplète. Notez-la.|まとまっていなくても、まず書き留めましょう。
编辑 Todo|Edit Todo|Modifier le Todo|Todo を編集
编辑 Idea|Edit Idea|Modifier l’Idea|Idea を編集
Todo 内容|Todo text|Texte du Todo|Todo の内容
Idea 内容|Idea text|Texte de l’Idea|Idea の内容
完成 {0}|Complete {0}|Terminer {0}|{0} を完了
查看 {0}|View {0}|Voir {0}|{0} を表示
记录详情|Record details|Détails de la fiche|記録の詳細
编辑记录 ↗|Edit record ↗|Modifier la fiche ↗|記録を編集 ↗
记录预览|Record preview|Aperçu de la fiche|記録のプレビュー
预览记录|Preview record|Aperçu de la fiche|記録をプレビュー
☆ 喜爱|☆ Favorite|☆ Ajouter aux favoris|☆ お気に入りに追加
★ 已喜爱|★ Favorited|★ Dans les favoris|★ お気に入り
把喜欢的网页标记为“喜爱”，下次打开就能在这里遇见。|Mark pages as favorites to find them here next time.|Ajoutez des pages aux favoris pour les retrouver ici.|ページをお気に入りにすると、次回ここに表示されます。
待浏览的网页组会出现在这里，一次打开，一点点读完。|Groups with unread pages appear here. Read at your own pace.|Les groupes contenant des pages non lues apparaissent ici. Lisez à votre rythme.|未読ページのあるグループがここに表示されます。少しずつ読み進めましょう。
建一个项目，让记录有一个可以相遇的地方。|Create a project to bring your records together.|Créez un projet pour réunir vos fiches.|プロジェクトを作って、記録をつなげましょう。
这个项目还没有描述。|This project has no description yet.|Ce projet n’a pas encore de description.|このプロジェクトにはまだ説明がありません。
尚未填写项目描述。|No project description yet.|Aucune description pour ce projet.|プロジェクトの説明はまだありません。
还没有记录，可以在整理页把资料加入这个项目。|No records yet. Add them from the organizer.|Aucune fiche. Ajoutez-en depuis le classement.|記録はまだありません。整理ページから追加できます。
子项目|Subprojects|Sous-projets|サブプロジェクト
在整理页打开 ↗|Open in organizer ↗|Ouvrir dans le classement ↗|整理ページで開く ↗
打开看看当时留下的内容。|Open to revisit what you saved.|Ouvrez pour retrouver ce que vous avez gardé.|保存した内容を開いて振り返りましょう。
给下一次灵感留个位置|Make room for your next idea|Faites une place à votre prochaine idée|次のひらめきのために場所を空けよう
把常用网站放在这里|Keep your go-to sites here|Gardez vos sites habituels ici|よく使うサイトをここに
添加常用网站|Add website|Ajouter un site|サイトを追加
管理常用网站|Manage websites|Gérer les sites|サイトを管理
编辑常用网站|Edit website|Modifier le site|サイトを編集
网站名称|Website name|Nom du site|サイト名
网站地址|Website URL|Adresse du site|サイトの URL
保存网站|Save website|Enregistrer le site|サイトを保存
添加网站|Add website|Ajouter un site|サイトを追加
上移 {0}|Move {0} up|Monter {0}|{0} を上へ
下移 {0}|Move {0} down|Descendre {0}|{0} を下へ
移除|Remove|Retirer|削除
还没有常用网站。点击添加，把常去的地方放进 Dock。|No sites yet. Add your favorite places to the Dock.|Aucun site. Ajoutez vos sites habituels au Dock.|サイトはまだありません。よく使うサイトを Dock に追加しましょう。
最多添加 12 个常用网站。|You can add up to 12 websites.|Vous pouvez ajouter jusqu’à 12 sites.|サイトは最大 12 個まで追加できます。
最多添加 12 个常用网站，可在管理中替换。|Up to 12 sites. Replace one in Manage websites.|Maximum 12 sites. Remplacez-en un dans la gestion.|最大 12 個までです。管理画面から入れ替えられます。
请填写网站名称。|Enter a website name.|Saisissez un nom de site.|サイト名を入力してください。
请填写有效的 HTTP / HTTPS 网站地址。|Enter a valid HTTP / HTTPS URL.|Saisissez une adresse HTTP / HTTPS valide.|有効な HTTP / HTTPS の URL を入力してください。
网站已在其他页面移除，请重新添加。|This site was removed in another page. Add it again.|Ce site a été retiré sur une autre page. Ajoutez-le à nouveau.|別のページで削除されました。もう一度追加してください。
欢迎使用 GUGA Knowledge|Welcome to GUGA Knowledge|Bienvenue dans GUGA Knowledge|GUGA Knowledge へようこそ
每次打开，|Each time you visit,|À chaque visite,|開くたびに、
回到自己的想法。|back to your own ideas.|retrouvez vos idées.|自分のアイデアに戻ろう。
把新标签页变成你的知识起点：计划、灵感、喜欢的网页和正在进行的项目，都在这里。|Make each new tab your starting point for plans, ideas, favorite pages and ongoing projects.|Faites de chaque nouvel onglet le point de départ de vos tâches, idées, pages favorites et projets.|新しいタブを、計画、アイデア、お気に入りのページ、進行中のプロジェクトへの入口に。
把今天的一件事，慢慢做好。|One thing today, at your own pace.|Une chose aujourd’hui, à votre rythme.|今日のひとつを、自分のペースで。
给一闪而过的念头，一个位置。|A place for a passing thought.|Une place pour une idée fugace.|ふと浮かんだアイデアに、居場所を。
要将 GUGA 设为新标签页吗？|Use GUGA for new tabs?|Utiliser GUGA pour les nouveaux onglets ?|新しいタブに GUGA を表示しますか？
开启后，点击“＋”或按 Ctrl+T 将显示启动页。你可以随时在设置中关闭。|When enabled, + or Ctrl+T opens your start page. Turn it off anytime in settings.|Une fois activé, + ou Ctrl+T ouvre votre accueil. Vous pouvez le désactiver dans les paramètres.|有効にすると、＋ または Ctrl+T でスタートページが開きます。設定でいつでも無効にできます。
使用 GUGA 新标签页|Use GUGA new tabs|Utiliser les onglets GUGA|新しいタブに GUGA を使う
暂不替换|Keep browser default|Garder la page du navigateur|今は変更しない
已保留浏览器原来的新标签页。之后可以在“设置与数据管理”中开启，也可以直接打开启动页预览。|Your browser’s new tab is unchanged. Enable GUGA later in Settings & data, or preview the start page.|La page du navigateur est conservée. Activez GUGA plus tard dans les paramètres ou prévisualisez l’accueil.|ブラウザの新しいタブを保持しました。後から設定で有効にしたり、プレビューを開いたりできます。
未命名记录|Untitled record|Fiche sans titre|無題の記録
未命名草稿|Untitled draft|Brouillon sans titre|無題の下書き
未命名网页组|Untitled web group|Groupe sans titre|無題のウェブグループ
请填写内容。|Enter some content.|Saisissez du contenu.|内容を入力してください。
这条 Todo 已在另一窗口移除。|This Todo was removed in another window.|Ce Todo a été supprimé dans une autre fenêtre.|この Todo は別のウィンドウで削除されました。
这条内容已在另一窗口移除。|This item was removed in another window.|Cet élément a été supprimé dans une autre fenêtre.|この項目は別のウィンドウで削除されました。
这条记录已不在资料库中。|This record is no longer in the library.|Cette fiche n’est plus dans la bibliothèque.|この記録はライブラリにありません。
清单模式|List mode|Mode de liste|リストのモード
新建文件夹名称|New folder name|Nom du nouveau dossier|新しいフォルダ名
`),
);
Object.assign(
  messages,
  Object.fromEntries(
    decodeRows(String.raw`
待处理收集|Pending captures|Captures en attente|未処理の収集
重复与相关内容|Duplicate & related content|Contenus doublons et associés|重複・関連する内容
内容重复|Duplicate content|Contenu en double|内容の重複
不同来源、内容相同|Same content, different sources|Même contenu, sources différentes|出典が異なる同じ内容
同页不同内容|Same page, different content|Même page, contenu différent|同じページの異なる内容
差异|Differences|Différences|差分
发现重复或相关内容，原文已保留在本机。|Duplicate or related content found. The original is kept locally.|Contenu doublon ou associé trouvé. L’original est conservé localement.|重複または関連する内容が見つかりました。元の内容はブラウザに保持しています。
你的这次收集已经留在本机。选择追加、另存或取消，系统不会自动合并。|Your capture is saved locally. Append, save separately or cancel; nothing is merged automatically.|La capture est conservée localement. Ajoutez, enregistrez séparément ou annulez ; aucune fusion automatique.|今回の収集はブラウザに保持されています。追加、別途保存、キャンセルを選べます。自動では統合しません。
发现相关记录，已保留到待处理收集；标签页没有关闭。|Related records found. Capture kept for review; tabs stayed open.|Fiches associées trouvées. Capture mise en attente ; onglets conservés.|関連記録が見つかりました。未処理の収集として保持し、タブは閉じていません。
仍然另存一条|Save separately anyway|Enregistrer séparément|別の記録として保存
取消这次收集|Cancel this capture|Annuler cette capture|この収集をキャンセル
查看已有记录|View existing record|Voir la fiche existante|既存の記録を表示
查看重复提示|View duplicate notice|Voir l’avertissement de doublon|重複の通知を表示
合并…|Merge…|Fusionner…|統合…
合并两条|Merge two records|Fusionner deux fiches|2 つの記録を統合
合并到|Merge into|Fusionner dans|統合先
合并已有记录|Merge existing records|Fusionner des fiches existantes|既存の記録を統合
合并并保留来源到回收站|Merge and keep source in trash|Fusionner et garder la source en corbeille|統合して元の記録をゴミ箱に保持
合并先保存在本机，等待同步。|Merges are saved locally, pending sync.|La fusion reste locale, à synchroniser.|統合結果はブラウザに保存し、同期待ちになります。
将“{0}”合并到所选记录。合并正文、附件、标签、项目和来源；来源记录保留在回收站中，可恢复。目标保留自己的类型与待办状态。|Merge “{0}” into the selected record, combining content, attachments, tags, projects and sources. The source stays restorable in trash. The target keeps its type and task status.|Fusionnez « {0} » dans la fiche choisie : contenus, pièces jointes, étiquettes, projets et sources. La source reste restaurable en corbeille. La cible garde son type et son statut.|「{0}」の本文、添付、タグ、プロジェクト、出典を選択した記録に統合します。元の記録はゴミ箱から復元できます。統合先の種類とタスク状態を保持します。
目标在回收站：合并时会明确还原到正常记录。|Target is in trash: merging restores it.|La cible est dans la corbeille : la fusion la restaure.|統合先はゴミ箱にあります。統合時に復元します。
来源记录正文|Source record content|Contenu de la fiche source|元の記録の本文
目标记录正文|Target record content|Contenu de la fiche cible|統合先の本文
当前没有重复候选，可以另存为新记录。|No duplicate candidates. Save as a new record.|Aucun doublon potentiel. Enregistrez une nouvelle fiche.|重複候補はありません。新しい記録として保存できます。
没有可合并的候选。可在列表选择两条记录手动合并。|No merge candidates. Select two records in the list to merge manually.|Aucune candidate à fusionner. Choisissez deux fiches dans la liste.|統合候補はありません。一覧で 2 つの記録を選択して統合できます。
已合并到本机，来源记录保留在回收站。|Merged locally. The source is kept in trash.|Fusion locale terminée. La source est en corbeille.|ブラウザで統合しました。元の記録はゴミ箱に保持しています。
追加到所选记录|Append to selected record|Ajouter à la fiche choisie|選択した記録に追加
追加（必要时还原）|Append (restore if needed)|Ajouter (restaurer si nécessaire)|追加（必要なら復元）
已追加到 collected，确认后再保存。|Appended to collected. Review, then save.|Ajouté à collected. Vérifiez puis enregistrez.|collected に追加しました。確認して保存してください。
已追加到 collected；图片已嵌入在线地址，离线查看需先保存原图。|Appended to collected. Image uses an online URL; save the original for offline access.|Ajouté à collected. L’image utilise une URL en ligne ; enregistrez l’original pour le hors ligne.|collected に追加しました。画像はオンライン URL です。オフラインで使うには元画像を保存してください。
这条收集已处理。|This capture was already handled.|Cette capture a déjà été traitée.|この収集は既に処理済みです。
在回收站|In trash|Dans la corbeille|ゴミ箱内
新增|New|Nouveau|新規
内置示例 · {0} 条|Built-in examples · {0}|Exemples intégrés · {0}|組み込みサンプル · {0} 件
内置示例 · 只读预览|Built-in example · Read only|Exemple intégré · Lecture seule|組み込みサンプル · 読み取り専用
内置示例：|Built-in example:|Exemple intégré :|組み込みサンプル：
查看 {0} 条内置示例|View {0} examples|Voir {0} exemples|{0} 件のサンプルを表示
打开示例|Open example|Ouvrir l’exemple|サンプルを開く
查看示例：{0}|View example: {0}|Voir l’exemple : {0}|サンプルを表示：{0}
全部加入我的收件箱|Add all to my inbox|Tout ajouter à ma boîte|すべて受信箱に追加
重试加载示例|Retry loading examples|Recharger les exemples|サンプルの読み込みを再試行
隐藏内置示例|Hide examples|Masquer les exemples|サンプルを非表示
显示收件箱内置示例|Show inbox examples|Afficher les exemples de la boîte|受信箱のサンプルを表示
已保存过此示例|Example already saved|Exemple déjà enregistré|保存済みのサンプル
保存前为只读预览；图片和测试录音来自已验证的演示数据。|Read-only until saved. Images and test audio come from verified demo data.|Lecture seule avant enregistrement. Images et audios proviennent des données de démonstration vérifiées.|保存前は読み取り専用です。画像とテスト音声は検証済みのデモデータです。
加入后可编辑，并按当前设置同步；已保存过的示例会跳过。|Added examples become editable and sync normally. Already saved examples are skipped.|Les exemples ajoutés deviennent modifiables et synchronisables. Ceux déjà enregistrés sont ignorés.|追加すると編集や同期ができます。保存済みのサンプルはスキップします。
示例随扩展离线提供，预览不参与同步。点击保存后成为你的普通记录，并使用当前同步设置。|Examples are included offline and do not sync while previewing. Save one to make it a normal record.|Les exemples sont disponibles hors ligne sans synchronisation. Enregistrez-en un pour en faire une fiche normale.|サンプルはオフラインで利用でき、プレビュー中は同期しません。保存すると通常の記録になります。
收件箱中的示例用于展示文字、网页、图片、录音和快照。隐藏后可在这里恢复预览。|Inbox examples demonstrate text, pages, images, audio and snapshots. Restore hidden examples here.|Les exemples illustrent textes, pages, images, audios et captures. Rétablissez ici leur aperçu.|受信箱のサンプルで文章、ページ、画像、音声、スナップショットを紹介します。非表示にしたものはここで再表示できます。
已加入 {0} 条示例到收件箱；{1} 条已保存过，保留原有内容。|Added {0} examples; {1} already saved examples kept unchanged.|{0} exemples ajoutés ; {1} exemples déjà enregistrés conservés.|{0} 件を受信箱に追加しました。保存済みの {1} 件はそのまま保持しています。
此示例已保存过；已有的修改和删除状态保持不变。|Already saved. Existing changes and deletion status are kept.|Déjà enregistré. Modifications et état de suppression sont conservés.|保存済みです。既存の編集や削除状態を保持します。
示例已保存到你的收件箱，可编辑并按当前设置同步。|Example saved to inbox. You can edit and sync it.|Exemple enregistré dans votre boîte, modifiable et synchronisable.|サンプルを受信箱に保存しました。編集や同期ができます。
已隐藏内置示例，可在设置与数据管理中恢复。|Examples hidden. Restore them in Settings & data.|Exemples masqués. Rétablissez-les dans les paramètres.|サンプルを非表示にしました。設定とデータ管理から再表示できます。
GUGA Knowledge · 使用说明书|GUGA Knowledge · User guide|GUGA Knowledge · Guide d’utilisation|GUGA Knowledge · 使い方ガイド
← 返回整理页|← Back to organizer|← Retour au classement|← 整理ページに戻る
▤ 使用说明书|▤ User guide|▤ Guide d’utilisation|▤ 使い方ガイド
◐ 主题与字体|◐ Theme & fonts|◐ Thème et polices|◐ テーマとフォント
⚙ 设置与数据管理|⚙ Settings & data|⚙ Paramètres et données|⚙ 設定とデータ管理
帮助文档|Help documents|Documents d’aide|ヘルプ文書
查找章节|Find a section|Rechercher une section|章を検索
章节目录|Table of contents|Table des matières|目次
如：录音、网页组、同步|e.g. audio, groups, sync|Ex. audio, groupes, synchronisation|例：録音、ウェブグループ、同期
下载 Markdown 原文|Download Markdown|Télécharger le Markdown|Markdown をダウンロード
打印 / 保存 PDF|Print / Save PDF|Imprimer / Enregistrer en PDF|印刷 / PDF に保存
可重复测试流程|Repeatable test guide (Chinese)|Procédure de test (chinois)|再現可能なテスト手順（中国語）
正在加载本地说明书…|Loading offline guide…|Chargement du guide local…|オフラインガイドを読み込み中…
文档尚未生成，请运行 npm run demo:manual 或重新构建扩展。|Guide unavailable. Rebuild the extension.|Guide indisponible. Reconstruisez l’extension.|ガイドがありません。拡張機能を再ビルドしてください。
无法打开说明书：{0}|Cannot open guide: {0}|Impossible d’ouvrir le guide : {0}|ガイドを開けません：{0}
待处理|Pending|En attente|未処理
进行中|In progress|En cours|進行中
已完成|Completed|Terminée|完了
已归档|Archived|Archivée|アーカイブ済み
按项目|By project|Par projet|プロジェクト別
按标签|By tag|Par étiquette|タグ別
不分类|No grouping|Sans classement|分類なし
`),
  ),
);
Object.assign(messages, Object.fromEntries(decodeRows(driveMessages)));
for (const label of [
  '复古青绿 · Vintage Teal',
  '陶土红 · Retro Coral',
  '亚麻卡其 · Linen Beige',
  '阳光黄 · Sunshine Yellow',
  '冲浪绿 · Surf Green',
  '湖水蓝 · Lagoon Blue',
  '深鼠尾草绿 · Deep Sage',
  '深咖啡棕 · Espresso Brown',
  '柔沙米色 · Soft Sand',
  'Red Chai · 红茶棕',
  'Masala · 玛萨拉红',
  'Cinnamon Toast · 肉桂吐司',
  'Cardamom · 小豆蔻米黄',
  'Ocean Deep · 深海绿',
  'Villa Nova · 象牙米白',
  'Siren Song · 浅灰鼠尾草绿',
  'Big River · 河岸灰绿',
  'Almond · 杏仁米色',
  'Matcha Brew · 抹茶绿',
  'Forest Roast · 森林深绿',
  'Eclipse · 暗夜墨绿',
]) {
  const name = label.split(' · ').find((part) => !/\p{Script=Han}/u.test(part));
  messages[label] = [name, name, name];
}
Object.assign(
  messages,
  Object.fromEntries(
    decodeRows(String.raw`
主题色|Accent color|Couleur d’accent|テーマカラー
卡片背景|Card background|Fond des cartes|カードの背景
基础界面|General interface|Interface générale|基本の画面
导航与侧栏|Navigation & sidebar|Navigation et panneau latéral|ナビゲーションとサイドバー
导航行距|Navigation spacing|Espacement de navigation|ナビゲーションの間隔
正文颜色|Text color|Couleur du texte|本文の色
辅助文字|Secondary text|Texte secondaire|補助テキスト
边框颜色|Border color|Couleur des bordures|枠線の色
页面背景|Page background|Fond de page|ページの背景
页面标题|Page headings|Titres de page|ページの見出し
记录卡片|Record cards|Cartes des fiches|記録カード
编辑器|Editor|Éditeur|エディター
颜色|Color|Couleur|色
{0}十六进制|{0} hex value|{0} en hexadécimal|{0} の 16 進数
{0}预设|{0} presets|Préréglages {0}|{0} のプリセット
{0}字体|{0} font|Police : {0}|{0} のフォント
{0}字号|{0} font size|Taille : {0}|{0} の文字サイズ
纸张|Paper|Papier|ペーパー
明亮|Light|Clair|ライト
深色|Dark|Sombre|ダーク
跟随系统|System|Système|システムに合わせる
配色主题|Color themes|Palettes de couleurs|配色テーマ
美式复古|American vintage|Rétro américain|アメリカンレトロ
法式复古|French vintage|Rétro français|フレンチレトロ
暖调香料|Warm spices|Épices chaudes|温かなスパイス
海洋自然|Ocean nature|Nature océanique|海の自然
抹茶森林|Matcha forest|Forêt matcha|抹茶の森
点击色卡即时预览，保存主题后应用到插件各页面。也可单独调整颜色与字体。|Click a palette to preview; save to apply across the extension. Colors and fonts can be customized.|Cliquez pour prévisualiser ; enregistrez pour appliquer partout. Couleurs et polices restent personnalisables.|色カードをクリックしてプレビューし、保存すると拡張機能全体に適用します。色やフォントも個別に調整できます。
选择配色主题，调整各区域的字体与导航行距。|Choose a palette, fonts and navigation spacing.|Choisissez une palette, les polices et l’espacement de navigation.|配色テーマ、各領域のフォント、ナビゲーションの間隔を調整します。
恢复默认|Restore defaults|Rétablir les valeurs par défaut|初期設定に戻す
已保存，整理页与侧栏同时生效。|Saved for organizer and sidebar.|Enregistré pour le classement et le panneau latéral.|保存しました。整理ページとサイドバーに適用します。
页面企鹅与伙伴|Penguin & companions|Manchot et compagnons|ペンギンと仲間たち
伙伴显示方式|Companion display mode|Mode d’affichage du compagnon|仲間の表示方法
伙伴更换间隔|Companion change interval|Intervalle de changement|仲間の切り替え間隔
选择页面伙伴|Choose a companion|Choisir un compagnon|仲間を選ぶ
固定|Fixed|Fixe|固定
随机|Random|Aléatoire|ランダム
循环|Cycle|Cycle|順番に表示
显示方式|Display mode|Mode d’affichage|表示方法
更换间隔|Change interval|Intervalle|切り替え間隔
固定显示{0}|Always show {0}|Toujours afficher {0}|{0} を固定表示
立即换一张|Change now|Changer maintenant|今すぐ切り替える
固定显示喜欢的伙伴，或按间隔随机更换、依次循环。点击图片固定显示；设置立即保存。|Keep a favorite companion, choose random changes or cycle through them. Click an image to pin it. Preferences save immediately.|Gardez un compagnon, changez-le aléatoirement ou en boucle. Cliquez pour le fixer. Les réglages sont enregistrés immédiatement.|好きな仲間を固定するか、ランダム・順番に切り替えられます。画像をクリックすると固定し、設定はすぐ保存されます。
原版企鹅|Original penguin|Manchot original|オリジナルのペンギン
睡觉企鹅|Sleeping penguin|Manchot endormi|眠るペンギン
团子企鹅|Round penguin|Manchot rond|まんまるペンギン
手绘企鹅|Sketched penguin|Manchot dessiné|手描きのペンギン
双人企鹅|Penguin pair|Duo de manchots|ペンギンのふたり
发呆黑猫|Daydreaming black cat|Chat noir rêveur|ぼんやり黒猫
5 分钟|5 minutes|5 minutes|5 分
{0} 秒|{0} seconds|{0} secondes|{0} 秒
图标|Icon|Icône|アイコン
图标 {0}|Icon {0}|Icône {0}|アイコン {0}
网页访问权限|Website permissions|Autorisations des sites|ウェブサイトの権限
允许所有网站访问|Allow all websites|Autoriser tous les sites|すべてのサイトへのアクセスを許可
撤销额外网站访问|Revoke website access|Révoquer l’accès aux sites|追加のサイト権限を取り消す
捕获时可只允许当前网站。若需要跨网站捕获、页面截图或读取外部链接标题，可在这里允许所有网站访问；授权不会开启后台扫描。请使用下方按钮发起 Chrome 授权。|You can allow just the current site when capturing. For cross-site captures, screenshots or link titles, allow all sites here. This never starts background scanning. Use the button to request Chrome permission.|Vous pouvez autoriser seulement le site actuel. Pour capturer plusieurs sites, des images ou des titres de liens, autorisez tous les sites ici. Aucun balayage en arrière-plan n’est lancé.|収集時に現在のサイトだけ許可できます。サイトをまたぐ収集、スクリーンショット、リンクタイトルの取得にはすべてのサイトへの権限を許可できます。バックグラウンドでの巡回は行いません。
尚未允许所有网站访问。可在捕获界面单独授权网站，或使用下方按钮授权全部网站。|All-site access is off. Allow individual sites when capturing, or use the button below.|L’accès global est désactivé. Autorisez un site lors de la capture ou utilisez le bouton ci-dessous.|全サイトへの権限は未許可です。収集時に個別で許可するか、下のボタンで許可できます。
已允许所有网站访问。|All-site access allowed.|Accès à tous les sites autorisé.|すべてのサイトへのアクセスを許可しました。
已允许网站访问。|Website access allowed.|Accès aux sites autorisé.|サイトへのアクセスを許可しました。
已撤销额外网站访问。|Extra website access revoked.|Accès supplémentaire révoqué.|追加のサイト権限を取り消しました。
未获得授权。可以重新点击授权，或在捕获界面只允许当前网站。|Permission not granted. Retry or allow only the current site when capturing.|Autorisation non accordée. Réessayez ou autorisez seulement le site actuel.|許可されませんでした。再試行するか、収集時に現在のサイトだけ許可してください。
未获得网站授权。可再次点击授权，也可以手动粘贴内容。|Website access not granted. Retry or paste content manually.|Accès non accordé. Réessayez ou collez le contenu manuellement.|サイトの権限が未許可です。再試行するか、内容を手動で貼り付けてください。
允许访问此网站并重试|Allow this site and retry|Autoriser ce site et réessayer|このサイトを許可して再試行
允许所有网站访问并重试截图|Allow all sites and retry screenshot|Autoriser tous les sites et réessayer la capture|全サイトを許可してスクリーンショットを再試行
Chrome 的页面截图接口需要所有网站访问权限，或通过点击工具栏扩展图标取得当前页临时权限。授权只用于你主动触发的捕获；也可回到网页点击扩展图标后重试。|Chrome screenshots need all-site access or temporary access from clicking the extension icon. Permission is used only for captures you request. You can also click the icon on the page and retry.|Les captures Chrome nécessitent l’accès global ou l’accès temporaire obtenu via l’icône de l’extension. L’accès ne sert qu’aux captures demandées. Cliquez sur l’icône de la page puis réessayez.|Chrome の撮影には全サイトの権限、または拡張機能のアイコンを押して取得する一時的な権限が必要です。権限は明示的な収集にのみ使います。ページ上でアイコンを押して再試行することもできます。
读取 {0} 的选中文字需要访问该网站。点击下方按钮，在 Chrome 中确认后自动重试。也可回到网页点击工具栏扩展图标后重试。|Reading selected text on {0} needs site access. Click below, confirm in Chrome and retry. Or click the extension icon on that page.|Lire la sélection sur {0} nécessite un accès. Cliquez ci-dessous et confirmez dans Chrome, ou cliquez sur l’icône de l’extension sur la page.|{0} の選択文字を読むには権限が必要です。下のボタンから Chrome で許可すると再試行します。ページで拡張アイコンを押して再試行することもできます。
网站授权失败：{0}|Website permission failed: {0}|Échec de l’autorisation du site : {0}|サイトの許可に失敗しました：{0}
网站授权失败：{0}。可以手动粘贴内容。|Website permission failed: {0}. You can paste content manually.|Échec de l’autorisation : {0}. Vous pouvez coller le contenu.|サイトの許可に失敗しました：{0}。内容を手動で貼り付けることもできます。
撤销权限失败：{0}|Failed to revoke permission: {0}|Échec de la révocation : {0}|権限の取り消しに失敗しました：{0}
开始录音|Start recording|Démarrer l’enregistrement|録音を開始
停止录音|Stop recording|Arrêter l’enregistrement|録音を停止
正在检查麦克风权限…|Checking microphone permission…|Vérification du microphone…|マイクの権限を確認中…
正在保存录音…|Saving audio…|Enregistrement de l’audio…|音声を保存中…
● 正在录音 00:00|● Recording 00:00|● Enregistrement 00:00|● 録音中 00:00
● 正在录音 {0}:{1} · 每秒保存片段到本机|● Recording {0}:{1} · Saved locally every second|● Enregistrement {0}:{1} · Sauvegarde locale chaque seconde|● 録音中 {0}:{1} · 毎秒ブラウザに保存
录音 {0}|Recording {0}|Enregistrement {0}|録音 {0}
录音已保存为附件；点击保存记录即可。|Audio saved as an attachment. Save the record to finish.|Audio enregistré en pièce jointe. Enregistrez la fiche.|音声を添付として保存しました。記録を保存してください。
录音被中断，已保存片段可以从设置中恢复。|Recording interrupted. Recover saved audio in settings.|Enregistrement interrompu. Récupérez les fragments dans les paramètres.|録音が中断されました。保存済みの音声は設定から復元できます。
{0} 已保存片段可在设置中恢复。|{0} Saved audio can be recovered in settings.|{0} Les fragments sont récupérables dans les paramètres.|{0} 保存済みの音声は設定から復元できます。
录音操作已取消。|Recording canceled.|Enregistrement annulé.|録音をキャンセルしました。
录音窗口已关闭。|Recording window closed.|Fenêtre d’enregistrement fermée.|録音ウィンドウが閉じられました。
收集窗口已关闭。|Capture window closed.|Fenêtre de capture fermée.|収集ウィンドウが閉じられました。
未完成录音恢复|Recover interrupted audio|Récupérer les audios interrompus|中断した録音を復元
没有需要恢复的录音。|No audio to recover.|Aucun audio à récupérer.|復元する音声はありません。
恢复到收件箱|Restore to inbox|Restaurer dans la boîte|受信箱に復元
已恢复录音到收件箱。|Audio restored to inbox.|Audio restauré dans la boîte.|音声を受信箱に復元しました。
请先停止当前录音。|Stop the current recording first.|Arrêtez d’abord l’enregistrement en cours.|先に現在の録音を停止してください。
请先停止录音。|Stop recording first.|Arrêtez d’abord l’enregistrement.|先に録音を停止してください。
请先停止录音，再保存完整本地包。|Stop recording before exporting a full backup.|Arrêtez l’enregistrement avant d’exporter une sauvegarde.|完全バックアップの書き出し前に録音を停止してください。
允许使用麦克风|Allow microphone access|Autoriser le microphone|マイクへのアクセスを許可
允许麦克风|Allow microphone|Autoriser le microphone|マイクを許可
允许麦克风 · GUGA Knowledge|Allow microphone · GUGA Knowledge|Autoriser le microphone · GUGA Knowledge|マイクを許可 · GUGA Knowledge
打开浏览器麦克风设置|Open browser microphone settings|Ouvrir les paramètres du microphone|ブラウザのマイク設定を開く
麦克风设置|Microphone settings|Paramètres du microphone|マイクの設定
麦克风只会在你主动录音时使用。|The microphone is used only when you start recording.|Le microphone est utilisé uniquement quand vous lancez un enregistrement.|マイクは録音を開始したときだけ使用します。
点击下方按钮，再在浏览器的权限提示中选择“允许”。授权完成后会返回插件并开始录音。|Click below, then Allow in your browser. Recording starts after permission is granted.|Cliquez ci-dessous puis Autoriser dans le navigateur. L’enregistrement commencera après autorisation.|下のボタンを押し、ブラウザの確認で「許可」を選んでください。許可後に拡張機能へ戻り録音を始めます。
请在浏览器弹出的麦克风权限提示中选择“允许”…|Choose Allow in the browser’s microphone prompt…|Choisissez Autoriser dans la demande du navigateur…|ブラウザのマイクの確認で「許可」を選んでください…
麦克风已允许，可以返回插件录音。|Microphone allowed. Return to the extension to record.|Microphone autorisé. Revenez à l’extension pour enregistrer.|マイクを許可しました。拡張機能に戻って録音できます。
已打开麦克风授权页，请点击“允许麦克风”。|Microphone permission page opened. Click Allow microphone.|Page d’autorisation ouverte. Cliquez sur Autoriser le microphone.|マイクの許可ページを開きました。「マイクを許可」を押してください。
已取消麦克风授权，录音没有开始。|Microphone permission canceled. Recording did not start.|Autorisation annulée. L’enregistrement n’a pas commencé.|マイクの許可をキャンセルしました。録音は開始していません。
麦克风授权页已关闭，录音没有开始。|Permission page closed. Recording did not start.|Page d’autorisation fermée. L’enregistrement n’a pas commencé.|許可ページが閉じられました。録音は開始していません。
麦克风授权页已离开，录音没有开始。|You left the permission page. Recording did not start.|Page d’autorisation quittée. L’enregistrement n’a pas commencé.|許可ページから移動しました。録音は開始していません。
麦克风未授权，录音没有开始。|Microphone not allowed. Recording did not start.|Microphone non autorisé. L’enregistrement n’a pas commencé.|マイクが許可されていないため録音は開始していません。
麦克风权限被阻止。请打开浏览器麦克风设置允许访问，并检查系统是否允许浏览器使用麦克风，再重试。|Microphone blocked. Allow it in browser settings, check system permissions, then retry.|Microphone bloqué. Autorisez-le dans le navigateur et le système, puis réessayez.|マイクがブロックされています。ブラウザと OS のマイク権限を許可して再試行してください。
麦克风权限被阻止，请点击“麦克风设置”打开授权页，并允许浏览器使用麦克风。|Microphone blocked. Open Microphone settings and allow access.|Microphone bloqué. Ouvrez ses paramètres et autorisez l’accès.|マイクがブロックされています。「マイクの設定」からアクセスを許可してください。
没有找到麦克风，请连接设备后重试。|No microphone found. Connect one and retry.|Aucun microphone trouvé. Branchez-en un et réessayez.|マイクが見つかりません。接続して再試行してください。
无法使用麦克风，请检查设备是否被其他程序占用。|Cannot use microphone. Check if another app is using it.|Microphone indisponible. Vérifiez si une autre application l’utilise.|マイクを使用できません。他のアプリで使用中か確認してください。
无法打开麦克风，请检查设备是否可用。|Cannot open microphone. Check the device.|Impossible d’ouvrir le microphone. Vérifiez l’appareil.|マイクを開けません。デバイスを確認してください。
浏览器无法使用麦克风，请在完整整理页录音。|Microphone unavailable here. Record from the full organizer.|Microphone indisponible ici. Enregistrez depuis le classement complet.|ここではマイクを使用できません。整理ページから録音してください。
`),
  ),
);
Object.assign(
  messages,
  Object.fromEntries(
    decodeRows(String.raw`
添加图片|Add image|Ajouter une image|画像を追加
下载图片|Download image|Télécharger l’image|画像をダウンロード
下载网页快照|Download snapshot|Télécharger la capture|スナップショットをダウンロード
加载图片|Load image|Charger l’image|画像を読み込む
加载录音|Load audio|Charger l’audio|音声を読み込む
加载快照|Load snapshot|Charger la capture|スナップショットを読み込む
图片无法解码，请重新收集原图或导入完整备份。|Cannot decode this image. Capture the original again or import a full backup.|Image illisible. Capturez à nouveau l’original ou importez une sauvegarde complète.|画像を表示できません。元の画像を再収集するか、完全バックアップを読み込んでください。
粘贴图片-{0}.png|Pasted-image-{0}.png|Image-collée-{0}.png|貼り付け画像-{0}.png
可在正文中 Ctrl+V 粘贴图片。录音与图片会写入 Markdown。|Paste images with Ctrl+V. Images and audio are included in Markdown.|Collez des images avec Ctrl+V. Images et audios sont ajoutés au Markdown.|本文に Ctrl+V で画像を貼り付けられます。画像と音声は Markdown に挿入します。
正在保存图片原文件…|Saving original image…|Enregistrement de l’image originale…|元の画像を保存中…
正在保存…|Saving…|Enregistrement…|保存中…
附件已保存在本机；保存记录后等待手动同步。|Attachment saved locally. Save the record, then sync manually.|Pièce jointe enregistrée localement. Enregistrez la fiche, puis synchronisez.|添付をブラウザに保存しました。記録を保存した後に手動で同期してください。
清单 Markdown|List Markdown|Markdown de la liste|リストの Markdown
添加清单项|Add list item|Ajouter un élément|リスト項目を追加
清单内容 {0}|List item {0}|Élément {0}|リストの項目 {0}
删除清单项 {0}|Delete list item {0}|Supprimer l’élément {0}|リストの項目 {0} を削除
分隔线|Divider|Séparateur|区切り線
清空|Clear|Effacer|クリア
写一个想法，按 Enter 添加；--- 添加分隔线|Write an idea, Enter to add; --- for a divider|Écrivez une idée, Entrée pour ajouter ; --- pour séparer|アイデアを入力して Enter で追加。--- で区切り線
写一项，按 Enter 添加；输入 --- 添加分隔线|Write an item, Enter to add; --- for a divider|Écrivez un élément, Entrée pour ajouter ; --- pour séparer|項目を入力して Enter で追加。--- で区切り線
写一项，按 Enter 生成待办；--- 添加分隔线|Write a task, Enter to add; --- for a divider|Écrivez une tâche, Entrée pour ajouter ; --- pour séparer|タスクを入力して Enter で追加。--- で区切り線
- [ ] 写下一项待办\n- [x] 已完成\n---|- [ ] Write a task\n- [x] Done\n---|- [ ] Écrire une tâche\n- [x] Terminée\n---|- [ ] タスクを書く\n- [x] 完了\n---
- 写下一条想法\n- 另一条想法\n---|- Write an idea\n- Another idea\n---|- Écrire une idée\n- Une autre idée\n---|- アイデアを書く\n- 別のアイデア\n---
逐行输入，按 Enter 添加。Todo 自动生成复选框，Idea 生成条目；--- 生成分隔线。内容保存为 Markdown。|Enter one item per line. Todo creates checkboxes, Idea creates bullets; --- adds a divider. Saved as Markdown.|Saisissez une ligne puis Entrée. Todo crée des cases, Idea des puces ; --- ajoute un séparateur. Enregistré en Markdown.|1 行ずつ入力し Enter で追加します。Todo はチェックボックス、Idea は箇条書き、--- は区切り線になります。Markdown として保存します。
写下想法，或粘贴图片…|Write a thought or paste an image…|Écrivez une idée ou collez une image…|アイデアを書いたり、画像を貼り付けたり…
输入自动保存为本机草稿|Input autosaves as a local draft|Saisie enregistrée en brouillon local|入力はローカルの下書きとして自動保存
草稿已保存到本机|Draft saved locally|Brouillon enregistré localement|下書きをブラウザに保存しました
请填写记录或添加图片、录音。|Write something or add an image or audio.|Écrivez du contenu ou ajoutez une image ou un audio.|内容を入力するか、画像や音声を追加してください。
收集方式|Capture method|Mode de capture|収集方法
随手收集|Quick capture|Capture rapide|クイック収集
捕获当前网页|Capture current page|Capturer la page actuelle|現在のページを収集
捕获网页快照|Capture snapshot|Capturer une image de page|ページのスナップショットを作成
捕获失败。|Capture failed.|Échec de la capture.|収集に失敗しました。
尚未捕获|Not captured yet|Pas encore capturé|まだ収集されていません
尚未捕获快照，请打开目标网页后点击“捕获当前网页”。|No snapshot yet. Open the target page and click Capture current page.|Aucune capture. Ouvrez la page souhaitée et cliquez sur Capturer la page actuelle.|スナップショットはまだありません。対象ページを開いて「現在のページを収集」を押してください。
截取当前网页可见区域的页面图片，并保留来源链接。|Capture the visible page area and keep its source link.|Capturez la zone visible de la page en conservant son lien source.|現在見えている範囲を画像として保存し、出典リンクを保持します。
旧版网页文件|Legacy web file|Ancien fichier web|旧形式のウェブファイル
旧版网页文件已保留，新快照使用页面图片。|Legacy file kept. New snapshots use page images.|Ancien fichier conservé. Les nouvelles captures sont des images.|旧形式のファイルを保持しました。新しいスナップショットは画像で保存します。
页面截图|Page screenshot|Capture de page|ページのスクリーンショット
请先捕获网页快照。|Capture a snapshot first.|Capturez d’abord la page.|先にスナップショットを作成してください。
请先停止录音，再捕获网页。|Stop recording before capturing a page.|Arrêtez l’enregistrement avant la capture.|ページを収集する前に録音を停止してください。
选择网页文字，右键保存，或按 Alt + Shift + S。\n每一条新收集都会先来到这里。|Select text, right-click to save or press Alt + Shift + S.\nNew captures arrive here.|Sélectionnez du texte, clic droit pour enregistrer ou Alt + Shift + S.\nLes nouvelles captures arrivent ici.|文字を選択し右クリックで保存、または Alt + Shift + S。\n新しい収集はここに表示されます。
选择网页文字，右键或按 Alt + Shift + S。\n也可以在上方直接写一条。|Select text and right-click or press Alt + Shift + S.\nOr write a note above.|Sélectionnez du texte, clic droit ou Alt + Shift + S.\nOu écrivez une note ci-dessus.|文字を選択して右クリック、または Alt + Shift + S。\n上で直接ノートを書くこともできます。
读取已打开网页…|Reading open pages…|Lecture des pages ouvertes…|開いているページを取得中…
选择已打开网页|Choose open pages|Choisir des pages ouvertes|開いているページを選択
选择全部标签页|Select all tabs|Sélectionner tous les onglets|すべてのタブを選択
选择全部（固定标签页保留）|Select all (keep pinned tabs)|Tout sélectionner (garder les onglets épinglés)|すべて選択（固定タブを保持）
选择标签页 {0}|Select tab {0}|Sélectionner l’onglet {0}|タブ {0} を選択
加入所选网页|Add selected pages|Ajouter la sélection|選択したページを追加
加入链接|Add link|Ajouter le lien|リンクを追加
待读网页|Pages to read|Pages à lire|あとで読むページ
粘贴网页链接|Paste a page URL|Coller un lien de page|ページの URL を貼り付け
网页标题（可选）|Page title (optional)|Titre de page (facultatif)|ページのタイトル（任意）
正在读取网页标题…|Reading page title…|Lecture du titre de page…|ページのタイトルを取得中…
正在读取链接标题…|Reading link title…|Lecture du titre du lien…|リンクのタイトルを取得中…
正在加入…|Adding…|Ajout…|追加中…
网页不提供标题|Page has no title|La page ne fournit pas de titre|ページにタイトルがありません
网页标题部分过大|Page title section is too large|La section du titre est trop grande|ページのタイトル部分が大きすぎます
多选已打开网页批量归组。请勿从浏览器顶部标签栏拖入，那会变成新窗口。未授权读取标题时显示网站域名，链接仍可保存，也可自行填写标题。|Select open pages to group them. Drag from this list, not the browser’s tab bar. Without title access, the domain is shown; links can still be saved and titles edited.|Sélectionnez les pages à regrouper depuis cette liste, pas depuis la barre d’onglets. Sans accès aux titres, le domaine s’affiche ; les liens restent enregistrables.|この一覧からページを選んでグループ化します。ブラウザのタブバーからドラッグしないでください。タイトルを取得できない場合はドメインを表示し、リンクの保存やタイトルの入力は可能です。
这个窗口没有可归类的网页。|No eligible pages in this window.|Aucune page à classer dans cette fenêtre.|このウィンドウに分類できるページはありません。
请先选择网页。|Select a page first.|Sélectionnez d’abord une page.|先にページを選択してください。
请先加入网页。|Add a page first.|Ajoutez d’abord une page.|先にページを追加してください。
请输入 HTTP / HTTPS 网页链接。|Enter an HTTP / HTTPS page URL.|Saisissez un lien HTTP / HTTPS.|HTTP / HTTPS のページ URL を入力してください。
请输入 HTTP / HTTPS 链接。|Enter an HTTP / HTTPS URL.|Saisissez un lien HTTP / HTTPS.|HTTP / HTTPS の URL を入力してください。
拖入 ↘|Drop here ↘|Déposer ici ↘|ここにドロップ ↘
拖入网页中的链接，或从插件列表拖入|Drag a page link or an item from the extension list|Glissez un lien de page ou un élément de la liste|ページのリンクか、拡張機能の一覧からドラッグ
只能拖入 HTTP / HTTPS 网页链接。|Only HTTP / HTTPS links can be dropped.|Seuls les liens HTTP / HTTPS sont acceptés.|HTTP / HTTPS のリンクのみドロップできます。
拖入的标签页格式不正确。|Invalid tab format.|Format d’onglet invalide.|タブの形式が正しくありません。
没有识别到网页链接。请从网页中拖动链接，或使用“选择已打开网页”。|No link recognized. Drag a page link or choose open pages.|Aucun lien reconnu. Glissez un lien ou choisissez des pages ouvertes.|リンクを認識できません。ページのリンクをドラッグするか、開いているページを選択してください。
没有识别到可移动的记录。|No movable record found.|Aucune fiche déplaçable trouvée.|移動できる記録が見つかりません。
没有需要并入的网页。|No pages to merge.|Aucune page à fusionner.|まとめるページがありません。
无法识别拖入的网页，请从网页旁边的拖动柄重新拖动。|Cannot identify this page. Drag it again using its handle.|Page non reconnue. Glissez-la à nouveau avec sa poignée.|ページを認識できません。ページ横のハンドルからドラッグし直してください。
这条记录不能移动，请重新选择。|This record cannot be moved. Select another.|Cette fiche ne peut pas être déplacée. Choisissez-en une autre.|この記録は移動できません。選び直してください。
⠿ 整组|⠿ Whole group|⠿ Groupe entier|⠿ グループ全体
拖到另一个网页组；点击可选择目标组|Drag to another group; click to choose a destination|Glissez vers un autre groupe ; cliquez pour choisir|別グループへドラッグ。クリックで移動先を選択
拖到标签或项目，移动整个网页组|Drag to a tag or project to move the whole group|Glissez sur une étiquette ou un projet pour déplacer tout le groupe|タグやプロジェクトへドラッグしてグループ全体を移動
拖动整个网页组 {0}|Drag whole web group {0}|Glisser le groupe entier {0}|ウェブグループ {0} 全体をドラッグ
拖动网页或 ⠿ 移动单项；拖动标题、空白处或“整组”移动整条记录。|Drag a page or ⠿ for one item; drag the title, blank area or Whole group for the entire record.|Glissez une page ou ⠿ pour un élément ; le titre, l’espace vide ou Groupe entier pour tout déplacer.|ページや ⠿ で単体を移動。タイトル、余白、「グループ全体」で記録全体を移動します。
移动单个网页|Move one page|Déplacer une page|1 つのページを移動
移动单个网页 {0}|Move page {0}|Déplacer la page {0}|ページ {0} を移動
移动网页|Move page|Déplacer la page|ページを移動
目标网页组|Destination group|Groupe de destination|移動先のグループ
只移动这个网页，保留已读状态。目标组已有相同网址时合并。|Move only this page, keeping read status. Matching URLs in the target are merged.|Déplace uniquement cette page en gardant son état de lecture. Les URL identiques sont fusionnées.|既読状態を保持してこのページだけを移動します。移動先の同じ URL は統合します。
请先新建另一个网页组。|Create another web group first.|Créez d’abord un autre groupe.|先に別のウェブグループを作成してください。
恢复网页|Restore page|Restaurer la page|ページを復元
已读 {0}|Read {0}|Lu {0}|{0} を既読にする
已移动网页。|Page moved.|Page déplacée.|ページを移動しました。
已移动网页，已读状态保留。|Page moved; read status kept.|Page déplacée ; état de lecture conservé.|既読状態を保持してページを移動しました。
已并入 {0} 个网页，重复网址合并。来源组的文字、标签和项目关系仍保留。|Merged {0} pages, combining duplicate URLs. Source text, tags and project memberships are kept.|{0} pages fusionnées, URL identiques réunies. Texte, étiquettes et projets d’origine sont conservés.|{0} ページを統合し、重複 URL をまとめました。元グループの本文、タグ、プロジェクト所属は保持します。
已加入 {0} 个网页，保存成功后才关闭标签页。|Added {0} pages. Tabs close only after saving.|{0} pages ajoutées. Les onglets fermeront après l’enregistrement.|{0} ページを追加しました。保存成功後にタブを閉じます。
已加入网页组并关闭 {0} 个标签页。|Added to the group and closed {0} tabs.|Pages ajoutées au groupe, {0} onglets fermés.|グループに追加し、{0} 個のタブを閉じました。
已保存并关闭 {0} 个标签页{1}|Saved and closed {0} tabs{1}|Enregistré, {0} onglets fermés{1}|保存して {0} 個のタブを閉じました{1}
；导航变化或无法关闭的标签页已保留|; navigated or unclosable tabs were kept| ; onglets ayant changé de page ou impossibles à fermer conservés|。移動済みまたは閉じられないタブは保持しました
已保存到本机，等待同步。|Saved locally, pending sync.|Enregistré localement, à synchroniser.|ブラウザに保存しました。同期待ちです。
已整理，等待同步。|Organized, pending sync.|Classée, à synchroniser.|整理済みにしました。同期待ちです。
已标记为已整理。|Marked organized.|Marquée comme classée.|整理済みにしました。
已移回收件箱。|Moved to inbox.|Remise dans la boîte.|受信箱に戻しました。
已移入回收站，可还原。|Moved to trash; you can restore it.|Mise à la corbeille ; restauration possible.|ゴミ箱に移動しました。復元できます。
已还原到本机。|Restored locally.|Restaurée localement.|ブラウザに復元しました。
已还原到本机，等待同步。|Restored locally, pending sync.|Restaurée localement, à synchroniser.|ブラウザに復元しました。同期待ちです。
已加入项目，保留原有标签和整理状态。|Added to projects, keeping tags and organization status.|Ajoutée aux projets, étiquettes et statut conservés.|タグと整理状態を保持してプロジェクトに追加しました。
已移动到“{0}”并标记已整理。|Moved to “{0}” and marked organized.|Déplacée vers « {0} » et marquée comme classée.|「{0}」に移動して整理済みにしました。
已新建标签“{0}”，可拖入记录。|Tag “{0}” created. Drag it onto records.|Étiquette « {0} » créée. Glissez-la sur des fiches.|タグ「{0}」を作成しました。記録にドラッグできます。
当前正文已移除，等待同步。|Content removed, pending sync.|Contenu retiré, à synchroniser.|本文を削除しました。同期待ちです。
已移除当前正文|Content removed|Contenu retiré|本文を削除済み
记录 {0} 的正文已移除，等待同步删除状态。|Content of record {0} removed; deletion status pending sync.|Contenu de la fiche {0} retiré ; suppression à synchroniser.|記録 {0} の本文を削除しました。削除状態の同期待ちです。
将所选记录移入回收站？|Move selected records to trash?|Mettre les fiches sélectionnées à la corbeille ?|選択した記録をゴミ箱に移動しますか？
记录可以还原，下一次同步时才传播删除状态。|Records can be restored. Deletion is sent on the next sync.|Les fiches restent restaurables. La suppression sera transmise à la prochaine synchronisation.|記録は復元できます。削除状態は次の同期で反映します。
此操作不能从回收站还原。保留最小删除标记防止旧电脑复活；其他设备和已有备份仍可能保留内容。|This cannot be restored from trash. A deletion marker prevents older devices from restoring it. Other devices and backups may still contain copies.|Cette action est irréversible depuis la corbeille. Un marqueur empêche les anciens appareils de rétablir le contenu. D’autres copies peuvent subsister.|ゴミ箱から復元できなくなります。古い端末からの復活を防ぐ削除マーカーを保持します。他の端末やバックアップに内容が残る場合があります。
删除标记|Deletion marker|Marqueur de suppression|削除マーカー
操作失败，请重试。|Operation failed. Please try again.|Échec de l’opération. Réessayez.|操作に失敗しました。再試行してください。
无法打开本地数据库：|Cannot open local database:|Impossible d’ouvrir la base locale :|ローカルデータベースを開けません：
`),
  ),
);
Object.assign(
  messages,
  Object.fromEntries(
    decodeRows(String.raw`
Google Drive 同步|Google Drive sync|Synchronisation Google Drive|Google Drive 同期
Google Drive · 尚未登录|Google Drive · Signed out|Google Drive · Déconnecté|Google Drive · 未ログイン
Google Drive 操作未完成，浏览器数据仍保留。|Google Drive did not finish. Browser data is safe.|L’opération Google Drive n’a pas abouti. Les données locales sont conservées.|Google Drive の操作が完了しませんでした。ブラウザ内のデータは保持されています。
登录 Google Drive|Sign in to Google Drive|Se connecter à Google Drive|Google Drive にログイン
退出 Google 登录|Sign out of Google|Se déconnecter de Google|Google からログアウト
登录自己的 Google 账号，选择一个数据文件夹。同步下载只读取云端；同步上传只发送浏览器里的修改。记录、项目及关系、标签定义和 Dock 常用网站都会同步；图片与音频分别保存。|Sign in with your own Google account and choose a data folder. Download reads the cloud; upload sends your browser’s changes. Records, projects, relationships, tag definitions and Dock sites are synced. Images and audio are separate files.|Connectez votre compte Google et choisissez un dossier. Le téléchargement lit le cloud ; l’envoi transmet vos modifications locales. Fiches, projets, relations, étiquettes et sites du Dock sont synchronisés. Images et audios sont séparés.|自分の Google アカウントでログインしてフォルダを選びます。ダウンロードはクラウドから読み取り、アップロードはブラウザの変更を送信します。記録、プロジェクト、関連、タグ定義、Dock のサイトも同期し、画像と音声は別ファイルに保存します。
尚未登录。浏览器里的记录可以继续离线编辑和导出。|Signed out. You can still edit and export records offline.|Déconnecté. Vous pouvez toujours modifier et exporter hors ligne.|未ログインです。ブラウザの記録は引き続きオフラインで編集・書き出しできます。
第一次使用|First time here|Première utilisation|初めて使う
新建并使用文件夹|Create and use folder|Créer et utiliser un dossier|フォルダを作成して使う
新文件夹名称|New folder name|Nom du nouveau dossier|新しいフォルダ名
已有数据，连接新设备|Existing data, new device|Données existantes, nouvel appareil|既存のデータを新しい端末で使う
选择已有文件夹|Choose existing folder|Choisir un dossier existant|既存のフォルダを選択
已有数据文件夹|Existing data folder|Dossier de données existant|既存のデータフォルダ
使用所选文件夹|Use selected folder|Utiliser ce dossier|選択したフォルダを使う
选择此简化版在同一 Google 账号下创建的文件夹，然后点击同步下载。|Select a folder created by this edition under the same Google account, then download.|Choisissez un dossier créé par cette édition avec le même compte Google, puis téléchargez.|このバージョンで同じ Google アカウントに作成したフォルダを選び、同期ダウンロードしてください。
未找到此简化版的数据文件夹。若来自旧版，请先在旧版导出完整 ZIP，再在这里导入并上传。|No data folder found for this edition. For older editions, export a full ZIP first, then import and upload here.|Aucun dossier de cette édition trouvé. Depuis une ancienne version, exportez un ZIP complet, puis importez-le et envoyez-le ici.|データフォルダが見つかりません。旧バージョンからは完全 ZIP を書き出し、ここで読み込んでアップロードしてください。
当前数据文件夹|Current data folder|Dossier actuel|現在のデータフォルダ
当前文件夹：{0}|Current folder: {0}|Dossier actuel : {0}|現在のフォルダ：{0}
尚未选择文件夹|No folder selected|Aucun dossier sélectionné|フォルダ未選択
请选择或新建数据文件夹。|Choose or create a data folder.|Choisissez ou créez un dossier de données.|データフォルダを選択または作成してください。
打开 Google Drive 目录|Open Google Drive folder|Ouvrir le dossier Google Drive|Google Drive のフォルダを開く
打开 Google Drive 目录 ↗|Open Google Drive folder ↗|Ouvrir le dossier Google Drive ↗|Google Drive のフォルダを開く ↗
整理云端目录|Organize cloud folders|Organiser les dossiers cloud|クラウドのフォルダを整理
开始整理|Organize|Organiser|整理を開始
所有设备请先更新扩展，再上传新文件或整理目录。新版兼容旧平铺文件和新分类目录。|Update every device before uploading or organizing. This version reads both old flat files and new folders.|Mettez tous les appareils à jour avant tout envoi ou classement. Cette version lit l’ancien et le nouveau rangement.|アップロードや整理の前に全端末を更新してください。このバージョンは旧形式と新しい分類フォルダの両方に対応します。
将整理 {0} 个文件到 records、metadata、assets/images、assets/audio。文件 ID 与内容保留。|Move {0} files into records, metadata, assets/images and assets/audio. IDs and content stay unchanged.|Déplacer {0} fichiers vers records, metadata, assets/images et assets/audio, en conservant identifiants et contenus.|{0} ファイルを records、metadata、assets/images、assets/audio に整理します。ID と内容は保持します。
云端目录已经整理完成。|Cloud folders are already organized.|Les dossiers cloud sont déjà organisés.|クラウドのフォルダは整理済みです。
已整理 {0} 个文件。其他设备请更新扩展后同步下载。|Organized {0} files. Update other devices before downloading.|{0} fichiers classés. Mettez les autres appareils à jour avant de télécharger.|{0} ファイルを整理しました。他の端末は更新後に同期ダウンロードしてください。
正在整理云端目录…|Organizing cloud folders…|Organisation des dossiers cloud…|クラウドのフォルダを整理中…
正在新建文件夹…|Creating folder…|Création du dossier…|フォルダを作成中…
正在打开 Google 登录…|Opening Google sign-in…|Ouverture de la connexion Google…|Google ログインを開いています…
已登录：{0}。{1}|Signed in: {0}. {1}|Connecté : {0}. {1}|ログイン中：{0}。{1}
上传|Upload|Envoi|アップロード
下载|Download|Téléchargement|ダウンロード
同步中…|Syncing…|Synchronisation…|同期中…
正在同步上传…|Uploading changes…|Envoi des modifications…|変更をアップロード中…
正在同步下载…|Downloading changes…|Téléchargement des modifications…|変更をダウンロード中…
正在上传到 Google Drive…|Uploading to Google Drive…|Envoi vers Google Drive…|Google Drive にアップロード中…
正在从 Google Drive 下载…|Downloading from Google Drive…|Téléchargement depuis Google Drive…|Google Drive からダウンロード中…
同步未完成：{0}|Sync incomplete: {0}|Synchronisation incomplète : {0}|同期が完了しませんでした：{0}
上传 {0} 条记录{1}，{2} 条冲突。{3}|Uploaded {0} records{1}; {2} conflicts. {3}|{0} fiches envoyées{1} ; {2} conflits. {3}|{0} 件をアップロード{1}。競合 {2} 件。{3}
下载 {0} 条记录{1}，{2} 条冲突。{3}|Downloaded {0} records{1}; {2} conflicts. {3}|{0} fiches téléchargées{1} ; {2} conflits. {3}|{0} 件をダウンロード{1}。競合 {2} 件。{3}
{0}完成：{1} 条记录{2}，{3} 条冲突。{4}{5}|{0} complete: {1} records{2}; {3} conflicts. {4}{5}|{0} terminé : {1} fiches{2} ; {3} conflits. {4}{5}|{0}完了：記録 {1} 件{2}、競合 {3} 件。{4}{5}
，已同步标签定义|, including tag definitions|, avec les définitions des étiquettes|、タグ定義も同期済み
，已同步常用网站|, including Dock sites|, avec les sites du Dock|、Dock のサイトも同期済み
复用 {0} 个未变化文件的缓存。|Reused {0} unchanged files from cache.|{0} fichiers inchangés réutilisés du cache.|変更のない {0} ファイルをキャッシュから再利用しました。
云端有文件被移除，浏览器版本仍保留；请检查所选文件夹。|Some cloud files were removed. Browser copies are kept. Check the selected folder.|Des fichiers cloud ont été retirés. Les copies locales sont conservées. Vérifiez le dossier.|クラウドの一部ファイルが削除されています。ブラウザのコピーは保持されています。フォルダを確認してください。
 · {0} 条冲突| · {0} conflicts| · {0} conflits| · 競合 {0} 件
 · 上次{0} {1}| · Last {0} {1}| · Dernier {0} {1}| · 前回の{0} {1}
 · 标签待上传| · Tags pending upload| · Étiquettes à envoyer| · タグのアップロード待ち
 · 常用网站待上传| · Dock sites pending upload| · Sites du Dock à envoyer| · Dock サイトのアップロード待ち
 · 标签定义 {0} 个| · {0} tag definitions| · {0} définitions d’étiquettes| · タグ定義 {0} 件
{0} 条同步冲突|{0} sync conflicts|{0} conflits de synchronisation|同期の競合 {0} 件
已保存到浏览器 · {0} 条待上传{1}{2}{3}|Saved in browser · {0} pending upload{1}{2}{3}|Enregistré dans le navigateur · {0} à envoyer{1}{2}{3}|ブラウザに保存済み · アップロード待ち {0} 件{1}{2}{3}
已保存到浏览器 · 登录 Google Drive 后可同步|Saved in browser · Sign in to Google Drive to sync|Enregistré dans le navigateur · Connectez Google Drive pour synchroniser|ブラウザに保存済み · Google Drive にログインすると同期できます
已登录 Google Drive · 请选择数据文件夹|Signed in to Google Drive · Choose a data folder|Connecté à Google Drive · Choisissez un dossier|Google Drive にログイン済み · データフォルダを選択してください
浏览器离线保存；手动下载或上传，随时导出 ZIP 备份。|Saved offline in your browser. Download or upload manually; export ZIP backups anytime.|Enregistrement hors ligne. Téléchargez ou envoyez manuellement ; exportez un ZIP à tout moment.|ブラウザにオフライン保存します。手動で同期し、いつでも ZIP を書き出せます。
处理冲突|Resolve conflicts|Résoudre les conflits|競合を解決
选择要保留的记录版本|Choose a record version|Choisir une version de la fiche|保持する記録のバージョンを選択
浏览器版本|Browser version|Version locale|ブラウザのバージョン
云端版本|Cloud version|Version cloud|クラウドのバージョン
保留浏览器版本|Keep browser version|Conserver la version locale|ブラウザのバージョンを保持
使用此云端版本|Use this cloud version|Utiliser cette version cloud|このクラウドのバージョンを使う
浏览器和云端版本都已保留。选择版本后同步下载以应用选择，需保留浏览器版本时再同步上传。|Both versions are kept. Choose one, then download to apply it. If you keep the browser version, upload afterward.|Les deux versions sont conservées. Choisissez puis téléchargez pour appliquer. Si vous gardez la version locale, envoyez-la ensuite.|両方のバージョンを保持しています。選択後にダウンロードして反映します。ブラウザ側を保持する場合は、その後アップロードしてください。
已保留浏览器版本，请点击同步上传更新云端。|Browser version kept. Upload to update the cloud.|Version locale conservée. Envoyez-la pour mettre le cloud à jour.|ブラウザ側を保持しました。同期アップロードでクラウドを更新してください。
管理云端同步、本地备份与界面偏好。|Manage cloud sync, backups and interface preferences.|Gérez la synchronisation, les sauvegardes et l’interface.|クラウド同期、バックアップ、表示設定を管理します。
完整本地备份|Full local backup|Sauvegarde locale complète|完全ローカルバックアップ
完整 ZIP|Full ZIP|ZIP complet|完全 ZIP
完整 ZIP 包含 JSON、Markdown、图片、音频、项目层级与关系图、回收站与草稿。JSON 单独导出仅包含数据和附件清单，不包含二进制附件。导出不包含 Google 授权凭证。|A full ZIP includes JSON, Markdown, images, audio, project hierarchy, graphs, trash and drafts. JSON alone lists attachments without their files. Google credentials are excluded.|Le ZIP complet contient JSON, Markdown, images, audios, projets, graphes, corbeille et brouillons. Le JSON seul exclut les fichiers joints. Les identifiants Google sont exclus.|完全 ZIP には JSON、Markdown、画像、音声、プロジェクト階層、関連図、ゴミ箱、下書きが含まれます。JSON 単体に添付の実体は含まれません。Google の認証情報は書き出しません。
导出备份（完整 ZIP）|Export backup (full ZIP)|Exporter la sauvegarde (ZIP complet)|バックアップを書き出す（完全 ZIP）
导出 JSON|Export JSON|Exporter en JSON|JSON を書き出す
导出 Markdown（含图片 ZIP）|Export Markdown (ZIP with images)|Exporter Markdown (ZIP avec images)|Markdown を書き出す（画像入り ZIP）
导入 JSON / ZIP|Import JSON / ZIP|Importer JSON / ZIP|JSON / ZIP を読み込む
选择 JSON 或 ZIP 备份|Choose a JSON or ZIP backup|Choisir une sauvegarde JSON ou ZIP|JSON または ZIP バックアップを選択
正在导出，请等待当前导出完成。|An export is in progress. Please wait.|Un export est en cours. Veuillez patienter.|書き出し中です。完了までお待ちください。
选择导出整理方式|Choose export layout|Choisir le classement de l’export|書き出しの分類方法を選択
文件夹整理方式|Folder layout|Classement des dossiers|フォルダの分類方法
导出目录示例|Export folder example|Exemple de dossiers exportés|書き出し先の構成例
开始导出|Export|Exporter|書き出しを開始
{0}：Markdown 使用项目或记录原名，重名自动区分。|{0}: Markdown uses original project and record names; duplicates get unique names.|{0} : Markdown reprend les noms d’origine ; les doublons sont distingués.|{0}：Markdown は元のプロジェクト名と記録名を使い、同名は区別します。
一条记录属于多个项目或标签时，各目录提供一份阅读副本；附件只保存一份。完整 ZIP 的恢复数据仍按唯一 ID 保存，导入不会重复。|Multiple projects or tags get reading copies in each folder. Attachments and restore data stay unique; importing creates no duplicates.|Chaque classement reçoit une copie de lecture. Pièces jointes et données de restauration restent uniques ; l’import ne crée pas de doublons.|複数所属の記録は各フォルダに閲覧用コピーを作成します。添付と復元用データは一意に保存され、読み込みで重複しません。
notes/项目/项目名称/记录名称.md\nnotes/未归入项目/记录名称.md|notes/Projects/Project name/Record name.md\nnotes/No project/Record name.md|notes/Projets/Nom du projet/Nom de fiche.md\nnotes/Sans projet/Nom de fiche.md|notes/プロジェクト/プロジェクト名/記録名.md\nnotes/未所属/記録名.md
notes/标签/标签名称/记录名称.md\nnotes/未打标签/记录名称.md|notes/Tags/Tag name/Record name.md\nnotes/Untagged/Record name.md|notes/Étiquettes/Nom d’étiquette/Nom de fiche.md\nnotes/Sans étiquette/Nom de fiche.md|notes/タグ/タグ名/記録名.md\nnotes/タグなし/記録名.md
notes/记录名称.md|notes/Record name.md|notes/Nom de fiche.md|notes/記録名.md
已生成完整本地 ZIP：包含记录、图片、音频和 Markdown。|Full ZIP created, including records, images, audio and Markdown.|ZIP complet créé avec fiches, images, audios et Markdown.|記録、画像、音声、Markdown を含む完全 ZIP を作成しました。
Markdown 与附件已打包，解压后打开 notes 中的 .md 文件。|Markdown and attachments are packed. Extract and open .md files in notes.|Markdown et pièces jointes sont archivés. Décompressez et ouvrez les .md dans notes.|Markdown と添付を書き出しました。展開して notes 内の .md を開いてください。
导入预览|Import preview|Aperçu de l’import|読み込みのプレビュー
导入到本机|Import locally|Importer localement|ブラウザに読み込む
导入只保存到浏览器，不自动上传。相同记录沿用原 ID，Google 登录和文件夹选择不会被备份覆盖。|Import saves to this browser without uploading. Records keep their IDs; Google sign-in and folder selection are unchanged.|L’import reste local sans envoi automatique. Les identifiants sont conservés ; la connexion Google et le dossier ne changent pas.|読み込みはブラウザにのみ保存し、自動アップロードしません。記録の ID、Google ログイン、フォルダ設定を保持します。
更新相同 ID 但内容不同的记录（包含恢复或删除状态变化）|Update matching IDs with different content (including restore or deletion changes)|Mettre à jour les mêmes identifiants aux contenus différents (restauration ou suppression incluse)|同じ ID で内容の異なる記録を更新（復元・削除状態を含む）
新增 {0} 条 · 相同 {1} 条 · 内容不同 {2} 条 · 待处理收集 {3} 条 · 草稿 {4} 条{5}。默认保留本机已有差异，重复导入不会复制整个数据库。|New {0} · Identical {1} · Changed {2} · Captures {3} · Drafts {4}{5}. Local differences are kept by default. Reimporting creates no duplicate library.|Nouvelles {0} · Identiques {1} · Différentes {2} · Captures {3} · Brouillons {4}{5}. Les différences locales sont conservées par défaut ; réimporter ne duplique pas la bibliothèque.|新規 {0} 件 · 同一 {1} 件 · 変更 {2} 件 · 未処理 {3} 件 · 下書き {4} 件{5}。既定でブラウザ側の差分を保持し、再読み込みでライブラリを複製しません。
标签描述与颜色一起导入。默认保留本机同名标签；勾选更新后，使用备份里的同名标签定义。|Tag descriptions and colors are imported together. Existing tags are kept unless you enable updates.|Descriptions et couleurs sont importées ensemble. Les étiquettes locales sont conservées sauf si vous activez la mise à jour.|タグの説明と色も読み込みます。既定では同名のローカルタグを保持し、更新を選ぶとバックアップ側を使用します。
备份超过 512 MB，请拆分后导入。|Backup exceeds 512 MB. Split it before importing.|La sauvegarde dépasse 512 Mo. Fractionnez-la avant l’import.|バックアップが 512 MB を超えています。分割して読み込んでください。
已导入 {0} 项变化。需要上传到云端时，请点击同步上传。|Imported {0} changes. Click upload when ready to send them to the cloud.|{0} modifications importées. Cliquez sur Envoyer pour les transmettre au cloud.|{0} 件の変更を読み込みました。クラウドに送るには同期アップロードしてください。
正在读取本地存储信息…|Reading local storage…|Lecture du stockage local…|ローカルストレージを確認中…
本地存储约 {0} MB（浏览器估算，包含索引）。卸载扩展前请导出备份。|Local storage: about {0} MB (browser estimate, including indexes). Export a backup before uninstalling.|Stockage local : environ {0} Mo (estimation avec index). Exportez une sauvegarde avant de désinstaller.|使用容量は約 {0} MB（インデックスを含むブラウザの推定値）です。拡張機能の削除前にバックアップを書き出してください。
本机未保存草稿|Local unsaved drafts|Brouillons locaux non enregistrés|ブラウザ内の未保存の下書き
旧版本编辑草稿不会覆盖最新记录。可继续编辑，或下载原始草稿；JSON 备份也会保留这些内容。|Older drafts do not overwrite current records. Continue editing or download the original draft. JSON backups include them.|Les anciens brouillons n’écrasent pas les fiches actuelles. Reprenez ou téléchargez-les ; les sauvegardes JSON les conservent.|古い下書きが最新の記録を上書きすることはありません。編集を続けるか元の下書きを保存できます。JSON バックアップにも含まれます。
目前没有未保存草稿。|No unsaved drafts.|Aucun brouillon non enregistré.|未保存の下書きはありません。
继续编辑清单|Continue editing list|Reprendre la liste|リストの編集を続ける
恢复为新记录|Restore as new record|Restaurer comme nouvelle fiche|新しい記録として復元
`),
  ),
);
Object.assign(
  messages,
  Object.fromEntries(
    decodeRows(String.raw`
保存修改|Save changes|Enregistrer les modifications|変更を保存
保存到我的收件箱|Save to my inbox|Enregistrer dans ma boîte|自分の受信箱に保存
保存到收件箱|Save to inbox|Enregistrer dans la boîte|受信箱に保存
保存到本机|Save locally|Enregistrer localement|ブラウザに保存
保存后关闭加入的标签页|Close added tabs after saving|Fermer les onglets ajoutés après l’enregistrement|保存後に追加したタブを閉じる
保存后才进入收件箱|Save to add to inbox|Enregistrez pour ajouter à la boîte|保存すると受信箱に追加されます
保存外观|Save appearance|Enregistrer l’apparence|外観を保存
保存归属|Save membership|Enregistrer les appartenances|所属を保存
保存清单|Save list|Enregistrer la liste|リストを保存
保存项目|Save project|Enregistrer le projet|プロジェクトを保存
保存主题|Save theme|Enregistrer le thème|テーマを保存
修改保留原 ID|Edits keep the original ID|Les modifications conservent l’identifiant|編集後も元の ID を保持
修改记录|Edit record|Modifier la fiche|記録を編集
取消编辑|Cancel editing|Annuler la modification|編集をキャンセル
取消选择|Clear selection|Annuler la sélection|選択を解除
取消置顶|Unpin|Désépingler|固定を解除
置顶|Pin|Épingler|固定
已置顶|Pinned|Épinglé|固定済み
固定置顶|Always first|Toujours en premier|先頭に固定
置顶记录|Pinned records|Notes épinglées|固定した記録
移入回收站|Move to trash|Mettre à la corbeille|ゴミ箱に移動
还原|Restore|Restaurer|復元
批量还原|Restore selected|Restaurer la sélection|選択した記録を復元
恢复|Restore|Restaurer|復元
移回收件箱|Move to inbox|Remettre dans la boîte|受信箱に戻す
标记已整理|Mark organized|Marquer comme classée|整理済みにする
加入项目|Add to projects|Ajouter aux projets|プロジェクトに追加
加入项目…|Add to projects…|Ajouter aux projets…|プロジェクトに追加…
管理项目…|Manage projects…|Gérer les projets…|プロジェクトを管理…
管理项目归属|Manage project membership|Gérer les appartenances|プロジェクトへの所属を管理
移除正文|Remove content|Retirer le contenu|本文を削除
移除当前正文？|Remove the current content?|Retirer le contenu actuel ?|現在の本文を削除しますか？
移除附件|Remove attachment|Retirer la pièce jointe|添付ファイルを削除
修改记录|Edit record|Modifier la fiche|記録を編集
编辑原记录|Edit original record|Modifier la fiche d’origine|元の記録を編集
编辑捕获记录|Edit captured record|Modifier la capture|収集した記録を編集
编辑记录|Edit record|Modifier la fiche|記録を編集
完整修改|Full editor|Éditeur complet|詳細編集
简单修改 · Markdown|Quick edit · Markdown|Modification rapide · Markdown|簡単編集 · Markdown
内容 · Markdown|Content · Markdown|Contenu · Markdown|本文 · Markdown
Markdown 源码|Markdown source|Source Markdown|Markdown ソース
预览|Preview|Aperçu|プレビュー
预览 {0}|Preview {0}|Aperçu de {0}|{0} をプレビュー
人工总结|Summary|Résumé|要約
人工总结（可选）|Summary (optional)|Résumé (facultatif)|要約（任意）
添加人工总结…|Add a summary…|Ajouter un résumé…|要約を追加…
标题（可选）|Title (optional)|Titre (facultatif)|タイトル（任意）
来源链接（可选）|Source link (optional)|Lien source (facultatif)|出典リンク（任意）
（没有正文）|(No content)|(Aucun contenu)|（本文なし）
尚未补充正文|No content yet|Aucun contenu pour le moment|本文はまだありません
仅链接|Link only|Lien uniquement|リンクのみ
只有链接|Link only|Lien uniquement|リンクのみ
空项目|Empty item|Élément vide|空の項目
原 ID {0}|Original ID {0}|Identifiant d’origine {0}|元の ID {0}
{0}{1} 条记录|{0}{1} records|{0}{1} fiches|{0}{1} 件の記録
{0} 张图片 · {1} 段录音|{0} images · {1} audio clips|{0} images · {1} audios|画像 {0} 件 · 音声 {1} 件
{0} 图片 · {1} 音频|{0} images · {1} audio|{0} images · {1} audios|画像 {0} 件 · 音声 {1} 件
{0} 个网页 · {1} 个未读|{0} pages · {1} unread|{0} pages · {1} non lues|{0} ページ · 未読 {1} 件
{0}网页 {1}|{0}Page {1}|{0}Page {1}|{0}ページ {1}
{0} 条收集等待处理|{0} captures pending|{0} captures en attente|未処理の収集 {0} 件
已选 {0} 条|{0} selected|{0} sélectionnées|{0} 件を選択中
选择 {0}|Select {0}|Sélectionner {0}|{0} を選択
打开 {0}|Open {0}|Ouvrir {0}|{0} を開く
打开查看内容|Open content|Ouvrir le contenu|内容を開く
这里还没有记录|No records here yet|Aucune fiche ici|記録はまだありません
没有匹配的记录|No matching records|Aucune fiche correspondante|一致する記録はありません
试试其他筛选条件，或新建一条记录。|Try another filter or create a record.|Essayez un autre filtre ou créez une fiche.|別の条件を試すか、新しい記録を作成してください。
所有新收集都先留在这里。先保存，稍后整理。|New captures arrive here. Save now, organize later.|Vos captures arrivent ici. Enregistrez maintenant, classez plus tard.|新しく集めたものはここへ。まず保存し、整理は後で。
你的文字、链接与想法，保存在自己的数据库中。|Your notes, links and ideas in your own library.|Vos notes, liens et idées dans votre bibliothèque.|文章、リンク、アイデアを自分のライブラリに。
已经分类，随时可以再次使用。|Organized and ready to use again.|Classées, prêtes à être réutilisées.|分類済みで、いつでも活用できます。
收藏的记录，随时回来浏览。|Your favorites, ready to revisit.|Vos favoris, à retrouver quand vous voulez.|お気に入りの記録を、いつでも見返せます。
检查正文相同的记录和重复保存的网页链接。|Find identical content and duplicate saved links.|Repérez les contenus identiques et les liens enregistrés en double.|同じ本文の記録や、重複したリンクを確認します。
这些修改只保存在本机，点击同步后才会上传。|These edits are local until you sync.|Ces modifications restent locales jusqu’à la synchronisation.|変更はブラウザ内に保存され、同期時にアップロードされます。
删除与还原也由你决定同步时机。回收站不会自动清空。|Choose when to sync deletions and restores. Trash is never emptied automatically.|Choisissez quand synchroniser suppressions et restaurations. La corbeille n’est pas vidée automatiquement.|削除や復元の同期も自分のタイミングで。ゴミ箱は自動で空になりません。
标签名称|Tag name|Nom de l’étiquette|タグ名
标签描述|Tag description|Description de l’étiquette|タグの説明
标签颜色|Tag color|Couleur de l’étiquette|タグの色
标签外观|Tag appearance|Apparence de l’étiquette|タグの外観
添加标签|Add tags|Ajouter des étiquettes|タグを追加
批量添加标签|Add tags to selected|Étiqueter la sélection|選択した記録にタグを追加
新标签名称|New tag name|Nom de la nouvelle étiquette|新しいタグ名
＋ 新建标签…|＋ New tag…|＋ Nouvelle étiquette…|＋ 新しいタグ…
点击 ＋ 新建标签|Click ＋ to create a tag|Cliquez sur ＋ pour créer une étiquette|＋ を押してタグを作成
选择标签|Choose tags|Choisir des étiquettes|タグを選択
例如：工作、学习、待读|e.g. work, study, reading|Ex. travail, études, à lire|例：仕事、勉強、あとで読む
用逗号分隔|Separate with commas|Séparez par des virgules|カンマで区切る
用逗号分隔，如：学习, 待阅读|Comma-separated, e.g. study, to read|Séparez par des virgules, ex. études, à lire|カンマで区切る。例：勉強, あとで読む
这个标签用于哪些内容？|What is this tag for?|À quoi sert cette étiquette ?|どのような内容に使うタグですか？
标签 · {0}|Tag · {0}|Étiquette · {0}|タグ · {0}
保留每条记录已有的标签。|Keep existing tags on each record.|Conserver les étiquettes existantes.|各記録の既存のタグを保持します。
把标签拖到记录上即可追加分类，保留已有标签。|Drag a tag onto a record to add it, keeping existing tags.|Glissez une étiquette sur une fiche pour l’ajouter sans retirer les autres.|タグを記録にドラッグして追加できます。既存のタグは保持されます。
已有标签也会自动显示在标签列表中。|Existing tags appear automatically in the tag list.|Les étiquettes existantes apparaissent automatiquement dans la liste.|既存のタグもタグ一覧に自動で表示されます。
添加标签并标记已整理，保留已有标签。标签之间没有父子层级。|Add tags and mark organized, keeping existing tags. Tags have no hierarchy.|Ajoutez des étiquettes et marquez comme classée, sans retirer les autres. Les étiquettes n’ont pas de hiérarchie.|既存のタグを保持して追加し、整理済みにします。タグに階層はありません。
请填写标签。|Enter a tag.|Saisissez une étiquette.|タグを入力してください。
请先新建标签。|Create a tag first.|Créez d’abord une étiquette.|先にタグを作成してください。
请填写 1–100 字的标签名称，不含逗号或换行。|Enter a tag name of 1–100 characters, without commas or line breaks.|Saisissez 1 à 100 caractères, sans virgule ni saut de ligne.|タグ名は 1〜100 文字で、カンマや改行を含めずに入力してください。
添加到 {0} 条记录|Add to {0} records|Ajouter à {0} fiches|{0} 件の記録に追加
移动|Move|Déplacer|移動
移动到…|Move to…|Déplacer vers…|移動先…
移动记录|Move records|Déplacer des fiches|記録を移動
移动目标|Destination|Destination|移動先
移动 {0} 条记录到|Move {0} records to|Déplacer {0} fiches vers|{0} 件の記録を移動
新建子项目|New subproject|Nouveau sous-projet|新しいサブプロジェクト
编辑项目|Edit project|Modifier le projet|プロジェクトを編集
编辑子项目|Edit subproject|Modifier le sous-projet|サブプロジェクトを編集
项目名称|Project name|Nom du projet|プロジェクト名
项目描述|Project description|Description du projet|プロジェクトの説明
项目颜色|Project color|Couleur du projet|プロジェクトの色
项目图标|Project icon|Icône du projet|プロジェクトのアイコン
项目文件夹|Project folder|Dossier de projet|プロジェクトフォルダ
父项目|Parent project|Projet parent|親プロジェクト
顶层项目|Top-level project|Projet racine|最上位のプロジェクト
例如：论文研究|e.g. thesis research|Ex. recherche de thèse|例：論文の研究
这个项目要完成什么？这些资料有什么用途？|What is the goal? How will these materials help?|Quel est l’objectif ? À quoi serviront ces ressources ?|何を達成するプロジェクトですか？資料の用途は何ですか？
为这个项目添加描述，说明目标与资料范围。|Describe the project’s goals and scope.|Décrivez les objectifs et le périmètre du projet.|目的と資料の範囲を説明しましょう。
为项目填写描述，说明目标和资料范围。|Describe the project’s goals and scope.|Décrivez les objectifs et le périmètre du projet.|目的と資料の範囲を説明しましょう。
请填写项目名称。|Enter a project name.|Saisissez un nom de projet.|プロジェクト名を入力してください。
请至少选择一个项目。|Select at least one project.|Sélectionnez au moins un projet.|プロジェクトを少なくとも 1 つ選択してください。
请选择至少一个项目。|Select at least one project.|Sélectionnez au moins un projet.|プロジェクトを少なくとも 1 つ選択してください。
还没有项目，请先新建。|Create a project first.|Créez d’abord un projet.|先にプロジェクトを作成してください。
可加入多个项目，保留已有项目关联、标签与整理状态。加入子项目不会自动加入父项目。|Add to multiple projects without changing existing memberships, tags or status. Subprojects do not imply parent membership.|Ajoutez à plusieurs projets sans modifier les appartenances, étiquettes ou statut existants. Un sous-projet n’ajoute pas au parent.|既存の所属、タグ、整理状態を保持して複数のプロジェクトに追加できます。子への追加で親に所属することはありません。
可选择多个项目。取消某项目会同时删除该记录在该项目内的连线。|Select multiple projects. Removing membership also removes this record’s edges in that project.|Sélectionnez plusieurs projets. Retirer une appartenance supprime aussi les liens de cette fiche dans le projet.|複数選択できます。所属を解除すると、そのプロジェクト内の関連線も削除されます。
项目内记录关系图|Project relationship graph|Graphe des relations du projet|プロジェクト内の関連図
项目关系图 · |Project graph · |Graphe du projet · |プロジェクトの関連図 ·
项目记录 · {0}|Project records · {0}|Fiches du projet · {0}|プロジェクトの記録 · {0}
项目可包含子项目；每条记录可属于多个项目。关系图只连接当前层的记录与子项目节点。|Projects may contain subprojects; records may belong to several projects. The graph links only records and subprojects at this level.|Les projets peuvent contenir des sous-projets ; une fiche peut appartenir à plusieurs projets. Le graphe relie les nœuds du niveau actuel.|プロジェクトは子を含むことができ、記録は複数のプロジェクトに所属できます。関連図は現在の階層の記録と子プロジェクトを結びます。
关系图|Graph|Graphe|関連図
关系起点|Connection source|Départ du lien|関連の始点
关系终点|Connection target|Arrivée du lien|関連の終点
关系说明|Connection label|Libellé du lien|関連の説明
关系说明与列表|Connection labels & list|Libellés et liste des liens|関連の説明と一覧
保存关系|Save connection|Enregistrer le lien|関連を保存
添加关系|Add connection|Ajouter un lien|関連を追加
编辑关系|Edit connection|Modifier le lien|関連を編集
编辑关系 {0}|Edit connection {0}|Modifier le lien {0}|関連 {0} を編集
删除关系|Delete connection|Supprimer le lien|関連を削除
例如：参考、补充、相关|e.g. reference, supplement, related|Ex. référence, complément, associé|例：参考、補足、関連
相关|Related|Associé|関連
节点 A|Node A|Nœud A|ノード A
节点 B|Node B|Nœud B|ノード B
选择节点|Select node|Sélectionner un nœud|ノードを選択
连线|Connect|Relier|接続
结束连线|Finish connecting|Terminer les liens|接続を終了
依次选择两个节点|Select two nodes in order|Sélectionnez deux nœuds dans l’ordre|順番に 2 つのノードを選択
请选择两个节点。|Select two nodes.|Sélectionnez deux nœuds.|2 つのノードを選択してください。
请选择终点|Choose a target|Choisissez une arrivée|終点を選択してください
拖动此处连线|Drag to connect|Glisser pour relier|ドラッグして接続
点击记录预览；拖动节点整理布局；点击“连线”后依次选择两个节点，或从连接点拖到另一个节点。|Click a record to preview. Drag nodes to arrange. Connect by selecting two nodes or dragging between connection points.|Cliquez pour prévisualiser, glissez les nœuds pour les placer. Reliez deux nœuds par sélection ou glissement entre leurs points de connexion.|クリックで記録を表示、ドラッグで配置します。「接続」で 2 つのノードを選ぶか、接続点をドラッグしてください。
在这里，把零散的知识连起来。|Connect your scattered knowledge here.|Reliez ici vos connaissances éparses.|ばらばらの知識を、ここでつなげよう。
布局已保存|Layout saved|Disposition enregistrée|配置を保存しました
总结已保存|Summary saved|Résumé enregistré|要約を保存しました
描述已保存|Description saved|Description enregistrée|説明を保存しました
子项目描述|Subproject description|Description du sous-projet|サブプロジェクトの説明
添加子项目描述…|Add a subproject description…|Ajouter une description…|サブプロジェクトの説明を追加…
← 返回父项目|← Parent project|← Projet parent|← 親プロジェクトに戻る
进入子项目|Open subproject|Ouvrir le sous-projet|サブプロジェクトを開く
全屏|Full screen|Plein écran|全画面
退出全屏|Exit full screen|Quitter le plein écran|全画面を終了
放大|Zoom in|Agrandir|拡大
缩小|Zoom out|Réduire|縮小
重新排列|Rearrange|Réorganiser|再配置
项目不存在。|Project not found.|Projet introuvable.|プロジェクトが見つかりません。
项目已不存在。|This project no longer exists.|Ce projet n’existe plus.|このプロジェクトは既にありません。
记录不存在。|Record not found.|Fiche introuvable.|記録が見つかりません。
记录已不存在。|This record no longer exists.|Cette fiche n’existe plus.|この記録は既にありません。
目标已不存在。|The target no longer exists.|La cible n’existe plus.|移動先は既にありません。
项目已保存。|Project saved.|Projet enregistré.|プロジェクトを保存しました。
`),
  ),
);
