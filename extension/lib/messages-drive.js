export const driveMessages = String.raw`
打开 GUGA Knowledge|Open GUGA Knowledge|Ouvrir GUGA Knowledge|GUGA Knowledge を開く
收集选中文字到 {0}|Save selected text to {0}|Enregistrer la sélection dans {0}|選択した文字を {0} に保存
收集当前网页到 {0}|Save this page to {0}|Enregistrer cette page dans {0}|このページを {0} に保存
收集链接到 {0}|Save link to {0}|Enregistrer le lien dans {0}|リンクを {0} に保存
收集图片到 {0}|Save image to {0}|Enregistrer l’image dans {0}|画像を {0} に保存
需要授权后才能捕获，请点击编辑器中的授权按钮。|Permission required. Use the permission button in the editor.|Autorisation requise. Utilisez le bouton de l’éditeur.|収集には権限が必要です。エディターの許可ボタンを押してください。
浏览器尚未授权访问当前网页，请用网页右键或 Alt + Shift + S 收集，也可以手动粘贴链接。|No page access yet. Use right-click, Alt + Shift + S, or paste a link.|Accès non autorisé. Utilisez le clic droit, Alt + Shift + S ou collez un lien.|ページへの権限がありません。右クリック、Alt + Shift + S、またはリンクの貼り付けで収集してください。
这个页面不允许读取，请打开侧边栏手动粘贴内容。|This page cannot be read. Paste content in the sidebar.|Cette page ne peut pas être lue. Collez le contenu dans le panneau latéral.|このページは読み取れません。サイドバーに内容を貼り付けてください。
请先切回要截图的网页。|Switch back to the page to capture.|Revenez à la page à capturer.|撮影したいページに切り替えてください。
截图时网页发生切换或导航，请重新截图。|The page changed during capture. Please retry.|La page a changé pendant la capture. Réessayez.|撮影中にページが変わりました。再試行してください。
网页已切换，请回到目标网页后重新点击捕获。|The active page changed. Return to the target page.|La page active a changé. Revenez à la page souhaitée.|ページが切り替わりました。対象ページに戻ってください。
收集图片.png|Captured-image.png|Image-capturée.png|収集した画像.png
收集图片|Captured image|Image capturée|収集した画像
只能收集 HTTP / HTTPS 图片或链接。|Only HTTP / HTTPS images and links are supported.|Seuls les images et liens HTTP / HTTPS sont acceptés.|HTTP / HTTPS の画像とリンクのみ収集できます。
未能取得图片原文件，目前只保留图片链接。需要离线保存或同步图片时，请复制图片后粘贴到正文，或用“添加图片”上传原文件。|Only the image link was saved. For offline use and sync, paste a copy into the content or use Add image.|Seul le lien de l’image est conservé. Pour le hors ligne et la synchronisation, collez l’image ou utilisez Ajouter une image.|画像のリンクのみ保存しました。オフライン利用や同期には画像を貼り付けるか、「画像を追加」で元のファイルを保存してください。
云端文件超出允许大小。|Cloud file exceeds the size limit.|Le fichier cloud dépasse la taille autorisée.|クラウドのファイルがサイズ制限を超えています。
此记录刚被另一设备修改，请先同步下载。|Another device changed this record. Download first.|Cette fiche a été modifiée ailleurs. Téléchargez d’abord.|別の端末で記録が更新されました。先に同期ダウンロードしてください。
Google 登录已失效，请重新登录。|Google sign-in expired. Sign in again.|Connexion Google expirée. Reconnectez-vous.|Google のログインが失効しました。再ログインしてください。
Google Drive 文件或文件夹已不存在。|Google Drive file or folder no longer exists.|Le fichier ou dossier Google Drive n’existe plus.|Google Drive のファイルまたはフォルダがありません。
Google Drive API 尚未启用。请在 OAuth 客户端所属的 Google Cloud 项目{0}中启用 Google Drive API，等待几分钟后重试。|Google Drive API is disabled. Enable it in the OAuth client’s Google Cloud project {0}, wait a few minutes and retry.|L’API Google Drive est désactivée. Activez-la dans le projet Google Cloud du client OAuth {0}, attendez quelques minutes puis réessayez.|Google Drive API が無効です。OAuth クライアントの Google Cloud プロジェクト {0} で有効にし、数分後に再試行してください。
Google 授权缺少 Drive 文件访问权限。请重新登录并允许访问此应用的 Google Drive 文件。|Drive file permission is missing. Sign in again and allow this app’s files.|Autorisation Drive manquante. Reconnectez-vous et autorisez les fichiers de l’application.|Drive のファイル権限がありません。再ログインしてアクセスを許可してください。
当前账号无权访问此文件。请确认登录账号，并使用此简化版创建的数据文件夹。|Account cannot access this file. Check the account and use a folder created by this edition.|Ce compte ne peut pas accéder au fichier. Vérifiez le compte et utilisez un dossier de cette édition.|このアカウントはファイルにアクセスできません。アカウントとフォルダを確認してください。
Google Cloud 项目的 API 配额已用完，请检查配额或等待恢复后重试。|Google Cloud API quota exhausted. Check the quota or wait for it to reset.|Quota API Google Cloud épuisé. Vérifiez-le ou attendez son rétablissement.|Google Cloud の API 割り当てを使い切りました。確認するか、回復後に再試行してください。
此 Google 账号的 Drive 存储空间已满，请释放空间后重试。|Google Drive storage is full. Free space and retry.|Stockage Google Drive plein. Libérez de l’espace.|Google Drive の容量がいっぱいです。空きを作って再試行してください。
此 Google 账号的组织策略禁止应用访问 Drive，请联系组织管理员。|Your organization blocks Drive access. Contact its administrator.|Votre organisation bloque l’accès à Drive. Contactez l’administrateur.|組織のポリシーで Drive へのアクセスが禁止されています。管理者に連絡してください。
Google Drive 请求过于频繁，请稍后再试。|Too many Google Drive requests. Try again later.|Trop de requêtes Google Drive. Réessayez plus tard.|Google Drive へのリクエストが多すぎます。後で再試行してください。
Google Drive 请求失败。{0}|Google Drive request failed. {0}|Échec de la requête Google Drive. {0}|Google Drive のリクエストに失敗しました。{0}
Google 返回：{0}|Google response: {0}|Réponse Google : {0}|Google の応答：{0}
请重试；如仍失败，请提供此完整提示。|Retry; if it still fails, share this full message.|Réessayez ; en cas d’échec, fournissez ce message complet.|再試行し、失敗する場合はメッセージ全体をお知らせください。
此扩展尚未配置 Google 登录。请由开发者完成一次 OAuth 配置后重新加载；你的记录仍保存在浏览器中。|Google sign-in is not configured. Ask the developer to configure OAuth. Your records stay in the browser.|Connexion Google non configurée. Le développeur doit configurer OAuth. Vos fiches restent locales.|Google ログインが未設定です。開発者による OAuth 設定が必要です。記録はブラウザに保持しています。
未取得 Google 授权，请重新登录。|Google authorization unavailable. Sign in again.|Autorisation Google indisponible. Reconnectez-vous.|Google の認証を取得できません。再ログインしてください。
无法确认 Google 账号。|Cannot verify Google account.|Impossible de vérifier le compte Google.|Google アカウントを確認できません。
不允许的 Drive 请求地址。|Drive request URL not allowed.|Adresse Drive non autorisée.|許可されていない Drive リクエスト先です。
请先登录 Google Drive。|Sign in to Google Drive first.|Connectez-vous d’abord à Google Drive.|先に Google Drive にログインしてください。
文件夹 ID 无效。|Invalid folder ID.|Identifiant de dossier invalide.|フォルダの ID が無効です。
云端文件 ID 无效。|Invalid cloud file ID.|Identifiant de fichier cloud invalide.|クラウドのファイル ID が無効です。
请选择此简化版创建的个人数据文件夹。|Choose a personal folder created by this edition.|Choisissez un dossier personnel créé par cette édition.|このバージョンで作成した個人のフォルダを選択してください。
请输入 1–120 字的文件夹名称。|Enter a folder name of 1–120 characters.|Saisissez un nom de dossier de 1 à 120 caractères.|フォルダ名は 1〜120 文字で入力してください。
云端重复目录过多，请先检查数据文件夹。|Too many duplicate cloud folders. Check the data folder.|Trop de dossiers cloud en double. Vérifiez le dossier.|重複フォルダが多すぎます。データフォルダを確認してください。
云端文件位置或用途已变化，请重新预览整理。|Cloud file location or role changed. Preview again.|L’emplacement ou le rôle du fichier a changé. Prévisualisez à nouveau.|ファイルの場所や用途が変わりました。再度プレビューしてください。
云端记录正在修改，请稍后重试。|Cloud record is being edited. Retry shortly.|Fiche cloud en cours de modification. Réessayez.|クラウドの記録は更新中です。後で再試行してください。
缺少云端版本信息，不能覆盖记录。|Missing cloud version; cannot overwrite.|Version cloud manquante ; remplacement impossible.|クラウドのバージョン情報がないため上書きできません。
请登录此浏览器原先绑定的 Google 账号，或在新的 Chrome 配置中使用另一个账号。|Use the linked Google account, or another Chrome profile for a different account.|Utilisez le compte lié, ou un autre profil Chrome pour un autre compte.|紐付けた Google アカウントでログインしてください。別のアカウントには新しい Chrome プロファイルを使ってください。
此浏览器已选择数据文件夹。|This browser already has a data folder.|Ce navigateur a déjà un dossier de données.|このブラウザではデータフォルダを選択済みです。
不支持的 Google Drive 操作。|Unsupported Google Drive operation.|Opération Google Drive non prise en charge.|未対応の Google Drive 操作です。
另一个窗口正在操作 Google Drive，请稍后重试。|Another window is using Google Drive. Retry shortly.|Une autre fenêtre utilise Google Drive. Réessayez.|別のウィンドウで Google Drive を操作中です。後で再試行してください。
云端记录格式或 ID 不正确，未覆盖浏览器数据。|Invalid cloud record format or ID. Browser data kept.|Format ou identifiant cloud invalide. Données locales conservées.|クラウドの記録の形式または ID が無効です。ブラウザのデータを保持しました。
云端记录校验失败，未覆盖浏览器数据。|Cloud record validation failed. Browser data kept.|Vérification cloud échouée. Données locales conservées.|クラウドの記録の検証に失敗しました。ブラウザのデータを保持しました。
此浏览器已绑定另一个账号或文件夹。为避免资料混用，请在新的 Chrome 配置中连接另一份数据；现有资料可导出备份。|Another account or folder is linked. Use a new Chrome profile for other data; existing data can be exported.|Un autre compte ou dossier est lié. Utilisez un nouveau profil Chrome pour d’autres données ; les données actuelles sont exportables.|別のアカウントまたはフォルダに紐付いています。別のデータには新しい Chrome プロファイルを使ってください。既存の資料は書き出せます。
请先选择或新建 Google Drive 文件夹。|Choose or create a Google Drive folder first.|Choisissez ou créez d’abord un dossier Google Drive.|先に Google Drive のフォルダを選択または作成してください。
当前 Google 账号与此浏览器的数据文件夹不一致，请登录原账号。|Google account does not match the folder. Use the original account.|Le compte ne correspond pas au dossier. Utilisez le compte d’origine.|アカウントがフォルダと一致しません。元のアカウントでログインしてください。
数据文件夹已在其他窗口改变，请重新打开设置。|The data folder changed in another window. Reopen settings.|Le dossier de données a changé dans une autre fenêtre. Rouvrez les paramètres.|別のウィンドウでデータフォルダが変更されました。設定を開き直してください。
云端缺少附件“{0}”，下载未覆盖记录。|Cloud attachment “{0}” is missing. Records kept.|Pièce jointe cloud « {0} » absente. Fiches conservées.|クラウドに添付「{0}」がありません。記録は保持しました。
下载未应用，浏览器记录仍保留：{0} 请先处理相关记录或项目的冲突，再同步下载。|Download not applied; local records kept: {0} Resolve related conflicts, then download.|Téléchargement non appliqué, fiches conservées : {0} Résolvez les conflits puis téléchargez.|ダウンロードを適用せず記録を保持しました：{0} 関連する競合を解決してから同期してください。
附件“{0}”未完整保存在浏览器中，请先同步下载或导入完整 ZIP。|Attachment “{0}” incomplete locally. Download or import a full ZIP.|Pièce jointe « {0} » incomplète. Téléchargez ou importez un ZIP complet.|添付「{0}」が不完全です。同期ダウンロードまたは完全 ZIP の読み込みを行ってください。
同步方向无效。|Invalid sync direction.|Sens de synchronisation invalide.|同期の方向が無効です。
另一个窗口正在同步，请稍后重试。|Another window is syncing. Retry shortly.|Une autre fenêtre synchronise. Réessayez.|別のウィンドウで同期中です。後で再試行してください。
冲突已变化，请重新同步下载。|Conflict changed. Download again.|Le conflit a changé. Téléchargez à nouveau.|競合が変わりました。再度同期ダウンロードしてください。
浏览器记录已修改，请重新同步下载后选择版本。|Local record changed. Download before choosing a version.|La fiche locale a changé. Téléchargez avant de choisir une version.|記録が変更されています。再度ダウンロードしてからバージョンを選択してください。
`;
