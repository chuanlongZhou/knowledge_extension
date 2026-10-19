# GUGA Knowledge · Guide d’utilisation

## 1. Capturer et classer

Le panneau latéral permet de rédiger des notes, capturer la zone visible d’une page, gérer Todo / Idea et créer des groupes de pages. Sélectionnez du texte, puis utilisez le clic droit ou Alt + Shift + S. Les données sont enregistrées hors ligne dans ce navigateur. Collez des images avec Ctrl+V ou ajoutez des fichiers. L’audio nécessite l’autorisation du microphone. Attendez la fin de l’enregistrement des pièces jointes.

Glissez les étiquettes sur les fiches et les fiches dans les projets. Une fiche peut appartenir à plusieurs projets. Les projets ont une description, des sous-projets et un graphe de relations. Les noms, descriptions et couleurs des étiquettes sont synchronisés. Filtrez les fiches classées selon leur appartenance à un projet.

## 2. Accueil et tri

Lorsque l’extension est activée, GUGA devient la page des nouveaux onglets grâce à l’API URL Overrides de Chrome. Ouvrez un onglet avec + ou Ctrl+T. Paramètres et données → Accueil indique ce statut et règle le nombre de favoris.

L’accueil affiche les listes Todo et Idea complètes, chacune avec son propre défilement. Saisissez `---` pour ajouter un séparateur ; cliquez sur × au bout d’une ligne pour la supprimer. Ces listes partagent vos données existantes et se synchronisent normalement. Épinglez une fiche depuis l’organisateur ou son aperçu sur l’accueil pour la placer en priorité et l’afficher au-dessus des favoris ; vous pouvez la désépingler. L’accueil affiche aussi 5 / 8 / 10 pages favorites récentes, les groupes à lire et les projets. Cliquez sur un projet pour afficher ses fiches et sous-projets. Ouvrez une fiche pour la prévisualiser, puis utilisez Modifier la fiche. Cliquez hors d’une boîte de dialogue pour la fermer. Le Dock accepte jusqu’à 12 sites, modifiables, déplaçables et supprimables.

Triez par création, modification, étiquette, projet ou titre. Une modification conserve la position de la carte. Rouvrez la vue, rechargez ou relancez le tri pour appliquer les nouvelles valeurs. Changer le filtre ou le mode recalcule l’ordre. La liste et les fiches épinglées restent prioritaires.

## 3. Groupes de pages

Glissez le titre d’une page ou sa poignée ⠿ vers un autre groupe pour déplacer cette page en conservant son état de lecture. Le titre du groupe, l’espace vide et Groupe entier déplacent la fiche entière vers un projet ou une étiquette, ou fusionnent toutes ses pages dans un autre groupe. Les URL identiques sont réunies. Le texte et le classement d’origine sont conservés. Cliquez sur une poignée pour choisir la destination sans glisser.

## 4. Google Drive

Connectez votre propre compte Google. Créez un dossier pour commencer ; sur un nouvel appareil, choisissez le dossier existant créé par cette édition avec le même compte, puis téléchargez. Le bouton du dossier Google Drive permet de l’ouvrir.

Le téléchargement lit le cloud ; l’envoi transmet vos modifications locales. Aucun sens ne déclenche automatiquement l’autre. Chaque fiche et projet est un JSON ; les étiquettes utilisent tags.json et les pièces jointes sont séparées. Les fichiers inchangés utilisent un cache vérifié. Mettez tous les appareils à jour avant de classer les dossiers cloud. Choisissez une version en cas de conflit, téléchargez pour l’appliquer, puis envoyez si vous gardez la version locale.

Supprimer un fichier cloud ne supprime pas sa copie locale. Des pièces jointes ou références de projets manquantes peuvent bloquer le téléchargement. Restaurez-les depuis la corbeille Drive. La déconnexion conserve les fiches. Utilisez des profils Chrome distincts pour des comptes ou bibliothèques différents.

## 5. Sauvegardes et préférences

Avant de désinstaller, exportez un ZIP complet. Classez par projet, étiquette ou sans classement. Markdown reprend les noms d’origine, conserve la hiérarchie et les liens des pièces jointes. Les appartenances multiples créent des copies de lecture ; les données de restauration restent uniques. Restaurez le ZIP complet, pas du Markdown modifié ailleurs. Le JSON seul ne contient pas les fichiers joints. Un import reste local jusqu’à votre envoi.

Les paramètres proposent thèmes, polices, compagnons, autorisations et langue. Choisissez English, 中文, Français ou 日本語 puis Appliquer la langue. La page recharge après sauvegarde du brouillon du panneau ; actualisez les autres pages ouvertes. Les sites du Dock se synchronisent avec votre Google Drive lorsque vous lancez un envoi ou un téléchargement manuel ; ils figurent aussi dans la sauvegarde ZIP complète. Les modifications concurrentes du Dock sont soumises au choix de version. La langue, les thèmes et le nombre de favoris restent propres au navigateur. Vos contenus ne sont pas traduits. Les identifiants Google sont exclus des sauvegardes. Pour mettre à jour, conservez le même dossier et rechargez sans désinstaller.
